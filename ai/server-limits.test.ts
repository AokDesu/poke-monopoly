import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { chatReplySchema } from '../engine/contract/chat-reply.ts';
import { decisionResponseSchema, type DecisionRequest } from '../engine/contract/decision.ts';
import { speakResponseSchema } from '../engine/contract/speech.ts';
import { toEngineContent } from '../content/schema.ts';
import startFixture from '../engine/fixtures/start-of-game-2p.json';
import strategyFixture from '../engine/fixtures/strategy-with-items.json';
import {
  applyAction,
  createGame,
  createGameConfig,
  fixtureSchema,
  observe,
  type GameState,
} from '../engine/index.ts';
import { JevAdmission, MAX_TRACKED_GAMES, QuotaBook } from './admission.ts';
import { createApp } from './app.ts';
import { createOrchestratorDecider } from './decider.ts';
import { createFakeHaikuClient } from './haiku/fake.ts';
import { PINNED_HAIKU_MODEL } from './haiku/client.ts';
import { PINNED_JEV_MODEL, type JevAnswer, type JevRequest, type JevResult } from './jev/client.ts';
import { createFakeJevClient } from './jev/fake.ts';
import { SpendLedger } from './jev/spend.ts';
import { RequestWindow } from './jev/window.ts';
import { createManipulationGate } from './speech/gate.ts';
import { CONTENT } from './questions/content.ts';

// Server audit follow-up (#64), finding 3 (spec §9): a client that invents a fresh game ID or turn
// key on every request gets no fresh budget, and chat and the speech gate have the caps a Jev
// decision has. Offline only: Hono's in-memory `app.request()`, fake clients and no network.
const SAME_ORIGIN = {
  host: 'localhost:5173',
  origin: 'http://localhost:5173',
  'content-type': 'application/json',
};

beforeEach(() => {
  vi.stubEnv('JEV_ENABLED', 'true');
  vi.stubEnv('TYPESAFE_API_KEY', 'placeholder-key-not-real-4b1e8d');
  vi.stubEnv('HAIKU_ENABLED', 'false');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

type App = ReturnType<typeof createApp>;
const post = (app: App, path: string, body: unknown) =>
  app.request(path, { method: 'POST', headers: SAME_ORIGIN, body: JSON.stringify(body) });

const fixture = fixtureSchema.parse(strategyFixture);
const seat = fixture.state.activeSeatIndex;
const observation = fixture.observation[String(seat)]!;
const strategy: DecisionRequest = {
  gameId: 'game-limits-1',
  seatIndex: seat,
  decisionPoint: 'strategy',
  stateRevision: observation.public.stateRevision,
  observation,
  enabledActions: fixture.legalActions[String(seat)]!.enabled,
  facts: {},
  difficulty: 'normal',
  personalityId: 'greedy',
  turnKey: 'turn-1',
};

/** Jev answers every question with full confidence in its first label. */
const confident = (request: JevRequest, inputTokens = 100): JevResult => {
  const answers: Record<string, JevAnswer> = {};
  for (const [name, question] of Object.entries(request.questions)) {
    if (question.type === 'noul') {
      answers[name] = { type: 'noul', noul: 0.01 };
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
    usage: { inputTokens, outputTokens: 0 },
  };
};

const decide = async (app: App, over: Partial<DecisionRequest>) =>
  decisionResponseSchema.parse(
    await (await post(app, '/api/ai/decide', { ...strategy, ...over })).json(),
  );

describe('a fresh ID on every request gets no fresh budget', () => {
  test('fresh game IDs and turn keys cannot send more Jev requests than the server-wide window', async () => {
    const client = createFakeJevClient((request) => confident(request));
    const app = createApp({
      usage: () => new SpendLedger(),
      jevClient: () => client,
      decisionLog: () => {},
      limits: { jevWindow: new RequestWindow(5) },
    });
    const bodies = [];
    for (let i = 0; i < 12; i++)
      bodies.push(await decide(app, { gameId: `g-${i}`, turnKey: `t-${i}` }));
    expect(client.requests).toHaveLength(5);
    expect(bodies.filter((body) => body.source === 'jev')).toHaveLength(5);
    const refused = bodies.filter((body) => body.source === 'fallback');
    expect(refused).toHaveLength(7);
    expect(refused.every((body) => body.fallbackReason === 'request_limit')).toBe(true);
  });

  test('past the tracked games, new IDs share one overflow quota: the turn limit holds across them', async () => {
    const client = createFakeJevClient((request) => confident(request));
    const app = createApp({
      usage: () => new SpendLedger(),
      jevClient: () => client,
      decisionLog: () => {},
      limits: { quotas: new QuotaBook(1), jevWindow: new RequestWindow(Infinity) },
    });
    await decide(app, { gameId: 'tracked', turnKey: 'turn-x' });
    // Six invented games, all naming one turn key: they share the overflow's 3 requests per turn.
    for (let i = 0; i < 6; i++) await decide(app, { gameId: `invented-${i}`, turnKey: 'turn-y' });
    expect(client.requests).toHaveLength(1 + 3);
  });

  test('the book keeps a tracked game and shares one overflow quota past its size', () => {
    const book = new QuotaBook(2);
    const first = book.for('a');
    expect(book.for('b')).not.toBe(first);
    const overflow = book.for('c');
    expect(book.for('d')).toBe(overflow);
    expect(overflow).not.toBe(first);
    // Tracked games are never replaced: the same quota, however many IDs came after.
    expect(book.for('a')).toBe(first);
    expect(MAX_TRACKED_GAMES).toBe(64);
  });

  test("dropping a game's orchestrator never resets its turn count (spec §9, #295)", async () => {
    const client = createFakeJevClient((request) => confident(request));
    const quotas = new QuotaBook();
    const app = createApp({
      usage: () => new SpendLedger(),
      decisionLog: () => {},
      decider: createOrchestratorDecider({
        client: () => client,
        usage: () => new SpendLedger(),
        maxGames: 1,
        quotas,
      }),
    });
    await decide(app, { gameId: 'a', turnKey: 'turn-1' });
    await decide(app, { gameId: 'a', turnKey: 'turn-1' });
    await decide(app, { gameId: 'b', turnKey: 'turn-1' }); // evicts a's orchestrator
    const third = await decide(app, { gameId: 'a', turnKey: 'turn-1' });
    const fourth = await decide(app, { gameId: 'a', turnKey: 'turn-1' });
    expect(third.source).toBe('jev');
    expect(fourth).toMatchObject({ source: 'fallback', fallbackReason: 'request_limit' });
    expect(client.requests).toHaveLength(4); // a: 3, b: 1
  });

  test('normal play is unaffected: one game, many turns, every decision asks Jev', async () => {
    const client = createFakeJevClient((request) => confident(request));
    const app = createApp({
      usage: () => new SpendLedger(),
      jevClient: () => client,
      decisionLog: () => {},
    });
    for (let turn = 0; turn < 40; turn++) {
      const body = await decide(app, { turnKey: `turn-${turn}` });
      expect(body.source).toBe('jev');
    }
    expect(client.requests).toHaveLength(40);
  });
});

describe('chat has the caps a Jev decision has', () => {
  const scenario = fixtureSchema.parse(startFixture).state;
  const state: GameState = createGame(
    createGameConfig({
      seats: scenario.config.seats,
      seed: 4,
      lapTarget: 3,
      socialWindow: true,
    }),
    structuredClone(scenario.content),
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
  const revision = observe(state, 0).public.stateRevision;
  const chatted = applyAction(state, {
    actorId: state.players[0]!.actorId,
    actionSeq: revision + 1,
    stateRevisionBefore: revision,
    kind: 'chat',
    payload: { targetSeatIndex: 1, topic: 'truce' },
  });
  if ('rejected' in chatted) throw new Error(chatted.reason);
  const aiView = observe(chatted.state, 1);
  const chatBody = (over: Record<string, unknown> = {}) => ({
    gameId: 'game-chat-1',
    seatIndex: 1,
    stateRevision: aiView.public.stateRevision,
    observation: aiView,
    personalityId: 'cautious',
    turnKey: 'chat:1:1',
    ...over,
  });
  const reply = async (app: App, over?: Record<string, unknown>) =>
    chatReplySchema.parse(await (await post(app, '/api/ai/chat', chatBody(over))).json());

  test('fresh game IDs cannot send more chat requests than the server-wide window', async () => {
    const client = createFakeJevClient((request) => confident(request));
    const app = createApp({
      usage: () => new SpendLedger(),
      jevClient: () => client,
      decisionLog: () => {},
      limits: { jevWindow: new RequestWindow(2) },
    });
    const replies = [];
    for (let i = 0; i < 6; i++) replies.push(await reply(app, { gameId: `chat-${i}` }));
    expect(client.requests).toHaveLength(2);
    expect(replies.filter((r) => r.source === 'jev')).toHaveLength(2);
    expect(replies.filter((r) => r.fallbackReason === 'rate_limited')).toHaveLength(4);
  });

  test('a spent turn limit or game token budget is a fallback line and sends nothing', async () => {
    const client = createFakeJevClient((request) => confident(request));
    const quotas = new QuotaBook();
    const app = createApp({
      usage: () => new SpendLedger(),
      jevClient: () => client,
      decisionLog: () => {},
      limits: { quotas, jevWindow: new RequestWindow(Infinity) },
    });
    const turn = quotas.for('turn-spent');
    for (let i = 0; i < 3; i++) turn.reserve('chat:1:1');
    expect((await reply(app, { gameId: 'turn-spent' })).fallbackReason).toBe('rate_limited');
    quotas
      .for('tokens-spent')
      .meter.record(confident({ state: {}, questions: {} } as JevRequest, 600_000));
    expect((await reply(app, { gameId: 'tokens-spent' })).fallbackReason).toBe('budget_exceeded');
    expect(client.requests).toHaveLength(0);
  });

  test('a repeated message is answered once, so a repeat costs nothing more', async () => {
    const client = createFakeJevClient((request) => confident(request));
    const app = createApp({
      usage: () => new SpendLedger(),
      jevClient: () => client,
      decisionLog: () => {},
    });
    // The same message is answered once (the reply is remembered); distinct games each have their own turns.
    const first = await reply(app);
    const again = await reply(app);
    expect(again).toMatchObject({ lineId: first.lineId });
    expect(client.requests).toHaveLength(1);
  });
});

describe('the speech gate has the caps a Jev decision has', () => {
  const gate = (admission: JevAdmission, client: ReturnType<typeof createFakeJevClient>) =>
    createManipulationGate({ client: () => client, usage: () => new SpendLedger(), admission });
  const line = { from: 'Rival', to: 'Greedy', text: 'You should trade me that.' };

  test('fresh game IDs cannot send more gate checks than the server-wide window', async () => {
    const client = createFakeJevClient((request) => confident(request));
    const admission = new JevAdmission({
      usage: () => new SpendLedger(),
      window: new RequestWindow(3),
    });
    const verdicts = [];
    for (let i = 0; i < 8; i++) {
      verdicts.push(
        await gate(admission, client).check({ ...line, gameId: `g-${i}`, turnKey: `t-${i}` }),
      );
    }
    expect(client.requests).toHaveLength(3);
    expect(verdicts.filter((verdict) => verdict === 'clean')).toHaveLength(3);
    expect(verdicts.filter((verdict) => verdict === 'unavailable')).toHaveLength(5);
  });

  test('the turn limit applies: three checks a turn, the fourth is refused', async () => {
    const client = createFakeJevClient((request) => confident(request));
    const ledger = new SpendLedger();
    const admission = new JevAdmission({ usage: () => ledger });
    const check = (turnKey: string) =>
      gate(admission, client).check({ ...line, gameId: 'a', turnKey });
    for (let i = 0; i < 3; i++) expect(await check('turn-1')).toBe('clean');
    expect(await check('turn-1')).toBe('unavailable');
    expect(await check('turn-2')).toBe('clean');
    expect(client.requests).toHaveLength(4);
  });

  test('the game token budget applies, and every hold is given back', async () => {
    const client = createFakeJevClient((request) => confident(request, 300_000));
    const ledger = new SpendLedger();
    const admission = new JevAdmission({ usage: () => ledger });
    const check = (turnKey: string) =>
      gate(admission, client).check({ ...line, gameId: 'b', turnKey });
    expect(await check('turn-1')).toBe('clean');
    expect(await check('turn-2')).toBe('clean');
    expect(await check('turn-3')).toBe('unavailable'); // 600,000 input tokens are spent
    expect(client.requests).toHaveLength(2);
    expect(ledger.reservedThb()).toBe(0);
  });
});

describe('the speech route has a server-wide Haiku window', () => {
  const content = toEngineContent(CONTENT);
  const speechState = createGame(
    createGameConfig({
      seats: ['main-character', 'rival', 'nurse-joy'].map((classId, seatIndex) => ({
        actorId: `player-${seatIndex}`,
        seatIndex,
        classId,
        starterSpeciesId: content.classes.find((entry) => entry.id === classId)!
          .starterSpeciesIds[0]!,
        controller: 'ai' as const,
      })),
      seed: 'LIMITS-SEED',
      lapTarget: 3,
    }),
    content,
  );
  const speechView = observe(speechState, 0);

  test('fresh game IDs cannot send more Haiku calls than the window', async () => {
    vi.stubEnv('HAIKU_ENABLED', 'true');
    vi.stubEnv('ANTHROPIC_API_KEY', 'placeholder-haiku-key-not-real-4c81e2');
    const haiku = createFakeHaikuClient(() => ({
      ok: true,
      text: 'That went well for me, and the grass looks friendly today.',
      model: PINNED_HAIKU_MODEL,
      latencyMs: 5,
      usage: { inputTokens: 100, outputTokens: 10 },
    }));
    const app = createApp({
      usage: () => new SpendLedger(),
      decisionLog: () => {},
      speech: { client: haiku, log: () => {} },
      limits: { haikuWindow: new RequestWindow(3) },
    });
    const bodies = [];
    for (let i = 0; i < 8; i++) {
      const response = await post(app, '/api/ai/speak', {
        gameId: `speak-${i}`,
        seatIndex: 0,
        stateRevision: speechView.public.stateRevision,
        observation: speechView,
        situation: 'catch_success',
        personalityId: 'greedy',
        turnKey: `0:${i}`,
      });
      bodies.push(speakResponseSchema.parse(await response.json()));
    }
    expect(haiku.requests).toHaveLength(3);
    expect(bodies.filter((body) => body.source === 'haiku')).toHaveLength(3);
    expect(
      bodies.filter((body) => 'fallbackReason' in body && body.fallbackReason === 'rate_limited'),
    ).toHaveLength(5);
  });
});

describe('the request window', () => {
  test('counts the last window only, and a refusal counts nothing', () => {
    let now = 0;
    const window = new RequestWindow(2, 1_000, () => now);
    expect([window.take(), window.take(), window.take()]).toEqual([true, true, false]);
    now = 999;
    expect(window.take()).toBe(false);
    now = 1_000;
    expect([window.take(), window.take(), window.take()]).toEqual([true, true, false]);
  });
});
