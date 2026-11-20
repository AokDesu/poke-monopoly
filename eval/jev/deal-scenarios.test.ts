import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, test, vi } from 'vitest';
import { FallbackPolicy } from '../../ai/fallback/index.ts';
import type { JevClient } from '../../ai/jev/client.ts';
import { assertNoComparableNumbers, assertStateTokenBudget } from '../../ai/state/index.ts';
import { legalActions, observe } from '../../engine/index.ts';
import { createPolicyRng } from '../../sim/policy.ts';
import { dealTable, owned, proposeDeal } from './deal-kit.ts';
import { DEAL_KIND, DEAL_SCENARIOS, OVER_BUDGET_SCENARIOS } from './deal-scenarios.ts';
import { DEFAULT_FIXTURES, parseFixture, readJson, runOffline } from './index.ts';
import { SYNTHETIC_REQUEST_PREFIX } from './fixture.ts';
import { runScenario, scenarioRequest } from './replay.ts';
import { decideRequest, type EvalScenario } from './scenarios.ts';

// Issue #164 D3, spec §5.3, §5.5, §8: Deal Card decision scenarios, replayed offline with no key.

const PERSONALITIES = ['greedy', 'aggressive', 'cautious', 'opportunist'] as const;
const weightsOf = async (id: string) =>
  (
    JSON.parse(
      await readFile(
        join(import.meta.dirname, '../../content/personalities', `${id}.json`),
        'utf8',
      ),
    ) as { weights: Record<string, number> }
  ).weights;

test('at least 8 scenarios, each of the five kinds for every personality, plus over budget', () => {
  expect(DEAL_SCENARIOS.length).toBeGreaterThanOrEqual(8);
  expect(new Set([...DEAL_SCENARIOS, ...OVER_BUDGET_SCENARIOS].map((s) => s.id)).size).toBe(
    DEAL_SCENARIOS.length + OVER_BUDGET_SCENARIOS.length,
  );
  for (const id of PERSONALITIES) {
    const mine = DEAL_SCENARIOS.filter((s) => s.personality.id === id);
    expect(new Set(mine.map((s) => DEAL_KIND.get(s.id)))).toEqual(
      new Set(['fair', 'lopsided', 'counter', 'low-trust', 'reject']),
    );
    expect(OVER_BUDGET_SCENARIOS.filter((s) => s.personality.id === id).length).toBeGreaterThan(0);
  }
  // Accept, reject and counter are each an acceptable answer somewhere (spec's within-budget cases).
  const answers = new Set(DEAL_SCENARIOS.flatMap((s) => s.acceptable as string[]));
  expect(answers.has('respond-deal:accept')).toBe(true);
  expect(answers.has('respond-deal:reject')).toBe(true);
  expect([...answers].some((id) => id.startsWith('counter-deal:'))).toBe(true);
});

test("every scenario's reason cites weights, and each cited value matches the personality file", async () => {
  for (const scenario of DEAL_SCENARIOS) {
    const weights = await weightsOf(scenario.personality.id);
    expect(scenario.reason!.startsWith(`${scenario.personality.name}: `), scenario.id).toBe(true);
    const cited = [
      ...scenario.reason!.matchAll(/\b(risk|aggression|liquidity|loyalty) (\d\.\d)\b/g),
    ];
    expect(cited.length, `${scenario.id} cites no weight`).toBeGreaterThan(0);
    for (const [, weight, value] of cited)
      expect(Number(value), `${scenario.id} ${weight}`).toBe(weights[weight!]);
  }
});

test('the acceptable answers are among the options the question offers (checked by the recording path)', async () => {
  for (const scenario of DEAL_SCENARIOS) {
    const run = await runScenario(scenario, {
      ask: async () => ({ ok: false, fallbackReason: 'network' }),
    });
    expect(run.acceptable.deal!.length, scenario.id).toBe((scenario.acceptable as string[]).length);
    expect(run.decisionPoint).toBe('deal_response');
  }
});

test('the question asked for each scenario is within budget; the over-budget ones are not asked', async () => {
  for (const scenario of DEAL_SCENARIOS) {
    const ids = legalActions(scenario.build().state, 1).enabled.map((a) => a.id);
    expect(ids, scenario.id).toContain('respond-deal:accept');
  }
  for (const scenario of OVER_BUDGET_SCENARIOS) {
    const ids = legalActions(scenario.build().state, 1).enabled.map((a) => a.id);
    expect(ids, scenario.id).not.toContain('respond-deal:accept');
  }
});

describe('over budget replays through the orchestrator without a request', () => {
  test.each(OVER_BUDGET_SCENARIOS.map((s) => [s.id, s] as const))('%s', async (_id, scenario) => {
    const ask = vi.fn(async () => {
      throw new Error('Jev must not be asked over budget');
    });
    const run = await runScenario(scenario, { ask } as JevClient);
    expect(ask).not.toHaveBeenCalled();
    expect(run.requests).toHaveLength(0);
    expect(run.decision).toMatchObject({
      choice: 'respond-deal:reject',
      requests: 0,
      source: 'auto',
    });
    expect(run.illegalApplied).toBe(0);
  });
});

test("the fallback policy's own answer is acceptable in every scenario (a cross-check, not the source)", () => {
  for (const scenario of DEAL_SCENARIOS) {
    const { state } = scenario.build();
    const choice = new FallbackPolicy(scenario.personality).decide(
      observe(state, 1),
      legalActions(state, 1),
      createPolicyRng(scenario.id),
    );
    expect(scenario.acceptable as string[], `${scenario.id}: ${String(choice)}`).toContain(choice);
  }
});

test('each request holds only engine facts: buckets, no number, no hidden information', async () => {
  const world = (scenario: EvalScenario, tag: string): EvalScenario => ({
    ...scenario,
    build: () => {
      const { state } = scenario.build();
      state.players[0]!.items.push({
        instanceId: 'hidden',
        itemId: 'potion',
        name: `SECRET_ITEM_${tag}`,
        visibility: 'secret',
      });
      state.players[0]!.privateResults = [{ kind: 'peek', eventId: `PRIVATE_PEEK_${tag}` }];
      state.config.seed = `SEED_${tag}`;
      state.rng = { state: `RNG_${tag}`, cursor: tag === 'A' ? 987654321 : 123456789 };
      state.eventDeck = { drawPile: [`EVENT_ORDER_${tag}`], discardPile: [`DISCARD_${tag}`] };
      return { state };
    },
  });
  for (const scenario of DEAL_SCENARIOS) {
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
      'DISCARD_',
      '987654321',
    ])
      expect(text, `${scenario.id} ${sentinel}`).not.toContain(sentinel);
  }
});

test('within a table state the requests differ only in the personality; trust and the deal change the rest', async () => {
  const byGroup = new Map<string, EvalScenario[]>();
  for (const scenario of DEAL_SCENARIOS) {
    const group = scenario.id.slice(scenario.personality.id.length + 1);
    byGroup.set(group, [...(byGroup.get(group) ?? []), scenario]);
  }
  expect(byGroup.size).toBe(5);
  const strip = (request: Awaited<ReturnType<typeof scenarioRequest>>) => {
    const copy = structuredClone(request.state) as { you: { personality?: string } };
    delete copy.you.personality;
    return JSON.stringify(copy);
  };
  const states = new Set<string>();
  for (const [group, members] of byGroup) {
    expect(members).toHaveLength(4);
    const requests = await Promise.all(members.map((m) => scenarioRequest(m)));
    expect(new Set(requests.map(strip)).size, group).toBe(1);
    expect(new Set(requests.map((r) => JSON.stringify(r))).size, group).toBe(4);
    states.add(strip(requests[0]!));
  }
  expect(states.size).toBe(5);
});

test('a contrast: Cautious accepts the fair deal at neutral trust and refuses it when distrusting', () => {
  const find = (suffix: string) =>
    DEAL_SCENARIOS.find((s) => s.id === `cautious-${suffix}`)!.acceptable as string[];
  expect(find('deal-fair-eevee-sale')).toContain('respond-deal:accept');
  expect(find('deal-low-trust-eevee-sale')).toEqual(['respond-deal:reject']);
  const opportunist = (suffix: string) =>
    DEAL_SCENARIOS.find((s) => s.id === `opportunist-${suffix}`)!.acceptable as string[];
  expect(opportunist('deal-low-trust-eevee-sale')).toContain('respond-deal:accept');
});

describe('fixtures', () => {
  const dealFixtures = async () =>
    Promise.all(
      (await readdir(DEFAULT_FIXTURES))
        .filter((file) => file.includes('-deal-') && file.endsWith('.json'))
        .map(async (file) => parseFixture(await readJson(join(DEFAULT_FIXTURES, file)), file)),
    );

  test('every deal scenario has a fixture: a marked synthetic placeholder or a live recording', async () => {
    const saved = new Map((await dealFixtures()).map((fixture) => [fixture.id, fixture]));
    expect(saved.size).toBe(DEAL_SCENARIOS.length);
    for (const scenario of DEAL_SCENARIOS) {
      const fixture = saved.get(scenario.id);
      expect(fixture, scenario.id).toBeDefined();
      expect(fixture!.synthetic).toBe(
        fixture!.recorded.requestId?.startsWith(SYNTHETIC_REQUEST_PREFIX),
      );
      expect(fixture!.reason).toBe(scenario.reason);
      expect(fixture!.tags).toEqual({
        decisionPoint: 'deal_response',
        personality: scenario.personality.name,
      });
      if (fixture!.synthetic)
        expect(fixture!.recorded.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
    }
    // No over-budget scenario has a fixture: no request is made, so there is nothing to record.
    for (const scenario of OVER_BUDGET_SCENARIOS) expect(saved.has(scenario.id)).toBe(false);
  });

  test('the README lists every synthetic deal fixture a person still has to record', async () => {
    const readme = await readFile(join(import.meta.dirname, 'README.md'), 'utf8');
    const section = /Fixtures still to record:([\s\S]*?)(?=\n## )/.exec(readme)?.[1];
    expect(section).toBeDefined();
    for (const fixture of (await dealFixtures()).filter((entry) => entry.synthetic))
      expect(section, fixture.id).toContain(fixture.id);
  });

  test('the offline run replays every deal fixture through the orchestrator with no key', async () => {
    const rows = await runOffline();
    const deal = rows.filter((row) => row.fixture.includes('-deal-'));
    expect(new Set(deal.map((row) => row.fixture)).size).toBe(DEAL_SCENARIOS.length);
    for (const row of deal) {
      expect(row.question).toBe('deal');
      expect(row.synthetic).toBe(true);
      expect(row.applied).toMatch(/^(respond-deal:(accept|reject)|counter-deal:coins-\d+)$/);
    }
  });
});

test('every answer applied by a replay is legal, whatever the fixture says', async () => {
  for (const scenario of DEAL_SCENARIOS) {
    const run = await runScenario(scenario, {
      ask: async () => ({ ok: false, fallbackReason: 'timeout' }),
    });
    expect(run.illegalApplied, scenario.id).toBe(0);
    expect(run.decision.source).toBe('fallback');
  }
});

test('the deal state used by the table builders is the engine path, not a hand-set pending record', () => {
  const state = proposeDeal(
    dealTable({ seed: 1, coins: [10, 20], humanTeam: [owned(0, 1, 'eevee')] }),
    {
      sells: { pokemon: 'caught:0:1' },
      coins: 7,
    },
  );
  expect(state.pendingResponse).toMatchObject({ kind: 'deal', stage: 'proposed' });
  expect(
    decideRequest({
      id: 'x',
      description: 'x',
      personality: DEAL_SCENARIOS[0]!.personality,
      seat: 1,
      build: () => ({ state }),
      acceptable: [],
    }).request.decisionPoint,
  ).toBe('deal_response');
});
