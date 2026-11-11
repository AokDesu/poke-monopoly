import { expect, test } from 'vitest';
import { fc } from '@fast-check/vitest';
import {
  actingSeatIndex,
  actionVisibleTo,
  advanceAutomatically,
  applyAction,
  checkInvariants,
  createGame,
  createGameConfig,
  createGameLog,
  deserialize,
  ENGINE_VERSION,
  eventsVisibleTo,
  fixtureSchema,
  gameConfigSchema,
  legalActions,
  observe,
  replay,
  serialize,
  verifyReplay,
  type ChatPayload,
  type GameState,
  type LegalAction,
} from './index.ts';
import fixture from './fixtures/start-of-game-2p.json';

/** Seat 0 (human) in Social with its one interaction; seat 1 is an AI; a third seat is optional. */
function social(options: { flag?: boolean | undefined; seats?: 2 | 3; seed?: number } = {}) {
  const { seats = 2, seed = 4 } = options;
  const flag = 'flag' in options ? options.flag : true;
  const scenario = fixtureSchema.parse(fixture).state;
  const content = structuredClone(scenario.content);
  content.classes.push({
    id: 'team-rocket',
    name: 'Team Rocket',
    starterSpeciesIds: ['eevee'],
    classItemId: 'pickpocket',
  });
  const seatList = [
    ...scenario.config.seats,
    { actorId: 'player-2', seatIndex: 2, classId: 'team-rocket', controller: 'ai' as const },
  ].slice(0, seats);
  const state = createGame(
    createGameConfig({
      seats: seatList,
      seed,
      lapTarget: 3,
      ...(flag === undefined ? {} : { socialWindow: flag }),
    }),
    content,
  );
  state.phase = { kind: 'social' };
  state.globalTurnNo = 1;
  state.players[0]!.ownTurnNo = 1;
  state.turnBudgets = { tacticalAction: 1, catchAttempt: 1, pokemonAbility: 1 };
  if (flag) state.turnBudgets.socialInteraction = 1;
  return state;
}

function command(state: GameState, kind: string, payload: object = {}) {
  return applyAction(state, {
    actorId: state.players[state.activeSeatIndex]!.actorId,
    actionSeq: state.stateRevision + 1,
    stateRevisionBefore: state.stateRevision,
    kind,
    payload,
  });
}

function accepted(state: GameState, kind: string, payload: object = {}) {
  const result = command(state, kind, payload);
  if ('rejected' in result) throw new Error(result.reason);
  return result;
}

const chatsOf = (state: GameState, seat: number): LegalAction[] =>
  legalActions(state, seat).enabled.filter((choice) => choice.kind === 'chat');

test('with the flag off or absent, Social offers only Skip and refuses chat (§4.2, §4.8)', () => {
  for (const flag of [undefined, false]) {
    const state = social({ flag });
    expect(legalActions(state, 0).enabled.map((choice) => choice.kind)).toEqual(['skip']);
    const result = command(state, 'chat', { targetSeatIndex: 1, topic: 'truce' });
    expect(result).toMatchObject({ rejected: true, reason: 'illegal_action' });
    expect('socialInteraction' in social({ flag }).turnBudgets).toBe(false);
    expect(observe(state, 0).own).not.toHaveProperty('chats');
  }
});

test('the socialWindow flag is an optional boolean on the game config', () => {
  const config = createGameConfig({ ...social().config, socialWindow: true });
  expect(gameConfigSchema.parse(config).socialWindow).toBe(true);
  expect(gameConfigSchema.safeParse({ ...config, socialWindow: 'yes' }).success).toBe(false);
  const bare = structuredClone(config);
  delete bare.socialWindow;
  expect(gameConfigSchema.parse(bare)).not.toHaveProperty('socialWindow');
});

test('with the flag on, the human is offered Skip plus every valid chat message (§4.8)', () => {
  const two = legalActions(social(), 0);
  expect(two.disabled).toEqual([]);
  expect(two.enabled.filter((choice) => choice.kind === 'skip')).toHaveLength(1);
  const payloads = chatsOf(social(), 0).map((choice) => choice.payload);
  // Truce, trade, and each of the four utility items for both item topics; no third seat to point at.
  expect(payloads).toHaveLength(2 + 4 + 4);
  expect(payloads).toContainEqual({ targetSeatIndex: 1, topic: 'truce' });
  expect(payloads).toContainEqual({ targetSeatIndex: 1, topic: 'use_item', itemId: 'repel' });
  expect(payloads.some((payload) => (payload as ChatPayload).topic === 'point_leader')).toBe(false);
  const three = chatsOf(social({ seats: 3 }), 0).map((choice) => choice.payload);
  expect(three).toContainEqual({ targetSeatIndex: 1, topic: 'point_leader', leaderSeatIndex: 2 });
  expect(three).toContainEqual({ targetSeatIndex: 2, topic: 'point_leader', leaderSeatIndex: 1 });
  expect(new Set(chatsOf(social({ seats: 3 }), 0).map((choice) => choice.id)).size).toBe(
    three.length,
  );
});

test('every enumerated message is accepted, and nothing else is (validated as a whole)', () => {
  const state = social({ seats: 3 });
  for (const choice of chatsOf(state, 0)) {
    expect(command(state, 'chat', choice.payload)).toMatchObject({ accepted: true });
  }
  const bad: object[] = [
    { targetSeatIndex: 0, topic: 'truce' }, // oneself
    { targetSeatIndex: 9, topic: 'truce' }, // no such seat
    { targetSeatIndex: 1, topic: 'truce', itemId: 'repel' },
    { targetSeatIndex: 1, topic: 'trade', leaderSeatIndex: 2 },
    { targetSeatIndex: 1, topic: 'point_leader' },
    { targetSeatIndex: 1, topic: 'point_leader', leaderSeatIndex: 1 },
    { targetSeatIndex: 1, topic: 'point_leader', leaderSeatIndex: 0 },
    { targetSeatIndex: 1, topic: 'point_leader', leaderSeatIndex: 2, itemId: 'repel' },
    { targetSeatIndex: 1, topic: 'use_item' },
    { targetSeatIndex: 1, topic: 'use_item', itemId: 'poke-ball' }, // a Ball is not a usable item
    { targetSeatIndex: 1, topic: 'hold_item', itemId: 'no-such-item' },
    { targetSeatIndex: 1, topic: 'hold_item', itemId: 'SENTINEL-1' }, // an instance, not a content id
    { targetSeatIndex: 1, topic: 'use_item', itemId: 'repel', leaderSeatIndex: 2 },
  ];
  for (const payload of bad) {
    expect(command(state, 'chat', payload)).toMatchObject({
      rejected: true,
      reason: 'illegal_action',
    });
  }
  expect(command(state, 'chat', { topic: 'truce' })).toMatchObject({
    rejected: true,
    reason: 'malformed_action',
  });
  expect(command(state, 'chat', { targetSeatIndex: 1, topic: 'bribe' })).toMatchObject({
    rejected: true,
    reason: 'malformed_action',
  });
});

test('an AI seat is never offered a chat and cannot send one (§4.2)', () => {
  const state = social();
  state.activeSeatIndex = 1;
  state.turnBudgets.socialInteraction = 1;
  expect(legalActions(state, 1).enabled.map((choice) => choice.kind)).toEqual(['skip']);
  expect(command(state, 'chat', { targetSeatIndex: 0, topic: 'truce' })).toMatchObject({
    rejected: true,
    reason: 'illegal_action',
  });
  // Nor is a chat offered to the inactive human, or outside the Social window.
  expect(chatsOf(social(), 1)).toEqual([]);
  const strategy = social();
  strategy.phase = { kind: 'strategy' };
  expect(chatsOf(strategy, 0)).toEqual([]);
  expect(command(strategy, 'chat', { targetSeatIndex: 1, topic: 'truce' })).toMatchObject({
    rejected: true,
  });
});

test('after one message only Skip remains; Skip moves on to Strategy (§4.2)', () => {
  const { state, events } = accepted(social(), 'chat', { targetSeatIndex: 1, topic: 'truce' });
  expect(state.phase).toEqual({ kind: 'social' });
  expect(state.turnBudgets.socialInteraction).toBe(0);
  expect(events).toEqual([{ kind: 'chat_sent', fromSeatIndex: 0, toSeatIndex: 1, topic: 'truce' }]);
  expect(legalActions(state, 0).enabled.map((choice) => choice.kind)).toEqual(['skip']);
  expect(command(state, 'chat', { targetSeatIndex: 1, topic: 'trade' })).toMatchObject({
    rejected: true,
    reason: 'illegal_action',
  });
  expect(accepted(state, 'skip').state.phase).toEqual({ kind: 'strategy' });
});

test('the budget resets when the next turn starts (§4.2 Start)', () => {
  const spent = accepted(social(), 'chat', { targetSeatIndex: 1, topic: 'truce' }).state;
  spent.activeSeatIndex = 1;
  spent.phase = { kind: 'end' };
  const next = accepted(spent, 'skip').state; // seat 1's End starts seat 0's turn at Start
  expect(next.activeSeatIndex).toBe(0);
  expect(next.turnBudgets.socialInteraction).toBe(1);
  const again = accepted(accepted(next, 'skip').state, 'skip').state; // Start, then Social
  expect(again.phase).toEqual({ kind: 'strategy' });
  expect(chatsOf(accepted(next, 'skip').state, 0).length).toBeGreaterThan(0);
});

test('a flag-off game never gains a social budget when turns start', () => {
  const state = social({ flag: undefined });
  state.activeSeatIndex = 1;
  state.phase = { kind: 'end' };
  expect(accepted(state, 'skip').state.turnBudgets).not.toHaveProperty('socialInteraction');
});

test('the engine keeps the last 3 messages per pair, in order, and pairs are unordered', () => {
  let state = social({ seats: 3 });
  const topics = ['truce', 'trade', 'truce', 'trade'] as const;
  for (const [index, topic] of topics.entries()) {
    state.turnBudgets.socialInteraction = 1;
    state.globalTurnNo = index + 1;
    state = accepted(state, 'chat', { targetSeatIndex: 1, topic }).state;
  }
  state.config.seats[2]!.controller = 'human';
  state.activeSeatIndex = 2;
  state.turnBudgets.socialInteraction = 1;
  state = accepted(state, 'chat', { targetSeatIndex: 0, topic: 'truce' }).state;
  expect(state.chats).toHaveLength(2);
  const pair01 = state.chats!.find((entry) => entry.seats.join() === '0,1')!;
  expect(pair01.messages.map((message) => message.globalTurnNo)).toEqual([2, 3, 4]);
  expect(state.chats!.find((entry) => entry.seats.join() === '0,2')!.messages).toHaveLength(1);
});

test('asking about an item leaks nothing: choices and outcome ignore what the target holds (§4.8)', () => {
  const bare = social({ seats: 3 });
  const armed = structuredClone(bare);
  for (const seat of [1, 2]) {
    armed.players[seat]!.items.push(
      { instanceId: `SECRET-${seat}`, itemId: 'repel', name: 'Repel', visibility: 'secret' },
      { instanceId: `SECRET-${seat}b`, itemId: 'pickpocket', name: 'P', visibility: 'secret' },
    );
  }
  for (const seat of [0, 1, 2]) {
    expect(legalActions(armed, seat)).toEqual(legalActions(bare, seat));
  }
  for (const itemId of ['repel', 'lucky-egg']) {
    for (const topic of ['use_item', 'hold_item']) {
      const payload = { targetSeatIndex: 1, topic, itemId };
      const withItem = accepted(armed, 'chat', payload);
      const without = accepted(bare, 'chat', payload);
      expect(withItem.events).toEqual(without.events);
      expect(withItem.state.chats).toEqual(without.state.chats);
      expect(withItem.state.turnBudgets).toEqual(without.state.turnBudgets);
      expect(observe(withItem.state, 0).own.chats).toEqual(observe(without.state, 0).own.chats);
    }
  }
});

test('a third seat sees no chat in its observation, events or action record (§4.8, §5.4)', () => {
  const before = social({ seats: 3 });
  const payload = { targetSeatIndex: 1, topic: 'use_item', itemId: 'repel' };
  const { state, events, record } = accepted(before, 'chat', payload);
  expect(events).toHaveLength(1);
  for (const seat of [0, 1]) {
    expect(eventsVisibleTo(before, events, seat)).toEqual(events);
    expect(actionVisibleTo(before, record, seat).action).toEqual(record.action);
    expect(observe(state, seat).own.chats).toEqual([
      {
        fromSeatIndex: 0,
        toSeatIndex: 1,
        topic: 'use_item',
        itemId: 'repel',
        globalTurnNo: 1,
      },
    ]);
  }
  expect(eventsVisibleTo(before, events, 2)).toEqual([]);
  expect(observe(state, 2).own.chats).toEqual([]);
  const seen = actionVisibleTo(before, record, 2);
  expect(seen.events).toEqual([]);
  expect(seen.action.payload).toEqual({});
  // Nothing of the message appears anywhere in the third seat's view of the game.
  expect(JSON.stringify([observe(state, 2), seen])).not.toMatch(/repel|use_item|chat_sent/);
});

test('a chat changes nothing beyond its history and the social budget (§4.8 hard line)', () => {
  const strip = (state: GameState) => {
    const copy = structuredClone(state);
    delete copy.chats;
    delete copy.turnBudgets.socialInteraction;
    copy.stateRevision = 0;
    return copy;
  };
  fc.assert(
    fc.property(
      fc.integer({ min: 0, max: 100_000 }),
      fc.boolean(),
      fc.nat(500),
      fc.nat(30),
      fc.nat(3),
      fc.nat(3),
      (seed, third, pick, coins, pokeBalls, ultraBalls) => {
        const before = social({ seats: third ? 3 : 2, seed });
        before.players[0]!.coins = coins;
        before.players[1]!.coins = 30 - coins;
        before.players[0]!.balls = { poke: pokeBalls, great: 1, ultra: ultraBalls };
        before.players[1]!.items.push({
          instanceId: 'S1',
          itemId: 'pickpocket',
          name: 'P',
          visibility: 'secret',
        });
        const choices = chatsOf(before, 0);
        const chosen = choices[pick % choices.length]!;
        const after = accepted(before, 'chat', chosen.payload).state;
        // Coins, teams, items, Balls, RNG, phase and every other field: identical.
        expect(strip(after)).toEqual(strip(before));
        expect(after.rng).toEqual(before.rng);
        // The legal set shrinks only by the social budget: the social choices go, nothing else moves.
        for (const seat of before.players.map((player) => player.seatIndex)) {
          const without = (state: GameState) => {
            const set = legalActions(state, seat);
            return {
              enabled: set.enabled.filter(
                (choice) => choice.kind !== 'chat' && choice.kind !== 'offer_promise',
              ),
              disabled: set.disabled,
            };
          };
          expect(without(after)).toEqual(without(before));
        }
        expect(chatsOf(after, 0)).toEqual([]);
        return true;
      },
    ),
    { numRuns: 200 },
  );
});

/** Plays a whole game choosing among legal actions, with the social window open. */
function playRandomly(seed: number, picks: number[]): { state: GameState; chats: number } {
  const state0 = social({ seed });
  state0.phase = {
    kind: 'first_player_roll',
    contenders: [0, 1],
    rolls: [],
    awaitingResult: false,
  };
  state0.globalTurnNo = 0;
  state0.players[0]!.ownTurnNo = 0;
  state0.turnBudgets = { tacticalAction: 0, catchAttempt: 0, pokemonAbility: 0 };
  let state = state0;
  let chats = 0;
  let wasSocial = false;
  for (let step = 0; step < 4000 && state.phase.kind !== 'finished'; step++) {
    const auto = advanceAutomatically(state);
    // The responder acts while a promise question is pending (§4.2, responding-seat seam).
    const acting = actingSeatIndex(state);
    const choices = legalActions(state, acting).enabled;
    const inSocial = state.phase.kind === 'social';
    const human = state.config.seats[state.activeSeatIndex]!.controller === 'human';
    // Entering a human's Social window always reopens the one interaction (reset at Start).
    if (inSocial && !wasSocial && human) {
      expect(choices.some((choice) => choice.kind === 'chat')).toBe(true);
    }
    if (inSocial && !human) expect(choices.map((choice) => choice.kind)).toEqual(['skip']);
    wasSocial = inSocial;
    if (auto.records.length) {
      state = auto.state;
      continue;
    }
    const choice = choices[picks[step % picks.length]! % choices.length]!;
    const before = state;
    const action = {
      actorId: state.players[acting]!.actorId,
      actionSeq: state.stateRevision + 1,
      stateRevisionBefore: state.stateRevision,
      kind: choice.kind,
      payload: choice.payload,
    };
    const result = applyAction(state, action);
    expect(checkInvariants(before, action, result)).toEqual([]);
    if ('rejected' in result) throw new Error(`${choice.id} rejected: ${result.reason}`);
    if (choice.kind === 'chat') chats++;
    state = result.state;
  }
  return { state, chats };
}

test('whole games with the window open obey the invariants and reopen the budget each human turn', () => {
  let totalChats = 0;
  fc.assert(
    fc.property(
      fc.integer({ min: 0, max: 100_000 }),
      fc.array(fc.nat(1000), { minLength: 50, maxLength: 50 }),
      (seed, picks) => {
        const { state, chats } = playRandomly(seed, picks);
        totalChats += chats;
        // Chat is only ever stored by an accepted chat command, and the human chats when picked.
        expect(state.chats === undefined).toBe(chats === 0);
        for (const pair of state.chats ?? []) expect(pair.messages.length).toBeLessThanOrEqual(3);
        return true;
      },
    ),
    { numRuns: 20 },
  );
  expect(totalChats).toBeGreaterThan(20);
});

test('chats replay and survive a save round-trip (§6.7, §6.8)', () => {
  const initial = social({ seats: 3 });
  const log = createGameLog(initial);
  const first = accepted(initial, 'chat', {
    targetSeatIndex: 2,
    topic: 'point_leader',
    leaderSeatIndex: 1,
  });
  const second = accepted(first.state, 'skip');
  log.actions.push(
    { action: first.record.action, events: first.events },
    { action: second.record.action, events: second.events },
  );
  expect(replay(log)).toEqual(second.state);
  const game = { state: second.state, log };
  expect(verifyReplay(game)).toMatchObject({ pass: true });
  const loaded = deserialize(serialize(game));
  expect(loaded.state).toEqual(second.state);
  expect(loaded.state.chats).toEqual(second.state.chats);
  expect(verifyReplay(loaded)).toMatchObject({ pass: true });
  expect(observe(loaded.state, 2).own.chats).toHaveLength(1);
  // An older engine's save is refused by name, as ENGINE_VERSION moved (spec §6.8).
  expect(ENGINE_VERSION).not.toBe('0.14.0');
  expect(() => deserialize(serialize(game).replace(ENGINE_VERSION, '0.14.0'))).toThrow(/0\.14\.0/);
});
