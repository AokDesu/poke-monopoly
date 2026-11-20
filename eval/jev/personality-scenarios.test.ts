import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { assertNoComparableNumbers, assertStateTokenBudget } from '../../ai/state/index.ts';
import { observe } from '../../engine/index.ts';
import { DEFAULT_FIXTURES, parseFixture, readJson } from './index.ts';
import { SYNTHETIC_REQUEST_PREFIX, validateFixture, type Fixture } from './fixture.ts';
import { scenarioRequest } from './replay.ts';
import { CONTRAST_KINDS, type EvalScenario } from './scenario-kit.ts';
import { PROMISE_SCENARIOS } from './promise-scenarios.ts';
import { GREEDY_SCENARIOS, SCENARIOS as ALL_SCENARIOS } from './scenarios.ts';

// Issue #233, spec §5.5, §8: 15 decision scenarios per personality with reasons from its file.

// The promise response scenarios have their own tests (promise-scenarios.test.ts).
const SCENARIOS = ALL_SCENARIOS.filter((scenario) => !PROMISE_SCENARIOS.includes(scenario));
const NEW = SCENARIOS.filter((scenario) => scenario.personality.id !== 'greedy');
const byPersonality = (id: string) =>
  SCENARIOS.filter((scenario) => scenario.personality.id === id);
const sameSets = (a: EvalScenario, b: Pick<EvalScenario, 'acceptable'>) =>
  JSON.stringify(a.acceptable) === JSON.stringify(b.acceptable);

const groupedNew = (): Map<string, EvalScenario[]> => {
  const result = new Map<string, EvalScenario[]>();
  for (const scenario of NEW) {
    const key = scenario.contrast!.group;
    result.set(key, [...(result.get(key) ?? []), scenario]);
  }
  return result;
};

const personalityFile = async (id: string) =>
  JSON.parse(
    await readFile(join(import.meta.dirname, '../../content/personalities', `${id}.json`), 'utf8'),
  ) as { weights: Record<string, number> };

test('spec §8: at least 60 scenarios and 15 per personality; the 20 Greedy ones are unchanged', () => {
  expect(SCENARIOS.length).toBeGreaterThanOrEqual(60);
  for (const id of ['greedy', 'aggressive', 'cautious', 'opportunist'])
    expect(byPersonality(id).length).toBeGreaterThanOrEqual(15);
  expect(byPersonality('greedy')).toHaveLength(20);
  expect(SCENARIOS.slice(0, 20)).toEqual(GREEDY_SCENARIOS);
  for (const id of ['aggressive', 'cautious', 'opportunist'])
    expect(byPersonality(id)).toHaveLength(15);
  expect(new Set(SCENARIOS.map((scenario) => scenario.id)).size).toBe(SCENARIOS.length);
});

test('each new personality covers 6 Strategy, 4 Encounter and 5 Sell decisions', async () => {
  const phases = async (scenarios: EvalScenario[]) => {
    const requests = await Promise.all(scenarios.map((scenario) => scenarioRequest(scenario)));
    return requests.map((request) => (request.state as { phase: string }).phase);
  };
  for (const id of ['aggressive', 'cautious', 'opportunist']) {
    const counts: Record<string, number> = {};
    for (const phase of await phases(byPersonality(id))) counts[phase] = (counts[phase] ?? 0) + 1;
    expect(counts).toEqual({ strategy: 6, encounter: 4, sell: 5 });
  }
});

test("every new scenario's reason cites weights, and each cited value matches the personality file", async () => {
  for (const scenario of NEW) {
    const { weights } = await personalityFile(scenario.personality.id);
    expect(scenario.reason, scenario.id).toBeTruthy();
    expect(scenario.reason!.startsWith(`${scenario.personality.name}: `), scenario.id).toBe(true);
    const cited = [
      ...scenario.reason!.matchAll(/\b(risk|aggression|liquidity|loyalty) (\d\.\d)\b/g),
    ];
    expect(cited.length, `${scenario.id} cites no weight`).toBeGreaterThan(0);
    for (const [, weight, value] of cited)
      expect(Number(value), `${scenario.id} ${weight}`).toBe(weights[weight!]);
  }
});

test('within a table state the requests differ only in the personality, and match a Greedy twin', async () => {
  const groups = groupedNew();
  expect(groups.size).toBe(15);
  for (const [group, members] of groups) {
    expect(members.map((m) => m.personality.id).sort(), group).toEqual([
      'aggressive',
      'cautious',
      'opportunist',
    ]);
    const twin = GREEDY_SCENARIOS.find((s) => s.id === members[0]!.contrast!.greedyTwin);
    const reference = members.map((member) => member.build().state);
    if (twin) reference.push(twin.build().state); // the Greedy scenario holds the same table
    expect(new Set(reference.map((state) => JSON.stringify(observe(state, 0)))).size, group).toBe(
      1,
    );
    const requests = await Promise.all(members.map((member) => scenarioRequest(member)));
    // The personality shortlist may drop options (spec §5.3), so compare the state, not the options.
    const strip = (request: Awaited<ReturnType<typeof scenarioRequest>>) => {
      const copy = structuredClone(request.state) as { you: { personality?: string } };
      delete copy.you.personality;
      return JSON.stringify(copy);
    };
    expect(new Set(requests.map(strip)).size, group).toBe(1);
    expect(new Set(requests.map((r) => JSON.stringify(r))).size, group).toBe(3);
  }
});

test('each of the four contrasts has a state where two personalities accept different answers', () => {
  const groups = groupedNew();
  for (const kind of CONTRAST_KINDS) {
    const differing = [...groups.values()].filter(
      (members) =>
        members[0]!.contrast!.kind === kind &&
        members.some((member) => !sameSets(member, members[0]!)),
    );
    expect(differing.length, kind).toBeGreaterThanOrEqual(1);
  }
  // Some states are controls where every personality agrees, so echoing the text earns nothing.
  expect(
    [...groups.values()].some((members) =>
      members.every((member) => sameSets(member, members[0]!)),
    ),
  ).toBe(true);
});

test('Greedy twins differ from a new personality on a hostile item, Ball choice and Sell contrast', () => {
  const twinOf = (scenario: EvalScenario) =>
    GREEDY_SCENARIOS.find((greedy) => greedy.id === scenario.contrast!.greedyTwin);
  for (const kind of ['hostile-item', 'sell-keep', 'ball-choice'] as const) {
    const differs = NEW.some((scenario) => {
      const twin = twinOf(scenario);
      return scenario.contrast!.kind === kind && twin && !sameSets(scenario, twin);
    });
    expect(differs, kind).toBe(true);
  }
});

test('every new request holds only engine facts: named buckets, no hidden information, within budget', async () => {
  // Two worlds that differ only in what no seat may see; seat 0's request must be identical.
  const world = (scenario: EvalScenario, tag: string): EvalScenario => ({
    ...scenario,
    build: () => {
      const { state } = scenario.build();
      for (const player of state.players.filter((entry) => entry.seatIndex !== 0)) {
        player.items.push({
          instanceId: 'hidden',
          itemId: 'potion',
          name: `SECRET_ITEM_${tag}`,
          visibility: 'secret',
        });
        player.privateResults = [{ kind: 'peek', eventId: `PRIVATE_PEEK_${tag}` }];
      }
      state.config.seed = `SEED_${tag}`;
      state.rng = { state: `RNG_${tag}`, cursor: tag === 'A' ? 987654321 : 123456789 };
      state.eventDeck = {
        drawPile: [`EVENT_ORDER_${tag}`, `ANOTHER_EVENT_${tag}`],
        discardPile: [`DISCARD_${tag}`],
      };
      return { state };
    },
  });
  for (const scenario of NEW) {
    const request = await scenarioRequest(scenario);
    assertNoComparableNumbers(request.state);
    assertStateTokenBudget(request.state);
    const a = await scenarioRequest(world(scenario, 'A'));
    const b = await scenarioRequest(world(scenario, 'B'));
    expect(a, scenario.id).toEqual(b);
    const text = JSON.stringify(a);
    for (const sentinel of [
      'SECRET_ITEM_',
      'PRIVATE_PEEK_',
      'SEED_',
      'RNG_',
      'EVENT_ORDER_',
      'ANOTHER_EVENT_',
      'DISCARD_',
      '987654321',
    ])
      expect(text, `${scenario.id} ${sentinel}`).not.toContain(sentinel);
  }
});

const fixtures = async (): Promise<Fixture[]> =>
  Promise.all(
    (await readdir(DEFAULT_FIXTURES))
      .filter((file) => file.endsWith('.json'))
      .map(async (file) => parseFixture(await readJson(join(DEFAULT_FIXTURES, file)), file)),
  );

test('every new fixture is a marked synthetic placeholder or a live recording, never both or neither', async () => {
  const saved = new Map((await fixtures()).map((fixture) => [fixture.id, fixture]));
  for (const scenario of NEW) {
    const fixture = saved.get(scenario.id);
    expect(fixture, scenario.id).toBeDefined();
    expect(fixture!.synthetic).toBe(
      fixture!.recorded.requestId?.startsWith(SYNTHETIC_REQUEST_PREFIX),
    );
    expect(fixture!.reason, scenario.id).toBe(scenario.reason);
    expect(fixture!.tags.personality).toBe(scenario.personality.name);
    if (fixture!.synthetic)
      expect(fixture!.recorded.usage, scenario.id).toEqual({ inputTokens: 0, outputTokens: 0 });
  }
  // A placeholder passed off as a recording, and a recording marked synthetic, both fail the load.
  const [base] = [...saved.values()];
  const placeholder = {
    ...base!,
    synthetic: true,
    recorded: { ...base!.recorded, requestId: `${SYNTHETIC_REQUEST_PREFIX}${base!.id}` },
  };
  expect(() => validateFixture(placeholder)).not.toThrow();
  expect(() => validateFixture({ ...placeholder, synthetic: false })).toThrow(
    'synthetic must be true',
  );
  expect(() =>
    validateFixture({
      ...placeholder,
      recorded: { ...placeholder.recorded, requestId: 'req_real' },
    }),
  ).toThrow('synthetic must be true');
});

test('the README lists every synthetic fixture a person still has to record', async () => {
  const readme = await readFile(join(import.meta.dirname, 'README.md'), 'utf8');
  expect(readme).toContain('npm run eval:jev -- --record');
  const synthetic = (await fixtures()).filter((fixture) => fixture.synthetic).map((f) => f.id);
  const section = /Fixtures still to record:([\s\S]*?)(?=\n## )/.exec(readme)?.[1];
  expect(section).toBeDefined();
  // Once none is synthetic the section says so; otherwise it names each one.
  if (synthetic.length === 0) expect(section).toContain('none');
  for (const id of synthetic) expect(section, id).toContain(id);
});
