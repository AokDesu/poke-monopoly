import { expect, test } from 'vitest';
import {
  actionVisibleTo,
  advanceAutomatically,
  applyAction,
  createGame,
  createGameConfig,
  createGameLog,
  createRng,
  eventsVisibleTo,
  fixtureSchema,
  int,
  legalActions,
  observe,
  RNG_VERSION,
  shuffle,
  type ActionRecord,
  type GameState,
} from './index.ts';
import fixture from './fixtures/start-of-game-2p.json';

/** A record as a seat's feed shows it, numbered as in the full log (no hidden records before it). */
const seatRecord = (before: GameState, record: ActionRecord, seatIndex: number) =>
  actionVisibleTo(before, record, seatIndex, record.action.stateRevisionBefore)!;

/** Seat 0 in Strategy holding one secret item; seat 1 (Rival) holds its public Lucky Egg. */
function strategy(itemId: string): GameState {
  const scenario = fixtureSchema.parse(fixture).state;
  const state = createGame(
    createGameConfig({ seats: scenario.config.seats, seed: 4, lapTarget: 3 }),
    scenario.content,
  );
  state.phase = { kind: 'strategy' };
  state.globalTurnNo = 1;
  state.players[0]!.ownTurnNo = 1;
  state.turnBudgets = { tacticalAction: 1, catchAttempt: 1, pokemonAbility: 1 };
  state.players[0]!.items.push({
    instanceId: 'SENTINEL-0',
    itemId,
    name: 'SENTINEL-0',
    visibility: 'secret',
  });
  return state;
}

function accepted(state: GameState, kind: string, payload = {}) {
  const result = applyAction(state, {
    actorId: state.players[state.activeSeatIndex]!.actorId,
    actionSeq: state.stateRevision + 1,
    stateRevisionBefore: state.stateRevision,
    kind,
    payload,
  });
  if ('rejected' in result) throw new Error(result.reason);
  return result;
}

test("a used secret item's uid_destroyed is visible only to its owner (§4.1, §4.8, §5.4)", () => {
  const before = strategy('pickpocket');
  const { events } = accepted(before, 'use_item', {
    itemInstanceId: 'SENTINEL-0',
    targetSeatIndex: 1,
  });
  expect(eventsVisibleTo(before, events, 0)).toEqual(events);
  expect(eventsVisibleTo(before, events, 1)).toEqual(
    events.filter((event) => event.kind !== 'uid_destroyed'),
  );
});

/** `strategy` with a third seat, so a bystander can be checked. */
function strategy3(itemId: string): GameState {
  const scenario = fixtureSchema.parse(fixture).state;
  const content = structuredClone(scenario.content);
  content.classes.push({
    id: 'team-rocket',
    name: 'Team Rocket',
    starterSpeciesIds: ['eevee'],
    classItemId: 'pickpocket',
  });
  const seats = [
    ...scenario.config.seats,
    { actorId: 'player-2', seatIndex: 2, classId: 'team-rocket', controller: 'ai' as const },
  ];
  const state = createGame(createGameConfig({ seats, seed: 4, lapTarget: 3 }), content);
  const two = strategy(itemId);
  return { ...two, config: state.config, content, players: [...two.players, state.players[2]!] };
}

test('a secret hostile item use is told to its user and target only, not to bystanders (§4.1, §4.4, §5.4)', () => {
  for (const itemId of ['repel', 'pickpocket']) {
    const before = strategy3(itemId);
    const { events } = accepted(before, 'use_item', {
      itemInstanceId: 'SENTINEL-0',
      targetSeatIndex: 1,
    });
    const used = { kind: 'hostile_item_used', userSeatIndex: 0, targetSeatIndex: 1, itemId };
    expect(events).toContainEqual(used);
    expect(eventsVisibleTo(before, events, 0)).toContainEqual(used);
    expect(eventsVisibleTo(before, events, 1)).toContainEqual(used);
    expect(eventsVisibleTo(before, events, 2)).toEqual(
      events.filter((event) => event.kind === 'coin_transfer'),
    );
  }
});

test('a Lucky Egg, used on oneself, emits no hostile item event (§4.6)', () => {
  const { events } = accepted(strategy('lucky-egg'), 'use_item', { itemInstanceId: 'SENTINEL-0' });
  expect(events.map((event) => event.kind)).toEqual(['uid_destroyed']);
});

test("a bought item's uid_created is visible only to the buyer (§4.1, §4.6, §5.4)", () => {
  const resolving = strategy('repel');
  resolving.players[0]!.items = [];
  resolving.phase = { kind: 'resolve' };
  resolving.players[0]!.routeProgress = 4;
  const before = accepted(resolving, 'skip').state;
  if (before.phase.kind !== 'shop') throw new Error('expected Shop');
  const offer = before.phase.offers.find((entry) => entry.kind === 'utility')!;
  const { events } = accepted(before, 'buy', { offerId: offer.id });
  expect(eventsVisibleTo(before, events, 0)).toEqual(events);
  expect(eventsVisibleTo(before, events, 1)).toEqual(
    events.filter((event) => event.kind !== 'uid_created'),
  );
});

test('no seat sees the draws of an Event deck shuffle, which would reveal its order (§4.6, §5.4)', () => {
  const before = strategy('repel');
  before.eventDeck = { drawPile: ['event-a', 'event-b', 'event-c'], discardPile: [] };
  const order = shuffle(before.rng, before.eventDeck.drawPile, 'shuffle:events').value;
  const result = applyAction(before, {
    actorId: 'engine',
    actionSeq: 1,
    stateRevisionBefore: 0,
    kind: 'shuffle',
    payload: { deckId: 'events', order },
  });
  if ('rejected' in result) throw new Error(result.reason);
  expect(result.events).toHaveLength(2);
  for (const seat of [0, 1]) expect(eventsVisibleTo(before, result.events, seat)).toEqual([]);
});

const SEED = 'SEED-SENTINEL';
const DECK = ['EVENT-SENTINEL-a', 'EVENT-SENTINEL-b', 'EVENT-SENTINEL-c'];

/** A 2- or 3-seat game whose seats each hold secret sentinel items and whose deck is planted. */
function sentinelGame(game: number): GameState {
  const scenario = fixtureSchema.parse(fixture).state;
  const content = structuredClone(scenario.content);
  content.classes.push({
    id: 'team-rocket',
    name: 'Team Rocket',
    starterSpeciesIds: ['eevee'],
    classItemId: 'pickpocket',
  });
  const seats = [
    ...scenario.config.seats,
    { actorId: 'player-2', seatIndex: 2, classId: 'team-rocket', controller: 'ai' as const },
  ].slice(0, 2 + (game % 2));
  const state = createGame(
    createGameConfig({ seats, seed: `${SEED}-${game}`, lapTarget: 3 }),
    content,
  );
  const usable = ['lucky-egg', 'repel', 'pickpocket', 'potion'];
  for (const player of state.players) {
    for (let n = 0; n < 2; n++) {
      player.items.push({
        instanceId: `SENTINEL-${player.seatIndex}-${n}`,
        itemId: usable[(game + player.seatIndex + n) % usable.length]!,
        name: `SENTINEL-${player.seatIndex}-${n}`,
        visibility: 'secret',
      });
    }
  }
  state.eventDeck = { drawPile: [...DECK], discardPile: [] };
  return state;
}

/** Name every secret item after its owner so a leak of it is detectable. */
function plantSentinels(state: GameState): void {
  for (const player of state.players) {
    for (const item of player.items) {
      if (item.visibility === 'secret') item.name = `SENTINEL-name-${item.instanceId}`;
    }
  }
}

/** Serialised fragments that would reveal a secret item held by any seat other than `seat`. */
function othersSecrets(states: GameState[], seat: number): string[] {
  return states.flatMap((state) =>
    state.players
      .filter((player) => player.seatIndex !== seat)
      .flatMap((player) => player.items.filter((item) => item.visibility === 'secret'))
      .flatMap((item) => [`"${item.instanceId}"`, item.name]),
  );
}

function step(state: GameState, pick: (n: number) => number) {
  const automatic = advanceAutomatically(state);
  if (automatic.records.length === 1) return automatic;
  const enabled = legalActions(state, state.activeSeatIndex).enabled;
  const choice = enabled[pick(enabled.length)]!;
  const result = applyAction(state, {
    actorId: state.players.find((player) => player.seatIndex === state.activeSeatIndex)!.actorId,
    actionSeq: state.stateRevision + 1,
    stateRevisionBefore: state.stateRevision,
    kind: choice.kind,
    payload: choice.payload,
  });
  if ('rejected' in result) throw new Error(result.reason);
  return result;
}

test('500 random mid-game states never show a seat another seat’s secrets, RNG or deck order in observations, events or records (§1, §4.1, §4.4, §4.8, §5.4, §8)', () => {
  let states = 0;
  const itemEvents = new Set<string>();
  const actionKinds = new Set<string>();
  for (let game = 0; game < 25; game++) {
    let state = sentinelGame(game);
    let choices = createRng(game);
    const pick = (n: number) => {
      const draw = int(choices, n);
      choices = draw.rng;
      return draw.value;
    };
    for (let move = 1; move <= 60; move++) {
      const before = state;
      const result = step(before, pick);
      state = structuredClone(result.state);
      plantSentinels(state);
      const record = 'record' in result ? result.record : result.records[0]!;
      actionKinds.add(record.action.kind);
      for (const event of result.events) {
        if (event.kind.startsWith('uid_') && 'entity' in event && event.entity === 'item') {
          itemEvents.add(event.kind);
        }
        if (event.kind === 'hostile_item_used') itemEvents.add(event.kind);
      }
      if (move % 3 === 0) states++;
      for (const player of state.players) {
        const seat = player.seatIndex;
        const secrets = othersSecrets([before, state], seat);
        const visible = eventsVisibleTo(before, result.events, seat);
        const events = JSON.stringify(visible);
        for (const secret of secrets) expect(events).not.toContain(secret);
        for (const event of visible) {
          if (event.kind !== 'hostile_item_used') continue;
          expect([event.userSeatIndex, event.targetSeatIndex]).toContain(seat);
        }
        const seatView = seatRecord(before, record, seat);
        expect(seatView.events).toEqual(visible);
        const seenRecord = JSON.stringify(seatView);
        for (const secret of secrets) expect(seenRecord).not.toContain(secret);
        for (const hidden of [SEED, ...DECK]) expect(seenRecord).not.toContain(hidden);
        const actor = before.players.find((entry) => entry.actorId === record.action.actorId);
        if (actor?.seatIndex !== seat) expect(seenRecord).not.toContain('"offerId"');
        if (move % 3 !== 0) continue;
        const seen = JSON.stringify([observe(state, seat), legalActions(state, seat)]);
        for (const secret of secrets) expect(seen).not.toContain(secret);
        for (const hidden of [SEED, `"${state.rng.state}"`, RNG_VERSION, ...DECK]) {
          expect(seen).not.toContain(hidden);
        }
        expect(seen).not.toMatch(/"(rng|cursor|seed|rngVersion|eventDeck|drawPile)":/);
        // Control: the seat does see its own secret items.
        for (const item of player.items) expect(seen).toContain(`"${item.instanceId}"`);
      }
    }
  }
  expect(states).toBe(500);
  // Random play bought and used secret items, so their UID events were exercised.
  expect(itemEvents).toEqual(new Set(['uid_created', 'uid_destroyed', 'hostile_item_used']));
  // Random play reached these record kinds; shuffle and event_draw are checked above.
  expect(actionKinds).toEqual(
    new Set(['roll', 'dice_result', 'skip', 'catch', 'release', 'buy', 'skip_shop', 'use_item']),
  );
});

test('an opponent observation shows coins, team, item count and the public class item, but omits the Ball pouch and secret items (§3, §4.1)', () => {
  const state = strategy('repel');
  state.players[1]!.balls = { poke: 2, great: 1, ultra: 3 };
  const rival = observe(state, 0).public.players[1]!;
  expect(rival).toMatchObject({ coins: 20, itemCount: 1 });
  expect(rival.knownItems.map((item) => item.name)).toEqual(['Lucky Egg']);
  expect(rival).not.toHaveProperty('balls');
  const seen = observe(state, 1);
  expect(seen.public.players[0]).toMatchObject({ itemCount: 1, knownItems: [] });
  expect(seen.public.players[0]).not.toHaveProperty('balls');
  expect(seen.own.balls).toEqual({ poke: 2, great: 1, ultra: 3 });
  expect(JSON.stringify(seen)).not.toContain('SENTINEL-0');
  expect(observe(state, 0).own.items.map((item) => item.instanceId)).toContain('SENTINEL-0');
});

test('event visibility rejects an unknown seat like the other read seams (§5.4)', () => {
  expect(() => eventsVisibleTo(strategy('repel'), [], 2)).toThrow(RangeError);
});

test('pre-hostile-event executable versions reject instead of replaying without hostile_item_used (§6.8)', () => {
  const state = strategy('repel');
  state.config.engineVersion = '0.10.0';
  expect(() => createGame(state.config, state.content)).toThrow(/unsupported/i);
  expect(() => createGameLog(state)).toThrow(/unsupported/i);
});

test('a buy record hides which offer was bought from everyone but the buyer (§4.1, §4.6, §5.4)', () => {
  const resolving = strategy('repel');
  resolving.phase = { kind: 'resolve' };
  resolving.players[0]!.routeProgress = 4;
  const before = accepted(resolving, 'skip').state;
  if (before.phase.kind !== 'shop') throw new Error('expected Shop');
  const offer = before.phase.offers.find((entry) => entry.kind === 'utility')!;
  const { record } = accepted(before, 'buy', { offerId: offer.id });
  expect(seatRecord(before, record, 0)).toEqual(record);
  const seen = seatRecord(before, record, 1);
  expect(seen.action).toMatchObject({ kind: 'buy', payload: {} });
  expect(seen.action.payload).not.toHaveProperty('offerId');
  expect(seen.events).toEqual(eventsVisibleTo(before, record.events, 1));
});

test('a use_item record hides a secret item ID from non-owners and the target from bystanders (§4.1, §4.4, §5.4)', () => {
  const before = strategy3('repel');
  const { record } = accepted(before, 'use_item', {
    itemInstanceId: 'SENTINEL-0',
    targetSeatIndex: 1,
  });
  expect(seatRecord(before, record, 0)).toEqual(record);
  expect(seatRecord(before, record, 1).action.payload).toEqual({ targetSeatIndex: 1 });
  expect(seatRecord(before, record, 2).action.payload).toEqual({});
  // A public class item's ID is public, as its uid_destroyed is.
  const egg = strategy('repel');
  egg.activeSeatIndex = 1;
  egg.players[1]!.ownTurnNo = 1;
  const eggId = egg.players[1]!.items[0]!.instanceId;
  const used = accepted(egg, 'use_item', { itemInstanceId: eggId });
  expect(seatRecord(egg, used.record, 0).action.payload).toEqual({ itemInstanceId: eggId });
});

test('shuffle and event_draw records hide the deck order and drawn card from every seat (§4.1, §4.6, §5.4)', () => {
  const before = strategy('repel');
  before.eventDeck = { drawPile: ['event-a', 'event-b', 'event-c'], discardPile: [] };
  const order = shuffle(before.rng, before.eventDeck.drawPile, 'shuffle:events').value;
  const shuffled = applyAction(before, {
    actorId: 'engine',
    actionSeq: 1,
    stateRevisionBefore: 0,
    kind: 'shuffle',
    payload: { deckId: 'events', order },
  });
  if ('rejected' in shuffled) throw new Error(shuffled.reason);
  const draw = {
    action: {
      actorId: 'engine',
      actionSeq: 2,
      stateRevisionBefore: 1,
      kind: 'event_draw' as const,
      payload: { eventId: 'event-a' },
    },
    events: [],
  };
  for (const seat of [0, 1]) {
    expect(seatRecord(before, shuffled.record, seat)).toMatchObject({
      action: { kind: 'shuffle', payload: { deckId: 'events' } },
      events: [],
    });
    expect(seatRecord(before, shuffled.record, seat).action.payload).not.toHaveProperty('order');
    expect(seatRecord(shuffled.state, draw, seat).action.payload).toEqual({});
  }
});

test('action record visibility rejects an unknown seat like the other read seams (§5.4)', () => {
  const before = strategy('repel');
  const { record } = accepted(before, 'skip');
  expect(() => seatRecord(before, record, 2)).toThrow(RangeError);
});
