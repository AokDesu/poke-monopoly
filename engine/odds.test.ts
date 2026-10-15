import { expect, test } from 'vitest';
import { fc } from '@fast-check/vitest';
import {
  advanceAutomatically,
  applyAction,
  catchOdds,
  oddsForAllBalls,
  legalActions,
  createGame,
  createGameConfig,
  fixtureSchema,
  type GameState,
} from './index.ts';
import fixture from './fixtures/start-of-game-2p.json';

/** A live current-version Encounter for seat 0 against `speciesId`. */
function encounter(speciesId: string, seed = 4): GameState {
  const scenario = fixtureSchema.parse(fixture).state;
  const state = createGame(
    createGameConfig({ seats: scenario.config.seats, seed, lapTarget: 3 }),
    scenario.content,
  );
  state.phase = { kind: 'encounter', pokemon: { speciesId } };
  state.globalTurnNo = 1;
  state.turnBudgets.catchAttempt = 1;
  return state;
}

test('a DC 4 Pokémon with a Great Ball and no other bonus needs a 3 or better: 67% (§4.3)', () => {
  expect(catchOdds(encounter('eevee'), 0, 'great')).toEqual({
    needed: 3,
    successFaces: 4,
    probability: 4 / 6,
    percent: 67,
  });
});

test('odds list every held Ball type, in pouch order, and omit Ball types not held (§4.3)', () => {
  // Seat 0 holds 5 Poké Balls and 1 Great Ball; Caterpie is DC 2.
  expect(oddsForAllBalls(encounter('caterpie'), 0)).toEqual([
    { ballType: 'poke', needed: 2, successFaces: 5, probability: 5 / 6, percent: 83 },
    { ballType: 'great', needed: 1, successFaces: 6, probability: 1, percent: 100 },
  ]);
});

test('probability is the share of d6 faces on which the real catch succeeds (§4.3, §8)', () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 0, max: 2 ** 31 }),
      fc.constantFrom('chansey', 'eevee', 'caterpie', 'pidgey'),
      fc.constantFrom('poke', 'great', 'ultra'),
      (seed, speciesId, ballType) => {
        const state = encounter(speciesId, seed);
        state.players[0]!.balls = { poke: 1, great: 1, ultra: 1 };
        const odds = catchOdds(state, 0, ballType);
        const faces = [1, 2, 3, 4, 5, 6].filter((face) => face >= odds.needed);
        expect(odds.probability).toBe(faces.length / 6);
        const confirmed = applyAction(state, {
          actorId: 'player-0',
          actionSeq: 1,
          stateRevisionBefore: 0,
          kind: 'catch',
          payload: { ballType },
        });
        if ('rejected' in confirmed) throw new Error(confirmed.reason);
        const rolled = advanceAutomatically(confirmed.state);
        const face = rolled.events.find((event) => event.kind === 'random_result')!.result;
        expect(rolled.state.players[0]!.team.length > state.players[0]!.team.length).toBe(
          faces.includes(face as number),
        );
      },
    ),
    { numRuns: 200 },
  );
});

test('percent is the whole-number share of succeeding faces for DC 2 to 5 and every Ball (§4.3)', () => {
  // [DC, Ball, needed, successFaces, percent]: a worked table, d6 + Ball bonus >= DC.
  const table = [
    [2, 'poke', 2, 5, 83],
    [2, 'great', 1, 6, 100],
    [2, 'ultra', 0, 6, 100],
    [3, 'poke', 3, 4, 67],
    [3, 'great', 2, 5, 83],
    [3, 'ultra', 1, 6, 100],
    [4, 'poke', 4, 3, 50],
    [4, 'great', 3, 4, 67],
    [4, 'ultra', 2, 5, 83],
    [5, 'poke', 5, 2, 33],
    [5, 'great', 4, 3, 50],
    [5, 'ultra', 3, 4, 67],
  ] as const;
  for (const [dc, ballType, needed, successFaces, percent] of table) {
    const state = encounter('chansey');
    state.content.species.find((species) => species.id === 'chansey')!.dc = dc;
    expect(catchOdds(state, 0, ballType)).toMatchObject({ needed, successFaces, percent });
  }
});

test('odds are 0 when the roll needed is above 6 and 1 when it is 1 or less (§4.3)', () => {
  const state = encounter('chansey');
  const chansey = state.content.species.find((species) => species.id === 'chansey')!;
  chansey.dc = 9;
  expect(catchOdds(state, 0, 'great')).toEqual({
    needed: 8,
    successFaces: 0,
    probability: 0,
    percent: 0,
  });
  chansey.dc = 1;
  expect(catchOdds(state, 0, 'ultra')).toEqual({
    needed: -1,
    successFaces: 6,
    probability: 1,
    percent: 100,
  });
});

test('odds need a Pokémon to catch and a known seat (§4.3)', () => {
  const state = encounter('eevee');
  expect(() => catchOdds(state, 7, 'poke')).toThrow(RangeError);
  state.phase = { kind: 'end' };
  expect(() => catchOdds(state, 0, 'poke')).toThrow(RangeError);
});

test('with 4 utility items held, Shop disables utility offers with ITEMS_FULL but still sells Balls (§3.1, §4.6)', () => {
  const state = encounter('eevee');
  const player = state.players[0]!;
  player.coins = 20;
  player.items = [1, 2, 3, 4].map((n) => ({
    instanceId: `item-full-${n}`,
    itemId: 'potion',
    name: 'Potion',
    visibility: 'public' as const,
  }));
  state.phase = {
    kind: 'shop',
    offers: [
      { id: 'poke-ball', itemId: 'poke-ball', kind: 'ball', ballType: 'poke', price: 1 },
      { id: 'repel', itemId: 'repel', kind: 'utility', price: 3 },
      { id: 'lucky-egg', itemId: 'lucky-egg', kind: 'utility', price: 30 },
    ],
  };
  expect(legalActions(state, 0)).toEqual({
    enabled: [
      { id: 'buy:poke-ball', kind: 'buy', payload: { offerId: 'poke-ball' } },
      { id: 'skip', kind: 'skip', payload: {} },
    ],
    disabled: [
      {
        id: 'buy:repel',
        kind: 'buy',
        payload: { offerId: 'repel' },
        reasonCode: 'ITEMS_FULL',
        reasonText: 'Items full',
      },
      // §3.1: an unaffordable item always reads "Not enough coins", even with a full hand.
      {
        id: 'buy:lucky-egg',
        kind: 'buy',
        payload: { offerId: 'lucky-egg' },
        reasonCode: 'NOT_ENOUGH_COINS',
        reasonText: 'Not enough coins',
      },
    ],
  });
});
