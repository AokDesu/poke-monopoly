/// <reference types="vite/client" />
import { expect, test } from 'vitest';
import { parseContent, toEngineContent } from '../content/schema.ts';
import {
  advanceAutomatically,
  applyAction,
  checkInvariants,
  createGame,
  createGameConfig,
  createGameLog,
  observe,
  legalActions,
  actionVisibleTo,
  eventsVisibleTo,
  eventsVisibleToSpectator,
  observeSpectator,
  type GameState,
} from './index.ts';

const files = Object.fromEntries(
  Object.entries(
    import.meta.glob<unknown>('../content/*.json', { eager: true, import: 'default' }),
  ).map(([path, json]) => [path.split('/').at(-1)!.slice(0, -5), json]),
);
const content = toEngineContent(parseContent(files));

function landing(eventId: string, seats = 2): GameState {
  const state = createGame(
    createGameConfig({
      seats: ['rival', 'researcher', 'bug-catcher', 'nurse-joy']
        .slice(0, seats)
        .map((classId, seatIndex) => ({
          actorId: `p${seatIndex}`,
          seatIndex,
          classId,
          controller: 'ai' as const,
        })),
      seed: 162,
      lapTarget: 2,
    }),
    content,
  );
  state.phase = { kind: 'resolve' };
  state.globalTurnNo = 1;
  state.players[0]!.ownTurnNo = 1;
  state.players[0]!.routeProgress = 2;
  state.turnBudgets = { tacticalAction: 1, catchAttempt: 1, pokemonAbility: 1 };
  state.eventDeck = { drawPile: [eventId], discardPile: [] };
  return state;
}

function resolve(state: GameState) {
  const result = advanceAutomatically(state);
  expect(result.records).toHaveLength(1);
  expect(
    checkInvariants(state, result.records[0]!.action, {
      accepted: true,
      state: result.state,
      events: result.events,
      record: result.records[0]!,
    }),
  ).toEqual([]);
  return result;
}

test('landing draws e2 once, discards it, pays six sourced coins and exposes the result (§4.6)', () => {
  const before = landing('e2');
  const result = resolve(before);
  expect(result.state.players[0]!.coins).toBe(26);
  expect(result.state.eventDeck).toEqual({ drawPile: [], discardPile: ['e2'] });
  expect(result.events).toContainEqual({ kind: 'event_drawn', seatIndex: 0, eventId: 'e2' });
  expect(result.events).toContainEqual({
    kind: 'coin_transfer',
    source: { kind: 'bank' },
    destination: { kind: 'player', actorId: 'p0' },
    amount: 6,
    reason: 'event:e2',
  });
  expect(observe(result.state, 1).public).toHaveProperty('lastEvent', {
    seatIndex: 0,
    eventId: 'e2',
    result: { kind: 'coins', transfers: [{ seatIndex: 0, amount: 6 }] },
  });
  expect(before.eventDeck.drawPile).toEqual(['e2']);
});

test.each([0, 2, 4, 20])(
  'e3 pays min(4, %i) to the bank without going negative (§4.6)',
  (coins) => {
    const before = landing('e3');
    before.players[0]!.coins = coins;
    const result = resolve(before);
    expect(result.state.players[0]!.coins).toBe(Math.max(0, coins - 4));
    expect(result.events).toContainEqual({
      kind: 'coin_transfer',
      source: { kind: 'player', actorId: 'p0' },
      destination: { kind: 'bank' },
      amount: Math.min(4, coins),
      reason: 'event:e3',
    });
    expect(observe(result.state, 1).public).toHaveProperty('lastEvent.result.transfers', [
      { seatIndex: 0, amount: -Math.min(4, coins) },
    ]);
  },
);

test.each([
  [
    [0, 8],
    [5, 8],
  ],
  [
    [0, 0],
    [2, 2],
  ],
  [
    [2, 2, 2],
    [3, 3, 3],
  ],
  [
    [0, 0, 0, 0],
    [1, 1, 1, 1],
  ],
  [
    [20, 0, 0],
    [20, 2, 2],
  ],
])('e6 splits five among all poorest seats, rounding down: %j (§4.6)', (coins, expected) => {
  const before = landing('e6', coins.length);
  before.players.forEach((player, seatIndex) => {
    player.coins = coins[seatIndex]!;
  });
  const result = resolve(before);
  expect(result.state.players.map((player) => player.coins)).toEqual(expected);
  const poorest = Math.min(...coins);
  expect(observe(result.state, 0).public).toHaveProperty(
    'lastEvent.result.transfers',
    coins.flatMap((coin, seatIndex) =>
      coin === poorest ? [{ seatIndex, amount: expected[seatIndex]! - coin }] : [],
    ),
  );
});

test.each(['available', 'spent', 'no-balls'])(
  'e1 opens a normal encounter with catch budget %s (§4.6, §4.3)',
  (scenario) => {
    const before = landing('e1');
    before.turnBudgets.pokemonAbility = 0;
    if (scenario === 'spent') before.turnBudgets.catchAttempt = 0;
    if (scenario === 'no-balls') before.players[0]!.balls = { poke: 0, great: 0, ultra: 0 };
    const result = resolve(before);
    expect(result.state.phase).toMatchObject({
      kind: 'encounter',
      pokemon: { speciesId: expect.any(String) },
    });
    expect(result.state.turnBudgets).toEqual(before.turnBudgets);
    expect(result.state.players[0]!.balls).toEqual(before.players[0]!.balls);
    const legal = legalActions(result.state, 0);
    expect(legal.enabled.some((action) => action.kind === 'catch')).toBe(scenario === 'available');
    expect(legal.enabled.some((action) => action.kind === 'release')).toBe(true);
    if (scenario === 'available') {
      const attempted = applyAction(result.state, {
        actorId: 'p0',
        actionSeq: 2,
        stateRevisionBefore: 1,
        kind: 'catch',
        payload: { ballType: 'poke' },
      });
      expect(attempted).toHaveProperty('accepted', true);
      expect(attempted.state.turnBudgets.catchAttempt).toBe(0);
      expect(attempted.state.players[0]!.balls.poke).toBe(before.players[0]!.balls.poke - 1);
    } else {
      expect(legal.enabled.map((action) => action.kind)).toEqual(['release']);
      expect(advanceAutomatically(result.state).state.phase.kind).toBe('end');
    }
    expect(observe(result.state, 1).public).toHaveProperty('lastEvent.result', {
      kind: 'encounter',
      speciesId:
        result.state.phase.kind === 'encounter' ? result.state.phase.pokemon.speciesId : '',
    });
  },
);

test('e5 tires the highest printed battle, breaking ties by UID and reapplying expiry (§4.4, §4.6)', () => {
  const before = landing('e5');
  const starter = before.players[0]!.team[0]!;
  before.players[0]!.team = [
    { ...starter, instanceId: 'z', speciesId: 'snorlax', tired: false },
    { ...starter, instanceId: 'b', speciesId: 'magikarp', evolutionStage: 2, tired: false },
    { ...starter, instanceId: 'a', speciesId: 'snorlax', tired: true, tiredExpiresOwnTurnNo: 1 },
  ];
  const result = resolve(before);
  expect(result.state.players[0]!.team).toEqual([
    before.players[0]!.team[0],
    before.players[0]!.team[1],
    { ...before.players[0]!.team[2]!, tiredExpiresOwnTurnNo: 2 },
  ]);
  expect(result.events).toContainEqual({
    kind: 'status_changed',
    ownerId: 'p0',
    instanceId: 'a',
    status: 'tired',
    operation: 'reapplied',
    expiresOwnTurnNo: 2,
    reason: 'event:e5',
  });
  expect(observe(result.state, 1).public).toHaveProperty('lastEvent.result', {
    kind: 'tired',
    instanceId: 'a',
  });
});

test('e5 with an empty team records no target and continues (§4.6)', () => {
  const before = landing('e5');
  before.players[0]!.team = [];
  const result = resolve(before);
  expect(result.state.phase.kind).toBe('end');
  expect(result.events.some((event) => event.kind === 'status_changed')).toBe(false);
  expect(observe(result.state, 0).public).toHaveProperty('lastEvent.result', {
    kind: 'tired',
    instanceId: null,
  });
});

test('e4 grants one seeded secret utility item with a logged UID and an owner-only result (§4.6, §4.1)', () => {
  const before = landing('e4');
  const result = resolve(before);
  const gained = result.state.players[0]!.items.at(-1)!;
  expect(result.state.players[0]!.items).toHaveLength(before.players[0]!.items.length + 1);
  expect(gained).toMatchObject({ itemId: expect.any(String), visibility: 'secret' });
  expect(content.items.find((item) => item.id === gained.itemId)!.kind).toBe('utility');
  expect(result.events).toContainEqual({
    kind: 'uid_created',
    entity: 'item',
    instanceId: gained.instanceId,
    ownerId: 'p0',
  });
  expect(observe(result.state, 0).own).toHaveProperty('lastEventReward', {
    kind: 'item',
    item: gained,
  });
  expect(observe(result.state, 1).own).not.toHaveProperty('lastEventReward');
  expect(observe(result.state, 1).public).toHaveProperty('lastEvent.result', { kind: 'item' });
  expect(resolve(before).state).toEqual(result.state);
});

test('e4 with a full hand gains a Poké Ball, spends no RNG and cannot overflow (§4.6)', () => {
  const before = landing('e4');
  before.players[0]!.items = Array.from({ length: 4 }, (_, i) => ({
    instanceId: `item:${i}`,
    itemId: 'repel',
    name: 'Repel',
    visibility: 'secret' as const,
  }));
  const result = resolve(before);
  expect(result.state.players[0]!.items).toEqual(before.players[0]!.items);
  expect(result.state.players[0]!.balls.poke).toBe(before.players[0]!.balls.poke + 1);
  expect(result.state.rng).toEqual(before.rng);
  expect(observe(result.state, 0).own).toHaveProperty('lastEventReward', {
    kind: 'ball',
    ballType: 'poke',
  });
  expect(observe(result.state, 1).own).not.toHaveProperty('lastEventReward');
});

test('an exhausted draw pile reshuffles the discard in a logged record before drawing (§3.1)', () => {
  const before = landing('e2');
  before.eventDeck = { drawPile: [], discardPile: ['e2', 'e3'] };
  const result = resolve(before);
  expect(result.events).toContainEqual({ kind: 'event_deck_shuffled', cardCount: 2 });
  expect(result.state.eventDeck.drawPile).toHaveLength(1);
  expect(result.state.eventDeck.discardPile).toHaveLength(1);
  expect(
    [...result.state.eventDeck.drawPile, ...result.state.eventDeck.discardPile].sort(),
  ).toEqual(['e2', 'e3']);
  expect(result.events.findIndex((event) => event.kind === 'event_deck_shuffled')).toBeLessThan(
    result.events.findIndex((event) => event.kind === 'event_drawn'),
  );
  expect(result.state.phase.kind).toBe('end');
});

test('first Event use shuffles all six IDs lazily and consumes only the top card (§4.6, §6.8)', () => {
  const before = landing('e2');
  before.eventDeck = { drawPile: [], discardPile: [] };
  expect(before.rng.cursor).toBe(0);
  const result = resolve(before);
  expect(result.events).toContainEqual({ kind: 'event_deck_shuffled', cardCount: 6 });
  expect(result.state.eventDeck.drawPile).toHaveLength(5);
  expect(result.state.eventDeck.discardPile).toHaveLength(1);
  expect(
    [...result.state.eventDeck.drawPile, ...result.state.eventDeck.discardPile].sort(),
  ).toEqual(['e1', 'e2', 'e3', 'e4', 'e5', 'e6']);
});

test('e4 hides its item, selection and Ball gain from other seats and spectators (§4.1, §5.4)', () => {
  const before = landing('e4', 3);
  const result = resolve(before);
  const reward = observe(result.state, 0).own;
  expect(reward).toHaveProperty('lastEventReward.kind', 'item');
  const item = result.state.players[0]!.items.at(-1)!;
  for (const seat of [1, 2]) {
    const seen = JSON.stringify([
      observe(result.state, seat),
      eventsVisibleTo(before, result.events, seat),
      actionVisibleTo(before, result.records[0]!, seat, 0),
    ]);
    expect(seen).not.toContain(item.instanceId);
    expect(seen).not.toContain('event:e4:item');
    expect(seen).not.toContain('item_gained');
  }
  const spectator = JSON.stringify([
    observeSpectator(result.state),
    eventsVisibleToSpectator(before, result.events),
  ]);
  expect(spectator).not.toContain(item.instanceId);
  expect(spectator).not.toContain('event:e4:item');
  expect(eventsVisibleTo(before, result.events, 0)).toContainEqual({
    kind: 'item_gained',
    ownerId: 'p0',
    item,
  });
});

test('all seats and AI state see only the drawn card and result, never the remaining deck or shuffle choices (§5.4)', () => {
  const before = landing('e2', 4);
  before.eventDeck = { drawPile: [], discardPile: [] };
  const result = resolve(before);
  const twin = structuredClone(result.state);
  twin.eventDeck = {
    drawPile: ['HIDDEN-order-a', 'HIDDEN-order-b'],
    discardPile: ['HIDDEN-discard'],
  };
  for (const seat of [0, 1, 2, 3]) {
    expect(observe(twin, seat)).toEqual(observe(result.state, seat));
    const view = JSON.stringify([
      observe(result.state, seat),
      legalActions(result.state, seat),
      actionVisibleTo(before, result.records[0]!, seat, 0),
    ]);
    expect(view).not.toMatch(/"(drawPile|discardPile|eventDeck|order|rng|seed)":/);
    expect(view).not.toContain('shuffle:events');
    expect(observe(result.state, seat).public).toHaveProperty(
      'lastEvent.eventId',
      result.state.eventDeck.discardPile[0],
    );
  }
});

test.each([[], ['unknown'], ['e1', 'e1', 'e3', 'e4', 'e5', 'e6']].map((ids) => ({ ids })))(
  'setup rejects an incomplete or unsupported Event catalogue $ids (§4.6)',
  ({ ids }) => {
    const state = landing('e2');
    const invalid = structuredClone(content);
    invalid.events = ids.map((id) => ({ id }));
    expect(() => createGame(state.config, invalid)).toThrow(/Event/);
  },
);

test('pre-Event 0.18.0 command logs are rejected instead of replaying Event no-ops (§6.8)', () => {
  const before = landing('e2');
  before.config.engineVersion = '0.18.0';
  expect(() => createGameLog(before)).toThrow(/unsupported/i);
});
