import { cp, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import type { JevAnswer, JevResult } from '../ai/jev/client.ts';
import { createFakeJevClient } from '../ai/jev/fake.ts';
import { SpendLedger, type UsageLine } from '../ai/jev/spend.ts';
import { CONTENT } from '../ai/questions/content.ts';
import {
  DEFAULT_FIXTURES,
  parseFixture,
  readJson,
  recordScenarios,
  runOffline,
  writePlaceholders,
} from './jev/index.ts';
import { placeholderResult, runScenario, scenarioRequest } from './jev/replay.ts';
import { decideRequest, SCENARIOS } from './jev/scenarios.ts';

const directories: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
const directory = async () => {
  const path = await mkdtemp(join(tmpdir(), 'jev-scenarios-'));
  directories.push(path);
  return path;
};
const fixtures = async () =>
  Promise.all(
    (await readdir(DEFAULT_FIXTURES)).map(async (file) =>
      parseFixture(await readJson(join(DEFAULT_FIXTURES, file)), file),
    ),
  );

test('spec §10 C2: 8 Strategy, 6 Encounter and 6 Sell scenarios, each one committed fixture', async () => {
  const saved = await fixtures();
  const count = (point: string) => saved.filter((f) => f.tags.decisionPoint === point).length;
  expect([count('strategy'), count('encounter'), count('sell')]).toEqual([8, 6, 6]);
  expect(saved.map((f) => f.id).sort()).toEqual(SCENARIOS.map((s) => s.id).sort());
  for (const fixture of saved) {
    expect(fixture.recorded.requestId).toBeTruthy();
    expect(JSON.stringify(fixture)).not.toMatch(/api.?key|bearer|authorization/i);
  }
});

test('every scenario has its seat 0 to act and asks exactly one Jev request', async () => {
  for (const scenario of SCENARIOS) {
    const { state } = decideRequest(scenario);
    expect(state.activeSeatIndex).toBe(0);
    await expect(scenarioRequest(scenario)).resolves.toBeDefined();
  }
});

// Acceptance: a wording change fails the offline run and names every fixture to re-record.
test.each(['pickpocket', 'lucky-egg'])(
  'changing the %s Strategy criteria text fails naming the fixtures to re-record',
  async (itemId) => {
    const item = CONTENT.items.find((entry) => entry.id === itemId)!;
    if (item.kind !== 'utility') throw new TypeError('not a utility item');
    const holders = (await fixtures())
      .filter((f) => f.tags.decisionPoint === 'strategy')
      .filter((f) => JSON.stringify(f.request.questions).includes(item.effect))
      .map((f) => f.id)
      .sort();
    expect(holders.length).toBeGreaterThan(0);
    const effect = item.effect;
    item.effect = `${effect} (reworded)`;
    try {
      const error = await runOffline().then(
        () => undefined,
        (failure: unknown) => failure as Error,
      );
      expect(error?.message).toMatch(/^request changed, re-record: /);
      const named = error!.message.split(': ')[1]!.split('. ')[0]!.split(', ').sort();
      expect(named).toEqual(holders);
      expect(error!.message).toContain('npm run eval:jev -- --record');
    } finally {
      item.effect = effect;
    }
  },
);

/** The recorded answer with every Choice made illegal and every Noul turned into a Choice. */
function corrupted(result: JevResult): JevResult {
  if (!result.ok) return result;
  const answers: Record<string, JevAnswer> = {};
  for (const [name, answer] of Object.entries(result.answers)) {
    answers[name] =
      answer.type === 'choice'
        ? { ...answer, choice: 'not_offered', probabilities: { not_offered: 1 } }
        : { type: 'choice', choice: 'true', confidence: 1, probabilities: { true: 1 } };
  }
  return { ...result, answers };
}

test('illegalAppliedActionCount stays 0 when every recorded choice is corrupted to an illegal one', async () => {
  const byId = new Map((await fixtures()).map((f) => [f.id, f]));
  let illegalAppliedActionCount = 0;
  for (const scenario of SCENARIOS) {
    const recorded = byId.get(scenario.id)!.recorded;
    const run = await runScenario(
      scenario,
      createFakeJevClient(() => corrupted({ ...recorded, requestId: recorded.requestId })),
    );
    illegalAppliedActionCount += run.illegalApplied;
    expect(run.decision.source).toBe('fallback');
    expect(['invalid_choice', 'schema_mismatch']).toContain(run.decision.fallbackReason);
  }
  expect(illegalAppliedActionCount).toBe(0);
});

test('replay ignores the kill switch, because fixtures never reach the network', async () => {
  vi.stubEnv('JEV_ENABLED', 'false');
  const rows = await runOffline();
  expect(rows.some((row) => row.fallbackReason === 'disabled')).toBe(false);
  expect(process.env.JEV_ENABLED).toBe('false');
});

test('the recorder records placeholders and stale fixtures once, then keeps current recordings', async () => {
  vi.stubEnv('CI', undefined);
  const dir = await directory();
  const subset = SCENARIOS.filter((s) =>
    ['strategy-lucky-egg-only', 'sell-tired-eevee'].includes(s.id),
  );
  expect(await writePlaceholders(dir, subset)).toEqual(subset.map((s) => s.id));
  const fake = createFakeJevClient((request) => ({
    ...placeholderResult('live', request),
    requestId: 'req_live',
  }));
  const lines: UsageLine[] = [];
  const ledger = new SpendLedger({ append: (line) => lines.push(line) });
  expect(
    await recordScenarios(
      dir,
      () => fake,
      subset,
      () => ledger,
    ),
  ).toEqual({
    recorded: subset.map((s) => s.id),
    current: [],
  });
  expect(fake.requests).toHaveLength(2);
  await vi.waitFor(() => expect(lines.map((line) => line.status)).toEqual(['ok', 'ok']));
  const rows = await runOffline(dir, subset);
  expect(rows.every((row) => !row.synthetic)).toBe(true);
  // A current recording is neither recorded again nor replaced by a placeholder.
  expect(
    await recordScenarios(
      dir,
      () => fake,
      subset,
      () => ledger,
    ),
  ).toEqual({
    recorded: [],
    current: subset.map((s) => s.id),
  });
  expect(fake.requests).toHaveLength(2);
  expect(await writePlaceholders(dir, subset)).toEqual([]);
  const saved = await readFile(join(dir, 'sell-tired-eevee.json'), 'utf8');
  expect(JSON.parse(saved)).toMatchObject({
    synthetic: false,
    recorded: { requestId: 'req_live' },
  });
});

test('a failed live answer writes no fixture and the recorder refuses in CI before any client', async () => {
  vi.stubEnv('CI', undefined);
  const dir = await directory();
  const [scenario] = SCENARIOS;
  await expect(
    recordScenarios(
      dir,
      () => createFakeJevClient(() => ({ ok: false, fallbackReason: 'timeout' })),
      [scenario!],
      () => new SpendLedger(),
    ),
  ).rejects.toThrow(`Recording failed for ${scenario!.id} (timeout)`);
  expect(await readdir(dir)).toEqual([]);
  vi.stubEnv('CI', 'true');
  const createClient = vi.fn();
  await expect(recordScenarios(dir, createClient)).rejects.toThrow('CI is set');
  expect(createClient).not.toHaveBeenCalled();
});

test('the recorder sends nothing once the spend cap or daily budget is reached (spec §9)', async () => {
  vi.stubEnv('CI', undefined);
  const dir = await directory();
  const [scenario] = SCENARIOS;
  const fake = createFakeJevClient((request) => placeholderResult('live', request));
  await expect(
    recordScenarios(
      dir,
      () => fake,
      [scenario!],
      () => ({
        record: () => {},
        budgetExceeded: () => true,
      }),
    ),
  ).rejects.toThrow(`Recording failed for ${scenario!.id} (budget_exceeded)`);
  expect(fake.requests).toHaveLength(0);
  expect(await readdir(dir)).toEqual([]);
});

test('acceptable sets come from eval/jev/scenarios.ts; a fixture that drifts fails', async () => {
  const dir = await directory();
  const [scenario] = SCENARIOS;
  await cp(join(DEFAULT_FIXTURES, `${scenario!.id}.json`), join(dir, `${scenario!.id}.json`));
  await expect(runOffline(dir, [scenario!])).resolves.toBeDefined();
  const drifted = { ...scenario!, acceptable: ['skip'] };
  await expect(runOffline(dir, [drifted])).rejects.toThrow('acceptable set differs');
  expect(await writePlaceholders(dir, [drifted])).toEqual([scenario!.id]);
  await expect(runOffline(dir, [drifted])).resolves.toBeDefined();
});

test('a scenario without a fixture fails the offline run', async () => {
  const dir = await directory();
  const [first, second] = SCENARIOS;
  await cp(join(DEFAULT_FIXTURES, `${first!.id}.json`), join(dir, `${first!.id}.json`));
  await expect(runOffline(dir, [first!, second!])).rejects.toThrow(
    `no fixture for scenario: ${second!.id}`,
  );
});
