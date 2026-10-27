import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { choice } from '@typesafe-ai/sdk';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { parsePersonality, type Personality } from '../content/personality-schema.ts';
import { toEngineContent } from '../content/schema.ts';
import {
  createGame,
  createGameConfig,
  fixtureSchema,
  legalActions,
  observe,
  type GameState,
  type LegalActions,
  type Observation,
} from '../engine/index.ts';
import encounterFixture from '../engine/fixtures/encounter-with-balls.json';
import sellFixture from '../engine/fixtures/sell-phase-three-pokemon.json';
import strategyFixture from '../engine/fixtures/strategy-with-items.json';
import { realEngine } from '../sim/engine.ts';
import { createPolicyRng, POLICIES } from '../sim/policy.ts';
import { DEFAULT_OPTIONS, runSim } from '../sim/runner.ts';
import { FallbackPolicy, PERSONALITIES } from './fallback/index.ts';
import { JevPolicy } from './jev-policy.ts';
import {
  createSdkJevClient,
  PINNED_JEV_MODEL,
  type JevAnswer,
  type JevClient,
  type JevRequest,
  type JevResult,
} from './jev/client.ts';
import { createChaosJevClient, createFakeJevClient } from './jev/fake.ts';
import { openUsageLedger, SPEND_CONFIG, SpendLedger, type UsageLine } from './jev/spend.ts';
import {
  confidenceFloor,
  decisionRates,
  DecisionStats,
  Orchestrator,
  ORCHESTRATOR_CONFIG,
  type DecideRequest,
  type OrchestratorDecision,
} from './orchestrator.ts';
import { CONTENT } from './questions/content.ts';
import type { SellFacts } from './questions/index.ts';

// Offline only: fake clients, or the real wrapper with a placeholder key and a fake fetch.
const PLACEHOLDER_KEY = 'placeholder-key-not-real-45';
const greedy = PERSONALITIES.greedy;
const ENCOUNTER_ODDS = {
  odds: [
    { ballType: 'poke' as const, successFaces: 3 },
    { ballType: 'great' as const, successFaces: 4 },
  ],
};
const ENCOUNTER_POLICY_FACTS = { catchChance: { poke: 0.5, great: 0.67 } };

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

function seat0(fixture: unknown): { observation: Observation; legalActions: LegalActions } {
  const parsed = fixtureSchema.parse(fixture);
  return { observation: parsed.observation['0']!, legalActions: parsed.legalActions['0']! };
}

const encounter = seat0(encounterFixture);
const strategy = seat0(strategyFixture);
const sell = seat0(sellFixture);

function encounterRequest(overrides: Partial<DecideRequest> = {}): DecideRequest {
  return {
    turnKey: 't1',
    ...encounter,
    facts: { encounter: ENCOUNTER_ODDS, policy: ENCOUNTER_POLICY_FACTS },
    difficulty: 'normal',
    personality: greedy,
    rng: createPolicyRng(1),
    ...overrides,
  };
}

/** A successful result answering each Choice from `probabilities` (by label) and each Noul. */
function answered(
  request: JevRequest,
  probabilities: (labels: string[]) => Record<string, number>,
  extra: { choice?: string; confidence?: number; noul?: number; inputTokens?: number } = {},
): JevResult {
  const answers: Record<string, JevAnswer> = {};
  for (const [name, question] of Object.entries(request.questions)) {
    if (question.type === 'noul') {
      answers[name] = { type: 'noul', noul: extra.noul ?? 0.9 };
      continue;
    }
    const labels = Object.keys(question.criteria);
    const shares = probabilities(labels);
    const peak = Math.max(...Object.values(shares));
    const n = labels.length;
    answers[name] = {
      type: 'choice',
      choice: extra.choice ?? labels.find((label) => shares[label] === peak)!,
      confidence: extra.confidence ?? (n * peak - 1) / (n - 1),
      probabilities: shares,
    };
  }
  return {
    ok: true,
    answers,
    requestId: 'req_fake_1',
    model: PINNED_JEV_MODEL,
    latencyMs: 5,
    usage: { inputTokens: extra.inputTokens ?? 100, outputTokens: 0 },
  };
}

/** Jev confidently picks `release`, which the fallback policy never picks here. */
const confidentRelease = (request: JevRequest) =>
  answered(request, () => ({ poke_ball: 0.05, great_ball: 0.05, release: 0.9 }));

const fallbackChoice = (request: DecideRequest) =>
  new FallbackPolicy(request.personality).decide(
    request.observation,
    request.legalActions,
    createPolicyRng(1),
    request.facts.policy,
  );

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'x-typesafe-request-id': 'req_sdk_1' },
  });

/** The real wrapper over a fake `fetch`, so HTTP failures take the production path. */
const sdkClient = (respond: () => Response | Promise<Response>): JevClient =>
  createSdkJevClient({ apiKey: PLACEHOLDER_KEY, fetch: async () => respond() });

describe('unusable answers fall back with their reason (§3.1, §5.6, §9)', () => {
  test('the fallback policy never applies Jev’s choice here', () => {
    expect(fallbackChoice(encounterRequest())).not.toBe('release');
  });

  test.each([
    ['429', () => json({ error: 'slow down' }, 429), 'rate_limited'],
    ['500', () => json({ error: 'boom' }, 500), 'server_error'],
    ['a malformed body', () => new Response('not json', { status: 200 }), 'schema_mismatch'],
  ] as const)('%s', async (_name, respond, reason) => {
    const orchestrator = new Orchestrator({ client: sdkClient(respond) });
    const decision = await orchestrator.decide(encounterRequest());
    expect(decision).toMatchObject({ source: 'fallback', fallbackReason: reason, requests: 1 });
    expect(decision.choice).toBe(fallbackChoice(encounterRequest()));
    expect(decision.events).toHaveLength(1);
    expect(decision.events[0]).toMatchObject({ fallbackReason: reason, probabilities: null });
  });

  test('a request timeout', async () => {
    vi.useFakeTimers();
    const client = sdkClient(() => new Promise<Response>(() => {}));
    const pending = new Orchestrator({ client }).decide(encounterRequest());
    await vi.advanceTimersByTimeAsync(1000);
    const decision = await pending;
    expect(decision).toMatchObject({ source: 'fallback', fallbackReason: 'timeout' });
    expect(decision.choice).toBe(fallbackChoice(encounterRequest()));
  });

  test('a choice that is not among the options', async () => {
    const client = createFakeJevClient((request) =>
      answered(request, () => ({ poke_ball: 0.1, great_ball: 0.1, release: 0.8 }), {
        choice: 'ultra_ball',
      }),
    );
    const decision = await new Orchestrator({ client }).decide(encounterRequest());
    expect(decision).toMatchObject({ source: 'fallback', fallbackReason: 'invalid_choice' });
    expect(decision.choice).toBe(fallbackChoice(encounterRequest()));
    expect(decision.events[0]).toMatchObject({ requestId: 'req_fake_1', model: PINNED_JEV_MODEL });
  });

  test('a response for an older stateRevision', async () => {
    const client = createFakeJevClient(confidentRelease);
    const request = encounterRequest({ currentRevision: () => 1 });
    const decision = await new Orchestrator({ client }).decide(request);
    expect(decision).toMatchObject({ source: 'fallback', fallbackReason: 'revision_mismatch' });
    expect(decision.choice).toBe(fallbackChoice(request));
  });

  test('JEV_ENABLED=false sends no request', async () => {
    vi.stubEnv('JEV_ENABLED', 'false');
    const client = createFakeJevClient(confidentRelease);
    const decision = await new Orchestrator({ client }).decide(encounterRequest());
    expect(decision).toMatchObject({ source: 'fallback', fallbackReason: 'disabled', requests: 0 });
    expect(client.requests).toHaveLength(0);
  });

  test('past the per-game token budget every later decision falls back', async () => {
    const client = createFakeJevClient((request) =>
      answered(request, () => ({ poke_ball: 0.05, great_ball: 0.05, release: 0.9 }), {
        inputTokens: 400_000,
      }),
    );
    const orchestrator = new Orchestrator({ client });
    const turns = ['t1', 't2', 't3'].map((turnKey) => encounterRequest({ turnKey }));
    const decisions = [];
    for (const request of turns) decisions.push(await orchestrator.decide(request));
    expect(decisions.map((decision) => decision.fallbackReason)).toEqual([
      null,
      null,
      'token_budget',
    ]);
    expect(orchestrator.usage.totals().inputTokens).toBe(800_000);
    expect(client.requests).toHaveLength(2);
    expect(decisions[2]!.choice).toBe(fallbackChoice(turns[2]!));
  });

  test('an answer of the wrong type is a schema mismatch', async () => {
    const client = createFakeJevClient((request) => ({
      ...(answered(request, () => ({})) as Extract<JevResult, { ok: true }>),
      answers: { encounter: { type: 'noul', noul: 1 } },
    }));
    const decision = await new Orchestrator({ client }).decide(encounterRequest());
    expect(decision).toMatchObject({ source: 'fallback', fallbackReason: 'schema_mismatch' });
  });
});

describe('the 1,500 ms decision deadline (§5.6)', () => {
  test('a valid answer arriving after the deadline is discarded', async () => {
    vi.useFakeTimers();
    const client = createFakeJevClient(async (request) => {
      await new Promise((resolve) => setTimeout(resolve, 1600));
      return confidentRelease(request);
    });
    const pending = new Orchestrator({ client }).decide(encounterRequest());
    await vi.advanceTimersByTimeAsync(1600);
    const decision = await pending;
    expect(decision).toMatchObject({ source: 'fallback', fallbackReason: 'timeout' });
    expect(decision.choice).not.toBe('release');
  });

  test('even from a client that ignores it, and the decision returns at the deadline', async () => {
    vi.useFakeTimers();
    const client: JevClient = {
      ask: async (request) => {
        await new Promise((resolve) => setTimeout(resolve, 1600));
        return confidentRelease(request);
      },
    };
    const pending = new Orchestrator({ client }).decide(encounterRequest());
    await vi.advanceTimersByTimeAsync(1499);
    let settled = false;
    void pending.then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toBe(true);
    expect(await pending).toMatchObject({ source: 'fallback', fallbackReason: 'timeout' });
  });

  test('an answer inside the deadline is applied', async () => {
    const client = createFakeJevClient(confidentRelease);
    const decision = await new Orchestrator({ client }).decide(encounterRequest());
    expect(decision).toMatchObject({ choice: 'release', source: 'jev', fallbackReason: null });
  });
});

describe('Easy and Normal (§5.6)', () => {
  const SHARES = { poke_ball: 0.2, great_ball: 0.5, release: 0.3 };
  const ACTIONS = { 'catch:poke': 0.2, 'catch:great': 0.5, release: 0.3 };

  const easyRun = async (seed: number, decisions: number) => {
    const client = createFakeJevClient((request) => answered(request, () => SHARES));
    const orchestrator = new Orchestrator({ client });
    const rng = createPolicyRng(seed);
    const results: OrchestratorDecision[] = [];
    for (let i = 0; i < decisions; i++) {
      results.push(
        await orchestrator.decide(encounterRequest({ turnKey: `t${i}`, difficulty: 'easy', rng })),
      );
    }
    return results;
  };

  test('Easy samples Jev’s probabilities within 3 points over 2,000 seeded decisions', async () => {
    const results = await easyRun(45, 2000);
    expect(results.every((result) => result.source === 'jev')).toBe(true);
    for (const [actionId, share] of Object.entries(ACTIONS)) {
      const picked = results.filter((result) => result.choice === actionId).length / 2000;
      expect(Math.abs(picked - share)).toBeLessThan(0.03);
    }
    // The draw is logged, so the sample can be checked from the log.
    for (const result of results.slice(0, 20)) {
      expect(result.events[0]!.sampled).toEqual(expect.any(Number));
      expect(result.events[0]!.probabilities).toEqual(ACTIONS);
    }
  });

  test('Easy is reproducible from the seed', async () => {
    const choices = async (seed: number) =>
      (await easyRun(seed, 200)).map((result) => result.choice);
    expect(await choices(7)).toEqual(await choices(7));
    expect(await choices(7)).not.toEqual(await choices(8));
  });

  test('Normal always returns the highest-probability option', async () => {
    const rng = createPolicyRng(3);
    const labels = ['poke_ball', 'great_ball', 'release'];
    for (let i = 0; i < 50; i++) {
      const weights = labels.map(() => 1 + rng.int(100));
      const total = weights.reduce((sum, weight) => sum + weight, 0);
      const shares = Object.fromEntries(labels.map((label, k) => [label, weights[k]! / total]));
      const best = labels.reduce((top, label) => (shares[label]! > shares[top]! ? label : top));
      // Jev's own `choice` field and confidence do not override the argmax.
      const client = createFakeJevClient((request) =>
        answered(request, () => shares, { choice: 'poke_ball', confidence: 0.99 }),
      );
      const decision = await new Orchestrator({ client }).decide(encounterRequest());
      const expected = { poke_ball: 'catch:poke', great_ball: 'catch:great', release: 'release' };
      expect(decision.choice).toBe(expected[best as keyof typeof expected]);
      expect(decision.source).toBe('jev');
    }
  });
});

/** A four-seat Strategy where seat 0 holds two Pickpockets and two Repels: 13 legal actions. */
function twelveOptionStrategy(): Pick<DecideRequest, 'observation' | 'legalActions'> {
  const state: GameState = createGame(
    createGameConfig({
      seats: [
        { classId: 'main-character', starterSpeciesId: 'charmander' },
        { classId: 'rival' },
        { classId: 'nurse-joy' },
        { classId: 'researcher' },
      ].map((seat, seatIndex) => ({
        ...seat,
        actorId: `P${seatIndex + 1}`,
        seatIndex,
        controller: 'ai' as const,
      })),
      seed: 7,
      lapTarget: 3,
    }),
    toEngineContent(CONTENT),
  );
  state.phase = { kind: 'strategy' };
  state.globalTurnNo = 1;
  state.players[0]!.ownTurnNo = 1;
  state.turnBudgets = { tacticalAction: 1, catchAttempt: 1, pokemonAbility: 1 };
  for (const itemId of ['pickpocket', 'pickpocket', 'repel', 'repel']) {
    const player = state.players[0]!;
    player.items.push({
      instanceId: `bought:0:${player.items.length}`,
      itemId,
      name: CONTENT.items.find((item) => item.id === itemId)!.name,
      visibility: 'secret',
    });
  }
  return { observation: observe(state, 0), legalActions: legalActions(state, 0) };
}

describe('confidence floor by question type and option count (§5.6)', () => {
  // Loyalty 0 keeps every hostile item use on the shortlist, which then holds 12 options.
  const reckless: Personality = parsePersonality('reckless', {
    name: 'Reckless',
    description: 'Uses every item on anyone.',
    weights: { ...greedy.weights, loyalty: 0 },
    lineStyle: 'mercenary',
  });

  test('the default curve: 0.6 up to 4 options, falling to 0.5 at 12', () => {
    expect(confidenceFloor('strategy', 2)).toBe(0.6);
    expect(confidenceFloor('strategy', 4)).toBe(0.6);
    expect(confidenceFloor('strategy', 8)).toBeCloseTo(0.55);
    expect(confidenceFloor('strategy', 12)).toBe(0.5);
    expect(confidenceFloor('encounter', 3)).toBe(0.6);
    expect(ORCHESTRATOR_CONFIG.confidenceFloor.strategy).toEqual({
      few: 0.6,
      fewMax: 4,
      many: 0.5,
      manyFrom: 12,
    });
  });

  test('a 12-option Choice with a 0.6 peak (confidence ≈0.56) is applied', async () => {
    const twelve = twelveOptionStrategy();
    const client = createFakeJevClient((request) =>
      answered(request, (labels) =>
        Object.fromEntries(labels.map((label) => [label, label === 'a2' ? 0.6 : 0.4 / 11])),
      ),
    );
    const decision = await new Orchestrator({ client }).decide({
      ...encounterRequest(),
      ...twelve,
      facts: {},
      personality: reckless,
    });
    const asked = client.requests[0]!.questions.strategy!;
    expect(asked.type === 'choice' && Object.keys(asked.criteria)).toHaveLength(12);
    expect(decision.events[0]!.confidence).toBeCloseTo(0.5636, 4);
    expect(decision).toMatchObject({ source: 'jev', fallbackReason: null });
  });

  test('a 2-option Choice with a 0.55 peak goes to the top-two fallback', async () => {
    const client = createFakeJevClient((request) =>
      answered(request, () => ({ a1: 0.55, skip: 0.45 })),
    );
    const decision = await new Orchestrator({ client }).decide({
      ...encounterRequest(),
      ...strategy,
      facts: {},
    });
    expect(decision.events[0]!.confidence).toBeCloseTo(0.1);
    expect(decision).toMatchObject({ source: 'fallback', fallbackReason: 'low_confidence' });
    expect(['use-item:item-0', 'skip']).toContain(decision.choice);
  });

  test('Easy has no floor', async () => {
    const client = createFakeJevClient((request) =>
      answered(request, () => ({ a1: 0.55, skip: 0.45 })),
    );
    const decision = await new Orchestrator({ client }).decide({
      ...encounterRequest({ difficulty: 'easy' }),
      ...strategy,
      facts: {},
    });
    expect(decision).toMatchObject({ source: 'jev', fallbackReason: null });
  });
});

describe('request budget per AI turn (§5.3, §9)', () => {
  test('at most 3 requests in one AI turn; the 4th decision falls back', async () => {
    const client = createFakeJevClient(confidentRelease);
    const orchestrator = new Orchestrator({ client });
    const decisions = [];
    for (let i = 0; i < 4; i++) decisions.push(await orchestrator.decide(encounterRequest()));
    expect(client.requests).toHaveLength(3);
    expect(decisions.map((decision) => [decision.requests, decision.fallbackReason])).toEqual([
      [1, null],
      [1, null],
      [1, null],
      [0, 'request_limit'],
    ]);
    // A new AI turn starts a new count.
    const next = await orchestrator.decide(encounterRequest({ turnKey: 't2' }));
    expect(next).toMatchObject({ source: 'jev', requests: 1 });
  });

  test('a decision with one legal action asks nothing and uses no request', async () => {
    const client = createFakeJevClient(confidentRelease);
    const only = { enabled: encounter.legalActions.enabled.slice(-1), disabled: [] };
    const decision = await new Orchestrator({ client }).decide(
      encounterRequest({ legalActions: only }),
    );
    expect(decision).toMatchObject({ choice: 'release', source: 'auto', requests: 0 });
    expect(client.requests).toHaveLength(0);
  });

  test('an Encounter without engine odds falls back without asking', async () => {
    const client = createFakeJevClient(confidentRelease);
    const decision = await new Orchestrator({ client }).decide(
      encounterRequest({ facts: { policy: ENCOUNTER_POLICY_FACTS } }),
    );
    expect(decision).toMatchObject({ source: 'fallback', fallbackReason: 'missing_facts' });
    expect(client.requests).toHaveLength(0);
  });
});

describe('Sell Phase Nouls (§5.3)', () => {
  const ids = ['pokemon-0', 'pokemon-2', 'pokemon-3'];
  const sellFacts: SellFacts = {
    pokemon: ids.map((instanceId) => ({
      instanceId,
      salePrice: 8,
      classBonusAlone: 0,
      classBonusTogether: 0,
      keepValue: 4,
    })),
  };
  const sellRequest = (overrides: Partial<DecideRequest> = {}): DecideRequest => ({
    ...encounterRequest(),
    ...sell,
    facts: { sell: sellFacts },
    ...overrides,
  });

  test('every offered Pokémon is one Noul in one request; those at the threshold are sold', async () => {
    const nouls: Record<string, number> = { sell_team_0: 0.2, sell_team_1: 0.9, sell_team_2: 0.8 };
    const client = createFakeJevClient((request) => {
      const result = answered(request, () => ({})) as Extract<JevResult, { ok: true }>;
      for (const name of Object.keys(result.answers)) {
        result.answers[name] = { type: 'noul', noul: nouls[name]! };
      }
      return result;
    });
    const decision = await new Orchestrator({ client }).decide(sellRequest());
    expect(client.requests).toHaveLength(1);
    expect(decision).toMatchObject({
      choice: { sellUids: ['pokemon-2', 'pokemon-3'] },
      source: 'jev',
      requests: 1,
    });
    expect(decision.events.map((event) => [event.questionId, event.choice])).toEqual([
      ['sell_team_0', 'false'],
      ['sell_team_1', 'true'],
      ['sell_team_2', 'true'],
    ]);
  });

  test('one Pokémon sold is its listed action; none sold finishes the Sell Phase', async () => {
    const run = async (noul: (name: string) => number) => {
      const client = createFakeJevClient((request) => {
        const result = answered(request, () => ({})) as Extract<JevResult, { ok: true }>;
        for (const name of Object.keys(result.answers)) {
          result.answers[name] = { type: 'noul', noul: noul(name) };
        }
        return result;
      });
      return (await new Orchestrator({ client }).decide(sellRequest())).choice;
    };
    expect(await run((name) => (name === 'sell_team_1' ? 1 : 0))).toBe('sell:pokemon-2');
    expect(await run(() => 0)).toBe('finish-sell');
  });

  test('without engine sale facts the Sell Phase falls back', async () => {
    const client = createFakeJevClient(confidentRelease);
    const decision = await new Orchestrator({ client }).decide(sellRequest({ facts: {} }));
    expect(decision).toMatchObject({ source: 'fallback', fallbackReason: 'missing_facts' });
    expect(client.requests).toHaveLength(0);
  });
});

describe('log events (§6.8, §9)', () => {
  const FIELDS = [
    'choice',
    'confidence',
    'fallbackReason',
    'model',
    'probabilities',
    'questionId',
    'requestId',
    'sampled',
  ];

  test('every decision returns events with every field, and none holds the key', async () => {
    vi.stubEnv('TYPESAFE_API_KEY', PLACEHOLDER_KEY);
    const decisions: OrchestratorDecision[] = [];
    const orchestrator = new Orchestrator({
      client: createSdkJevClient({
        fetch: async () =>
          json({
            model: PINNED_JEV_MODEL,
            answers: {
              encounter: {
                type: 'choice',
                choice: 'release',
                confidence: 0.85,
                probabilities: { poke_ball: 0.05, great_ball: 0.05, release: 0.9 },
              },
            },
            usage: { input_tokens: 600, output_tokens: 0 },
          }),
      }),
    });
    decisions.push(await orchestrator.decide(encounterRequest()));
    decisions.push(await orchestrator.decide(encounterRequest({ difficulty: 'easy' })));
    decisions.push(await orchestrator.decide(encounterRequest({ currentRevision: () => 9 })));
    decisions.push(await orchestrator.decide(encounterRequest()));
    expect(decisions.map((decision) => decision.fallbackReason)).toEqual([
      null,
      null,
      'revision_mismatch',
      'request_limit',
    ]);
    expect(decisions[0]!.events[0]).toEqual({
      requestId: 'req_sdk_1',
      model: PINNED_JEV_MODEL,
      questionId: 'encounter',
      choice: 'release',
      probabilities: { 'catch:poke': 0.05, 'catch:great': 0.05, release: 0.9 },
      confidence: 0.85,
      sampled: null,
      fallbackReason: null,
    });
    for (const decision of decisions) {
      expect(decision.events.length).toBeGreaterThan(0);
      for (const event of decision.events) expect(Object.keys(event).sort()).toEqual(FIELDS);
      expect(JSON.stringify(decision)).not.toContain(PLACEHOLDER_KEY);
    }
  });
});

describe('spend guard and usage log (spec §1, §9)', () => {
  /** Input tokens that cost `thb`, logged as one earlier request. */
  const spent = (thb: number): UsageLine => ({
    time: new Date().toISOString(),
    gameId: 'earlier-game',
    requestId: 'req_old',
    model: PINNED_JEV_MODEL,
    inputTokens: Math.ceil(
      (thb / SPEND_CONFIG.thbPerUsd / SPEND_CONFIG.inputUsdPerMillionTokens) * 1_000_000,
    ),
    outputTokens: 0,
    latencyMs: 200,
    status: 'ok',
    turnKey: '1',
    decision: 0,
    decisionMs: 210,
  });

  /** Lets the usage lines of a returned decision land. */
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  test('at 100% of the cap the next decision falls back with budget_exceeded and sends nothing', async () => {
    const client = createFakeJevClient(confidentRelease);
    const usage = new SpendLedger({ lines: [spent(SPEND_CONFIG.totalCapThb)], warn: () => {} });
    const orchestrator = new Orchestrator({ client, usage });
    const decision = await orchestrator.decide(encounterRequest());
    expect(decision).toMatchObject({
      source: 'fallback',
      fallbackReason: 'budget_exceeded',
      requests: 0,
    });
    expect(decision.choice).toBe(fallbackChoice(encounterRequest()));
    expect(client.requests).toHaveLength(0);
    const planned = await orchestrator.decide(encounterRequest({ ...strategy, facts: {} }));
    expect(planned).toMatchObject({ fallbackReason: 'budget_exceeded', requests: 0 });
  });

  test('the request that reaches the cap is the last; the decision after it falls back', async () => {
    const warn = vi.fn();
    const usage = new SpendLedger({ lines: [spent(SPEND_CONFIG.totalCapThb - 0.001)], warn });
    expect(warn).toHaveBeenCalledOnce();
    const client = createFakeJevClient((request) =>
      answered(request, () => ({ poke_ball: 0.05, great_ball: 0.05, release: 0.9 }), {
        inputTokens: 3240,
      }),
    );
    const orchestrator = new Orchestrator({ client, usage });
    expect(await orchestrator.decide(encounterRequest())).toMatchObject({ source: 'jev' });
    await settle();
    const next = await orchestrator.decide(encounterRequest({ turnKey: 't2' }));
    expect(next).toMatchObject({ fallbackReason: 'budget_exceeded', requests: 0 });
    expect(client.requests).toHaveLength(1);
    expect(warn).toHaveBeenCalledOnce();
  });

  test('the daily budget switches to the fallback the same way', async () => {
    const client = createFakeJevClient(confidentRelease);
    const usage = new SpendLedger({ lines: [spent(5)], dailyBudgetThb: 5 });
    const decision = await new Orchestrator({ client, usage }).decide(encounterRequest());
    expect(decision.fallbackReason).toBe('budget_exceeded');
    expect(client.requests).toHaveLength(0);
  });

  test('the kill switch wins over the spend guard', async () => {
    vi.stubEnv('JEV_ENABLED', 'false');
    const usage = new SpendLedger({ lines: [spent(SPEND_CONFIG.totalCapThb)], warn: () => {} });
    const client = createFakeJevClient(confidentRelease);
    const decision = await new Orchestrator({ client, usage }).decide(encounterRequest());
    expect(decision.fallbackReason).toBe('disabled');
  });

  test('logs one line per request sent, with its decision time and turn key', async () => {
    const lines: UsageLine[] = [];
    const usage = new SpendLedger({ append: (line) => lines.push(line) });
    let calls = 0;
    const client = createFakeJevClient((request) =>
      ++calls === 2
        ? { ok: false, fallbackReason: 'rate_limited', status: 429 }
        : answered(request, () => ({ poke_ball: 0.05, great_ball: 0.05, release: 0.9 }), {
            inputTokens: 3240,
          }),
    );
    const orchestrator = new Orchestrator({ client, usage, gameId: 'game-log-1' });
    await orchestrator.decide(encounterRequest());
    await orchestrator.decide(encounterRequest());
    await settle();
    expect(lines).toHaveLength(2);
    expect(lines[0]).toEqual({
      time: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      gameId: 'game-log-1',
      requestId: 'req_fake_1',
      model: PINNED_JEV_MODEL,
      inputTokens: 3240,
      outputTokens: 0,
      latencyMs: expect.any(Number),
      status: 'ok',
      turnKey: 't1',
      decision: 0,
      decisionMs: expect.any(Number),
    });
    expect(lines[1]).toMatchObject({
      requestId: null,
      inputTokens: 0,
      status: 'rate_limited',
      decision: 1,
    });
    expect(usage.spentThb()).toBeCloseTo(
      ((3240 * SPEND_CONFIG.inputUsdPerMillionTokens) / 1_000_000) * SPEND_CONFIG.thbPerUsd,
      12,
    );
  });

  test('decisions that send nothing log nothing', async () => {
    const lines: UsageLine[] = [];
    const usage = new SpendLedger({ append: (line) => lines.push(line) });
    vi.stubEnv('JEV_ENABLED', 'false');
    await new Orchestrator({ client: createFakeJevClient(confidentRelease), usage }).decide(
      encounterRequest(),
    );
    await settle();
    expect(lines).toEqual([]);
  });

  test('the usage log never holds the key or any state or question text', async () => {
    vi.stubEnv('TYPESAFE_API_KEY', PLACEHOLDER_KEY);
    const file = join(mkdtempSync(join(tmpdir(), 'jev-usage-')), 'logs', 'jev-usage.jsonl');
    const usage = openUsageLedger(file, { dailyBudgetThb: undefined });
    const bodies: string[] = [];
    const orchestrator = new Orchestrator({
      usage,
      client: createSdkJevClient({
        fetch: async (_url, init) => {
          bodies.push(String(init?.body));
          return json({
            model: PINNED_JEV_MODEL,
            answers: {
              encounter: {
                type: 'choice',
                choice: 'release',
                confidence: 0.85,
                probabilities: { poke_ball: 0.05, great_ball: 0.05, release: 0.9 },
              },
            },
            usage: { input_tokens: 3240, output_tokens: 0 },
          });
        },
      }),
    });
    await orchestrator.decide(encounterRequest());
    await orchestrator.decide(encounterRequest({ turnKey: 't2' }));
    await settle();
    const log = readFileSync(file, 'utf8');
    expect(log.trim().split('\n')).toHaveLength(2);
    expect(log).not.toContain(PLACEHOLDER_KEY);
    const sent = JSON.parse(bodies[0]!) as { state: unknown; questions: unknown };
    // Every string the request carried, from its state and its questions' text.
    const texts = new Set<string>();
    const collect = (value: unknown): void => {
      if (typeof value === 'string' && value.length >= 4) texts.add(value);
      else if (value && typeof value === 'object') Object.values(value).forEach(collect);
    };
    collect(sent.state);
    collect(sent.questions);
    expect(texts.size).toBeGreaterThan(5);
    for (const text of texts) {
      if (text === PINNED_JEV_MODEL) continue;
      expect(log).not.toContain(text);
    }
    expect(log).not.toMatch(/"(state|questions|answers|criteria)"/);
  });
});

describe('counters (§5.6)', () => {
  test('invalidOutputRate and fallbackRate by cause', () => {
    const stats = new DecisionStats();
    const decision = (
      source: OrchestratorDecision['source'],
      fallbackReason: OrchestratorDecision['fallbackReason'],
      requests: number,
    ) => ({ choice: 'x', source, fallbackReason, requests, events: [] });
    stats.record(decision('jev', null, 1));
    stats.record(decision('fallback', 'invalid_choice', 1));
    stats.record(decision('fallback', 'timeout', 1));
    stats.record(decision('fallback', 'request_limit', 0));
    stats.record(decision('auto', null, 0));
    expect(decisionRates(stats.counts())).toEqual({
      decisions: 4,
      requests: 3,
      invalidOutputRate: 0.3333,
      fallbackRate: {
        total: 0.75,
        byCause: { invalid_choice: 0.25, timeout: 0.25, request_limit: 0.25 },
      },
    });
  });
});

describe('`--policy jev` in the sim (§5.6, §8)', () => {
  const options = { ...DEFAULT_OPTIONS, games: 6, seed: 1, seats: 3, policy: 'jev' };

  beforeEach(() => {
    vi.stubEnv('TYPESAFE_API_KEY', '');
  });

  test('random, invalid, late and failing fake answers never apply an illegal action', async () => {
    const { summary, failures } = await runSim(realEngine, options);
    expect(failures).toEqual([]);
    expect(summary).toMatchObject({ aborted: 0, illegalAppliedActionCount: 0 });
    expect(summary.jev!.decisions).toBeGreaterThan(0);
    expect(summary.jev!.requests).toBeGreaterThan(0);
    for (const cause of ['invalid_choice', 'timeout', 'rate_limited', 'server_error']) {
      expect(summary.jev!.fallbackRate.byCause[cause]).toBeGreaterThan(0);
    }
    expect(summary.policyCounts!['fallback:timeout']).toBeGreaterThan(0);
  });

  test('is reproducible for a seed', async () => {
    const one = { ...options, games: 2 };
    expect((await runSim(realEngine, one)).summary).toEqual(
      (await runSim(realEngine, one)).summary,
    );
  });

  test('JEV_ENABLED=false: 100 games, no network call, every Jev decision a disabled fallback', async () => {
    vi.stubEnv('JEV_ENABLED', 'false');
    const fetch = vi.fn(() => Promise.reject(new Error('no network in the kill-switch sim')));
    vi.stubGlobal('fetch', fetch);
    try {
      const { summary, failures } = await runSim(realEngine, {
        ...DEFAULT_OPTIONS,
        games: 100,
        seed: 1,
        policy: 'jev',
      });
      expect(failures).toEqual([]);
      expect(summary).toMatchObject({ games: 100, aborted: 0, illegalAppliedActionCount: 0 });
      expect(fetch).not.toHaveBeenCalled();
      expect(summary.jev!.decisions).toBeGreaterThan(0);
      expect(summary.jev!.requests).toBe(0);
      expect(summary.jev!.fallbackRate).toEqual({ total: 1, byCause: { disabled: 1 } });
      expect(summary.policyCounts).toEqual({
        decisions: summary.jev!.decisions,
        requests: 0,
        invalid_outputs: 0,
        'fallback:disabled': summary.jev!.decisions,
      });
    } finally {
      vi.unstubAllGlobals();
    }
  }, 120_000);

  test('every seat of one game shares one orchestrator, and each game gets its own', () => {
    const game = { seed: 1 };
    const [a, b] = [POLICIES.jev!(game), POLICIES.jev!(game)] as JevPolicy[];
    const c = POLICIES.jev!({ seed: 1 }) as JevPolicy;
    expect(a!.orchestrator).toBe(b!.orchestrator);
    expect(c.orchestrator).not.toBe(a!.orchestrator);
  });

  test('the chaos fake is seeded', async () => {
    const answers = async (seed: number) => {
      const client = createChaosJevClient(seed);
      const controller = new AbortController();
      const results = [];
      for (let i = 0; i < 20; i++) {
        const request = { state: {}, questions: encounterQuestion() };
        const result = await Promise.race([
          client.ask(request, { decisionSignal: controller.signal }),
          new Promise<string>((resolve) => setTimeout(() => resolve('late'), 5)),
        ]);
        results.push(typeof result === 'string' ? result : JSON.stringify(result));
      }
      controller.abort();
      return results;
    };
    expect(await answers(1)).toEqual(await answers(1));
  });
});

function encounterQuestion(): JevRequest['questions'] {
  return { encounter: choice('Pick one.', { poke_ball: 'Throw.', release: 'Release.' }) };
}
