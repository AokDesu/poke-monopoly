import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ESLint } from 'eslint';
import { afterAll, afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  aiStatusSchema,
  decisionResponseSchema,
  type DecisionRequest,
} from '../engine/contract/decision.ts';
import {
  applyAction,
  createGame,
  createGameConfig,
  fixtureSchema,
  legalActions,
  observe,
  oddsForAllBalls,
  saleFacts,
  type GameState,
} from '../engine/index.ts';
import startFixture from '../engine/fixtures/start-of-game-2p.json';
import { createPolicyRng } from '../sim/policy.ts';
import encounterFixture from '../engine/fixtures/encounter-with-balls.json';
import sellFixture from '../engine/fixtures/sell-phase-three-pokemon.json';
import strategyFixture from '../engine/fixtures/strategy-with-items.json';
import { createApp, MAX_BODY_BYTES } from './app.ts';
import { createOrchestratorDecider, type Decider } from './decider.ts';
import { Orchestrator } from './orchestrator.ts';
import { FallbackPolicy, PERSONALITIES } from './fallback/index.ts';
import type { JevAnswer, JevClient, JevRequest, JevResult } from './jev/client.ts';
import { PINNED_JEV_MODEL } from './jev/client.ts';
import { fileDecisionLog, type DecisionRecord } from './jev/decision-log.ts';
import { createFakeJevClient } from './jev/fake.ts';
import { SpendLedger, type UsageLine, type UsageRecorder } from './jev/spend.ts';
import { usageReport } from './jev/usage-report.ts';

// Offline only: a placeholder key, Hono's in-memory `app.request()` and no network.
const KEY_ENV = 'TYPESAFE_API_KEY';
const PLACEHOLDER_KEY = 'placeholder-key-not-real-4b1e8d';

/** Every response body and header seen in this file, searched for the key at the end. */
const seen: string[] = [];

type App = ReturnType<typeof createApp>;

/** An empty spend ledger, so no test reads a real `logs/jev-usage.jsonl`. */
const noSpend = () => new SpendLedger();
const overBudget = (): UsageRecorder => ({ record: () => {}, budgetExceeded: () => true });

/** A client that never reaches the SDK or the network: every request fails as `network`. */
const offlineClient: JevClient = { ask: async () => ({ ok: false, fallbackReason: 'network' }) };

/** The app over the offline client, so no test here can make a live call even with a key set. */
const testApp = (options: Parameters<typeof createApp>[0] = {}) =>
  createApp({ usage: noSpend, jevClient: () => offlineClient, ...options });

const record = async (response: Response) => {
  seen.push(await response.clone().text(), JSON.stringify([...response.headers]));
  return response;
};

const status = async (app: App = testApp()) => record(await app.request('/api/ai/status'));

const decide = async (body: unknown, app: App = testApp()) =>
  record(
    await app.request('/api/ai/decide', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  );

/** The outcome a browser reports when it applies `body`, a decide response, as it came. */
const outcomeFor = (request: DecisionRequest, body: Record<string, unknown>) => ({
  gameId: request.gameId,
  seatIndex: request.seatIndex,
  turnKey: request.turnKey,
  stateRevision: request.stateRevision,
  decisionPoint: request.decisionPoint,
  ...('choice' in body ? { choice: body.choice } : { sellUids: body.sellUids }),
  source: body.source,
  ...('fallbackReason' in body && { fallbackReason: body.fallbackReason }),
});

const report = (outcome: unknown, app: App) =>
  app.request('/api/ai/outcome', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(outcome),
  });

/** Decides, then reports the outcome as the browser does when it applies the answer it got. */
const decideApplied = async (request: DecisionRequest, app: App) => {
  const response = await decide(request, app);
  await report(outcomeFor(request, await response.clone().json()), app);
  return response;
};

/** A request for the fixture's active seat, built only from its role-scoped observation. */
const requestFor = (json: unknown): DecisionRequest => {
  const fixture = fixtureSchema.parse(json);
  const seat = fixture.state.activeSeatIndex;
  const observation = fixture.observation[String(seat)]!;
  const decisionPoint = observation.public.phase.kind as DecisionRequest['decisionPoint'];
  return {
    gameId: 'game-test-1',
    seatIndex: seat,
    decisionPoint,
    stateRevision: observation.public.stateRevision,
    observation,
    enabledActions: fixture.legalActions[String(seat)]!.enabled,
    facts:
      decisionPoint === 'encounter'
        ? { catchOdds: oddsForAllBalls(fixture.state, seat) }
        : decisionPoint === 'sell'
          ? { sell: saleFacts(fixture.state, seat) }
          : {},
    difficulty: 'normal',
    personalityId: 'greedy',
    turnKey: `${seat}:${observation.public.globalTurnNo}`,
  };
};

/** Seat 0 (human) in its Social window with the window open; seats 1 and 2 are AIs. */
function socialGame(seats: 2 | 3): GameState {
  const scenario = fixtureSchema.parse(startFixture).state;
  const content = structuredClone(scenario.content);
  content.classes.push({
    id: 'team-rocket',
    name: 'Team Rocket',
    starterSpeciesIds: ['eevee'],
    classItemId: 'pickpocket',
  });
  const state = createGame(
    createGameConfig({
      seats: [
        ...scenario.config.seats,
        { actorId: 'player-2', seatIndex: 2, classId: 'team-rocket', controller: 'ai' as const },
      ].slice(0, seats),
      seed: 4,
      lapTarget: 3,
      socialWindow: true,
    }),
    content,
  );
  state.phase = { kind: 'social' };
  state.globalTurnNo = 1;
  state.players[0]!.ownTurnNo = 1;
  state.turnBudgets = {
    tacticalAction: 1,
    catchAttempt: 1,
    pokemonAbility: 1,
    socialInteraction: 1,
  };
  return state;
}

/** The active seat's command, numbered with the revision that seat observes. */
function act(state: GameState, kind: string, payload: object = {}): GameState {
  const revision = observe(state, state.activeSeatIndex).public.stateRevision;
  const result = applyAction(state, {
    actorId: state.players[state.activeSeatIndex]!.actorId,
    actionSeq: revision + 1,
    stateRevisionBefore: revision,
    kind,
    payload,
  });
  if ('rejected' in result) throw new Error(result.reason);
  return result.state;
}

const strategy = requestFor(strategyFixture);
const encounter = requestFor(encounterFixture);
const sell = requestFor(sellFixture);

const answering =
  (answer: unknown): Decider =>
  async () =>
    answer as Awaited<ReturnType<Decider>>;

beforeEach(() => {
  vi.stubEnv('JEV_ENABLED', 'true');
  vi.stubEnv(KEY_ENV, PLACEHOLDER_KEY);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// Spec §9: whatever the decider sees or returns, no response carries any part of the key.
afterAll(() => {
  expect(seen.length).toBeGreaterThan(0);
  for (const text of seen) expect(text).not.toContain(PLACEHOLDER_KEY);
});

describe('GET /api/ai/status', () => {
  const speechOff = { enabled: false, reason: 'disabled' };

  beforeEach(() => {
    vi.stubEnv('HAIKU_ENABLED', undefined);
    vi.stubEnv('ANTHROPIC_API_KEY', undefined);
    vi.stubEnv('DEMO_MODE', undefined);
  });

  test('reports Jev on when enabled with a key', async () => {
    expect(await (await status()).json()).toEqual({
      jevEnabled: true,
      backupOnly: false,
      reason: null,
      speech: speechOff,
      demo: false,
    });
  });

  test('reports backup-only mode under the kill switch', async () => {
    vi.stubEnv('JEV_ENABLED', 'false');
    vi.stubEnv(KEY_ENV, undefined);
    expect(await (await status()).json()).toEqual({
      jevEnabled: false,
      backupOnly: true,
      reason: 'disabled',
      speech: speechOff,
      demo: false,
    });
  });

  test('reports backup-only mode once the spend cap or daily budget is reached', async () => {
    expect(await (await status(testApp({ usage: overBudget }))).json()).toEqual({
      jevEnabled: true,
      backupOnly: true,
      reason: 'budget_exceeded',
      speech: speechOff,
      demo: false,
    });
  });

  test('reports backup-only mode when the key is missing', async () => {
    vi.stubEnv(KEY_ENV, undefined);
    expect(await (await status()).json()).toEqual({
      jevEnabled: true,
      backupOnly: true,
      reason: 'missing_key',
      speech: speechOff,
      demo: false,
    });
  });

  test.each([
    ['1', true],
    ['true', true],
    [undefined, false],
    ['0', false],
    ['false', false],
    ['', false],
    ['TRUE', false],
    [' 1', false],
    ['yes', false],
  ])('DEMO_MODE=%j reports demo %s, and the body still matches the schema', async (value, demo) => {
    vi.stubEnv('DEMO_MODE', value);
    const body = await (await status()).json();
    expect(body.demo).toBe(demo);
    expect(aiStatusSchema.parse(body)).toEqual(body);
    expect(Object.keys(body).sort()).toEqual([
      'backupOnly',
      'demo',
      'jevEnabled',
      'reason',
      'speech',
    ]);
  });

  test('reports speech on with HAIKU_ENABLED=true and its own key, independent of Jev', async () => {
    vi.stubEnv('HAIKU_ENABLED', 'true');
    vi.stubEnv('ANTHROPIC_API_KEY', 'placeholder-haiku-key');
    vi.stubEnv('JEV_ENABLED', 'false');
    expect(await (await status()).json()).toEqual({
      jevEnabled: false,
      backupOnly: true,
      reason: 'disabled',
      speech: { enabled: true, reason: null },
      demo: false,
    });
  });

  test('reports speech off for a missing key and for a spent Haiku or total cap', async () => {
    vi.stubEnv('HAIKU_ENABLED', 'true');
    expect((await (await status()).json()).speech).toEqual({
      enabled: false,
      reason: 'missing_key',
    });
    vi.stubEnv('ANTHROPIC_API_KEY', 'placeholder-haiku-key');
    expect((await (await status(testApp({ usage: overBudget }))).json()).speech).toEqual({
      enabled: false,
      reason: 'budget_exceeded',
    });
  });
});

describe('POST /api/ai/decide', () => {
  test('a valid request returns only the response fields', async () => {
    const response = await decide(strategy);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(Object.keys(body).sort()).toEqual(
      ['choice', 'fallbackReason', 'latencyMs', 'requestId', 'source'].sort(),
    );
    expect(body).toMatchObject({ source: 'fallback', fallbackReason: 'network' });
    expect(decisionResponseSchema.parse(body)).toEqual(body);
  });

  test('falls back with budget_exceeded once the spend guard trips', async () => {
    const response = await decide(strategy, testApp({ usage: overBudget }));
    expect(await response.json()).toMatchObject({
      source: 'fallback',
      fallbackReason: 'budget_exceeded',
    });
  });

  test('a body over 32 KB returns 413', async () => {
    const response = await decide({ ...strategy, personalityId: 'x'.repeat(MAX_BODY_BYTES) });
    expect(response.status).toBe(413);
  });

  test('a body over 32 KB without a length header returns 413', async () => {
    const bytes = new TextEncoder().encode(
      JSON.stringify({ ...strategy, personalityId: 'x'.repeat(MAX_BODY_BYTES) }),
    );
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    });
    const response = await record(
      await testApp().request('/api/ai/decide', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'transfer-encoding': 'chunked' },
        body,
        duplex: 'half',
      } as RequestInit),
    );
    expect(response.status).toBe(413);
  });

  test.each([
    ['broken JSON', '{"gameId":'],
    ['a missing field', { ...strategy, turnKey: undefined }],
    ['an unknown top-level field', { ...strategy, debug: true }],
    [
      'an unknown field in an action',
      { ...strategy, enabledActions: [{ id: 'x', kind: 'skip', payload: {}, hint: 1 }] },
    ],
    ['no enabled action', { ...strategy, enabledActions: [] }],
    ['a revision that does not match the observation', { ...strategy, stateRevision: 999 }],
    ['a seat that does not match the observation', { ...strategy, seatIndex: 1 }],
    ['a decision point that does not match the phase', { ...strategy, decisionPoint: 'sell' }],
  ])('%s returns 400 with no stack trace', async (_name, body) => {
    const response = await decide(body);
    expect(response.status).toBe(400);
    const text = await response.text();
    expect(text).not.toMatch(/\bat\s|Error|stack|\.ts\b/);
    expect(JSON.parse(text)).toHaveProperty('error');
  });

  test.each([
    [
      'public',
      (request: DecisionRequest) => ({ ...request.observation.public, eventDeck: ['e1'] }),
    ],
    ['own', (request: DecisionRequest) => ({ ...request.observation.own, rng: 'seed' })],
  ])('an observation with an unknown %s field is rejected', async (part, extend) => {
    const observation = { ...strategy.observation, [part]: extend(strategy) };
    const response = await decide({ ...strategy, observation });
    expect(response.status).toBe(400);
  });

  test.each([2, 3] as const)(
    '%i seats: a request carries the revision the seat observed after a chat (§4.8, #143)',
    async (seats) => {
      const seat = seats - 1;
      // The human chats seat 1; with 3 seats, seat 2 is outside the chat.
      const state = act(socialGame(seats), 'chat', { targetSeatIndex: 1, topic: 'truce' });
      state.activeSeatIndex = seat;
      state.phase = { kind: 'strategy' };
      const observation = observe(state, seat);
      expect(observation.public.stateRevision).toBe(state.stateRevision - (seats === 3 ? 1 : 0));
      const request: DecisionRequest = {
        gameId: 'game-test-1',
        seatIndex: seat,
        decisionPoint: 'strategy',
        stateRevision: observation.public.stateRevision,
        observation,
        enabledActions: legalActions(state, seat).enabled,
        facts: {},
        difficulty: 'normal',
        personalityId: 'cautious',
        turnKey: `${seat}:1`,
      };
      const response = await decide(request);
      expect(response.status).toBe(200);
      expect(decisionResponseSchema.parse(await response.json())).toMatchObject({
        choice: policyChoice(request),
      });
      // A revision other than the observed one (the global count, for a bystander) is refused.
      const other = await decide({
        ...request,
        stateRevision: observation.public.stateRevision + 1,
      });
      expect(other.status).toBe(400);
    },
  );

  test('an answer that is not among the options falls back (spec §3.1)', async () => {
    const app = testApp({
      decider: answering({ choice: 'buy:everything', source: 'jev' }),
    });
    expect(await (await decide(strategy, app)).json()).toMatchObject({
      choice: 'use-item:item-0',
      source: 'fallback',
      fallbackReason: 'not_an_option',
    });
    const seller = testApp({
      decider: answering({ sellUids: ['pokemon-1'], source: 'jev' }),
    });
    expect(await (await decide(sell, seller)).json()).toMatchObject({
      sellUids: ['pokemon-0'],
      fallbackReason: 'not_an_option',
    });
  });

  test('a Jev answer among the options is returned without a fallback reason', async () => {
    const app = testApp({
      decider: answering({ sellUids: ['pokemon-2', 'pokemon-3'], source: 'jev' }),
    });
    const body = await (await decide(sell, app)).json();
    expect(body).toMatchObject({ sellUids: ['pokemon-2', 'pokemon-3'], source: 'jev' });
    expect(body).not.toHaveProperty('fallbackReason');
  });

  test('only IDs and telemetry leave, whatever the decider returns', async () => {
    const app = testApp({
      decider: answering({
        choice: 'skip',
        source: 'jev',
        jevBody: { answers: {}, key: PLACEHOLDER_KEY },
        apiKey: PLACEHOLDER_KEY,
      }),
    });
    const body = await (await decide(strategy, app)).json();
    expect(Object.keys(body).sort()).toEqual(['choice', 'latencyMs', 'requestId', 'source']);
  });

  test('a decider that throws falls back without leaking the error', async () => {
    const app = testApp({
      decider: async () => {
        throw new Error(`boom ${PLACEHOLDER_KEY}`);
      },
    });
    const response = await decide(strategy, app);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ fallbackReason: 'decider_error' });
  });
});

/** The fallback policy's choice for a request, as `decide` seeds it. */
const policyChoice = (request: DecisionRequest) =>
  new FallbackPolicy(PERSONALITIES.greedy).decide(
    request.observation,
    { enabled: request.enabledActions, disabled: [] },
    createPolicyRng(`${request.gameId}:${request.turnKey}:${request.stateRevision}`),
    request.facts.catchOdds && {
      catchChance: Object.fromEntries(
        request.facts.catchOdds.map((odds) => [odds.ballType, odds.probability]),
      ),
      catchSuccessFaces: Object.fromEntries(
        request.facts.catchOdds.map((odds) => [odds.ballType, odds.successFaces]),
      ),
    },
  );

/** Jev answers every Choice with full confidence in `pick` (a label), or the first label. */
const confident = (request: JevRequest, pick?: string): JevResult => {
  const answers: Record<string, JevAnswer> = {};
  for (const [name, question] of Object.entries(request.questions)) {
    if (question.type === 'noul') {
      answers[name] = { type: 'noul', noul: 0.9 };
      continue;
    }
    const labels = Object.keys(question.criteria);
    const choice = pick && labels.includes(pick) ? pick : labels[0]!;
    answers[name] = {
      type: 'choice',
      choice,
      confidence: 1,
      probabilities: Object.fromEntries(labels.map((label) => [label, label === choice ? 1 : 0])),
    };
  }
  return {
    ok: true,
    answers,
    requestId: 'req_fake_1',
    model: PINNED_JEV_MODEL,
    latencyMs: 5,
    usage: { inputTokens: 100, outputTokens: 0 },
  };
};

describe('POST /api/ai/decide: the orchestrator-backed decider (spec §5.2, §5.6, §9)', () => {
  const pickSkip = (request: JevRequest) => confident(request, 'skip');

  test.each([
    ['JEV_ENABLED=false', 'disabled', () => vi.stubEnv('JEV_ENABLED', 'false')],
    ['no key', 'missing_key', () => vi.stubEnv(KEY_ENV, undefined)],
  ])(
    '%s: the fallback policy decides, never the first enabled action',
    async (_name, reason, set) => {
      set();
      const fake = createFakeJevClient(pickSkip);
      const app = testApp({ jevClient: () => fake });
      for (const request of [strategy, encounter]) {
        const body = await (await decide(request, app)).json();
        expect(body).toMatchObject({
          choice: policyChoice(request),
          source: 'fallback',
          fallbackReason: reason,
        });
        expect(policyChoice(request)).not.toBe(request.enabledActions[0]!.id);
      }
      // Kill switch or no key: not even an attempt at Jev.
      expect(fake.requests).toHaveLength(0);
      const sold = await (await decide(sell, app)).json();
      expect(sold).toMatchObject({ source: 'fallback', fallbackReason: reason });
      expect(Array.isArray(sold.sellUids)).toBe(true);
      expect(sold).not.toHaveProperty('choice');
    },
  );

  test('POST /api/ai/fallback returns the fallback policy choice, never the first enabled action', async () => {
    for (const request of [strategy, encounter]) {
      const response = await record(
        await testApp().request('/api/ai/fallback', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(request),
        }),
      );
      expect(await response.json()).toMatchObject({
        choice: policyChoice(request),
        source: 'fallback',
        fallbackReason: 'timeout',
      });
      expect(policyChoice(request)).not.toBe(request.enabledActions[0]!.id);
    }
  });

  test('with a client it returns source: jev and only IDs and telemetry', async () => {
    const fake = createFakeJevClient(pickSkip);
    const body = await (await decide(strategy, testApp({ jevClient: () => fake }))).json();
    expect(body).toMatchObject({ choice: 'skip', source: 'jev' });
    expect(Object.keys(body).sort()).toEqual(['choice', 'latencyMs', 'requestId', 'source']);
    expect(fake.requests).toHaveLength(1);
  });

  test('the request facts reach the Encounter question', async () => {
    const fake = createFakeJevClient((request) => confident(request, 'release'));
    const app = testApp({ jevClient: () => fake });
    expect(await (await decide(encounter, app)).json()).toMatchObject({
      choice: 'release',
      source: 'jev',
    });
    expect(fake.requests).toHaveLength(1);
    // Without the catch odds the question cannot be built, so nothing is sent.
    const bare = createFakeJevClient(pickSkip);
    const without = await (
      await decide({ ...encounter, facts: {} }, testApp({ jevClient: () => bare }))
    ).json();
    expect(without).toMatchObject({ source: 'fallback', fallbackReason: 'missing_facts' });
    expect(bare.requests).toHaveLength(0);
  });

  test('the request sale facts reach the Sell Nouls, one per Pokémon, with named buckets only', async () => {
    const fake = createFakeJevClient(pickSkip);
    const body = await (await decide(sell, testApp({ jevClient: () => fake }))).json();
    expect(body).toMatchObject({ source: 'jev' });
    expect(body).toHaveProperty('sellUids');
    expect(fake.requests).toHaveLength(1);
    const sent = fake.requests[0]!;
    expect(Object.keys(sent.questions)).toEqual(['sell_team_0', 'sell_team_1', 'sell_team_2']);
    const wire = JSON.stringify(sent);
    for (const row of sell.facts.sell!) expect(wire).not.toContain(`"salePrice":${row.salePrice}`);
    expect(wire).toMatch(/sale_value_now/);
    expect(wire).toMatch(/keep_value/);
    for (const row of sell.facts.sell!) expect(wire).not.toContain(`"keepValue":${row.keepValue}`);
  });

  test('without sale facts, or with partial, foreign or inconsistent rows, a Sell Phase falls back as missing_facts', async () => {
    const rows = sell.facts.sell!;
    for (const facts of [
      {},
      { sell: rows.slice(1) },
      { sell: [...rows, { ...rows[0]!, instanceId: 'not-mine' }] },
      { sell: [rows[0]!, rows[0]!, ...rows.slice(2)] },
      // `saleValue` must be `salePrice + classBonusTogether`, or the policy and Jev would disagree.
      { sell: [{ ...rows[0]!, saleValue: rows[0]!.saleValue + 1 }, ...rows.slice(1)] },
    ]) {
      const fake = createFakeJevClient(pickSkip);
      const body = await (
        await decide({ ...sell, facts }, testApp({ jevClient: () => fake }))
      ).json();
      expect(body).toMatchObject({ source: 'fallback', fallbackReason: 'missing_facts' });
      expect(body).toHaveProperty('sellUids');
      expect(fake.requests).toHaveLength(0);
    }
  });

  test('a malformed sale fact is a 400, never an unchecked request', async () => {
    const row = sell.facts.sell![0]!;
    for (const bad of [
      { ...row, salePrice: -1 },
      { ...row, salePrice: 1.5 },
      { ...row, keepValue: -1 },
      { ...row, keepValue: 1.5 },
      { ...row, keepValue: undefined },
      { ...row, unexpectedField: 3 },
      { instanceId: row.instanceId },
    ]) {
      const response = await decide({ ...sell, facts: { sell: [bad] } });
      expect(response.status).toBe(400);
    }
  });

  test('the fallback policy sells from the sale facts when Jev is off, and keeps nothing it cannot price', async () => {
    vi.stubEnv('JEV_ENABLED', 'false');
    const priced = await (await decide(sell, testApp())).json();
    const bare = await (await decide({ ...sell, facts: {} }, testApp())).json();
    expect(priced).toMatchObject({ source: 'fallback', fallbackReason: 'disabled' });
    expect(priced.sellUids.length).toBeGreaterThan(0);
    expect(bare.sellUids).toEqual([]);
  });

  test('fallback receives engine keep values and holds high Battle contributors (§5.6)', async () => {
    vi.stubEnv('JEV_ENABLED', 'false');
    const request = (keepValue: number): DecisionRequest => ({
      ...sell,
      personalityId: 'greedy',
      facts: { sell: sell.facts.sell!.map((row) => ({ ...row, keepValue })) },
    });
    const low = await (await decide(request(0), testApp())).json();
    const high = await (await decide(request(3), testApp())).json();
    expect(low.sellUids.length).toBeGreaterThan(0);
    expect(high.sellUids).toEqual([]);
  });

  test('an unusable answer falls back with the orchestrator’s reason', async () => {
    const fake = createFakeJevClient((request) => {
      const result = confident(request);
      if (!result.ok) return result;
      for (const answer of Object.values(result.answers)) {
        if (answer.type === 'choice') answer.choice = 'buy_everything';
      }
      return result;
    });
    const body = await (await decide(strategy, testApp({ jevClient: () => fake }))).json();
    expect(body).toMatchObject({
      choice: policyChoice(strategy),
      source: 'fallback',
      fallbackReason: 'invalid_choice',
    });
    const unsure = createFakeJevClient((request) => {
      const result = confident(request);
      if (!result.ok) return result;
      for (const answer of Object.values(result.answers)) {
        if (answer.type === 'choice') answer.confidence = 0.1;
      }
      return result;
    });
    expect(
      await (await decide(strategy, testApp({ jevClient: () => unsure }))).json(),
    ).toMatchObject({
      source: 'fallback',
      fallbackReason: 'low_confidence',
    });
  });

  test('a decision with a single legal action is the policy choosing, reported as auto', async () => {
    const only = { ...strategy, enabledActions: [strategy.enabledActions.at(-1)!] };
    const fake = createFakeJevClient(pickSkip);
    const body = await (await decide(only, testApp({ jevClient: () => fake }))).json();
    expect(body).toMatchObject({ source: 'fallback', fallbackReason: 'auto' });
    expect(fake.requests).toHaveLength(0);
  });

  test('the 1,500 ms decision deadline holds: a silent Jev falls back with timeout', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const silent: JevClient = { ask: () => new Promise<JevResult>(() => {}) };
      const pending = decide(strategy, testApp({ jevClient: () => silent }));
      await vi.advanceTimersByTimeAsync(1499);
      let settled = false;
      void pending.then(() => (settled = true));
      await vi.advanceTimersByTimeAsync(0);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(await (await pending).json()).toMatchObject({
        choice: policyChoice(strategy),
        source: 'fallback',
        fallbackReason: 'timeout',
      });
    } finally {
      vi.useRealTimers();
    }
  });

  test('at most 3 Jev requests per turnKey; a new turnKey starts again', async () => {
    const fake = createFakeJevClient(pickSkip);
    const app = testApp({ jevClient: () => fake });
    const bodies = [];
    for (let call = 0; call < 4; call++) bodies.push(await (await decide(strategy, app)).json());
    expect(bodies.map((body) => body.source)).toEqual(['jev', 'jev', 'jev', 'fallback']);
    expect(bodies[3]).toMatchObject({ fallbackReason: 'request_limit' });
    expect(fake.requests).toHaveLength(3);
    const next = await (await decide({ ...strategy, turnKey: 'next-turn' }, app)).json();
    expect(next).toMatchObject({ source: 'jev' });
    expect(fake.requests).toHaveLength(4);
  });

  test('one orchestrator per gameId, from a bounded cache', async () => {
    const decider = createOrchestratorDecider({ client: () => offlineClient, usage: noSpend });
    const spy = vi.spyOn(Orchestrator.prototype, 'decide');
    try {
      const app = testApp({ decider });
      for (const gameId of ['a', 'a', 'b', 'a']) await decide({ ...strategy, gameId }, app);
      const owners = spy.mock.contexts;
      expect(owners).toHaveLength(4);
      expect(owners[0]).toBe(owners[1]);
      expect(owners[0]).toBe(owners[3]);
      expect(owners[2]).not.toBe(owners[0]);
    } finally {
      spy.mockRestore();
    }
  });

  test('a game’s limits survive its orchestrator being evicted by 64 other games', async () => {
    const fake = createFakeJevClient(pickSkip);
    const app = testApp({ jevClient: () => fake });
    const game = (gameId: string, turnKey = strategy.turnKey) => ({ ...strategy, gameId, turnKey });
    for (let call = 0; call < 3; call++) await decide(game('a'), app);
    for (let other = 0; other < 65; other++) await decide(game(`other-${other}`), app);
    expect(await (await decide(game('a'), app)).json()).toMatchObject({
      source: 'fallback',
      fallbackReason: 'request_limit',
    });
    expect(fake.requests).toHaveLength(3 + 65);
  });

  test('a game’s token budget survives eviction too', async () => {
    const heavy = createFakeJevClient((request) => {
      const result = pickSkip(request);
      if (result.ok) result.usage.inputTokens = 400_000;
      return result;
    });
    const app = testApp({ jevClient: () => heavy });
    const game = (gameId: string, turnKey: string) => ({ ...strategy, gameId, turnKey });
    await decide(game('a', 't1'), app);
    await decide(game('a', 't2'), app); // 800,000 input tokens: over the 600,000 per game
    for (let other = 0; other < 65; other++) await decide(game(`other-${other}`, 't1'), app);
    expect(await (await decide(game('a', 't3'), app)).json()).toMatchObject({
      source: 'fallback',
      fallbackReason: 'token_budget',
    });
  });

  test('an exhausted game stays exhausted after 10,000 other game IDs', async () => {
    let tokens = 100;
    const client = createFakeJevClient((request) => {
      const result = pickSkip(request);
      if (result.ok) result.usage.inputTokens = tokens;
      return result;
    });
    const decider = createOrchestratorDecider({ client: () => client, usage: noSpend });
    const ready = { jevEnabled: true, backupOnly: false, reason: null };
    const game = (gameId: string, turnKey: string) => ({ ...strategy, gameId, turnKey });
    // `requests`: three Jev requests on one turn. `tokens`: 800,000 input tokens, over the 600,000.
    for (let call = 0; call < 3; call++) await decider(game('requests', 't1'), { status: ready });
    tokens = 400_000;
    await decider(game('tokens', 't1'), { status: ready });
    await decider(game('tokens', 't2'), { status: ready });
    tokens = 100;
    for (let other = 0; other < 10_000; other++) {
      await decider(game(`other-${other}`, 't1'), { status: ready });
    }
    expect(await decider(game('requests', 't1'), { status: ready })).toMatchObject({
      source: 'fallback',
      fallbackReason: 'request_limit',
    });
    expect(await decider(game('tokens', 't3'), { status: ready })).toMatchObject({
      source: 'fallback',
      fallbackReason: 'token_budget',
    });
  }, 30_000);

  test('decision numbers and usage durations survive the orchestrator being evicted', async () => {
    const lines: UsageLine[] = [];
    const usage = () => new SpendLedger({ append: (line) => lines.push(line) });
    const decider = createOrchestratorDecider({
      client: () => createFakeJevClient(pickSkip),
      usage,
      maxGames: 1,
    });
    const ready = { jevEnabled: true, backupOnly: false, reason: null };
    const game = (gameId: string) => ({ ...strategy, gameId });
    await decider(game('a'), { status: ready });
    await decider(game('b'), { status: ready }); // evicts a's orchestrator
    await decider(game('a'), { status: ready });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const of = (gameId: string) => lines.filter((line) => line.gameId === gameId);
    expect(of('a').map((line) => line.decision)).toEqual([0, 1]);
    expect(of('b').map((line) => line.decision)).toEqual([0]);
    expect(usageReport(of('a')).turnMs?.p50).toBe(of('a')[0]!.decisionMs + of('a')[1]!.decisionMs);
  });

  test('the per-turnKey cap holds when turns interleave (A,A,A,A,B,A)', async () => {
    const fake = createFakeJevClient(pickSkip);
    const app = testApp({ jevClient: () => fake });
    const bodies = [];
    for (const turnKey of ['A', 'A', 'A', 'A', 'B', 'A']) {
      bodies.push(await (await decide({ ...strategy, turnKey }, app)).json());
    }
    expect(bodies.map((body) => body.source)).toEqual([
      'jev',
      'jev',
      'jev',
      'fallback',
      'jev',
      'fallback',
    ]);
    expect(bodies[5]).toMatchObject({ fallbackReason: 'request_limit' });
    expect(fake.requests).toHaveLength(4);
  });

  test('the per-turnKey cap holds for concurrent decisions (A,B,A,B,A,B,A)', async () => {
    const slow = createFakeJevClient(async (request) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return pickSkip(request);
    });
    const app = testApp({ jevClient: () => slow });
    const bodies = await Promise.all(
      ['A', 'B', 'A', 'B', 'A', 'B', 'A'].map(async (turnKey) =>
        (await decide({ ...strategy, turnKey }, app)).json(),
      ),
    );
    expect(bodies.filter((body) => body.source === 'jev')).toHaveLength(6);
    expect(bodies[6]).toMatchObject({ source: 'fallback', fallbackReason: 'request_limit' });
    expect(slow.requests).toHaveLength(6);
  });

  describe('decision events (spec §6.8)', () => {
    const FIELDS = [
      'choice',
      'confidence',
      'decisionPoint',
      'fallbackReason',
      'gameId',
      'model',
      'probabilities',
      'questionId',
      'requestId',
      'sampled',
      'seatIndex',
      'stateRevision',
      'time',
      'turnKey',
    ];

    test('a Normal Jev decision logs its probabilities and confidence, and nothing else', async () => {
      const records: DecisionRecord[] = [];
      const fake = createFakeJevClient(pickSkip);
      const app = testApp({ jevClient: () => fake, decisionLog: (line) => records.push(line) });
      await decideApplied(strategy, app);
      expect(records).toHaveLength(1);
      expect(Object.keys(records[0]!).sort()).toEqual(FIELDS);
      expect(records[0]).toMatchObject({
        gameId: strategy.gameId,
        turnKey: strategy.turnKey,
        stateRevision: strategy.stateRevision,
        requestId: 'req_fake_1',
        model: PINNED_JEV_MODEL,
        questionId: 'strategy',
        choice: 'skip',
        probabilities: { skip: 1, 'use-item:item-0': 0 },
        confidence: 1,
        sampled: null,
        fallbackReason: null,
      });
      expect(JSON.stringify(records)).not.toContain(PLACEHOLDER_KEY);
    });

    test('an Easy decision logs the sampled draw', async () => {
      const records: DecisionRecord[] = [];
      const app = testApp({
        jevClient: () => createFakeJevClient(pickSkip),
        decisionLog: (line) => records.push(line),
      });
      await decideApplied({ ...strategy, difficulty: 'easy' }, app);
      expect(records[0]!.sampled).toEqual(expect.any(Number));
      expect(records[0]!.sampled).toBeLessThan(2 ** 32);
    });

    test('a fallback decision logs its reason, with and without the orchestrator', async () => {
      const records: DecisionRecord[] = [];
      const log = (line: DecisionRecord) => records.push(line);
      await decideApplied(
        strategy,
        testApp({
          jevClient: () => createFakeJevClient(pickSkip),
          decisionLog: log,
          usage: overBudget,
        }),
      );
      vi.stubEnv('JEV_ENABLED', 'false');
      await decideApplied(encounter, testApp({ decisionLog: log }));
      expect(records.map((line) => [line.choice, line.fallbackReason, line.probabilities])).toEqual(
        [
          [policyChoice(strategy), 'budget_exceeded', null],
          [policyChoice(encounter), 'disabled', null],
        ],
      );
    });

    test('a Sell decision logs one event per question asked', async () => {
      const records: DecisionRecord[] = [];
      await decideApplied(
        sell,
        testApp({
          jevClient: () => createFakeJevClient(pickSkip),
          decisionLog: (line) => records.push(line),
        }),
      );
      expect(records.map((line) => [line.questionId, line.fallbackReason])).toEqual([
        ['sell_team_0', null],
        ['sell_team_1', null],
        ['sell_team_2', null],
      ]);
    });

    test('a Sell decision without sale facts logs one missing_facts event for the decision point', async () => {
      const records: DecisionRecord[] = [];
      await decideApplied(
        { ...sell, facts: {} },
        testApp({ decisionLog: (line) => records.push(line) }),
      );
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({ questionId: 'sell', fallbackReason: 'missing_facts' });
    });

    test('the file log appends one JSON line per record, creating its folder', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'jev-decisions-'));
      const path = join(dir, 'nested', 'jev-decisions.jsonl');
      const app = testApp({
        jevClient: () => createFakeJevClient(pickSkip),
        decisionLog: fileDecisionLog(path),
      });
      await decideApplied(strategy, app);
      await decideApplied({ ...strategy, turnKey: 'next' }, app);
      const lines = await vi.waitFor(() => {
        const written = readFileSync(path, 'utf8').trimEnd().split('\n');
        expect(written).toHaveLength(2);
        return written;
      });
      expect(lines.map((line) => JSON.parse(line).turnKey)).toEqual([strategy.turnKey, 'next']);
      expect(Object.keys(JSON.parse(lines[0]!)).sort()).toEqual(FIELDS);
    });

    test('the file log makes its folder again when it is removed while running', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const dir = mkdtempSync(join(tmpdir(), 'jev-decisions-'));
        const folder = join(dir, 'logs');
        const path = join(folder, 'jev-decisions.jsonl');
        const app = testApp({
          jevClient: () => createFakeJevClient(pickSkip),
          decisionLog: fileDecisionLog(path),
        });
        await decideApplied(strategy, app);
        await vi.waitFor(() => expect(readFileSync(path, 'utf8')).not.toBe(''));
        rmSync(folder, { recursive: true });
        await decideApplied({ ...strategy, turnKey: 'next' }, app);
        const lines = await vi.waitFor(() => {
          const written = readFileSync(path, 'utf8').trimEnd().split('\n');
          expect(written).toHaveLength(1);
          return written;
        });
        expect(JSON.parse(lines[0]!).turnKey).toBe('next');
        expect(warn).not.toHaveBeenCalled();
      } finally {
        warn.mockRestore();
      }
    });

    test('a file log that cannot write leaves the decision unchanged and warns once', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const dir = mkdtempSync(join(tmpdir(), 'jev-decisions-'));
        const blocker = join(dir, 'not-a-folder');
        writeFileSync(blocker, '');
        const withLog = testApp({
          jevClient: () => createFakeJevClient(pickSkip),
          decisionLog: fileDecisionLog(join(blocker, 'jev-decisions.jsonl')),
        });
        const without = testApp({ jevClient: () => createFakeJevClient(pickSkip) });
        const body = async (app: App, request: DecisionRequest) => {
          const response = await decideApplied(request, app);
          expect(response.status).toBe(200);
          const { choice, source, fallbackReason } = await response.json();
          return { choice, source, fallbackReason };
        };
        for (const turnKey of [strategy.turnKey, 'next'])
          expect(await body(withLog, { ...strategy, turnKey })).toEqual(
            await body(without, { ...strategy, turnKey }),
          );
        await vi.waitFor(() => expect(warn).toHaveBeenCalled());
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(warn).toHaveBeenCalledTimes(1);
      } finally {
        warn.mockRestore();
      }
    });

    test('a log that throws never fails the decision or leaks its error', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const app = testApp({
          jevClient: () => createFakeJevClient(pickSkip),
          decisionLog: () => {
            throw new Error(`disk full ${PLACEHOLDER_KEY}`);
          },
        });
        expect(await (await decideApplied(strategy, app)).json()).toMatchObject({ source: 'jev' });
        expect(
          await (await decideApplied({ ...strategy, turnKey: 'next' }, app)).json(),
        ).toMatchObject({
          source: 'jev',
        });
        expect(warn).toHaveBeenCalledTimes(1);
        expect(JSON.stringify(warn.mock.calls)).not.toContain(PLACEHOLDER_KEY);
      } finally {
        warn.mockRestore();
      }
    });
  });

  describe('the applied outcome (spec §6.8)', () => {
    const pickFirst = (request: JevRequest) => confident(request);
    const timedOut = (request: DecisionRequest) => ({
      ...outcomeFor(request, { choice: policyChoice(request) }),
      source: 'fallback',
      fallbackReason: 'timeout',
    });

    test('a delayed response: the browser used its fallback with timeout, so the log shows that', async () => {
      const records: DecisionRecord[] = [];
      const slow = createFakeJevClient(async (request) => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return pickFirst(request);
      });
      const app = testApp({ jevClient: () => slow, decisionLog: (line) => records.push(line) });
      // The browser's deadline passes while Jev is still answering: it applies its fallback.
      const pending = decide(strategy, app);
      expect((await report(timedOut(strategy), app)).status).toBe(204);
      const late = await (await pending).json();
      expect(late).toMatchObject({ choice: 'use-item:item-0', source: 'jev' });
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        choice: 'skip',
        fallbackReason: 'timeout',
        requestId: null,
        model: null,
        probabilities: null,
        questionId: 'strategy',
      });
      expect(records.map((line) => line.choice)).not.toContain('use-item:item-0');
    });

    test('the same when the browser reports after the late answer was produced', async () => {
      const records: DecisionRecord[] = [];
      const app = testApp({
        jevClient: () => createFakeJevClient(pickFirst),
        decisionLog: (line) => records.push(line),
      });
      await decide(strategy, app);
      expect(records).toHaveLength(0); // proposed, not yet applied
      await report(timedOut(strategy), app);
      expect(records.map((line) => [line.choice, line.fallbackReason])).toEqual([
        ['skip', 'timeout'],
      ]);
    });

    test('a speculative fallback is not a decision, and a decision never reported logs nothing', async () => {
      const records: DecisionRecord[] = [];
      const app = testApp({
        jevClient: () => createFakeJevClient(pickFirst),
        decisionLog: (line) => records.push(line),
      });
      const response = await app.request('/api/ai/fallback', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(strategy),
      });
      expect(response.status).toBe(200);
      await decide({ ...strategy, turnKey: 'unreported' }, app);
      expect(records).toHaveLength(0);
    });

    test('the answer applied as proposed keeps the server’s events, and one report logs once', async () => {
      const records: DecisionRecord[] = [];
      const app = testApp({
        jevClient: () => createFakeJevClient(pickFirst),
        decisionLog: (line) => records.push(line),
      });
      const response = await decide(strategy, app);
      const outcome = outcomeFor(strategy, await response.json());
      await report(outcome, app);
      await report(outcome, app);
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        choice: 'use-item:item-0',
        requestId: 'req_fake_1',
        confidence: 1,
        fallbackReason: null,
      });
    });

    test('a report that is not an outcome is a 400, and carries only IDs', async () => {
      const app = testApp({ decisionLog: () => {} });
      const good = timedOut(strategy);
      for (const bad of [
        { ...good, extra: 'state' },
        { ...good, fallbackReason: undefined },
        { ...good, source: 'jev' },
        { ...good, choice: undefined },
        { ...good, decisionPoint: 'trade' },
      ]) {
        expect((await report(bad, app)).status).toBe(400);
      }
      expect(
        (
          await app.request('/api/ai/outcome', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: '{',
          })
        ).status,
      ).toBe(400);
    });
  });

  test('when the client cannot be made the fallback policy decides, never the first action', async () => {
    const factory = vi.fn(() => {
      throw new Error(`cannot make a client ${PLACEHOLDER_KEY}`);
    });
    const app = testApp({ jevClient: factory });
    expect(strategy.enabledActions[0]!.id).toBe('use-item:item-0');
    const response = await decide(strategy, app);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      choice: policyChoice(strategy),
      source: 'fallback',
      fallbackReason: 'decider_error',
    });
    expect(body.choice).toBe('skip');
    // Nothing is cached from the failure: the next decision tries again.
    await decide(strategy, app);
    expect(factory).toHaveBeenCalledTimes(2);
  });

  test('a decision lands in the usage log without the key, and no console line carries it', async () => {
    const lines: UsageLine[] = [];
    const usage: UsageRecorder = {
      record: (line) => lines.push(line),
      budgetExceeded: () => false,
    };
    const spies = (['log', 'info', 'warn', 'error'] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => {}),
    );
    try {
      const fake = createFakeJevClient(pickSkip);
      await decide(strategy, testApp({ usage: () => usage, jevClient: () => fake }));
      await vi.waitFor(() => expect(lines).toHaveLength(1));
      expect(lines[0]).toMatchObject({ gameId: 'game-test-1', turnKey: strategy.turnKey });
      expect(JSON.stringify(lines)).not.toContain(PLACEHOLDER_KEY);
      for (const spy of spies)
        expect(JSON.stringify(spy.mock.calls)).not.toContain(PLACEHOLDER_KEY);
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });

  test('the real client is made only with Jev enabled and a key set', async () => {
    const make = vi.fn(() => offlineClient);
    vi.stubEnv('JEV_ENABLED', 'false');
    await decide(strategy, testApp({ jevClient: make }));
    vi.stubEnv('JEV_ENABLED', 'true');
    vi.stubEnv(KEY_ENV, undefined);
    await decide(strategy, testApp({ jevClient: make }));
    expect(make).not.toHaveBeenCalled();
    vi.stubEnv(KEY_ENV, PLACEHOLDER_KEY);
    await decide(strategy, testApp({ jevClient: make }));
    expect(make).toHaveBeenCalledTimes(1);
  });
});

// Criterion: web/ reaches the shared contract in engine/, never ai/ (spec §6 item 2, §7).
describe('import boundaries', () => {
  const eslint = new ESLint({ cwd: join(import.meta.dirname, '..') });
  const importErrors = async (code: string) => {
    const [result] = await eslint.lintText(code, { filePath: 'web/src/game/decide.ts' });
    return result!.messages.filter((message) => message.ruleId?.endsWith('no-restricted-imports'));
  };

  test('web/ may import the decision types from engine/contract/decision.ts', async () => {
    const code =
      "import type { DecisionRequest, DecisionResponse } from '../../../engine/contract/decision.ts';\n" +
      'export type Pair = [DecisionRequest, DecisionResponse];\n';
    expect(await importErrors(code)).toEqual([]);
  });

  test('web/ may not import from ai/', async () => {
    const code =
      "import type { Decider } from '../../../ai/decider.ts';\nexport type D = Decider;\n";
    expect(await importErrors(code)).not.toEqual([]);
  });
});

describe('responder decisions (spec §4.8, §5.3, §6 item 2; S06)', () => {
  /** Seat 0 asks seat 1 for a promise; seat 1 owes the answer while seat 0 stays active. */
  const pendingGame = () =>
    act(socialGame(3), 'offer_promise', { targetSeatIndex: 1, direction: 'offer' });
  const responderRequest = (
    state: GameState,
    seat: number,
    decisionPoint: DecisionRequest['decisionPoint'] = 'promise_response',
  ): DecisionRequest => {
    const observation = observe(state, seat);
    return {
      gameId: 'game-test-1',
      seatIndex: seat,
      decisionPoint,
      stateRevision: observation.public.stateRevision,
      observation,
      enabledActions: legalActions(state, seat).enabled,
      facts: {},
      difficulty: 'normal',
      personalityId: 'cautious',
      turnKey: `${seat}:1`,
    };
  };

  test("promise_response is answered with the responder's own accept or reject", async () => {
    const state = pendingGame();
    const request = responderRequest(state, 1);
    expect(request.enabledActions.map((action) => action.id)).toEqual([
      'respond:accept',
      'respond:reject',
    ]);
    const response = await decide(request);
    expect(response.status).toBe(200);
    const body = decisionResponseSchema.parse(await response.json());
    // The promise is a Jev question now (S09): the test app's client has no network, so the
    // fallback answers for that reason, not as an unasked `auto` decision.
    expect(body).toMatchObject({ source: 'fallback', fallbackReason: 'network' });
    expect(request.enabledActions.map((action) => action.id)).toContain(
      (body as { choice: string }).choice,
    );
  });

  test('only the pending-decision seat is accepted: not the initiator, a bystander or another point', async () => {
    const state = pendingGame();
    // The initiator is the active seat but owes nothing; seat 2 never sees the question.
    expect((await decide(responderRequest(state, 0))).status).toBe(400);
    expect((await decide(responderRequest(state, 2))).status).toBe(400);
    // The point must name the question the seat is asked: a promise is pending, not a Deal Card.
    expect((await decide(responderRequest(state, 1, 'deal_response'))).status).toBe(400);
    // A responder point with a non-respond action list is refused.
    const mixed = responderRequest(state, 1);
    const strategyActions = strategy.enabledActions;
    expect((await decide({ ...mixed, enabledActions: strategyActions })).status).toBe(400);
    // Without a pending question there is nothing to respond to.
    const idle = socialGame(3);
    expect(
      (await decide({ ...responderRequest(pendingGame(), 1), observation: observe(idle, 1) }))
        .status,
    ).toBe(400);
  });

  test('the orchestrator asks Jev the promise question and asks nothing for a deal point with no Deal Card pending', async () => {
    const state = pendingGame();
    const request = responderRequest(state, 1);
    const ask = vi.fn(async () => ({ ok: false as const, fallbackReason: 'network' as const }));
    const orchestrator = new Orchestrator({ client: { ask } });
    const decide = (decisionPoint: 'promise_response' | 'deal_response') =>
      orchestrator.decide({
        turnKey: 'k',
        observation: request.observation,
        legalActions: { enabled: request.enabledActions, disabled: [] },
        facts: {},
        difficulty: 'normal',
        personality: PERSONALITIES.greedy,
        decisionPoint,
        rng: createPolicyRng('r'),
      });
    // A deal point with no Deal Card pending has nothing to ask: it is applied without asking Jev.
    const deal = await decide('deal_response');
    expect(deal).toMatchObject({ source: 'auto', requests: 0 });
    expect(deal.events[0]!.questionId).toBe('deal_response');
    expect(ask).not.toHaveBeenCalled();
    const promise = await decide('promise_response');
    expect(promise).toMatchObject({ source: 'fallback', fallbackReason: 'network', requests: 1 });
    expect(promise.events[0]!.questionId).toBe('promise_response');
    expect(ask).toHaveBeenCalledTimes(1);
  });
});

describe('POST /api/ai/decide: the demo detail (spec §3, §1, §11 step 3)', () => {
  const pickSkip = (request: JevRequest) => confident(request, 'skip');
  const withDemo = (value: string | undefined) => vi.stubEnv('DEMO_MODE', value);

  test('with DEMO_MODE on, a Jev Choice carries the numbers copied from the answer', async () => {
    for (const value of ['1', 'true']) {
      withDemo(value);
      const fake = createFakeJevClient(pickSkip);
      const body = await (await decide(strategy, testApp({ jevClient: () => fake }))).json();
      expect(decisionResponseSchema.parse(body)).toEqual(body);
      expect(body.source).toBe('jev');
      expect(body.detail.confidence).toBe(1);
      expect(body.detail.options.find((o: { id: string }) => o.id === 'skip')).toEqual({
        id: 'skip',
        probability: 1,
      });
      expect(body.detail.options.map((o: { id: string }) => o.id).sort()).toEqual(
        strategy.enabledActions.map((a) => a.id).sort(),
      );
    }
  });

  test('with DEMO_MODE on, a Jev Sell Phase lists each Pokémon instance ID with its sale probability', async () => {
    withDemo('1');
    const fake = createFakeJevClient(pickSkip);
    const body = await (await decide(sell, testApp({ jevClient: () => fake }))).json();
    expect(decisionResponseSchema.parse(body)).toEqual(body);
    expect(body.detail.questionId).toBe('sell');
    expect(body.detail.confidence).toBeNull();
    expect(body.detail.options).toHaveLength(3);
    for (const option of body.detail.options) expect(option.probability).toBe(0.9);
  });

  test.each([undefined, '0', 'false', '', 'TRUE', 'yes', ' 1'])(
    'DEMO_MODE=%j: no detail field at all',
    async (value) => {
      withDemo(value);
      const fake = createFakeJevClient(pickSkip);
      const app = testApp({ jevClient: () => fake });
      for (const request of [strategy, encounter, sell]) {
        const body = await (await decide(request, app)).json();
        expect(body.source).toBe('jev');
        expect(body).not.toHaveProperty('detail');
        expect(decisionResponseSchema.parse(body)).toEqual(body);
      }
    },
  );

  test('with DEMO_MODE off, a query string, a header or a body field cannot turn the detail on', async () => {
    withDemo(undefined);
    const app = testApp({ jevClient: () => createFakeJevClient(pickSkip) });
    const post = (url: string, headers: Record<string, string>, payload: object) =>
      app.request(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(payload),
      });
    for (const url of ['/api/ai/decide?demo=1', '/api/ai/decide?demo=true&DEMO_MODE=1']) {
      const body = await (
        await post(url, { 'x-demo': '1', 'x-demo-mode': 'true', demo: '1' }, strategy)
      ).json();
      expect(body.source).toBe('jev');
      expect(body).not.toHaveProperty('detail');
    }
    const forged = await post('/api/ai/decide', {}, { ...strategy, demo: true });
    expect(forged.status).toBe(400);
    const status = await (
      await app.request('/api/ai/status?demo=1', { headers: { 'x-demo': '1' } })
    ).json();
    expect(status.demo).toBe(false);
  });

  test('with DEMO_MODE on, a fallback, an auto decision and the fallback route carry no detail', async () => {
    withDemo('1');
    vi.stubEnv('JEV_ENABLED', 'false');
    const app = testApp({ jevClient: () => createFakeJevClient(pickSkip) });
    for (const request of [strategy, encounter, sell]) {
      const body = await (await decide(request, app)).json();
      expect(body.source).toBe('fallback');
      expect(body).not.toHaveProperty('detail');
    }
    const routed = await (
      await app.request('/api/ai/fallback', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(strategy),
      })
    ).json();
    expect(routed).not.toHaveProperty('detail');
    vi.stubEnv('JEV_ENABLED', undefined);
    const down = await (await decide(strategy, testApp())).json();
    expect(down.source).toBe('fallback');
    expect(down).not.toHaveProperty('detail');
  });

  test('the demo status and detail never carry the key or budget figures', async () => {
    withDemo('1');
    const fake = createFakeJevClient(pickSkip);
    const app = testApp({ jevClient: () => fake });
    for (const response of [await status(app), await decide(strategy, app)]) {
      const text = await response.text();
      expect(text).not.toContain(PLACEHOLDER_KEY);
      expect(text).not.toMatch(/budget(?!_exceeded)|spend|token|cost/i);
    }
  });
});
