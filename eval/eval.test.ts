import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { FixtureJevClient, requestHash } from './jev/fixture.ts';
import { formatReport, parseFixture, recordFixture, runOffline } from './jev/index.ts';
import { createFakeJevClient } from '../ai/jev/fake.ts';
import { SpendLedger, type UsageLine } from '../ai/jev/spend.ts';

const directories: string[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
const directory = async () => {
  const path = await mkdtemp(join(tmpdir(), 'jev-eval-'));
  directories.push(path);
  return path;
};
// A generic (non-scenario) harness sample; the offline command does not replay it.
const sample = async () =>
  parseFixture(
    JSON.parse(
      await readFile(join(import.meta.dirname, 'jev/samples/synthetic-strategy.json'), 'utf8'),
    ),
    'sample',
  );
const write = async (data: unknown, dir = '') => {
  const path = join(dir || (await directory()), 'sample.json');
  await writeFile(path, JSON.stringify(data));
  return path;
};
// Each CLI run starts tsx and loads the engine, which takes seconds on a loaded machine.
const CLI_TIMEOUT_MS = 30_000;
const cli = (args: string[]) =>
  spawnSync(process.execPath, ['--import', 'tsx', 'eval/jev/cli.ts', ...args], {
    encoding: 'utf8',
  });

test(
  'the scenario fixtures replay through the orchestrator without network and report confidence',
  async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        throw new Error('network forbidden');
      }),
    );
    const rows = await runOffline();
    expect(new Set(rows.map((row) => row.fixture)).size).toBe(20);
    expect(rows.every((row) => row.applied !== undefined)).toBe(true);
    const report = formatReport(rows);
    expect(report).toMatch(/^Accuracy: \d+\/28 \(\d+\.\d%\) against the acceptable sets$/m);
    expect(report).toMatch(/^Mean confidence: correct \S+ \(n=\d+\), incorrect \S+ \(n=\d+\)/m);
    expect(report).toContain('illegalAppliedActionCount 0');
    expect(report).toContain('Confidence | Correct');
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(cli(['--offline']).status).toBe(0);
  },
  CLI_TIMEOUT_MS,
);

test('fixture client replays the full response, ignores object key order, rejects changed requests', async () => {
  const fixture = await sample();
  const client = new FixtureJevClient(fixture);
  const options = { decisionSignal: new AbortController().signal };
  const request = { questions: fixture.request.questions, state: fixture.request.state };
  const result = await client.ask(request, options);
  expect(result).toEqual(fixture.recorded);
  if (result.ok) result.answers = {};
  expect(await client.ask(request, options)).toEqual(fixture.recorded);
  expect(await client.ask({ ...request, state: 'changed' }, options)).toMatchObject({
    ok: false,
    fallbackReason: 'schema_mismatch',
  });
  expect(client.error).toContain('request changed, re-record');
  expect(await client.ask(request, { decisionSignal: AbortSignal.abort() })).toMatchObject({
    ok: false,
    fallbackReason: 'timeout',
  });
});

test.each(['request', 'schema', 'illegal', 'json'])('run fails for %s corruption', async (kind) => {
  const fixture = await sample();
  if (kind === 'request')
    fixture.request.questions.strategy!.instructions = 'Changed question text.';
  if (kind === 'illegal')
    fixture.recorded.answers.strategy = {
      type: 'choice',
      choice: 'not-offered',
      confidence: 0.8,
      probabilities: { skip: 0.9, challenge: 0.1 },
    };
  const dir = await directory();
  const path = await write(kind === 'schema' ? { ...fixture, synthetic: 'yes' } : fixture, dir);
  if (kind === 'json') await writeFile(path, '{broken JSON');
  await expect(runOffline(dir, [])).rejects.toThrow(
    kind === 'request'
      ? 'request changed, re-record'
      : kind === 'illegal'
        ? 'illegal answer'
        : 'schema error',
  );
});

test('legal but unacceptable answers reduce accuracy without failing the run', async () => {
  const fixture = await sample();
  fixture.acceptable.strategy = ['challenge'];
  const dir = await directory();
  await write(fixture, dir);
  expect(formatReport(await runOffline(dir, []))).toContain('Accuracy: 0/1 (0.0%)');
});

test('validates acceptable sets, response types and probability labels', async () => {
  const fixture = await sample();
  expect(() =>
    parseFixture({ ...fixture, acceptable: { strategy: ['unknown'] } }, 'sample'),
  ).toThrow('schema error');
  fixture.recorded.answers.strategy = { type: 'noul', noul: 0.7 };
  expect(() => parseFixture(fixture, 'sample')).toThrow('illegal answer');
  fixture.recorded.answers.strategy = {
    type: 'choice',
    choice: 'skip',
    confidence: 0.8,
    probabilities: { unknown: 1 },
  };
  expect(() => parseFixture(fixture, 'sample')).toThrow('illegal answer');
});

test('supports score rubric IDs and Noul true/false IDs without inventing Noul confidence', async () => {
  const fixture = await sample();
  fixture.request.questions = {
    risk: { type: 'score', criteria: ['low', 'high'] },
    sell: { type: 'noul', instructions: 'Sell now?' },
  };
  fixture.recorded.answers = {
    risk: { type: 'score', score: 0.8, confidence: 0.6, probabilities: { 0: 0.2, 1: 0.8 } },
    sell: { type: 'noul', noul: 0.5 },
  };
  fixture.acceptable = { risk: ['1'], sell: ['true'] };
  fixture.requestHash = requestHash(fixture.request);
  const dir = await directory();
  await write(fixture, dir);
  const rows = await runOffline(dir, []);
  expect(rows.map((row) => [row.answer, row.confidence, row.correct])).toEqual([
    ['1', 0.6, true],
    ['true', undefined, true],
  ]);
});

test('fake recording writes a replayable fixture and refuses to overwrite files', async () => {
  vi.stubEnv('CI', undefined);
  const fixture = await sample();
  const { recorded, requestHash: hash, ...scenario } = fixture;
  expect(hash).toHaveLength(64);
  const input = await write(scenario);
  const output = join(await directory(), 'recorded.json');
  const fake = createFakeJevClient(() => ({ ...recorded, requestId: recorded.requestId }));
  const lines: UsageLine[] = [];
  const ledger = new SpendLedger({ append: (line) => lines.push(line) });
  await recordFixture(
    input,
    output,
    () => fake,
    () => ledger,
  );
  expect(await runOffline(join(output, '..'), [])).toHaveLength(1);
  expect(fake.requests).toEqual([scenario.request]);
  expect(lines).toMatchObject([{ status: 'ok', requestId: recorded.requestId ?? null }]);
  await expect(
    recordFixture(
      input,
      output,
      () => fake,
      () => ledger,
    ),
  ).rejects.toThrow('EEXIST');
  const spent = createFakeJevClient(() => ({ ...recorded, requestId: recorded.requestId }));
  const fresh = join(await directory(), 'never.json');
  await expect(
    recordFixture(
      input,
      fresh,
      () => spent,
      () => ({ record: () => {}, budgetExceeded: () => true }),
    ),
  ).rejects.toThrow('spend cap or daily budget');
  expect(spent.requests).toEqual([]);
  await expect(readFile(fresh)).rejects.toThrow('ENOENT');
});

test('failed recording writes nothing; CI guard runs before constructing any client', async () => {
  vi.stubEnv('CI', undefined);
  const fixture = await sample();
  const { recorded, requestHash: hash, ...scenario } = fixture;
  expect(recorded.ok && hash.length).toBe(64);
  const input = await write(scenario);
  const output = join(await directory(), 'absent.json');
  await expect(
    recordFixture(
      input,
      output,
      () => createFakeJevClient(() => ({ ok: false, fallbackReason: 'disabled' })),
      () => new SpendLedger(),
    ),
  ).rejects.toThrow('no fixture written');
  await expect(readFile(output)).rejects.toThrow('ENOENT');
  vi.stubEnv('CI', 'true');
  const createClient = vi.fn();
  await expect(recordFixture(input, output, createClient)).rejects.toThrow('CI is set');
  expect(createClient).not.toHaveBeenCalled();
});

test('empty and duplicate fixture directories fail clearly', async () => {
  const dir = await directory();
  await expect(runOffline(dir, [])).rejects.toThrow('no fixtures');
  const fixture = await sample();
  await write(fixture, dir);
  await writeFile(join(dir, 'duplicate.json'), JSON.stringify(fixture));
  await expect(runOffline(dir, [])).rejects.toThrow('duplicate fixture id');
});

test(
  'CLI rejects missing or contradictory modes',
  () => {
    expect(cli([]).status).toBe(1);
    expect(cli(['--offline', '--record']).stderr).toContain('exactly one mode');
    expect(cli(['--placeholders', '--input', 'x.json']).stderr).toContain('require --record');
  },
  CLI_TIMEOUT_MS,
);
