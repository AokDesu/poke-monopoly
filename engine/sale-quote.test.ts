import { expect, test } from 'vitest';
import {
  applyAction,
  createGame,
  createGameConfig,
  fixtureSchema,
  saleQuote,
  type GameState,
} from './index.ts';
import fixture from './fixtures/start-of-game-2p.json';

function scenario(): GameState {
  const source = fixtureSchema.parse(fixture).state;
  source.content.classes.push({
    id: 'researcher',
    name: 'Researcher',
    starterSpeciesIds: ['eevee'],
    classItemId: 'potion',
    passive: 'lap_first_sale_bonus',
  });
  const state = createGame(
    createGameConfig({ seats: source.config.seats, seed: 4, lapTarget: 3 }),
    source.content,
  );
  state.phase = { kind: 'sell', destinationPosition: 2 };
  state.players[0]!.classId = 'researcher';
  state.players[0]!.team.push(
    {
      instanceId: 'caught',
      speciesId: 'eevee',
      origin: 'caught',
      evolutionStage: 0,
      tired: true,
      abilityReady: true,
    },
    {
      instanceId: 'rescue',
      speciesId: 'eevee',
      origin: 'rescue_starter',
      evolutionStage: 2,
      tired: true,
      abilityReady: true,
      tradeable: false,
    },
  );
  return state;
}

function commit(state: GameState, ids: string[]) {
  const result = applyAction(state, {
    actorId: 'player-0',
    actionSeq: 1,
    stateRevisionBefore: 0,
    kind: 'sell',
    payload: { pokemonInstanceIds: ids },
  });
  if ('rejected' in result) throw new Error(result.reason);
  return result;
}

test('sale quotes assign the batch bonus after tired reduction and equal actual payments without mutation', () => {
  const state = scenario();
  const before = structuredClone(state);
  const quote = saleQuote(state, 0, ['starter:0', 'caught', 'rescue']);
  expect(quote.rows).toEqual([
    { instanceId: 'starter:0', basePrice: 5, classBonus: 0 },
    { instanceId: 'caught', basePrice: 10, classBonus: 3 },
    { instanceId: 'rescue', basePrice: 0, classBonus: 0 },
  ]);
  expect(quote.total).toBe(18);
  expect(quote.rescueStarter).toEqual({ saleValue: 0 });
  const paid = commit(state, ['starter:0', 'caught', 'rescue']);
  expect(paid.state.players[0]!.coins - state.players[0]!.coins).toBe(quote.total);
  expect(paid.events.filter((e) => e.kind === 'coin_transfer').map((e) => e.sale)).toEqual(
    quote.rows.map(({ basePrice, classBonus }) => ({ basePrice, classBonus })),
  );
  expect(state).toEqual(before);
  quote.rows[0]!.basePrice = 999;
  expect(state).toEqual(before);
});

test('selection changes move the class bonus, empty sales pay nothing, and rescue never receives a bonus', () => {
  const state = scenario();
  expect(saleQuote(state, 0, ['starter:0'])).toEqual({
    rows: [{ instanceId: 'starter:0', basePrice: 5, classBonus: 3 }],
    total: 8,
    rescueStarter: null,
  });
  expect(saleQuote(state, 0, [])).toEqual({ rows: [], total: 0, rescueStarter: null });
  expect(saleQuote(state, 0, ['rescue']).total).toBe(0);
  state.players[0]!.team = [];
  expect(saleQuote(state, 0, []).rescueStarter).toEqual({ saleValue: 0 });
});

test('equal-basis ties are stable across selected order and evolved starters use their current form', () => {
  const state = scenario();
  state.players[0]!.team[0]!.speciesId = 'eevee';
  state.players[0]!.team[0]!.evolutionStage = 1;
  const forward = saleQuote(state, 0, ['starter:0', 'caught']);
  const reverse = saleQuote(state, 0, ['caught', 'starter:0']);
  expect(forward.rows).toEqual([
    { instanceId: 'starter:0', basePrice: 12, classBonus: 0 },
    { instanceId: 'caught', basePrice: 10, classBonus: 3 },
  ]);
  expect(reverse.rows).toEqual([...forward.rows].reverse());
  expect(reverse.total).toBe(25);
  expect(
    commit(state, ['caught', 'starter:0']).state.players[0]!.coins - state.players[0]!.coins,
  ).toBe(reverse.total);
});

test('invalid seats, phases, foreign/duplicate/unknown IDs and overflowing quotes reject without mutation', () => {
  const state = scenario();
  const before = structuredClone(state);
  for (const ids of [['missing'], ['starter:1'], ['caught', 'caught']]) {
    expect(() => saleQuote(state, 0, ids)).toThrow(RangeError);
  }
  expect(() => saleQuote(state, 3, [])).toThrow(RangeError);
  expect(() => saleQuote(state, 1, [])).toThrow(RangeError);
  expect(state).toEqual(before);
  state.phase = { kind: 'strategy' };
  expect(() => saleQuote(state, 0, [])).toThrow(RangeError);
  state.phase = { kind: 'sell', destinationPosition: 2 };
  state.players[0]!.coins = Number.MAX_SAFE_INTEGER;
  expect(() => saleQuote(state, 0, ['caught'])).toThrow(RangeError);
  expect(saleQuote(state, 0, []).total).toBe(0);
});
