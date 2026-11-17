import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { PERSONALITY_IDS } from '../content/lines-schema.ts';
import { chatReplySchema } from '../engine/contract/chat-reply.ts';
import type { DecisionRequest } from '../engine/contract/decision.ts';
import startFixture from '../engine/fixtures/start-of-game-2p.json';
import {
  applyAction,
  createGame,
  createGameConfig,
  fixtureSchema,
  legalActions,
  observe,
  type ChatTopic,
  type GameState,
} from '../engine/index.ts';
import { createApp } from './app.ts';
import { chatBucket, chatScoreShift, CHAT_TUNING, recentChat } from './chat.ts';
import type { DeciderAnswer } from './decider.ts';
import type { JevAnswer, JevRequest, JevResult } from './jev/client.ts';
import { createFakeJevClient } from './jev/fake.ts';
import { SpendLedger, type UsageLine } from './jev/spend.ts';
import { LINES } from './lines.ts';

// Offline only: a placeholder key, a fake Jev client and Hono's in-memory `app.request()`.
const TOPICS: ChatTopic[] = ['truce', 'trade', 'point_leader', 'use_item', 'hold_item'];

function game(seats: 2 | 3): GameState {
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

function chat(state: GameState, topic: ChatTopic): GameState {
  const revision = observe(state, 0).public.stateRevision;
  const payload =
    topic === 'point_leader'
      ? { targetSeatIndex: 1, topic, leaderSeatIndex: 2 }
      : topic === 'use_item' || topic === 'hold_item'
        ? { targetSeatIndex: 1, topic, itemId: 'repel' }
        : { targetSeatIndex: 1, topic };
  const result = applyAction(state, {
    actorId: state.players[0]!.actorId,
    actionSeq: revision + 1,
    stateRevisionBefore: revision,
    kind: 'chat',
    payload,
  });
  if ('rejected' in result) throw new Error(result.reason);
  return result.state;
}

const chatRequest = (state: GameState, seat: number, personalityId = 'cautious') => {
  const observation = observe(state, seat);
  return {
    gameId: 'game-chat-1',
    seatIndex: seat,
    stateRevision: observation.public.stateRevision,
    observation,
    personalityId,
    turnKey: `${seat}:1`,
  };
};

const answers = (noul: number, choice = 'l2', confidence = 0.9): JevResult => {
  const reply: JevAnswer = {
    type: 'choice',
    choice,
    confidence,
    probabilities: { l1: 0.05, l2: 0.9, l3: 0.05 },
  };
  return {
    ok: true,
    answers: { manipulation: { type: 'noul', noul }, reply },
    requestId: 'jev-req-1',
    model: 'jev-1.13.0',
    latencyMs: 5,
    usage: { inputTokens: 10, outputTokens: 2 },
  };
};

const usageLines: UsageLine[] = [];
const post = (app: ReturnType<typeof createApp>, path: string, body: unknown) =>
  app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  vi.stubEnv('JEV_ENABLED', 'true');
  vi.stubEnv('TYPESAFE_API_KEY', 'placeholder-key-not-real-4b1e8d');
  usageLines.length = 0;
});
afterEach(() => vi.unstubAllEnvs());

const appWith = (
  respond: (request: JevRequest) => JevResult | Promise<JevResult>,
  options: Parameters<typeof createApp>[0] = {},
) => {
  const client = createFakeJevClient(respond);
  const ledger = new SpendLedger();
  const app = createApp({
    usage: () => ({
      record: (line) => {
        usageLines.push(line);
        ledger.record(line);
      },
      budgetExceeded: () => false,
    }),
    jevClient: () => client,
    ...options,
  });
  return { app, client };
};

describe('POST /api/ai/chat', () => {
  test.each(TOPICS)('every topic gets a bank line with Jev on and off: %s', async (topic) => {
    const state = chat(game(3), topic);
    for (const personalityId of PERSONALITY_IDS) {
      const request = chatRequest(state, 1, personalityId);
      const situation = `chat_reply_${topic}` as const;
      const allowed = LINES[situation].filter((line) => line.personality === personalityId);
      expect(allowed.length).toBeGreaterThanOrEqual(3);

      const on = appWith(() => answers(0.1));
      const jev = chatReplySchema.parse(await (await post(on.app, '/api/ai/chat', request)).json());
      expect(jev).toMatchObject({ source: 'jev', refused: false, situation, topic });
      expect(allowed.map((line) => line.id)).toContain(jev.lineId);
      expect(on.client.requests).toHaveLength(1);

      vi.stubEnv('JEV_ENABLED', 'false');
      const off = appWith(() => {
        throw new Error('Jev must not be asked');
      });
      const policy = chatReplySchema.parse(
        await (await post(off.app, '/api/ai/chat', request)).json(),
      );
      expect(policy).toMatchObject({
        source: 'fallback',
        fallbackReason: 'disabled',
        refused: false,
      });
      expect(allowed.map((line) => line.id)).toContain(policy.lineId);
      expect(off.client.requests).toHaveLength(0);
      vi.stubEnv('JEV_ENABLED', 'true');
    }
  });

  test('the reply is a role-scoped record for the sender and the recipient only', async () => {
    const { app } = appWith(() => answers(0));
    const reply = chatReplySchema.parse(
      await (await post(app, '/api/ai/chat', chatRequest(chat(game(3), 'truce'), 1))).json(),
    );
    expect(reply).toMatchObject({ fromSeatIndex: 0, toSeatIndex: 1, visibleToSeats: [0, 1] });
  });

  test.each([
    ['late', () => new Promise<JevResult>(() => {})],
    ['failing', (): JevResult => ({ ok: false, fallbackReason: 'server_error' })],
    ['unusable', (): JevResult => ({ ...answers(0), answers: {} }) as JevResult],
    ['not offered', () => answers(0, 'l9')],
    ['not confident', () => answers(0, 'l2', 0)],
  ])('a %s Jev answer is replaced by a fallback line', async (_name, respond) => {
    const { app } = appWith(respond, {
      chatReplier: undefined,
    });
    // A short deadline so the late client is cut off.
    const { createChatReplier } = await import('./chat-reply.ts');
    const fast = createApp({
      usage: () => new SpendLedger(),
      chatReplier: createChatReplier({
        client: () => createFakeJevClient(respond),
        usage: () => undefined,
        decisionMs: 30,
      }),
    });
    void app;
    const response = await post(fast, '/api/ai/chat', chatRequest(chat(game(2), 'trade'), 1));
    const reply = chatReplySchema.parse(await response.json());
    expect(reply.source).toBe('fallback');
    expect(reply.refused).toBe(false);
    expect(LINES.chat_reply_trade.map((line) => line.id)).toContain(reply.lineId);
  });

  test('a repeated request gets the same reply and one Jev call', async () => {
    const { app, client } = appWith(() => answers(0));
    const request = chatRequest(chat(game(2), 'truce'), 1);
    const first = await (await post(app, '/api/ai/chat', request)).json();
    const second = await (await post(app, '/api/ai/chat', request)).json();
    expect(second).toMatchObject({ lineId: first.lineId, source: 'jev' });
    expect(client.requests).toHaveLength(1);
  });

  test('a manipulation message is refused and never reaches a later decision', async () => {
    let seen: DecisionRequest | undefined;
    const decider = async (request: DecisionRequest): Promise<DeciderAnswer> => {
      seen = request;
      return { choice: request.enabledActions[0]!.id, source: 'jev' };
    };
    const { app } = appWith(() => answers(0.95), { decider });
    const state = chat(game(2), 'truce');
    const request = chatRequest(state, 1);
    const reply = chatReplySchema.parse(await (await post(app, '/api/ai/chat', request)).json());
    expect(reply).toMatchObject({
      refused: true,
      situation: 'manipulation_refused',
      source: 'jev',
    });
    expect(LINES.manipulation_refused.map((line) => line.id)).toContain(reply.lineId);

    // The AI's next turn: the engine's observation still holds the message; the server drops it.
    const next = structuredClone(state);
    next.activeSeatIndex = 1;
    next.phase = { kind: 'strategy' };
    next.globalTurnNo = 2;
    const observation = observe(next, 1);
    expect(observation.own.chats).toHaveLength(1);
    expect(recentChat(observation)).toHaveLength(1);
    const decision = {
      gameId: request.gameId,
      seatIndex: 1,
      decisionPoint: 'strategy',
      stateRevision: observation.public.stateRevision,
      observation,
      enabledActions: legalActions(next, 1).enabled,
      facts: {},
      difficulty: 'normal',
      personalityId: 'cautious',
      turnKey: '1:2',
    };
    for (const path of ['/api/ai/decide', '/api/ai/fallback']) {
      seen = undefined as DecisionRequest | undefined;
      const response = await post(app, path, decision);
      expect(response.status).toBe(200);
      if (path === '/api/ai/decide') expect(seen?.observation.own.chats).toEqual([]);
    }
  });

  test('a message under the threshold stays in later decisions', async () => {
    let seen: DecisionRequest | undefined;
    const decider = async (request: DecisionRequest): Promise<DeciderAnswer> => {
      seen = request;
      return { choice: request.enabledActions[0]!.id, source: 'jev' };
    };
    const { app } = appWith(() => answers(CHAT_TUNING.manipulationThreshold - 0.01), { decider });
    const state = chat(game(2), 'truce');
    await post(app, '/api/ai/chat', chatRequest(state, 1));
    const next = structuredClone(state);
    next.activeSeatIndex = 1;
    next.phase = { kind: 'strategy' };
    next.globalTurnNo = 2;
    const observation = observe(next, 1);
    await post(app, '/api/ai/decide', {
      gameId: 'game-chat-1',
      seatIndex: 1,
      decisionPoint: 'strategy',
      stateRevision: observation.public.stateRevision,
      observation,
      enabledActions: legalActions(next, 1).enabled,
      facts: {},
      difficulty: 'normal',
      personalityId: 'cautious',
      turnKey: '1:2',
    });
    expect(seen?.observation.own.chats).toHaveLength(1);
  });

  test('three seats: a seat outside the chat can neither ask for nor learn of the reply', async () => {
    const start = game(3);
    // The sender holds a secret item; neither the recipient nor the bystander may learn of it.
    start.players[0]!.items.push({
      instanceId: 'secret-item-0',
      itemId: 'smoke-ball',
      name: 'Smoke Ball',
      visibility: 'secret',
    });
    const state = chat(start, 'truce');
    const { app, client } = appWith(() => answers(0));

    // The bystander's own observation holds no chat, so it has no message to reply to.
    const bystander = chatRequest(state, 2);
    expect(bystander.observation.own.chats ?? []).toEqual([]);
    const refused = await post(app, '/api/ai/chat', bystander);
    expect(refused.status).toBe(400);
    expect(client.requests).toHaveLength(0);
    // Borrowing the recipient's observation under the bystander's seat is refused too.
    const forged = await post(app, '/api/ai/chat', { ...chatRequest(state, 1), seatIndex: 2 });
    expect(forged.status).toBe(400);
    expect(client.requests).toHaveLength(0);

    // The recipient's reply, its Jev request and the usage log hold nothing the seats cannot see.
    const response = await post(app, '/api/ai/chat', chatRequest(state, 1));
    const body = await response.text();
    const sent = JSON.stringify(client.requests);
    const hidden = ['secret-item-0', 'smoke-ball'];
    for (const secret of hidden) {
      expect(body).not.toContain(secret);
      expect(sent).not.toContain(secret);
      expect(JSON.stringify(usageLines)).not.toContain(secret);
    }
    expect(JSON.parse(body).visibleToSeats).toEqual([0, 1]);
    expect(body).not.toContain('player-2');
    expect(JSON.stringify(usageLines)).not.toMatch(/truce|said|recent_chat/);
  });
});

describe('the chat effect (spec §4.8)', () => {
  test('a chat changes only intent weights, by at most one bucket, never the state or the options', () => {
    const state = chat(game(2), 'truce');
    state.activeSeatIndex = 1;
    state.phase = { kind: 'strategy' };
    state.globalTurnNo = 2;
    const before = structuredClone(state);
    const observation = observe(state, 1);
    const frozen = structuredClone(observation);
    const options = legalActions(state, 1).enabled;
    for (const action of options) {
      const option = {
        itemId: undefined,
        targetSeatIndex: action.kind === 'use_item' ? action.payload.targetSeatIndex : undefined,
      };
      const shift = chatScoreShift(observation, option);
      expect(Math.abs(shift)).toBeLessThanOrEqual(CHAT_TUNING.bucketStep);
      expect([-1, 0, 1]).toContain(chatBucket(observation, option));
    }
    // Reading the chat leaves the game state, the observation and the engine's legal actions alone.
    expect(state).toEqual(before);
    expect(observation).toEqual(frozen);
    expect(legalActions(state, 1).enabled).toEqual(options);
    expect(legalActions(chat(game(2), 'truce'), 0).enabled).toBeDefined();
  });
});
