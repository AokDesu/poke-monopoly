import { expect, test } from 'vitest';
import {
  advanceAutomatically,
  applyAction,
  catchOdds,
  createGame,
  createGameConfig,
  createGameLog,
  d6,
  replay,
  saleQuote,
  type GameState,
  type PokemonInstance,
} from '../engine/index.ts';
import { loadContent } from '../sim/content.ts';
import { toEngineContent } from './schema.ts';

function game(classId: string): GameState {
  const state = createGame(
    createGameConfig({
      seats: [
        { actorId: 'player-0', seatIndex: 0, classId, controller: 'human' },
        { actorId: 'player-1', seatIndex: 1, classId: 'researcher', controller: 'ai' },
      ],
      seed: 1,
      lapTarget: 2,
    }),
    toEngineContent(loadContent()),
  );
  state.activeSeatIndex = 0;
  state.globalTurnNo = 1;
  state.turnBudgets = { tacticalAction: 1, catchAttempt: 1, pokemonAbility: 1 };
  return state;
}

function command(state: GameState, kind: string, payload = {}) {
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

test.each([
  ['fisherman', 'magikarp', 2],
  ['bug-catcher', 'caterpie', 1],
] as const)(
  '%s tags cross a real d6 boundary and change shared odds on every catch (§4.3, Appendix A)',
  (classId, speciesId, bonus) => {
    const state = game(classId);
    state.phase = { kind: 'encounter', pokemon: { speciesId } };
    const face = d6(state.rng).value;
    state.content.species.find((entry) => entry.id === speciesId)!.dc = face + bonus;
    const unmatched = structuredClone(state);
    unmatched.content.species.find((entry) => entry.id === speciesId)!.tags = ['normal'];
    const before = structuredClone(state);
    const odds = catchOdds(state, 0, 'poke');
    expect(odds.needed).toBe(face);
    expect(catchOdds(unmatched, 0, 'poke').needed).toBe(face + bonus);
    expect(odds.successFaces).toBeGreaterThan(catchOdds(unmatched, 0, 'poke').successFaces);
    expect(state).toEqual(before);

    for (const [scenario, expectedBonus, caught] of [
      [state, bonus, true],
      [unmatched, 0, false],
    ] as const) {
      const initialTeamSize = scenario.players[0]!.team.length;
      const log = createGameLog(scenario);
      const confirmed = command(scenario, 'catch', { ballType: 'poke' });
      expect(confirmed.state.phase).toMatchObject({ catchRoll: { classBonus: expectedBonus } });
      const rolled = advanceAutomatically(confirmed.state);
      log.actions.push(confirmed.record, ...rolled.records);
      expect(rolled.state.players[0]!.team).toHaveLength(initialTeamSize + Number(caught));
      expect(rolled.state.players[0]!.balls.poke).toBe(4);
      expect(rolled.state.players[0]!.catchBonusUsedLap).toBeUndefined();
      expect(replay(JSON.parse(JSON.stringify(log)))).toEqual(rolled.state);

      // Neither typed passive is consumed by a roll in the same Lap.
      const next = structuredClone(rolled.state);
      next.globalTurnNo++;
      next.turnBudgets.catchAttempt = 1;
      next.phase = { kind: 'encounter', pokemon: { speciesId } };
      expect(command(next, 'catch', { ballType: 'poke' }).state.phase).toMatchObject({
        catchRoll: { classBonus: expectedBonus },
      });
    }
  },
);

test.each([
  ['fisherman', 'caterpie'],
  ['bug-catcher', 'magikarp'],
] as const)('%s receives no bonus for %s (§4.3)', (classId, speciesId) => {
  const state = game(classId);
  state.phase = { kind: 'encounter', pokemon: { speciesId } };
  expect(command(state, 'catch', { ballType: 'poke' }).state.phase).toMatchObject({
    catchRoll: { classBonus: 0 },
  });
});

function pokemon(instanceId: string, speciesId: string, tired = false): PokemonInstance {
  return { instanceId, speciesId, tired, origin: 'caught', evolutionStage: 0, abilityReady: true };
}

function sellState(): GameState {
  const state = game('bug-catcher');
  state.phase = { kind: 'sell', destinationPosition: 2 };
  state.players[0]!.team.push(
    pokemon('bug', 'caterpie', true),
    pokemon('water', 'magikarp', true),
    { ...pokemon('rescue', 'caterpie', true), origin: 'rescue_starter', evolutionStage: 1 },
  );
  return state;
}

test('each bug sale adds +2 after Tired rounding, including the original Starter; Rescue sales stay zero (§4.5, §4.7)', () => {
  const state = sellState();
  const ids = state.players[0]!.team.map((entry) => entry.instanceId);
  const quote = saleQuote(state, 0, ids);
  expect(quote.rows).toEqual([
    { instanceId: 'starter:0', basePrice: 5, classBonus: 2 },
    { instanceId: 'bug', basePrice: 3, classBonus: 2 },
    { instanceId: 'water', basePrice: 2, classBonus: 0 },
    { instanceId: 'rescue', basePrice: 0, classBonus: 0 },
  ]);
  expect(quote.total).toBe(14);
  expect(saleQuote(state, 0, [...ids].reverse()).rows).toEqual([...quote.rows].reverse());
  expect(saleQuote(state, 0, ['rescue']).total).toBe(0);
  const log = createGameLog(state);
  const sold = command(state, 'sell', { pokemonInstanceIds: ids });
  log.actions.push(sold.record);
  expect(sold.state.players[0]!.coins - state.players[0]!.coins).toBe(quote.total);
  expect(sold.events.filter((event) => event.kind === 'coin_transfer').map((e) => e.sale)).toEqual(
    quote.rows.map(({ basePrice, classBonus }) => ({ basePrice, classBonus })),
  );
  expect(sold.state.players[0]!.team).toMatchObject([{ origin: 'rescue_starter' }]);
  expect(replay(JSON.parse(JSON.stringify(log)))).toEqual(sold.state);
});

test('Fisherman receives no sale bonus, even for water or bug Pokémon (§4.7, Appendix A)', () => {
  const state = sellState();
  state.players[0]!.classId = 'fisherman';
  expect(saleQuote(state, 0, ['bug', 'water']).rows.map((entry) => entry.classBonus)).toEqual([
    0, 0,
  ]);
});

test('Bug Catcher receives no class bonus in final auto-sales (§4.7 step 3)', () => {
  const state = sellState();
  state.phase = { kind: 'end' };
  state.finalTableRound = { triggerSeatIndex: 0, targetOwnTurnNo: 1 };
  for (const player of state.players) player.ownTurnNo = 1;
  const finished = advanceAutomatically(state);
  expect(finished.state.phase.kind).toBe('finished');
  const sales = finished.events
    .filter((event) => event.kind === 'coin_transfer')
    .filter(
      (event) => event.destination.kind === 'player' && event.destination.actorId === 'player-0',
    );
  expect(sales.map((event) => event.amount)).toEqual([3, 2, 2]);
  expect(sales.every((event) => event.reason === 'final_sale' && event.sale === undefined)).toBe(
    true,
  );
  expect(finished.state.players[0]!.team).toMatchObject([{ instanceId: 'rescue' }]);
});

test.each([
  ['fisherman', 'magikarp', 2],
  ['bug-catcher', 'caterpie', 1],
] as const)(
  '%s retains its trainer catch passive with a Rescue Starter team (S01 scope)',
  (classId, speciesId, bonus) => {
    const state = game(classId);
    state.players[0]!.team[0]!.origin = 'rescue_starter';
    state.phase = { kind: 'encounter', pokemon: { speciesId } };
    expect(command(state, 'catch', { ballType: 'poke' }).state.phase).toMatchObject({
      catchRoll: { classBonus: bonus },
    });
  },
);

test('pre-S01 executable versions reject instead of silently changing replayed passives (§6.8)', () => {
  const state = game('fisherman');
  state.config.engineVersion = '0.11.0';
  expect(() => createGame(state.config, state.content)).toThrow(/unsupported/i);
  expect(() => createGameLog(state)).toThrow(/unsupported/i);
});
