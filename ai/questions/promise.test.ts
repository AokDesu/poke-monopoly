import { describe, expect, test } from 'vitest';
import { legalActions, observe, type GameState } from '../../engine/index.ts';
import { promiseTable, strategy } from '../../eval/jev/scenario-kit.ts';
import { PERSONALITIES } from '../fallback/index.ts';
import { bucketTrust } from '../promises.ts';
import { assertNoComparableNumbers, assertStateTokenBudget } from '../state/index.ts';
import { actionIdFor, buildPromiseResponseQuestion, buildStrategyQuestion } from './index.ts';

// Spec §4.8, §5.3, §5.4: the promise response question (S09).

const ask = (state: GameState, personality = PERSONALITIES.greedy) => {
  const decision = buildPromiseResponseQuestion(
    observe(state, 0),
    legalActions(state, 0).enabled,
    personality,
  );
  if (decision.kind !== 'ask') throw new Error(`expected a question, got ${decision.kind}`);
  return decision;
};

describe('wording and options', () => {
  test('a snapshot records the wording for a promise offered to the AI and one it is asked for', () => {
    const offered = ask(promiseTable({ seed: 1, direction: 'offer', trust: 0 }));
    const asked = ask(promiseTable({ seed: 1, direction: 'ask', trust: 0 }));
    expect({ offered: offered.questions, asked: asked.questions }).toMatchSnapshot();
  });

  test('accept and reject map to the engine actions respond:accept and respond:reject', () => {
    for (const direction of ['offer', 'ask'] as const) {
      const decision = ask(promiseTable({ seed: 2, direction, trust: 1 }));
      expect(decision.options).toEqual({ accept: 'respond:accept', reject: 'respond:reject' });
      expect(actionIdFor(decision, 'accept')).toBe('respond:accept');
      expect(actionIdFor(decision, 'reject')).toBe('respond:reject');
      expect(actionIdFor(decision, 'counter')).toBeUndefined();
      expect(Object.keys(decision.questions.promise_response!.criteria ?? {})).toEqual([
        'accept',
        'reject',
      ]);
    }
  });

  test('a single legal action is applied without a question, and none is skipped', () => {
    const state = promiseTable({ seed: 3, direction: 'offer', trust: 0 });
    const enabled = legalActions(state, 0).enabled;
    const observation = observe(state, 0);
    expect(buildPromiseResponseQuestion(observation, [enabled[0]!], PERSONALITIES.greedy)).toEqual({
      kind: 'autoApply',
      actionId: 'respond:accept',
    });
    expect(buildPromiseResponseQuestion(observation, [], PERSONALITIES.greedy)).toEqual({
      kind: 'skip',
    });
  });

  test('a seat with no promise question asked of it gets none', () => {
    const state = promiseTable({ seed: 4, direction: 'offer', trust: 0 });
    const enabled = legalActions(state, 0).enabled;
    // The asker owes nothing; a bystander does not even see the question.
    expect(() =>
      buildPromiseResponseQuestion(observe(state, 1), enabled, PERSONALITIES.greedy),
    ).toThrow(RangeError);
    const bystander = promiseTable({ seed: 4, direction: 'offer', trust: 0, bystander: true });
    expect(() =>
      buildPromiseResponseQuestion(observe(bystander, 2), enabled, PERSONALITIES.greedy),
    ).toThrow(RangeError);
  });
});

describe('actor IDs are opaque strings', () => {
  test('an ID made only of digits is allowed at the promise identifier paths and nowhere else', () => {
    const state = promiseTable({
      seed: 8,
      direction: 'offer',
      trust: 1,
      history: ['kept'],
      chats: [{ topic: 'truce' }],
    });
    for (const player of state.players) if (player.actorId === 'P2') player.actorId = '7';
    for (const seat of state.config.seats) if (seat.actorId === 'P2') seat.actorId = '7';
    const { state: sent } = ask(state);
    expect(sent.promise_offer).toMatchObject({ asked_by_id: '7', promiser_id: '7' });
    expect(sent.recent_chat).toEqual([{ from: '7', said: '"Can we call a truce?"' }]);
    expect(sent.opponents.map((opponent) => opponent.id)).toEqual(['7']);
    expect(() => assertNoComparableNumbers({ promise_offer: { trust_in_them: '7' } })).toThrow(
      TypeError,
    );
  });
});

describe('state: what is promised, trust, memory and chat', () => {
  test('a promise offered to the AI names the promiser, recipient, end and trust bucket', () => {
    const { state } = ask(
      promiseTable({ seed: 5, direction: 'offer', trust: 2, history: ['kept', 'kept'] }),
    );
    expect(state.promise_offer).toEqual({
      kind: 'no_attack',
      asked_by_id: 'P2',
      promiser_id: 'P2',
      recipient_id: 'P1',
      you_are: 'recipient',
      until: "the end of P2's next turn",
      trust_in_them: 'high',
      memory: ['P2 kept no_attack, made on turn 2', 'P2 kept no_attack, made on turn 5'],
    });
    expect(state.you.personality).toMatch(/^Greedy: /);
  });

  test('a promise the AI is asked to make says it is the promiser', () => {
    const { state } = ask(promiseTable({ seed: 6, direction: 'ask', trust: -1 }));
    expect(state.promise_offer).toMatchObject({
      asked_by_id: 'P2',
      promiser_id: 'P1',
      recipient_id: 'P2',
      you_are: 'promiser',
      until: 'the end of your next turn',
      trust_in_them: 'low',
      memory: [],
    });
  });

  test('memory is event evidence: a broken promise names the turn of the attack', () => {
    const { state } = ask(
      promiseTable({ seed: 7, direction: 'offer', trust: -2, history: ['broken'] }),
    );
    expect(state.promise_offer.memory).toEqual(['P2 broke no_attack on turn 3']);
  });

  test('trust is a named bucket, never the integer', () => {
    expect([-3, -2, -1, 0, 1, 2, 3].map((value) => bucketTrust(value))).toEqual([
      'low',
      'low',
      'low',
      'neutral',
      'high',
      'high',
      'high',
    ]);
    expect(() => bucketTrust(0.5)).toThrow(RangeError);
    for (const trust of [-3, 0, 3]) {
      const { state } = ask(promiseTable({ seed: 8, direction: 'offer', trust }));
      expect(['low', 'neutral', 'high']).toContain(state.promise_offer.trust_in_them);
      assertNoComparableNumbers(state);
      assertStateTokenBudget(state);
    }
  });

  test('recent_chat holds at most the last 3 messages from the asker, quoted as data', () => {
    const topics = ['truce', 'trade', 'truce', 'trade', 'truce'] as const;
    const { state } = ask(
      promiseTable({
        seed: 9,
        direction: 'offer',
        trust: 0,
        chats: topics.map((topic) => ({ topic })),
      }),
    );
    // The engine keeps 3 per pair; the newest three of five, oldest of those first.
    expect(state.recent_chat).toEqual([
      { from: 'P2', said: '"Can we call a truce?"' },
      { from: 'P2', said: '"Want to make a trade?"' },
      { from: 'P2', said: '"Can we call a truce?"' },
    ]);
    expect(state.recent_chat!.length).toBeLessThanOrEqual(3);
  });

  test('without any chat there is no recent_chat key, and no general social section', () => {
    const { state } = ask(promiseTable({ seed: 10, direction: 'offer', trust: 0 }));
    expect(state).not.toHaveProperty('recent_chat');
    expect(state).not.toHaveProperty('social');
  });
});

describe('no hidden information (spec §4.8 Privacy, §5.4, #143)', () => {
  const requestOf = (state: GameState) => JSON.stringify(ask(state));

  test('what the asker holds in secret never changes the request', () => {
    // The item count is public, so the two tables differ only in which secret item is held.
    const held = (itemId: string, name: string) => {
      const state = promiseTable({ seed: 11, direction: 'offer', trust: 1, bystander: true });
      state.players[1]!.items.push({
        instanceId: 'bought:1:0',
        itemId,
        name,
        visibility: 'secret',
      });
      return state;
    };
    const hostile = held('pickpocket', 'Pickpocket');
    const harmless = held('lucky-egg', 'Lucky Egg');
    hostile.players[1]!.balls = { poke: 9, great: 9, ultra: 9 };
    expect(requestOf(hostile)).toBe(requestOf(harmless));
    expect(requestOf(hostile)).not.toMatch(/bought:1:0|pickpocket/i);
  });

  test('a chat or promise between two other seats never appears', () => {
    const plain = promiseTable({ seed: 12, direction: 'offer', trust: 0, bystander: true });
    const talked = promiseTable({ seed: 12, direction: 'offer', trust: 0, bystander: true });
    // The asker also spoke to the third seat, and an unrelated promise stands between them.
    talked.chats = [
      ...(talked.chats ?? []),
      {
        seats: [1, 2],
        messages: [{ fromSeatIndex: 1, toSeatIndex: 2, topic: 'truce', globalTurnNo: 9 }],
      },
    ];
    talked.promises = [
      ...(talked.promises ?? []),
      {
        promiserSeatIndex: 1,
        recipientSeatIndex: 2,
        createdGlobalTurnNo: 4,
        closesOwnTurnNo: 3,
        acceptedActionSeq: 1,
        settled: { outcome: 'broken', globalTurnNo: 6 },
      },
    ];
    expect(requestOf(talked)).toBe(requestOf(plain));
  });

  test('a message from a seat other than the asker is not quoted', () => {
    const state = promiseTable({
      seed: 13,
      direction: 'offer',
      trust: 0,
      bystander: true,
      chats: [{ topic: 'truce' }],
    });
    state.chats = [
      ...(state.chats ?? []),
      {
        seats: [0, 2],
        messages: [{ fromSeatIndex: 2, toSeatIndex: 0, topic: 'trade', globalTurnNo: 10 }],
      },
    ];
    expect(ask(state).state.recent_chat).toEqual([{ from: 'P2', said: '"Can we call a truce?"' }]);
  });

  test('the request carries no trust integer, chance flag or sequence number', () => {
    const text = requestOf(
      promiseTable({ seed: 14, direction: 'offer', trust: -1, history: ['broken', 'kept'] }),
    );
    expect(text).not.toMatch(/keptGain|acceptedActionSeq|actionSeq|chance|"value"/);
  });
});

describe('breaking a promise is an explicit choice (spec §4.8, §5.3)', () => {
  test('an active promise to a rival changes no legal action and no Strategy option', () => {
    const open = strategy({ seed: 1, coins: [6, 30], items: ['pickpocket'] });
    const promised = strategy({ seed: 1, coins: [6, 30], items: ['pickpocket'] });
    // Seat 0 (the AI) promised seat 1 not to attack until the end of its next turn.
    promised.promises = [
      {
        promiserSeatIndex: 0,
        recipientSeatIndex: 1,
        createdGlobalTurnNo: 5,
        closesOwnTurnNo: promised.players[0]!.ownTurnNo + 1,
        acceptedActionSeq: 1,
      },
    ];
    const hostile = 'use-item:bought:0:0:seat-1';
    const options = (state: GameState) => {
      const enabled = legalActions(state, 0).enabled;
      const decision = buildStrategyQuestion(observe(state, 0), enabled, PERSONALITIES.greedy);
      if (decision.kind !== 'ask') throw new Error('expected a Strategy question');
      return { enabled: enabled.map((action) => action.id), shortlist: decision.options };
    };
    const before = options(open);
    const after = options(promised);
    expect(after.enabled).toContain(hostile);
    expect(after.enabled).toEqual(before.enabled);
    expect(Object.values(after.shortlist)).toContain(hostile);
    expect(after.shortlist).toEqual(before.shortlist);
  });
});
