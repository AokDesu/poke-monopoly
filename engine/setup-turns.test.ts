import { expect, test, vi } from 'vitest';
import * as random from './rng.ts';
import {
  createGame,
  createGameConfig,
  fixtureSchema,
  gameStateSchema,
  observe,
  advanceAutomatically,
  createGameLog,
  replay,
  stateHash,
  type GameState,
  type GameLog,
  applyAction,
  d6,
} from './index.ts';
import fixture from './fixtures/start-of-game-2p.json';

function fixtureContent() {
  const content = fixtureSchema.parse(fixture).state.content;
  // Contract-only seats, using species/items already in the minimal fixture.
  content.classes.push(
    {
      id: 'fixture-caterpie',
      name: 'Fixture Caterpie',
      starterSpeciesIds: ['caterpie'],
      classItemId: 'potion',
    },
    {
      id: 'fixture-pidgey',
      name: 'Fixture Pidgey',
      starterSpeciesIds: ['pidgey'],
      classItemId: 'great-ball',
    },
  );
  return content;
}

function configFor(count: number) {
  return createGameConfig({
    seats: ['main-character', 'rival', 'fixture-caterpie', 'fixture-pidgey']
      .slice(0, count)
      .map((classId, seatIndex) => ({
        actorId: `player-${seatIndex}`,
        seatIndex,
        classId,
        controller: seatIndex === 0 ? 'human' : 'ai',
      })),
    seed: 21,
    lapTarget: 3,
  });
}

test.each([2, 3, 4])(
  'a %i-seat game grants only the public starting kits and no setup income (§3, §4.1)',
  (count) => {
    const config = configFor(count);
    const content = fixtureContent();
    const before = structuredClone({ config, content });
    const state = createGame(config, content);
    expect(gameStateSchema.parse(state)).toEqual(state);
    expect(state.players).toHaveLength(count);
    const starters = ['bulbasaur', 'eevee', 'caterpie', 'pidgey'];
    const items = [null, 'lucky-egg', 'potion', null];
    for (const player of state.players) {
      expect(player).toMatchObject({
        actorId: `player-${player.seatIndex}`,
        coins: 20,
        routeProgress: 0,
        creditedLap: 0,
        ownTurnNo: 0,
        balls: { poke: 5, great: items[player.seatIndex] === null ? 1 : 0, ultra: 0 },
        team: [
          {
            speciesId: starters[player.seatIndex],
            origin: 'original_starter',
            evolutionStage: 0,
            tired: false,
            abilityReady: true,
          },
        ],
      });
      expect(player.items.map((item) => item.itemId)).toEqual(
        items[player.seatIndex] === null ? [] : [items[player.seatIndex]],
      );
      expect(player.items.every((item) => item.visibility === 'public')).toBe(true);
      expect(
        observe(state, (player.seatIndex + 1) % count).public.players[player.seatIndex]!.knownItems,
      ).toEqual(player.items);
    }
    const uids = state.players.flatMap((player) =>
      [...player.team, ...player.items].map((entry) => entry.instanceId),
    );
    expect(new Set(uids).size).toBe(uids.length);
    expect(state).toMatchObject({
      stateRevision: 0,
      globalTurnNo: 0,
      rng: { cursor: 0 },
      phase: { kind: 'first_player_roll' },
    });
    expect({ config, content }).toEqual(before);
    state.players[0]!.coins = 0;
    state.content.classes[0]!.name = 'changed';
    expect({ config, content }).toEqual(before);
  },
);

test('setup rejects duplicate classes rather than granting two copies of a class (§3)', () => {
  const config = configFor(2);
  config.seats[1]!.classId = config.seats[0]!.classId;
  const before = structuredClone(config);
  expect(() => createGame(config, fixtureContent())).toThrow(/unique classes/i);
  expect(config).toEqual(before);
});

test('only tied highest seats reroll, with every roll replayed through the command pipeline (§3, §6.4)', () => {
  const script = [2, 6, 6, 1, 4, 4, 3, 5];
  const seededD6 = random.d6;
  // Script the exported randomness boundary; cursor makes it snapshot/replay deterministic.
  const dice = vi.spyOn(random, 'd6').mockImplementation((rng, purpose = 'd6') => {
    const draw = seededD6(rng, purpose);
    const value = script[rng.cursor];
    if (value === undefined) throw new Error('Unexpected additional RNG draw');
    return { ...draw, value, events: [{ ...draw.events[0]!, result: value }] };
  });
  try {
    let state = createGame(configFor(4), fixtureContent());
    const log = createGameLog(state);
    for (let step = 0; step < 16; step++) {
      const before = structuredClone(state);
      const result = advanceAutomatically(state);
      expect(result.records).toHaveLength(1);
      expect(state).toEqual(before);
      log.actions.push(...result.records);
      state = result.state;
    }
    expect(
      log.actions
        .filter(({ action }) => action.kind === 'roll')
        .map(({ action }) => action.actorId),
    ).toEqual([
      'player-0',
      'player-1',
      'player-2',
      'player-3',
      'player-1',
      'player-2',
      'player-1',
      'player-2',
    ]);
    expect(
      log.actions.flatMap(({ events }) => events).filter((event) => event.kind === 'random_result'),
    ).toEqual(
      script.map((result, index) => ({
        kind: 'random_result',
        purpose: `first-player:${[0, 1, 2, 3, 1, 2, 1, 2][index]}`,
        result,
        drawCounter: index + 1,
      })),
    );
    expect(log.actions.map(({ action }) => action.actionSeq)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
    ]);
    expect(state).toMatchObject({
      activeSeatIndex: 2,
      phase: { kind: 'start' },
      globalTurnNo: 1,
      stateRevision: 16,
      rng: { cursor: 8 },
      turnBudgets: { tacticalAction: 1, catchAttempt: 1, pokemonAbility: 1 },
    });
    expect(state.players.map((player) => player.ownTurnNo)).toEqual([0, 0, 1, 0]);
    expect(state.players.map((player) => player.seatIndex)).toEqual([0, 1, 2, 3]);
    expect(stateHash(replay(JSON.parse(JSON.stringify(log))))).toBe(stateHash(state));
  } finally {
    dice.mockRestore();
  }
});

function startedGame(): { state: GameState; log: GameLog } {
  const config = configFor(3);
  config.seed = 7; // Fixed seeded rolls: 1, 1, 6. Seat 2 starts.
  let state = createGame(config, fixtureContent());
  const log = createGameLog(state);
  for (let step = 0; step < 6; step++) {
    const result = advanceAutomatically(state);
    if (result.records.length !== 1) throw new Error('First-player roll did not advance');
    state = result.state;
    log.actions.push(...result.records);
  }
  return { state, log };
}

// Wild spaces now require a deliberate player choice; keep turn-flow tests on release.
function advanceOrRelease(state: GameState) {
  if (state.phase.kind !== 'encounter' && state.phase.kind !== 'sell') {
    return advanceAutomatically(state);
  }
  // Sell and Encounter expose real decisions; these turn-order scenarios keep the team.
  const result = applyAction(state, {
    actorId: state.players[state.activeSeatIndex]!.actorId,
    actionSeq: state.stateRevision + 1,
    stateRevisionBefore: state.stateRevision,
    ...(state.phase.kind === 'sell'
      ? { kind: 'sell' as const, payload: { pokemonInstanceIds: [] } }
      : { kind: 'release' as const, payload: {} }),
  });
  if ('rejected' in result) throw new Error(result.reason);
  return { state: result.state, records: [result.record], events: result.events };
}

test('the logged phase skeleton passes through social/strategy and returns to Start in fixed seat order (§4.2)', () => {
  const game = startedGame();
  let state = game.state;
  const log = game.log;
  const before = structuredClone(state);
  const phases = [state.phase.kind];
  for (let step = 0; step < 8; step++) {
    const result = advanceOrRelease(state);
    expect(result.records).toHaveLength(1);
    log.actions.push(...result.records);
    state = result.state;
    phases.push(state.phase.kind);
  }
  expect(phases).toEqual([
    'start',
    'social',
    'strategy',
    'move',
    'move',
    'resolve',
    'encounter',
    'end',
    'start',
  ]);
  expect(state).toMatchObject({ activeSeatIndex: 0, globalTurnNo: 2, phase: { kind: 'start' } });
  expect(state.players.map((player) => player.ownTurnNo)).toEqual([1, 0, 1]);
  expect(state.players.map((player) => player.routeProgress)).toEqual([0, 0, 5]);
  expect(
    state.players.map(({ coins, creditedLap, balls, items, team }) => ({
      coins,
      creditedLap,
      balls,
      items,
      team,
    })),
  ).toEqual(
    before.players.map(({ coins, creditedLap, balls, items, team }) => ({
      coins,
      creditedLap,
      balls,
      items,
      team,
    })),
  );
  expect(stateHash(replay(JSON.parse(JSON.stringify(log))))).toBe(stateHash(state));
});

test('setup rejects duplicate actors or invalid fixed seat indexes (§3, §6.4)', () => {
  for (const change of [
    (config: ReturnType<typeof configFor>) => {
      config.seats[1]!.actorId = config.seats[0]!.actorId;
    },
    (config: ReturnType<typeof configFor>) => {
      config.seats[1]!.seatIndex = 0;
    },
    (config: ReturnType<typeof configFor>) => {
      config.seats[1]!.seatIndex = 3;
    },
  ]) {
    const config = configFor(2);
    change(config);
    expect(() => createGame(config, fixtureContent())).toThrow(/unique actors|fixed seats/i);
  }
});

test('setup honors an explicit class Starter choice when content lists alternatives (§4.1, Appendix A)', () => {
  const content = fixtureContent();
  content.classes[0]!.starterSpeciesIds = ['bulbasaur', 'eevee'];
  const config = configFor(2);
  config.seats[0] = { ...config.seats[0]!, starterSpeciesId: 'eevee' };
  expect(createGame(config, content).players[0]!.team[0]!.speciesId).toBe('eevee');
  delete config.seats[0]!.starterSpeciesId;
  expect(() => createGame(config, content)).toThrow(/choose a class starter/i);
  config.seats[0]!.starterSpeciesId = 'caterpie';
  expect(() => createGame(config, content)).toThrow(/class starter/i);
});

test('40 turns with 3 seats keep global and own counters separate and replay exactly (§6.4)', () => {
  const game = startedGame();
  let state = game.state;
  const log = game.log;
  const startedSeats: number[] = [];
  for (let turn = 1; turn <= 40; turn++) {
    expect(state.phase.kind).toBe('start');
    startedSeats.push(state.activeSeatIndex);
    expect(state.globalTurnNo).toBe(turn);
    expect(state.turnBudgets).toEqual({ tacticalAction: 1, catchAttempt: 1, pokemonAbility: 1 });
    if (turn === 40) break;
    for (let step = 0; step < 10; step++) {
      const result = advanceOrRelease(state);
      expect(result.records).toHaveLength(1);
      state = result.state;
      log.actions.push(...result.records);
      if (state.phase.kind === 'start') break;
    }
  }
  expect(startedSeats).toEqual([
    2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0,
    1, 2, 0, 1, 2, 0, 1, 2,
  ]);
  expect(state.players.map((player) => player.ownTurnNo)).toEqual([13, 13, 14]);
  expect(state.players.map((player) => player.seatIndex)).toEqual([0, 1, 2]);
  expect(stateHash(replay(JSON.parse(JSON.stringify(log))))).toBe(stateHash(state));
  expect(log.actions.map(({ action }) => action.actionSeq)).toEqual(
    Array.from({ length: log.actions.length }, (_, index) => index + 1),
  );
});

test('turn start replaces spent and leftover budgets with one, without accumulation (§4.2)', () => {
  let { state } = startedGame();
  for (let step = 0; step < 7; step++) state = advanceOrRelease(state).state;
  expect(state.phase.kind).toBe('end');
  for (const turnBudgets of [
    { tacticalAction: 0, catchAttempt: 5, pokemonAbility: 2 },
    { tacticalAction: 8, catchAttempt: 0, pokemonAbility: 0 },
  ]) {
    const withLeftovers = { ...structuredClone(state), turnBudgets };
    const before = structuredClone(withLeftovers);
    const result = advanceAutomatically(withLeftovers);
    expect(result.state.turnBudgets).toEqual({
      tacticalAction: 1,
      catchAttempt: 1,
      pokemonAbility: 1,
    });
    expect(result.state.globalTurnNo).toBe(2);
    expect(result.state.players.map((player) => player.ownTurnNo)).toEqual([1, 0, 1]);
    expect(withLeftovers).toEqual(before);
  }
});

test('new setup rejects incompatible engine and RNG versions (§6.8)', () => {
  for (const field of ['engineVersion', 'rngVersion'] as const) {
    const config = configFor(2);
    config[field] = 'unsupported';
    expect(() => createGame(config, fixtureContent())).toThrow(/unsupported.*version/i);
  }
});

test('reserved dice results require an outstanding roll and its exact purpose (§3, §6.3)', () => {
  const { state } = startedGame();
  const purpose = 'first-player:2';
  const forged = applyAction(state, {
    actorId: 'engine',
    kind: 'dice_result',
    actionSeq: state.stateRevision + 1,
    stateRevisionBefore: state.stateRevision,
    payload: { purpose, value: d6(state.rng, purpose).value },
  });
  expect(forged).toEqual({ rejected: true, reason: 'illegal_action', state });
  let move = state;
  for (let step = 0; step < 3; step++) move = advanceAutomatically(move).state;
  expect(move.phase.kind).toBe('move');
  const movePurpose = 'move:2:1';
  expect(
    applyAction(move, {
      actorId: 'engine',
      kind: 'dice_result',
      actionSeq: move.stateRevision + 1,
      stateRevisionBefore: move.stateRevision,
      payload: { purpose: movePurpose, value: d6(move.rng, movePurpose).value },
    }),
  ).toEqual({ rejected: true, reason: 'illegal_action', state: move });
  const pending = advanceAutomatically(move).state;
  const before = structuredClone(pending);
  for (const payload of [
    { purpose: 'wrong-purpose', value: d6(pending.rng).value },
    { purpose: movePurpose, value: (d6(pending.rng).value % 6) + 1 },
  ]) {
    expect(
      applyAction(pending, {
        actorId: 'engine',
        kind: 'dice_result',
        actionSeq: pending.stateRevision + 1,
        stateRevisionBefore: pending.stateRevision,
        payload,
      }),
    ).toEqual({ rejected: true, reason: 'illegal_action', state: pending });
  }
  expect(
    applyAction(pending, {
      actorId: 'player-2',
      kind: 'roll',
      payload: {},
      actionSeq: pending.stateRevision + 1,
      stateRevisionBefore: pending.stateRevision,
    }),
  ).toEqual({ rejected: true, reason: 'illegal_action', state: pending });
  expect(pending).toEqual(before);
  expect(advanceAutomatically(pending).state.phase.kind).toBe('resolve');
});

test('input array order cannot reorder fixed seats (§3)', () => {
  const config = configFor(3);
  config.seats.reverse();
  const before = structuredClone(config);
  const state = createGame(config, fixtureContent());
  expect(state.config.seats.map((seat) => seat.seatIndex)).toEqual([0, 1, 2]);
  expect(state.players.map((player) => player.actorId)).toEqual([
    'player-0',
    'player-1',
    'player-2',
  ]);
  expect(state.phase).toMatchObject({ kind: 'first_player_roll', contenders: [0, 1, 2] });
  expect(config).toEqual(before);
});

test('setup refuses unsupported seat counts and missing starting-kit references (§3, §4.1)', () => {
  for (const count of [1, 5]) {
    const config = configFor(4);
    config.seats =
      count === 1
        ? config.seats.slice(0, 1)
        : [...config.seats, { actorId: 'fifth', seatIndex: 4, classId: 'fifth', controller: 'ai' }];
    expect(() => createGame(config, fixtureContent())).toThrow();
  }
  for (const change of [
    (content: ReturnType<typeof fixtureContent>) => {
      content.classes[0]!.id = 'unknown-class';
    },
    (content: ReturnType<typeof fixtureContent>) => {
      content.species = content.species.filter(({ id }) => id !== 'bulbasaur');
    },
    (content: ReturnType<typeof fixtureContent>) => {
      content.items = content.items.filter(({ id }) => id !== 'great-ball');
    },
  ]) {
    const content = fixtureContent();
    change(content);
    expect(() => createGame(configFor(2), content)).toThrow(/unknown class|missing content/i);
  }
});
