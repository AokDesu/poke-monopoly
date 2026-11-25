import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  aiStatusSchema,
  decisionResponseSchema,
  type DecisionRequest,
} from '../engine/contract/decision.ts';
import {
  fixtureSchema,
  legalActions,
  observe,
  pendingDecision,
  type GameState,
} from '../engine/index.ts';
import { decisionStates } from '../engine/rollout-testing.ts';
import encounterFixture from '../engine/fixtures/encounter-with-balls.json';
import strategyFixture from '../engine/fixtures/strategy-with-items.json';
import { createPolicyRng } from '../sim/policy.ts';
import { createApp } from './app.ts';
import { FallbackPolicy, PERSONALITIES } from './fallback/index.ts';
import { hardOutcomes } from './hard.ts';
import { PINNED_JEV_MODEL, type JevAnswer, type JevRequest, type JevResult } from './jev/client.ts';
import { createFakeJevClient } from './jev/fake.ts';
import {
  costUsd,
  openUsageLedger,
  readUsageLog,
  SPEND_CONFIG,
  SpendLedger,
  type UsageLine,
  type UsageRecorder,
} from './jev/spend.ts';
import { DecisionJournal } from './jev/decision-journal.ts';
import { isStrategyQuestionAction } from './questions/strategy.ts';

// Server audit follow-ups (#64), findings 4, 6 and 9 (spec §9, §5.6, §8). Offline only: Hono's
// in-memory `app.request()`, a fake Jev client, a placeholder key and no network.
const SAME_ORIGIN = {
  host: 'localhost:5173',
  origin: 'http://localhost:5173',
  'content-type': 'application/json',
};
const PLACEHOLDER_KEY = 'placeholder-key-not-real-4b1e8d';

type App = ReturnType<typeof createApp>;

beforeEach(() => {
  vi.stubEnv('JEV_ENABLED', 'true');
  vi.stubEnv('TYPESAFE_API_KEY', PLACEHOLDER_KEY);
  vi.stubEnv('HAIKU_ENABLED', 'false');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const requestFor = (json: unknown): DecisionRequest => {
  const fixture = fixtureSchema.parse(json);
  const seat = fixture.state.activeSeatIndex;
  const observation = fixture.observation[String(seat)]!;
  return {
    gameId: 'game-audit-1',
    seatIndex: seat,
    decisionPoint: observation.public.phase.kind as DecisionRequest['decisionPoint'],
    stateRevision: observation.public.stateRevision,
    observation,
    enabledActions: fixture.legalActions[String(seat)]!.enabled,
    facts: {},
    difficulty: 'normal',
    personalityId: 'greedy',
    turnKey: `${seat}:${observation.public.globalTurnNo}`,
  };
};
const strategy = requestFor(strategyFixture);
const encounter = requestFor(encounterFixture);

const decide = async (app: App, body: unknown, path = '/api/ai/decide') =>
  await app.request(path, { method: 'POST', headers: SAME_ORIGIN, body: JSON.stringify(body) });
const getStatus = (app: App) => app.request('/api/ai/status', { headers: { host: 'localhost' } });

/** Jev answers every Choice with full confidence in its first label. */
const confident = (request: JevRequest): JevResult => {
  const answers: Record<string, JevAnswer> = {};
  for (const [name, question] of Object.entries(request.questions)) {
    if (question.type === 'noul') {
      answers[name] = { type: 'noul', noul: 0.9 };
      continue;
    }
    const labels = Object.keys(question.criteria);
    answers[name] = {
      type: 'choice',
      choice: labels[0]!,
      confidence: 1,
      probabilities: Object.fromEntries(labels.map((label, i) => [label, i === 0 ? 1 : 0])),
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

/** The fallback policy's choice for a request, as `decide` seeds it. */
const policyChoice = (request: DecisionRequest) =>
  new FallbackPolicy(PERSONALITIES.greedy).decide(
    request.observation,
    { enabled: request.enabledActions, disabled: [] },
    createPolicyRng(`${request.gameId}:${request.turnKey}:${request.stateRevision}`),
    request.facts.catchOdds && undefined,
  );

const nextTick = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('finding 4: concurrent decisions cannot pass the spend guard together past the cap', () => {
  /** What one Jev request is counted at before its real usage is known (spec §9, issue #48). */
  const estimateThb =
    costUsd({ inputTokens: SPEND_CONFIG.estimatedInputTokensPerRequest, outputTokens: 0 }) *
    SPEND_CONFIG.thbPerUsd;

  test('a reservation is refused once spent plus reserved reaches the cap, and released on settle', () => {
    const ledger = new SpendLedger({
      config: { ...SPEND_CONFIG, totalCapThb: estimateThb * 2.5 },
    });
    const first = ledger.reserve();
    expect(ledger.reserve()).toBeTypeOf('function');
    expect(ledger.reserve()).toBeTypeOf('function'); // the request that reaches the cap is the last
    expect(first).toBeTypeOf('function');
    expect(ledger.reserve()).toBeNull();
    expect(ledger.budgetExceeded()).toBe(true);
    first!();
    first!(); // releasing twice never frees more than was held
    expect(ledger.reservedThb()).toBeCloseTo(estimateThb * 2, 9);
    expect(ledger.budgetExceeded()).toBe(false);
    expect(ledger.reserve()).toBeTypeOf('function');
    expect(ledger.reserve()).toBeNull();
  });

  test('N parallel decisions at a cap that allows fewer send no more than the cap', async () => {
    const allowed = 3;
    const parallel = 12;
    const lines: UsageLine[] = [];
    const ledger = new SpendLedger({
      config: { ...SPEND_CONFIG, totalCapThb: estimateThb * (allowed - 0.5) },
      append: (line) => lines.push(line),
    });
    // The client holds every answer until all decisions have asked, as slow concurrent requests do.
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const client = createFakeJevClient(async (request) => {
      await gate;
      return confident(request);
    });
    const app = createApp({ usage: () => ledger, jevClient: () => client, decisionLog: () => {} });
    const responses = Array.from({ length: parallel }, (_, i) =>
      decide(app, { ...strategy, gameId: `game-${i}`, turnKey: `turn-${i}` }),
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    release();
    const bodies = await Promise.all(
      responses.map(async (response) =>
        decisionResponseSchema.parse(await (await response).json()),
      ),
    );
    expect(client.requests).toHaveLength(allowed);
    const refused = bodies.filter((body) => body.fallbackReason === 'budget_exceeded');
    expect(refused).toHaveLength(parallel - allowed);
    expect(bodies.filter((body) => body.source === 'jev')).toHaveLength(allowed);
    // Every reservation is settled once the usage lines are in, so none is held for good.
    await vi.waitFor(() => expect(lines).toHaveLength(allowed));
    expect(ledger.reservedThb()).toBe(0);
  });

  test('a request that fails before it goes out gives its reservation back', async () => {
    const ledger = new SpendLedger({
      config: { ...SPEND_CONFIG, totalCapThb: estimateThb * 1.5 },
    });
    const client = createFakeJevClient(async () => ({ ok: false, fallbackReason: 'network' }));
    const app = createApp({ usage: () => ledger, jevClient: () => client, decisionLog: () => {} });
    for (let i = 0; i < 4; i++) {
      await decide(app, { ...strategy, gameId: `game-${i}`, turnKey: `turn-${i}` });
    }
    await vi.waitFor(() => expect(ledger.reservedThb()).toBe(0));
    expect(client.requests.length).toBeGreaterThanOrEqual(2);
  });
});

describe('finding 6: a throwing ledger never turns a decision into the first enabled action', () => {
  const SECRET = 'EACCES: /home/secret/logs/jev-usage.jsonl';
  const throwingOpen = (): UsageRecorder => {
    throw new Error(SECRET);
  };
  const throwingGuard = (): UsageRecorder => ({
    record: () => {},
    budgetExceeded: () => {
      throw new TypeError(SECRET);
    },
  });

  const warned = () => vi.spyOn(console, 'warn').mockImplementation(() => {});
  const logged = (spy: ReturnType<typeof warned>) => JSON.stringify(spy.mock.calls);

  test.each([
    ['opening the ledger', throwingOpen],
    ['asking the guard', throwingGuard],
  ])(
    '%s throws: the status route answers truthfully and logs the class only',
    async (_n, usage) => {
      const spy = warned();
      const app = createApp({ usage, jevClient: () => createFakeJevClient(confident) });
      const response = await getStatus(app);
      expect(response.status).toBe(200);
      expect(aiStatusSchema.parse(await response.json())).toMatchObject({
        jevEnabled: true,
        backupOnly: true,
        reason: 'budget_exceeded',
      });
      expect(logged(spy)).toMatch(/Error/);
      expect(logged(spy)).not.toContain('secret');
      expect(logged(spy)).not.toContain('EACCES');
    },
  );

  test.each([
    ['opening the ledger', throwingOpen],
    ['asking the guard', throwingGuard],
  ])('%s throws: decide falls back with a named reason, by the policy', async (_n, usage) => {
    const spy = warned();
    const client = createFakeJevClient(confident);
    const app = createApp({ usage, jevClient: () => client, decisionLog: () => {} });
    for (const request of [strategy, encounter]) {
      const response = await decide(app, request);
      expect(response.status).toBe(200);
      const body = decisionResponseSchema.parse(await response.json());
      expect(body).toMatchObject({ source: 'fallback', fallbackReason: 'budget_exceeded' });
      expect(body).toMatchObject({ choice: policyChoice(request) });
    }
    // The two fixtures are the ones the policy does not answer with the first action.
    expect(policyChoice(strategy)).not.toBe(strategy.enabledActions[0]!.id);
    expect(client.requests).toHaveLength(0);
    expect(logged(spy)).not.toContain('secret');
    expect(logged(spy)).not.toContain('EACCES');
  });

  test('the fallback route also answers, never a 500', async () => {
    warned();
    const app = createApp({ usage: throwingOpen, jevClient: () => createFakeJevClient(confident) });
    const response = await decide(app, strategy, '/api/ai/fallback');
    expect(response.status).toBe(200);
    expect(decisionResponseSchema.parse(await response.json())).toMatchObject({
      source: 'fallback',
      fallbackReason: 'budget_exceeded',
    });
  });

  test('a guard that fails in the middle of a decision falls back by the policy, not the first action', async () => {
    const spy = warned();
    let calls = 0;
    // The status check passes; the orchestrator's own check then throws.
    const usage = (): UsageRecorder => ({
      record: () => {},
      budgetExceeded: () => {
        if (++calls > 1) throw new RangeError(SECRET);
        return false;
      },
    });
    const app = createApp({
      usage,
      jevClient: () => createFakeJevClient(confident),
      decisionLog: () => {},
    });
    const body = decisionResponseSchema.parse(await (await decide(app, strategy)).json());
    expect(body).toMatchObject({ source: 'fallback', fallbackReason: 'budget_exceeded' });
    expect(body).toMatchObject({ choice: policyChoice(strategy) });
    expect(logged(spy)).not.toContain('secret');
  });

  test('a ledger that cannot write the usage line still lets the decision through, logging the class only', async () => {
    const spy = warned();
    const ledger = new SpendLedger({
      append: () => {
        throw new Error(SECRET);
      },
    });
    const app = createApp({
      usage: () => ledger,
      jevClient: () => createFakeJevClient(confident),
      decisionLog: () => {},
    });
    const body = decisionResponseSchema.parse(await (await decide(app, strategy)).json());
    expect(body.source).toBe('jev');
    await vi.waitFor(() => expect(spy).toHaveBeenCalled());
    expect(logged(spy)).toMatch(/Error/);
    expect(logged(spy)).not.toContain('secret');
    expect(logged(spy)).not.toContain('EACCES');
    // The line was counted before the write failed, so the guard still sees the spend.
    expect(ledger.spentThb()).toBeGreaterThan(0);
  });

  test('Voice is off, not a 500, when the ledger throws while Haiku is on', async () => {
    vi.stubEnv('HAIKU_ENABLED', 'true');
    vi.stubEnv('ANTHROPIC_API_KEY', 'placeholder-haiku-key-not-real-7c2d');
    const spy = warned();
    const app = createApp({
      usage: throwingGuard,
      jevClient: () => createFakeJevClient(confident),
    });
    const response = await getStatus(app);
    expect(response.status).toBe(200);
    expect(aiStatusSchema.parse(await response.json()).speech).toEqual({
      enabled: false,
      reason: 'budget_exceeded',
    });
    expect(logged(spy)).not.toContain('EACCES');
  });

  test('any other 500 is logged by class only, and the body stays internal_error', async () => {
    vi.stubEnv('DEMO_MODE', '1');
    const spy = warned();
    // A demo-mode answer whose detail is malformed fails the response schema inside the route.
    const app = createApp({
      usage: () => new SpendLedger(),
      decider: async () =>
        ({
          choice: strategy.enabledActions[0]!.id,
          source: 'jev',
          detail: { secret: SECRET },
        }) as never,
      decisionLog: () => {},
    });
    const response = await decide(app, strategy);
    expect(response.status).toBe(500);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({ error: 'internal_error' });
    expect(logged(spy)).toMatch(/Error/);
    expect(logged(spy)).not.toContain('secret');
    expect(logged(spy)).not.toContain('EACCES');
  });
});

/** A real Hard rollout is CPU work; on a loaded machine it needs more than vitest's default 5 s. */
const ROLLOUT_TEST_BUDGET_MS = 30_000;

describe('finding 9: Hard rollouts let other requests through while they run', () => {
  const findState = (match: (state: GameState) => boolean): GameState => {
    for (let seed = 1; seed < 60; seed++) {
      const found = decisionStates(seed, { seats: 2 + (seed % 3), every: 1, limit: 400 }).find(
        match,
      );
      if (found) return found;
    }
    throw new Error('No matching real decision state');
  };
  const seatOf = (state: GameState) => pendingDecision(state)!.seatIndex;
  const state = findState((candidate) => {
    if (candidate.phase.kind !== 'strategy' || candidate.pendingResponse) return false;
    const enabled = legalActions(candidate, seatOf(candidate)).enabled;
    return enabled.filter(isStrategyQuestionAction).length >= 2 && enabled.length >= 2;
  });
  const hardRequest = (gameId: string): DecisionRequest => {
    const seat = seatOf(state);
    const observation = observe(state, seat);
    return {
      gameId,
      seatIndex: seat,
      decisionPoint: 'strategy',
      stateRevision: observation.public.stateRevision,
      observation,
      enabledActions: legalActions(state, seat).enabled,
      facts: {},
      difficulty: 'hard',
      personalityId: 'greedy',
      turnKey: `${seat}:${observation.public.globalTurnNo}`,
    };
  };
  const sampleRollout = () => {
    const request = hardRequest('probe');
    const started = performance.now();
    const outcomes = hardOutcomes({
      observation: request.observation,
      legalActions: { enabled: request.enabledActions, disabled: [] },
      personality: PERSONALITIES.greedy,
      seed: 1,
    });
    return { ms: performance.now() - started, outcomes };
  };

  test(
    'the rollout is real: it adds buckets, and takes long enough to block a loop',
    { timeout: ROLLOUT_TEST_BUDGET_MS },
    () => {
      const { ms, outcomes } = sampleRollout();
      expect(outcomes).toBeDefined();
      // The ratio checks below mean something only when the whole rollout is far longer than one world.
      expect(ms).toBeGreaterThan(20);
    },
  );

  test(
    'a status request and a second seat decision are answered while a rollout runs',
    { timeout: ROLLOUT_TEST_BUDGET_MS },
    async () => {
      const { ms: wholeRollout } = sampleRollout();
      const client = createFakeJevClient(confident);
      const app = createApp({ usage: () => new SpendLedger(), jevClient: () => client });
      let hardDone = false;
      const hard = decide(app, hardRequest('game-hard')).then((response) => {
        hardDone = true;
        return response;
      });
      // The rollout starts a few ticks in, once the request body is read; probe from then on.
      await nextTick();
      const gaps: number[] = [];
      const secondSeat: number[] = [];
      let last = performance.now();
      let probes = 0;
      while (!hardDone) {
        const started = performance.now();
        const status = await getStatus(app);
        expect(status.status).toBe(200);
        gaps.push(performance.now() - last);
        last = performance.now();
        if (++probes === 3) {
          const second = await decide(app, { ...strategy, gameId: 'game-second' });
          expect(second.status).toBe(200);
          secondSeat.push(performance.now() - started);
        }
        await nextTick();
      }
      expect((await hard).status).toBe(200);
      // Within the 400 ms limit nothing waits for a whole rollout: the longest gap between two
      // answers is a fraction of it (one option of one sampled world is a small share of it), where a blocking rollout has
      // a gap as long as the rollout itself.
      expect(Math.max(...gaps)).toBeLessThan(wholeRollout / 2);
      expect(secondSeat[0]).toBeLessThan(wholeRollout / 2);
    },
  );
});

describe('finding 5: a damaged usage log never undercounts spend (spec §9)', () => {
  const estimateThb =
    costUsd({ inputTokens: SPEND_CONFIG.estimatedInputTokensPerRequest, outputTokens: 0 }) *
    SPEND_CONFIG.thbPerUsd;
  const logFile = () => join(mkdtempSync(join(tmpdir(), 'jev-usage-')), 'jev-usage.jsonl');
  const goodLine = JSON.stringify({
    time: '2026-11-20T10:00:00.000Z',
    gameId: 'g',
    requestId: null,
    model: PINNED_JEV_MODEL,
    inputTokens: 1000,
    outputTokens: 0,
    latencyMs: 5,
    status: 'ok',
    turnKey: 't',
    decision: 0,
    decisionMs: 5,
  });
  // A line that says nothing of its provider counts at the dearer one, which is Haiku's estimate.
  const unknownThb =
    costUsd({
      provider: 'haiku',
      inputTokens: SPEND_CONFIG.estimatedHaikuInputTokensPerRequest,
      outputTokens: SPEND_CONFIG.estimatedHaikuOutputTokensPerRequest,
    }) * SPEND_CONFIG.thbPerUsd;
  const goodThb = costUsd({ inputTokens: 1000, outputTokens: 0 }) * SPEND_CONFIG.thbPerUsd;

  test('each unreadable line counts as a request, and the guard trips at the cap through the status route', async () => {
    const file = logFile();
    writeFileSync(
      file,
      `${goodLine}\n{"time":"2026-11-20T10:00:01.000Z","gameId":"g","inpu\nnot json at all\n`,
    );
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ledger = openUsageLedger(file, {
      config: { ...SPEND_CONFIG, totalCapThb: goodThb + estimateThb + unknownThb * 1.5 },
    });
    expect(ledger.spentThb()).toBeCloseTo(goodThb + estimateThb + unknownThb, 9);
    expect(ledger.budgetExceeded()).toBe(false);
    const app = createApp({ usage: () => ledger, decisionLog: () => {} });
    expect(aiStatusSchema.parse(await (await getStatus(app)).json()).reason).toBeNull();
    // A third unreadable line (the log's own damage grows) pushes the same cap over.
    writeFileSync(file, `${readFileSync(file, 'utf8')}{"oops\n`);
    const again = openUsageLedger(file, {
      config: { ...SPEND_CONFIG, totalCapThb: goodThb + estimateThb + unknownThb * 1.5 },
    });
    const status = aiStatusSchema.parse(
      await (await getStatus(createApp({ usage: () => again, decisionLog: () => {} }))).json(),
    );
    expect(status).toMatchObject({ backupOnly: true, reason: 'budget_exceeded' });
  });

  test('a damaged line counts the tokens it still shows when that is more than the estimate', () => {
    const file = logFile();
    writeFileSync(file, '{"provider":"haiku","gameId":"g","inputTokens":900000,"outp\n');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ledger = openUsageLedger(file);
    expect(ledger.spentThb('haiku')).toBeGreaterThan(
      costUsd({ provider: 'haiku', inputTokens: 900_000, outputTokens: 0 }) *
        SPEND_CONFIG.thbPerUsd,
    );
  });

  test('the warning names line numbers and never the content', () => {
    const file = logFile();
    writeFileSync(file, `${goodLine}\nSECRET-DEBRIS-7c1\n`);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    openUsageLedger(file);
    expect(JSON.stringify(warn.mock.calls)).toMatch(/line 2/);
    expect(JSON.stringify(warn.mock.calls)).not.toContain('SECRET-DEBRIS');
  });

  test('a log cut short mid-line does not swallow the next line', () => {
    const file = logFile();
    writeFileSync(file, `${goodLine}\n{"time":"2026-11-20T10:00:01.000Z","gameId":"g","inpu`);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ledger = openUsageLedger(file);
    ledger.record(JSON.parse(goodLine));
    ledger.record(JSON.parse(goodLine));
    const parsed = readUsageLog(file);
    expect(parsed.lines).toHaveLength(3);
    expect(parsed.invalid).toEqual([2]);
    // The next start counts the debris once and every real line once.
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(openUsageLedger(file).spentThb()).toBeCloseTo(goodThb * 3 + estimateThb, 9);
  });
});

describe('finding 8: every client string is bounded before it reaches the decision log (spec §9)', () => {
  const outcome = (over: Record<string, unknown> = {}) => ({
    gameId: 'game-audit-1',
    seatIndex: 0,
    turnKey: '0:1',
    stateRevision: 1,
    decisionPoint: 'strategy',
    source: 'fallback',
    fallbackReason: 'timeout',
    choice: 'skip',
    ...over,
  });
  const seen: unknown[] = [];
  const logApp = () => createApp({ decisionLog: (record) => seen.push(record) });

  beforeEach(() => {
    seen.length = 0;
  });

  test('a normal outcome is logged with exactly its explicit fields', async () => {
    const app = logApp();
    // No key in this file's environment for the decider: the server falls back, and the browser applies that.
    vi.stubEnv('TYPESAFE_API_KEY', '');
    const answered = decisionResponseSchema.parse(await (await decide(app, strategy)).json());
    const response = await decide(
      app,
      outcome({
        seatIndex: strategy.seatIndex,
        turnKey: strategy.turnKey,
        stateRevision: strategy.stateRevision,
        decisionPoint: strategy.decisionPoint,
        choice: (answered as { choice: string }).choice,
        fallbackReason: answered.fallbackReason,
      }),
      '/api/ai/outcome',
    );
    expect(response.status).toBe(204);
    expect(seen).toHaveLength(1);
    expect(Object.keys(seen[0] as object).sort()).toEqual(
      [
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
      ].sort(),
    );
  });

  test.each([
    ['a game ID with a newline', { gameId: 'g\n{"forged":true}' }],
    ['a game ID with spaces', { gameId: 'my game' }],
    ['a game ID of 65 characters', { gameId: 'g'.repeat(65) }],
    ['a turn key of 129 characters', { turnKey: 't'.repeat(129) }],
    ['a turn key with a quote', { turnKey: '0:1"' }],
    ['a choice with a newline', { choice: 'skip\nnext' }],
    ['a choice of 513 characters', { choice: 'a'.repeat(513) }],
    ['a Sell uid with a slash', { choice: undefined, sellUids: ['../etc/passwd'] }],
  ])('%s is a 400 and writes nothing', async (_name, over) => {
    const app = logApp();
    const response = await decide(app, outcome(over), '/api/ai/outcome');
    expect(response.status).toBe(400);
    expect(seen).toHaveLength(0);
  });

  test('the same IDs are refused on every route that takes them', async () => {
    const app = logApp();
    for (const path of ['/api/ai/decide', '/api/ai/fallback']) {
      expect((await decide(app, { ...strategy, gameId: 'bad id' }, path)).status).toBe(400);
      expect((await decide(app, { ...strategy, turnKey: 'x'.repeat(129) }, path)).status).toBe(400);
    }
    expect((await decide(app, { gameId: 'bad id' }, '/api/ai/chat')).status).toBe(400);
    expect((await decide(app, { gameId: 'bad id' }, '/api/ai/speak')).status).toBe(400);
  });

  test('the journal itself drops a record with an unsafe string, warning once and never with the text', () => {
    const records: unknown[] = [];
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const journal = new DecisionJournal((record) => records.push(record));
    const ids = { gameId: 'g', seatIndex: 0, turnKey: '0:1', stateRevision: 1, decisionPoint: 's' };
    const answer = { source: 'fallback', fallbackReason: 'timeout' } as const;
    for (const choice of ['ok-1', 'bad\nchoice', 'bad"choice']) {
      journal.propose({ ...ids, stateRevision: records.length + 10 }, { ...answer, choice }, []);
      journal.applied({ ...ids, stateRevision: records.length + 10 }, { ...answer, choice });
    }
    expect(records).toHaveLength(1);
    expect(warn).toHaveBeenCalledOnce();
    expect(JSON.stringify(warn.mock.calls)).not.toContain('bad');
  });
});
