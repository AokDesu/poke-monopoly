import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { FixtureJevClient, requestHash } from './jev/fixture.ts';
import {
  DEFAULT_FIXTURES,
  formatReport,
  parseFixture,
  recordFixture,
  runOffline,
} from './jev/index.ts';
import { createFakeJevClient } from '../ai/jev/fake.ts';

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
const sample = async () =>
  parseFixture(
    JSON.parse(await readFile(join(DEFAULT_FIXTURES, 'synthetic-strategy.json'), 'utf8')),
    'sample',
  );
const write = async (data: unknown, dir = '') => {
  const path = join(dir || (await directory()), 'sample.json');
  await writeFile(path, JSON.stringify(data));
  return path;
};
const cli = (args: string[]) =>
  spawnSync(process.execPath, ['--import', 'tsx', 'eval/jev/cli.ts', ...args], {
    encoding: 'utf8',
  });

test('all three synthetic samples run without network and report confidence versus correctness', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('network forbidden');
    }),
  );
  const rows = await runOffline();
  expect(rows).toHaveLength(3);
  expect(rows.every((row) => row.synthetic && row.correct)).toBe(true);
  expect(formatReport(rows)).toContain('Accuracy: 3/3 (100.0%)');
  expect(formatReport(rows)).toContain('Confidence | Correct');
  expect(globalThis.fetch).not.toHaveBeenCalled();
  expect(cli(['--offline']).status).toBe(0);
});

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

test.each(['request', 'schema', 'illegal', 'json'])('CLI fails for %s corruption', async (kind) => {
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
  const result = cli(['--offline', '--fixtures', dir]);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain(
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
  expect(formatReport(await runOffline(dir))).toContain('Accuracy: 0/1 (0.0%)');
  expect(cli(['--offline', '--fixtures', dir]).status).toBe(0);
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
  const rows = await runOffline(dir);
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
  await recordFixture(input, output, () => fake);
  expect(await runOffline(join(output, '..'))).toHaveLength(1);
  expect(fake.requests).toEqual([scenario.request]);
  await expect(recordFixture(input, output, () => fake)).rejects.toThrow('EEXIST');
});

test('failed recording writes nothing; CI guard runs before constructing any client', async () => {
  vi.stubEnv('CI', undefined);
  const fixture = await sample();
  const { recorded, requestHash: hash, ...scenario } = fixture;
  expect(recorded.ok && hash.length).toBe(64);
  const input = await write(scenario);
  const output = join(await directory(), 'absent.json');
  await expect(
    recordFixture(input, output, () =>
      createFakeJevClient(() => ({ ok: false, fallbackReason: 'disabled' })),
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
  await expect(runOffline(dir)).rejects.toThrow('no fixtures');
  const fixture = await sample();
  await write(fixture, dir);
  await writeFile(join(dir, 'duplicate.json'), JSON.stringify(fixture));
  await expect(runOffline(dir)).rejects.toThrow('duplicate fixture id');
});

test('CLI rejects missing or contradictory modes', () => {
  expect(cli([]).status).toBe(1);
  expect(cli(['--offline', '--record']).stderr).toContain('exactly one mode');
  expect(
    execFileSync(process.execPath, ['--import', 'tsx', 'eval/jev/cli.ts', '--offline'], {
      encoding: 'utf8',
    }),
  ).toContain('Synthetic samples');
});
