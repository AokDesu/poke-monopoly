import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ESLint } from 'eslint';
import { afterAll, afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { decisionResponseSchema, type DecisionRequest } from '../engine/contract/decision.ts';
import { fixtureSchema, oddsForAllBalls } from '../engine/index.ts';
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
    facts: decisionPoint === 'encounter' ? { catchOdds: oddsForAllBalls(fixture.state, seat) } : {},
    difficulty: 'normal',
    personalityId: 'cautious',
    turnKey: `${seat}:${observation.public.globalTurnNo}`,
  };
};

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
  test('reports Jev on when enabled with a key', async () => {
    expect(await (await status()).json()).toEqual({
      jevEnabled: true,
      backupOnly: false,
      reason: null,
    });
  });

  test('reports backup-only mode under the kill switch', async () => {
    vi.stubEnv('JEV_ENABLED', 'false');
    vi.stubEnv(KEY_ENV, undefined);
    expect(await (await status()).json()).toEqual({
      jevEnabled: false,
      backupOnly: true,
      reason: 'disabled',
    });
  });

  test('reports backup-only mode once the spend cap or daily budget is reached', async () => {
    expect(await (await status(testApp({ usage: overBudget }))).json()).toEqual({
      jevEnabled: true,
      backupOnly: true,
      reason: 'budget_exceeded',
    });
  });

  test('reports backup-only mode when the key is missing', async () => {
    vi.stubEnv(KEY_ENV, undefined);
    expect(await (await status()).json()).toEqual({
      jevEnabled: true,
      backupOnly: true,
      reason: 'missing_key',
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

  test('a Sell Phase has no sale facts on the wire yet, so the policy sells', async () => {
    const fake = createFakeJevClient(pickSkip);
    const body = await (await decide(sell, testApp({ jevClient: () => fake }))).json();
    expect(body).toMatchObject({ source: 'fallback', fallbackReason: 'missing_facts' });
    expect(fake.requests).toHaveLength(0);
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
      await decide(strategy, app);
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
      await decide({ ...strategy, difficulty: 'easy' }, app);
      expect(records[0]!.sampled).toEqual(expect.any(Number));
      expect(records[0]!.sampled).toBeLessThan(2 ** 32);
    });

    test('a fallback decision logs its reason, with and without the orchestrator', async () => {
      const records: DecisionRecord[] = [];
      const log = (line: DecisionRecord) => records.push(line);
      await decide(
        strategy,
        testApp({
          jevClient: () => createFakeJevClient(pickSkip),
          decisionLog: log,
          usage: overBudget,
        }),
      );
      vi.stubEnv('JEV_ENABLED', 'false');
      await decide(encounter, testApp({ decisionLog: log }));
      expect(records.map((line) => [line.choice, line.fallbackReason, line.probabilities])).toEqual(
        [
          [policyChoice(strategy), 'budget_exceeded', null],
          [policyChoice(encounter), 'disabled', null],
        ],
      );
    });

    test('a Sell decision logs one event per question asked', async () => {
      const records: DecisionRecord[] = [];
      await decide(sell, testApp({ decisionLog: (line) => records.push(line) }));
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
      await decide(strategy, app);
      await decide({ ...strategy, turnKey: 'next' }, app);
      const lines = readFileSync(path, 'utf8').trimEnd().split('\n');
      expect(lines.map((line) => JSON.parse(line).turnKey)).toEqual([strategy.turnKey, 'next']);
      expect(Object.keys(JSON.parse(lines[0]!)).sort()).toEqual(FIELDS);
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
        expect(await (await decide(strategy, app)).json()).toMatchObject({ source: 'jev' });
        expect(JSON.stringify(warn.mock.calls)).not.toContain(PLACEHOLDER_KEY);
      } finally {
        warn.mockRestore();
      }
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
