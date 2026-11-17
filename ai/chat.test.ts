import { describe, expect, test } from 'vitest';
import { toEngineContent } from '../content/schema.ts';
import {
  createGame,
  createGameConfig,
  legalActions,
  observe,
  type ChatMessage,
  type GameState,
} from '../engine/index.ts';
import { CHAT_TUNING, chatHints, recentChat } from './chat.ts';
import { scoreOptions } from './fallback/index.ts';
import { CONTENT } from './questions/content.ts';
import { buildStrategyQuestion, shortlistActions, type Personality } from './questions/index.ts';
import { assertNoComparableNumbers, assertStateTokenBudget, buildJevState } from './state/index.ts';

const personality: Personality = {
  name: 'Greedy',
  description: 'values cash now over long-term team building; avoids fights it may lose.',
  weights: { risk: 0.3, aggression: 0.4, liquidity: 0.9, loyalty: 0.2 },
};

const SEATS = [
  { classId: 'main-character', starterSpeciesId: 'charmander' },
  { classId: 'rival' },
  { classId: 'nurse-joy' },
  { classId: 'researcher' },
];

/** Seat 0 is the human; seats 1 and 2 are AIs; seat 3 an AI. The turn is seat 1's, after seat 0's. */
function game(items: Record<number, string[]> = { 1: ['repel', 'pickpocket'] }): GameState {
  const state = createGame(
    createGameConfig({
      seats: SEATS.map((seat, seatIndex) => ({
        ...seat,
        actorId: `P${seatIndex + 1}`,
        seatIndex,
        controller: seatIndex === 0 ? ('human' as const) : ('ai' as const),
      })),
      seed: 7,
      lapTarget: 3,
      socialWindow: true,
    }),
    toEngineContent(CONTENT),
  );
  state.phase = { kind: 'strategy' };
  state.activeSeatIndex = 1;
  state.globalTurnNo = 2;
  state.turnBudgets = { tacticalAction: 1, catchAttempt: 1, pokemonAbility: 1 };
  state.players[0]!.coins = 10;
  state.players[1]!.coins = 20;
  state.players[2]!.coins = 30;
  state.players[3]!.coins = 20;
  for (const [seat, ids] of Object.entries(items)) {
    for (const itemId of ids) {
      const player = state.players[Number(seat)]!;
      player.items.push({
        instanceId: `bought:${seat}:${player.items.length}`,
        itemId,
        name: CONTENT.items.find((item) => item.id === itemId)!.name,
        visibility: 'secret',
      });
    }
  }
  return state;
}

const say = (state: GameState, message: Omit<ChatMessage, 'globalTurnNo'>, turn = 1) => {
  const seats: [number, number] = [
    Math.min(message.fromSeatIndex, message.toSeatIndex),
    Math.max(message.fromSeatIndex, message.toSeatIndex),
  ];
  const chats = (state.chats ??= []);
  let pair = chats.find((entry) => entry.seats[0] === seats[0] && entry.seats[1] === seats[1]);
  if (!pair) chats.push((pair = { seats, messages: [] }));
  pair.messages.push({ ...message, globalTurnNo: turn });
};

const SEAT = 1;
const rank = (state: GameState) => {
  const observation = observe(state, SEAT);
  const options = legalActions(state, SEAT).enabled;
  const scores = scoreOptions(observation, options, personality as never);
  return { options, observation, scores };
};

/** The score of the Repel/Pickpocket use against a target seat. */
function scoreOf(state: GameState, itemId: string, target: number): number {
  const { options, observation, scores } = rank(state);
  const option = options.find(
    (action) =>
      action.kind === 'use_item' &&
      action.payload.targetSeatIndex === target &&
      observation.own.items.find((entry) => entry.instanceId === action.payload.itemInstanceId)
        ?.itemId === itemId,
  );
  return scores.get(option!.id)!;
}

describe('chat topics shift the next turn (spec §5.3)', () => {
  test('truce lowers targeting the speaker by exactly one bucket, then returns to baseline', () => {
    const plain = game();
    const withTruce = game();
    say(withTruce, { fromSeatIndex: 0, toSeatIndex: SEAT, topic: 'truce' });
    expect(scoreOf(withTruce, 'repel', 0)).toBeCloseTo(
      scoreOf(plain, 'repel', 0) - CHAT_TUNING.bucketStep,
    );
    // Other targets and other items' scores stay put.
    expect(scoreOf(withTruce, 'repel', 2)).toBe(scoreOf(plain, 'repel', 2));
    // After the seat's next own turn (a full round later) the effect is gone.
    withTruce.globalTurnNo = 2 + SEATS.length;
    plain.globalTurnNo = 2 + SEATS.length;
    expect(scoreOf(withTruce, 'repel', 0)).toBe(scoreOf(plain, 'repel', 0));
  });

  test('point_leader raises the named seat; use_item and hold_item shift that item', () => {
    const plain = game();
    const leader = game();
    say(leader, { fromSeatIndex: 0, toSeatIndex: SEAT, topic: 'point_leader', leaderSeatIndex: 3 });
    expect(scoreOf(leader, 'pickpocket', 3)).toBeCloseTo(
      scoreOf(plain, 'pickpocket', 3) + CHAT_TUNING.bucketStep,
    );
    const use = game();
    say(use, { fromSeatIndex: 0, toSeatIndex: SEAT, topic: 'use_item', itemId: 'repel' });
    expect(scoreOf(use, 'repel', 2)).toBeCloseTo(
      scoreOf(plain, 'repel', 2) + CHAT_TUNING.bucketStep,
    );
    expect(scoreOf(use, 'pickpocket', 2)).toBe(scoreOf(plain, 'pickpocket', 2));
    const hold = game();
    say(hold, { fromSeatIndex: 0, toSeatIndex: SEAT, topic: 'hold_item', itemId: 'repel' });
    expect(scoreOf(hold, 'repel', 2)).toBeCloseTo(
      scoreOf(plain, 'repel', 2) - CHAT_TUNING.bucketStep,
    );
  });

  test('trade has no Strategy effect, and the effect is bounded to one bucket', () => {
    const plain = game();
    const trade = game();
    say(trade, { fromSeatIndex: 0, toSeatIndex: SEAT, topic: 'trade' });
    expect(rank(trade).scores).toEqual(rank(plain).scores);
    expect(chatHints(observe(trade, SEAT))).toEqual([]);
    const twice = game();
    for (let i = 0; i < 2; i++) {
      say(twice, { fromSeatIndex: 0, toSeatIndex: SEAT, topic: 'use_item', itemId: 'repel' });
    }
    expect(scoreOf(twice, 'repel', 2)).toBeCloseTo(
      scoreOf(plain, 'repel', 2) + CHAT_TUNING.bucketStep,
    );
  });

  test('the shortlist ranking shifts too', () => {
    const state = game({ 1: ['pickpocket'] });
    const target = (s: GameState) => {
      const kept = shortlistActions(
        legalActions(s, SEAT).enabled,
        personality,
        observe(s, SEAT),
        2,
      );
      const use = kept.find((action) => action.kind === 'use_item');
      return use?.kind === 'use_item' ? use.payload.targetSeatIndex : undefined;
    };
    expect(target(state)).toBe(2); // the richest opponent
    say(state, { fromSeatIndex: 0, toSeatIndex: SEAT, topic: 'point_leader', leaderSeatIndex: 3 });
    expect(target(state)).toBe(3);
    state.globalTurnNo = 2 + SEATS.length;
    expect(target(state)).toBe(2);
  });
});

describe('Jev state', () => {
  test('recent_chat holds the last 3 addressed messages as quoted English with the speaker name', () => {
    const state = game();
    for (const itemId of ['repel', 'pickpocket', 'potion', 'lucky-egg']) {
      say(state, { fromSeatIndex: 0, toSeatIndex: SEAT, topic: 'use_item', itemId });
    }
    const recent = recentChat(observe(state, SEAT));
    expect(recent).toHaveLength(3);
    expect(recent[0]).toEqual({ from: 'P1', said: expect.stringMatching(/^".*"$/) });
    const jev = buildJevState(observe(state, SEAT));
    expect(jev).toHaveProperty('recent_chat', recent);
    expect(() => assertNoComparableNumbers(jev)).not.toThrow();
    expect(() => assertStateTokenBudget(jev)).not.toThrow();
  });

  test('an empty chat history gives an empty list; Strategy state carries the named hint', () => {
    const state = game();
    expect(buildJevState(observe(state, SEAT))).not.toHaveProperty('recent_chat');
    say(state, { fromSeatIndex: 0, toSeatIndex: SEAT, topic: 'truce' });
    const decision = buildStrategyQuestion(
      observe(state, SEAT),
      legalActions(state, SEAT).enabled,
      personality,
    );
    expect(decision.kind).toBe('ask');
    if (decision.kind !== 'ask') return;
    expect({ state: decision.state, questions: decision.questions }).toMatchSnapshot();
    expect(decision.state.chat_hint).toEqual(['Slightly less likely to target P1 this turn.']);
    expect(() => assertNoComparableNumbers(decision.state)).not.toThrow();
    expect(() => assertStateTokenBudget(decision.state)).not.toThrow();
  });

  test('messages between the human and one AI never reach a third seat', () => {
    const state = game();
    say(state, { fromSeatIndex: 0, toSeatIndex: 2, topic: 'truce' });
    say(state, { fromSeatIndex: 0, toSeatIndex: 2, topic: 'use_item', itemId: 'repel' });
    for (const seat of [1, 3]) {
      const observation = observe(state, seat);
      expect(buildJevState(observation)).not.toHaveProperty('recent_chat');
      expect(chatHints(observation)).toEqual([]);
      const other = game();
      expect(JSON.stringify(buildJevState(observation))).toBe(
        JSON.stringify(buildJevState(observe(other, seat))),
      );
    }
    expect(buildJevState(observe(state, 2)).recent_chat).toHaveLength(2);
  });

  test('the state is the same whether or not the AI holds the item asked about', () => {
    const holds = game({ 1: ['repel', 'pickpocket'] });
    const lacks = game({ 1: ['pickpocket'] });
    for (const state of [holds, lacks]) {
      say(state, { fromSeatIndex: 0, toSeatIndex: SEAT, topic: 'use_item', itemId: 'repel' });
    }
    const pick = (state: GameState) => {
      const { recent_chat } = buildJevState(observe(state, SEAT)) as { recent_chat?: unknown };
      return { recent_chat, hints: chatHints(observe(state, SEAT)) };
    };
    expect(pick(holds)).toEqual(pick(lacks));
  });
});
