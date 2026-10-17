import { expect, test } from 'vitest';
import { fc } from '@fast-check/vitest';
import {
  advanceAutomatically,
  applyAction,
  createGame,
  createGameConfig,
  createGameLog,
  fixtureSchema,
  legalActions,
  observe,
  positionOf,
  replay,
  stateHash,
  type GameState,
} from './index.ts';
import fixture from './fixtures/start-of-game-2p.json';
import { forceMove } from './testing.ts';

function movementState(progress = 20, seed = 4): GameState {
  const scenario = fixtureSchema.parse(fixture).state;
  const state = createGame(
    createGameConfig({ seats: scenario.config.seats, seed, lapTarget: 3 }),
    scenario.content,
  );
  state.phase = { kind: 'move' };
  state.globalTurnNo = 1;
  state.players[0]!.routeProgress = progress;
  return state;
}

function command(state: GameState, kind: string) {
  const result = applyAction(state, {
    actorId: state.players.find((player) => player.seatIndex === state.activeSeatIndex)!.actorId,
    actionSeq: state.stateRevision + 1,
    stateRevisionBefore: state.stateRevision,
    kind,
    payload: {},
  });
  if ('rejected' in result) throw new Error(result.reason);
  return result;
}

function move(state: GameState) {
  const roll = command(state, 'roll');
  const result = advanceAutomatically(roll.state);
  expect(result.records).toHaveLength(1);
  return { ...result, records: [roll.record, ...result.records] };
}

test('a logged six from square 20 lands on 2 and pays one bank income before Sell (§4.1, §4.2, §4.7)', () => {
  const state = movementState(); // Seed 4's first d6 is 6.
  const before = structuredClone(state);
  const result = move(state);
  expect(result.state.players[0]).toMatchObject({ routeProgress: 26, creditedLap: 1, coins: 25 });
  expect(observe(result.state, 0).public.players[0]!.position).toBe(2);
  expect(result.events).toEqual([
    { kind: 'random_result', purpose: 'move:0:1', result: 6, drawCounter: 1 },
    {
      kind: 'coin_transfer',
      source: { kind: 'bank' },
      destination: { kind: 'player', actorId: 'player-0' },
      amount: 5,
      reason: 'start_income',
    },
    { kind: 'phase_changed', from: 'move', to: 'sell' },
  ]);
  expect(result.state.phase).toEqual({ kind: 'sell', destinationPosition: 2 });
  expect(state).toEqual(before);
});

test('landing exactly on Start pays once, while setup and a move before Start pay nothing (§4.1)', () => {
  const fresh = movementState(0);
  expect(fresh.players[0]).toMatchObject({
    coins: 20,
    creditedLap: 0,
    highestRewardedMilestone: 0,
  });
  const beforeStart = move(fresh);
  expect(beforeStart.state.players[0]).toMatchObject({
    routeProgress: 6,
    coins: 20,
    creditedLap: 0,
  });
  expect(beforeStart.events.filter((event) => event.kind === 'coin_transfer')).toEqual([]);
  const landed = move(movementState(18));
  expect(observe(landed.state, 0).public.players[0]!.position).toBe(0);
  expect(landed.state.players[0]).toMatchObject({ routeProgress: 24, creditedLap: 1, coins: 25 });
  expect(landed.state.phase).toEqual({ kind: 'sell', destinationPosition: 0 });
  expect(landed.events.filter((event) => event.kind === 'coin_transfer')).toHaveLength(1);
});

test.each([
  { progress: 18, position: 0, space: 'start' },
  { progress: 20, position: 2, space: 'event' },
  { progress: 22, position: 4, space: 'shop' },
  { progress: 24, position: 6, space: 'gym' },
])(
  'the $space destination logs resolution without gameplay effects (§4.2)',
  ({ progress, position }) => {
    let state = move(movementState(progress)).state;
    if (state.phase.kind === 'sell') state = command(state, 'finish_sell').state;
    const before = structuredClone(state);
    const result = command(state, 'skip');
    expect(result.events).toEqual([
      { kind: 'space_resolved', seatIndex: 0, position },
      { kind: 'phase_changed', from: 'resolve', to: 'end' },
    ]);
    expect(result.state.players).toEqual(before.players);
    expect(state).toEqual(before);
  },
);

test('pending movement resumes once and paid movement/Sell/resolution replay exactly (§6.8, §8)', () => {
  const initial = movementState();
  const log = createGameLog(initial);
  const roll = command(initial, 'roll');
  log.actions.push(roll.record);
  const resumed = replay(JSON.parse(JSON.stringify(log)));
  expect(resumed.phase).toEqual({ kind: 'move', awaitingResult: true });
  expect(resumed.players[0]!.routeProgress).toBe(20);
  const result = advanceAutomatically(resumed);
  log.actions.push(...result.records);
  const finished = command(result.state, 'finish_sell');
  log.actions.push(finished.record);
  const resolved = command(finished.state, 'skip');
  log.actions.push(resolved.record);
  expect(stateHash(replay(JSON.parse(JSON.stringify(log))))).toBe(stateHash(resolved.state));
  expect(
    log.actions
      .flatMap((record) => record.events)
      .filter((event) => event.kind === 'coin_transfer'),
  ).toHaveLength(1);
  expect(result.state.players[1]).toEqual(initial.players[1]);
  expect(replay(log).players[0]).toMatchObject({
    coins: 25,
    creditedLap: 1,
    highestRewardedMilestone: 1,
  });
  const repeated = applyAction(result.state, {
    actorId: 'engine',
    actionSeq: result.state.stateRevision + 1,
    stateRevisionBefore: result.state.stateRevision,
    kind: 'dice_result',
    payload: { purpose: 'move:0:1', value: 2 },
  });
  expect(repeated).toMatchObject({ rejected: true, reason: 'illegal_action' });
  expect(repeated.state).toBe(result.state);
});

test('10,000 random single moves keep credit monotonic, positions bounded and milestones paid once (§6.5, §8)', () => {
  fc.assert(
    fc.property(
      fc.array(fc.integer({ min: -6, max: 6 }), { minLength: 10_000, maxLength: 10_000 }),
      (deltas) => {
        let state = movementState(0, 22);
        const rewarded = new Set<number>();
        for (const delta of deltas) {
          const previous = state.players[0]!;
          if (delta <= 0 || delta % 2 === 0) {
            state = forceMove(state, 0, delta);
            expect(state.players[0]!.coins).toBe(previous.coins);
            expect(state.players[0]!.highestRewardedMilestone).toBe(
              previous.highestRewardedMilestone,
            );
          } else {
            state.phase = { kind: 'move' };
            const result = move(state);
            state = result.state;
            for (const event of result.events) {
              if (event.kind !== 'coin_transfer') continue;
              const milestone = Math.floor(state.players[0]!.routeProgress / 24);
              expect(rewarded.has(milestone)).toBe(false);
              rewarded.add(milestone);
            }
          }
          const player = state.players[0]!;
          expect(player.creditedLap).toBeGreaterThanOrEqual(previous.creditedLap);
          expect(player.creditedLap).toBe(rewarded.size);
          expect(player.coins).toBe(20 + 5 * rewarded.size);
          expect(positionOf(player.routeProgress)).toBeGreaterThanOrEqual(0);
          expect(positionOf(player.routeProgress)).toBeLessThanOrEqual(23);
        }
      },
    ),
    { numRuns: 1, seed: 22 },
  );
});

test('test-only displacement preserves other seats and rejects non-whole or unsafe movement (§6.5)', () => {
  const state = movementState(0);
  const before = structuredClone(state);
  const pushed = forceMove(state, 1, -2);
  expect(positionOf(pushed.players[1]!.routeProgress)).toBe(22);
  expect(pushed.players[1]).toMatchObject({
    coins: 20,
    creditedLap: 0,
    highestRewardedMilestone: 0,
  });
  expect(pushed.players[0]).toEqual(state.players[0]);
  expect(pushed.stateRevision).toBe(state.stateRevision);
  expect(pushed.rng).toEqual(state.rng);
  for (const delta of [0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    expect(() => forceMove(state, 0, delta)).toThrow(RangeError);
  }
  expect(() => forceMove(movementState(Number.MAX_SAFE_INTEGER), 0, 1)).toThrow(RangeError);
  expect(() => forceMove(state, 9, 1)).toThrow(RangeError);
  expect(state).toEqual(before);
});

test('crossing setup Start from negative progress gives no income (§4.1, §6.5)', () => {
  const result = move(forceMove(movementState(0), 0, -2));
  expect(result.state.players[0]).toMatchObject({ routeProgress: 4, creditedLap: 0, coins: 20 });
  expect(result.events.filter((event) => event.kind === 'coin_transfer')).toEqual([]);
});

test('executors reject old turn-only version snapshots instead of silently changing their replay (§6.8)', () => {
  const initial = movementState();
  initial.config.engineVersion = '0.1.0';
  expect(() => createGame(initial.config, initial.content)).toThrow(/unsupported/i);
  expect(() => createGameLog(initial)).toThrow(/unsupported/i);
});

test('an empty Sell finishes before the destination is resolved (§4.2 steps 4–6, §4.7, §8)', () => {
  const movement = move(movementState());
  const finished = command(movement.state, 'finish_sell');
  expect(finished.state.phase).toEqual({ kind: 'resolve' });
  expect(finished.state.players).toEqual(movement.state.players);
  expect(legalActions(movement.state, 0).enabled.map((choice) => choice.kind)).toEqual([
    'sell',
    'sell',
  ]);
  const resolved = command(finished.state, 'skip');
  expect(resolved.state.phase).toEqual({ kind: 'end' });
  expect(
    [...movement.events, ...finished.events, ...resolved.events].map((event) => event.kind),
  ).toEqual([
    'random_result',
    'coin_transfer',
    'phase_changed',
    'phase_changed',
    'space_resolved',
    'phase_changed',
  ]);
  expect(resolved.events).toEqual([
    { kind: 'space_resolved', seatIndex: 0, position: 2 },
    { kind: 'phase_changed', from: 'resolve', to: 'end' },
  ]);
});

test('a forced pushback and forward recrossing never pay the old milestone twice (§6.5)', () => {
  const paid = move(movementState()).state;
  const before = structuredClone(paid);
  const pushed = forceMove(paid, 0, -4);
  expect(pushed.players[0]).toMatchObject({ routeProgress: 22, coins: 25, creditedLap: 1 });
  expect(paid).toEqual(before);
  pushed.phase = { kind: 'move' };
  const recrossed = move(pushed); // Seed 4's second d6 is 2: lands exactly on old Start.
  expect(recrossed.state.players[0]).toMatchObject({
    routeProgress: 24,
    coins: 25,
    creditedLap: 1,
  });
  expect(recrossed.events.filter((event) => event.kind === 'coin_transfer')).toEqual([]);
  expect(recrossed.state.phase).toEqual({ kind: 'resolve' });
});

test('a forced forward crossing earns nothing and cannot make a later paid milestone pay twice (§6.5)', () => {
  const initial = movementState();
  const pulled = forceMove(initial, 0, 24);
  expect(pulled.players[0]).toMatchObject({ routeProgress: 44, creditedLap: 0, coins: 20 });
  const paid = move(pulled).state;
  expect(paid.players[0]).toMatchObject({
    routeProgress: 50,
    coins: 25,
    creditedLap: 1,
    highestRewardedMilestone: 2,
  });
  const pushed = forceMove(paid, 0, -4);
  pushed.phase = { kind: 'move' };
  const recrossed = move(pushed);
  expect(recrossed.state.players[0]).toMatchObject({ routeProgress: 48, coins: 25 });
  expect(recrossed.events.filter((event) => event.kind === 'coin_transfer')).toEqual([]);
});

test('Start income and Sell precede the Wild draw, whose release and movement replay exactly (§4.2, §4.5, §8)', () => {
  const initial = movementState(19);
  const log = createGameLog(initial);
  const moved = move(initial);
  log.actions.push(...moved.records);
  expect(moved.state.phase).toEqual({ kind: 'sell', destinationPosition: 1 });
  expect(moved.state.rng.cursor).toBe(1);
  const sold = command(moved.state, 'finish_sell');
  log.actions.push(sold.record);
  expect(sold.state.phase).toEqual({ kind: 'resolve' });
  expect(sold.state.rng.cursor).toBe(1);
  const resolved = command(sold.state, 'skip');
  log.actions.push(resolved.record);
  expect(resolved.state.phase.kind).toBe('encounter');
  expect(resolved.events).toEqual([
    { kind: 'space_resolved', seatIndex: 0, position: 1 },
    { kind: 'random_result', purpose: 'encounter:rarity', result: 0, drawCounter: 2 },
    { kind: 'random_result', purpose: 'encounter:species', result: 0, drawCounter: 3 },
    { kind: 'phase_changed', from: 'resolve', to: 'encounter' },
  ]);
  const released = command(resolved.state, 'release');
  log.actions.push(released.record);
  expect(released.state.phase.kind).toBe('end');
  expect(released.state.players[0]).toMatchObject({ coins: 25, creditedLap: 1 });
  expect(released.state.players[0]!.team).toEqual(initial.players[0]!.team);
  expect(replay(JSON.parse(JSON.stringify(log)))).toEqual(released.state);
});
