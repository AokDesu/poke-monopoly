import { expect, test } from 'vitest';
import { fc } from '@fast-check/vitest';
import {
  advanceAutomatically,
  applyAction,
  catchOdds,
  oddsForAllBalls,
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

test('DC 2–5 with bonuses 0–3 agrees with actual catches on all six faces (#32)', () => {
  // Literal d6 face counts indexed by the needed roll, including guaranteed success.
  const successesByNeeded = [6, 6, 5, 4, 3, 2];
  const percentByFaces = [0, 17, 33, 50, 67, 83, 100];
  // These seeds yield faces 1 through 6 for the first catch roll, respectively.
  const seedsByFace = new Map<number, number>();
  for (let seed = 0; seedsByFace.size < 6 && seed < 100; seed++) {
    const state = encounter('chansey', seed);
    const confirmed = applyAction(state, {
      actorId: 'player-0',
      actionSeq: 1,
      stateRevisionBefore: 0,
      kind: 'catch',
      payload: { ballType: 'poke' },
    });
    if ('rejected' in confirmed) throw new Error(confirmed.reason);
    const rolled = advanceAutomatically(confirmed.state);
    const face = rolled.events.find((event) => event.kind === 'random_result')!.result as number;
    seedsByFace.set(face, seed);
  }
  expect(seedsByFace.size).toBe(6);
  for (const dc of [2, 3, 4, 5]) {
    for (const bonus of [0, 1, 2, 3]) {
      for (const [ballType, ballBonus] of [
        ['poke', 0],
        ['great', 1],
        ['ultra', 2],
      ] as const) {
        let succeeded = 0;
        for (const seed of seedsByFace.values()) {
          const state = encounter('chansey', seed);
          state.content.species.find((species) => species.id === 'chansey')!.dc = dc;
          // Synthetic modifier snapshots cover the arithmetic contract beyond today's +1 Egg.
          state.turnEffects = { itemBonus: bonus };
          state.players[0]!.balls[ballType] = 1;
          const before = structuredClone(state);
          const odds = catchOdds(state, 0, ballType);
          const needed = dc - bonus - ballBonus;
          const faces = successesByNeeded[Math.max(0, needed)]!;
          expect(odds).toEqual({
            needed,
            successFaces: faces,
            probability: faces / 6,
            percent: percentByFaces[faces],
          });
          expect(state).toEqual(before);
          const confirmed = applyAction(state, {
            actorId: 'player-0',
            actionSeq: 1,
            stateRevisionBefore: 0,
            kind: 'catch',
            payload: { ballType },
          });
          if ('rejected' in confirmed) throw new Error(confirmed.reason);
          const rolled = advanceAutomatically(confirmed.state);
          if (rolled.state.players[0]!.team.length > before.players[0]!.team.length) succeeded++;
        }
        const state = encounter('chansey');
        state.content.species.find((species) => species.id === 'chansey')!.dc = dc;
        state.turnEffects = { itemBonus: bonus };
        expect(catchOdds(state, 0, ballType).probability).toBe(succeeded / 6);
      }
    }
  }
});

test('odds need a Pokémon to catch and a known seat (§4.3)', () => {
  const state = encounter('eevee');
  expect(() => catchOdds(state, 7, 'poke')).toThrow(RangeError);
  state.phase = { kind: 'end' };
  expect(() => catchOdds(state, 0, 'poke')).toThrow(RangeError);
});

test('an active Lucky Egg lowers the roll needed by one for every Ball that turn (§4.3, §4.6)', () => {
  const state = encounter('eevee');
  state.phase = { kind: 'strategy' };
  state.turnBudgets.tacticalAction = 1;
  state.players[0]!.items.push({
    instanceId: 'egg',
    itemId: 'lucky-egg',
    name: 'Lucky Egg',
    visibility: 'secret',
  });
  const used = applyAction(state, {
    actorId: 'player-0',
    actionSeq: 1,
    stateRevisionBefore: 0,
    kind: 'use_item',
    payload: { itemInstanceId: 'egg' },
  });
  if ('rejected' in used) throw new Error(used.reason);
  // Same turn, now facing the DC 4 Eevee.
  const facing = {
    ...used.state,
    phase: { kind: 'encounter' as const, pokemon: { speciesId: 'eevee' } },
  };
  expect(oddsForAllBalls(facing, 0)).toEqual([
    { ballType: 'poke', needed: 3, successFaces: 4, probability: 4 / 6, percent: 67 },
    { ballType: 'great', needed: 2, successFaces: 5, probability: 5 / 6, percent: 83 },
  ]);
});

test('only the seat in the Encounter has odds, so another seat never picks up its Lucky Egg (§4.3, §4.6)', () => {
  const state = encounter('eevee');
  state.turnEffects = { itemBonus: 1 };
  expect(() => catchOdds(state, 1, 'poke')).toThrow(RangeError);
  expect(() => oddsForAllBalls(state, 1)).toThrow(RangeError);
  expect(catchOdds(state, 0, 'poke')).toMatchObject({ needed: 3, successFaces: 4 });
});

test("class bonuses reach the odds through the class dispatcher: the Researcher's sale bonus adds nothing to a catch (§4.3, §4.7)", () => {
  const state = encounter('eevee');
  state.content.classes.push({
    id: 'researcher',
    name: 'Researcher',
    starterSpeciesIds: ['bulbasaur'],
    classItemId: 'great-ball',
    passive: 'lap_first_sale_bonus',
  });
  state.players[0]!.classId = 'researcher';
  expect(catchOdds(state, 0, 'poke')).toMatchObject({ needed: 4, successFaces: 3, percent: 50 });
});
