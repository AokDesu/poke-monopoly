import { expect, test } from 'vitest';
import {
  advanceAutomatically,
  applyAction,
  createGame,
  createGameConfig,
  createRng,
  eventsVisibleTo,
  fixtureSchema,
  int,
  legalActions,
  observe,
  RNG_VERSION,
  shuffle,
  type GameState,
} from './index.ts';
import fixture from './fixtures/start-of-game-2p.json';

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
  const transfer = events.find((event) => event.kind === 'coin_transfer');
  expect(eventsVisibleTo(before, events, 0)).toEqual(events);
  expect(eventsVisibleTo(before, events, 1)).toEqual([transfer]);
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

test('500 random mid-game states never show a seat another seat’s secrets, RNG or deck order (§1, §4.1, §4.8, §5.4, §8)', () => {
  let states = 0;
  const itemEvents = new Set<string>();
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
      for (const event of result.events) {
        if (event.kind.startsWith('uid_') && 'entity' in event && event.entity === 'item') {
          itemEvents.add(event.kind);
        }
      }
      if (move % 3 === 0) states++;
      for (const player of state.players) {
        const seat = player.seatIndex;
        const secrets = othersSecrets([before, state], seat);
        const events = JSON.stringify(eventsVisibleTo(before, result.events, seat));
        for (const secret of secrets) expect(events).not.toContain(secret);
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
  expect(itemEvents).toEqual(new Set(['uid_created', 'uid_destroyed']));
});

test('an opponent shows coins, team and an item count, the public class item, and no Balls or secret items (§3, §4.1)', () => {
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
