import { expect, test } from 'vitest';
import { fc } from '@fast-check/vitest';
import {
  advanceAutomatically,
  applyAction,
  createGame,
  createGameConfig,
  createGameLog,
  d6,
  fixtureSchema,
  legalActions,
  replay,
  type GameState,
} from './index.ts';
import fixture from './fixtures/start-of-game-2p.json';

/** Seat 0 in Strategy holding one secret item; seat 1 (Rival) holds its public Lucky Egg. */
function strategy(itemId: string, seed = 4): GameState {
  const scenario = fixtureSchema.parse(fixture).state;
  const state = createGame(
    createGameConfig({ seats: scenario.config.seats, seed, lapTarget: 3 }),
    scenario.content,
  );
  state.phase = { kind: 'strategy' };
  state.globalTurnNo = 1;
  state.players[0]!.ownTurnNo = 1;
  state.turnBudgets = { tacticalAction: 1, catchAttempt: 1, pokemonAbility: 1 };
  state.players[0]!.items.push({
    instanceId: 'bought:0:1',
    itemId,
    name: itemId,
    visibility: 'secret',
  });
  return state;
}

/** Keep the team, buy and catch nothing, and skip everything else until `done` holds. */
function playUntil(start: GameState, done: (state: GameState) => boolean): GameState {
  let state = start;
  for (let step = 0; step < 200; step++) {
    if (done(state)) return state;
    const automatic = advanceAutomatically(state);
    if (automatic.records.length === 1) {
      state = automatic.state;
    } else if (state.phase.kind === 'sell') {
      state = accepted(state, 'sell', { pokemonInstanceIds: [] }).state;
    } else if (state.phase.kind === 'shop') {
      state = accepted(state, 'skip_shop').state;
    } else if (state.phase.kind === 'encounter') {
      state = accepted(state, 'release').state;
    } else {
      state = accepted(state, 'skip').state;
    }
  }
  throw new Error('Scenario state not reached');
}

/** `seat` has rolled and its move die is pending. */
function untilMoveResult(start: GameState, seat: number): GameState {
  return playUntil(
    start,
    (state) =>
      state.activeSeatIndex === seat && state.phase.kind === 'move' && !!state.phase.awaitingResult,
  );
}

/** Value the next logged move die will show for the active seat. */
function pendingMoveDie(state: GameState): number {
  return d6(state.rng, `move:${state.activeSeatIndex}:${state.globalTurnNo}`).value;
}

function command(state: GameState, kind: string, payload = {}) {
  return applyAction(state, {
    actorId: state.players[state.activeSeatIndex]!.actorId,
    actionSeq: state.stateRevision + 1,
    stateRevisionBefore: state.stateRevision,
    kind,
    payload,
  });
}

function accepted(state: GameState, kind: string, payload = {}) {
  const result = command(state, kind, payload);
  if ('rejected' in result) throw new Error(result.reason);
  return result;
}

test.each([
  [9, 5, 4, 25],
  [3, 3, 0, 23],
])(
  'Pickpocket against a target holding %i coins moves %i to the user in one coin_transfer (§4.6, Appendix A)',
  (targetCoins, taken, targetAfter, userAfter) => {
    const state = strategy('pickpocket');
    state.players[1]!.coins = targetCoins;
    const result = accepted(state, 'use_item', {
      itemInstanceId: 'bought:0:1',
      targetSeatIndex: 1,
    });
    expect(result.state.players[1]!.coins).toBe(targetAfter);
    expect(result.state.players[0]!.coins).toBe(userAfter);
    expect(result.events.filter((event) => event.kind === 'coin_transfer')).toEqual([
      {
        kind: 'coin_transfer',
        source: { kind: 'player', actorId: 'player-1' },
        destination: { kind: 'player', actorId: 'player-0' },
        amount: taken,
        reason: 'pickpocket',
      },
    ]);
  },
);

test('a used item is removed, logged with uid_destroyed and spends the tacticalAction (§4.2, §8)', () => {
  const state = strategy('pickpocket');
  const result = accepted(state, 'use_item', { itemInstanceId: 'bought:0:1', targetSeatIndex: 1 });
  expect(result.state.players[0]!.items).toEqual([]);
  expect(result.events.at(-1)).toEqual({
    kind: 'uid_destroyed',
    instanceId: 'bought:0:1',
    entity: 'item',
    reason: 'used',
  });
  expect(result.state.turnBudgets).toEqual({
    tacticalAction: 0,
    catchAttempt: 1,
    pokemonAbility: 1,
  });
  expect(result.state.phase).toEqual({ kind: 'strategy' });
});

test('a second item use in the same turn is disabled with ALREADY_USED_THIS_TURN (§4.2)', () => {
  const state = strategy('pickpocket');
  state.players[0]!.items.push({
    instanceId: 'bought:0:2',
    itemId: 'pickpocket',
    name: 'Pickpocket',
    visibility: 'secret',
  });
  const used = accepted(state, 'use_item', { itemInstanceId: 'bought:0:1', targetSeatIndex: 1 });
  const choices = legalActions(used.state, 0);
  expect(choices.enabled).toEqual([{ id: 'skip', kind: 'skip', payload: {} }]);
  expect(choices.disabled).toEqual([
    {
      id: 'use-item:bought:0:2:seat-1',
      kind: 'use_item',
      payload: { itemInstanceId: 'bought:0:2', targetSeatIndex: 1 },
      reasonCode: 'ALREADY_USED_THIS_TURN',
      reasonText: 'Tactical action already used this turn',
    },
  ]);
  const second = command(used.state, 'use_item', {
    itemInstanceId: 'bought:0:2',
    targetSeatIndex: 1,
  });
  expect(second).toEqual({ rejected: true, reason: 'illegal_action', state: used.state });
});

test('Pickpocket against a target with 0 coins is disabled with NO_VALID_TARGET and rejected (§4.6)', () => {
  const state = strategy('pickpocket');
  state.players[1]!.coins = 0;
  expect(legalActions(state, 0).disabled).toEqual([
    {
      id: 'use-item:bought:0:1:seat-1',
      kind: 'use_item',
      payload: { itemInstanceId: 'bought:0:1', targetSeatIndex: 1 },
      reasonCode: 'NO_VALID_TARGET',
      reasonText: 'Target has no coins',
    },
  ]);
  const result = command(state, 'use_item', { itemInstanceId: 'bought:0:1', targetSeatIndex: 1 });
  expect(result).toEqual({ rejected: true, reason: 'illegal_action', state });
});

test.each([
  [1, 1],
  [3, 1],
  [6, 4],
])(
  "Repel makes the target's next move with d6 = %i advance %i square(s), then clears (§4.6, Appendix A)",
  (die, steps) => {
    for (let seed = 0; seed < 500; seed++) {
      const used = accepted(strategy('repel', seed), 'use_item', {
        itemInstanceId: 'bought:0:1',
        targetSeatIndex: 1,
      }).state;
      const pending = untilMoveResult(used, 1);
      if (pendingMoveDie(pending) !== die) continue;
      const before = pending.players[1]!.routeProgress;
      const moved = advanceAutomatically(pending).state;
      expect(moved.players[1]!.routeProgress - before).toBe(steps);
      // The slow is gone after that actual move: the following move uses the full die.
      const next = untilMoveResult(moved, 1);
      const full = pendingMoveDie(next);
      const from = next.players[1]!.routeProgress;
      expect(advanceAutomatically(next).state.players[1]!.routeProgress - from).toBe(full);
      return;
    }
    throw new Error(`No seed produced a target move die of ${die}`);
  },
);

test('a second Repel on a target that still has one pending is NO_VALID_TARGET (§4.6)', () => {
  const scenario = fixtureSchema.parse(fixture).state;
  const content = structuredClone(scenario.content);
  content.classes.push({
    id: 'nurse-joy',
    name: 'Nurse Joy',
    starterSpeciesIds: ['chansey'],
    classItemId: 'poke-ball',
  });
  let state = createGame(
    createGameConfig({
      seats: [
        ...scenario.config.seats,
        { actorId: 'player-2', seatIndex: 2, classId: 'nurse-joy', controller: 'ai' },
      ],
      seed: 4,
      lapTarget: 3,
    }),
    content,
  );
  state.phase = { kind: 'strategy' };
  state.turnBudgets = { tacticalAction: 1, catchAttempt: 1, pokemonAbility: 1 };
  for (const seat of [0, 1]) {
    state.players[seat]!.items.push({
      instanceId: `bought:${seat}:1`,
      itemId: 'repel',
      name: 'Repel',
      visibility: 'secret',
    });
  }
  state = accepted(state, 'use_item', { itemInstanceId: 'bought:0:1', targetSeatIndex: 2 }).state;
  state = playUntil(
    state,
    (current) => current.activeSeatIndex === 1 && current.phase.kind === 'strategy',
  );
  const choices = legalActions(state, 1);
  expect(choices.enabled.map((choice) => choice.id)).toEqual([
    'use-item:class-item:1',
    'use-item:bought:1:1:seat-0',
    'skip',
  ]);
  expect(choices.disabled).toEqual([
    {
      id: 'use-item:bought:1:1:seat-2',
      kind: 'use_item',
      payload: { itemInstanceId: 'bought:1:1', targetSeatIndex: 2 },
      reasonCode: 'NO_VALID_TARGET',
      reasonText: 'Target is already slowed',
    },
  ]);
});

test('hostile items never target the user and reach a target at any board distance (§4.6)', () => {
  for (const itemId of ['repel', 'pickpocket']) {
    const state = strategy(itemId);
    state.players[1]!.routeProgress = 12;
    expect(
      legalActions(state, 0)
        .enabled.filter((choice) => choice.kind === 'use_item')
        .map((choice) => choice.payload),
    ).toEqual([{ itemInstanceId: 'bought:0:1', targetSeatIndex: 1 }]);
    for (const payload of [
      { itemInstanceId: 'bought:0:1', targetSeatIndex: 0 },
      { itemInstanceId: 'bought:0:1' },
    ]) {
      expect(command(state, 'use_item', payload)).toEqual({
        rejected: true,
        reason: 'illegal_action',
        state,
      });
    }
    expect(
      'accepted' in
        command(state, 'use_item', { itemInstanceId: 'bought:0:1', targetSeatIndex: 1 }),
    ).toBe(true);
  }
});

test("Lucky Egg adds exactly 1 to that turn's catch roll, not to movement or the next turn (§4.3, Appendix A)", () => {
  const onWild = (seat: number) => (state: GameState) =>
    state.activeSeatIndex === seat && state.phase.kind === 'encounter';
  for (let seed = 0; seed < 500; seed++) {
    const used = accepted(strategy('lucky-egg', seed), 'use_item', {
      itemInstanceId: 'bought:0:1',
    });
    expect(used.events).toEqual([
      { kind: 'uid_destroyed', instanceId: 'bought:0:1', entity: 'item', reason: 'used' },
    ]);
    const rolled = untilMoveResult(used.state, 0);
    const die = pendingMoveDie(rolled);
    const moved = advanceAutomatically(rolled).state;
    expect(moved.players[0]!.routeProgress).toBe(die);
    const encounter = playUntil(moved, (state) => onWild(0)(state) || state.globalTurnNo > 1);
    if (encounter.globalTurnNo > 1) continue;
    const caught = accepted(encounter, 'catch', { ballType: 'poke' }).state;
    if (caught.phase.kind !== 'encounter') throw new Error('Catch roll not pending');
    expect(caught.phase.catchRoll?.itemBonus).toBe(1);
    // Seat 0's following Wild encounter, in a later turn, has no item bonus.
    const later = playUntil(caught, (state) => state.globalTurnNo > 1 && onWild(0)(state));
    const next = accepted(later, 'catch', { ballType: 'poke' }).state;
    if (next.phase.kind !== 'encounter') throw new Error('Catch roll not pending');
    expect(next.phase.catchRoll?.itemBonus).toBe(0);
    return;
  }
  throw new Error('No seed landed seat 0 on a Wild square');
});

test('1,000 random legal actions with items keep coins nonnegative, transfers balanced and replay exact (§8)', () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 0, max: 100_000 }),
      fc.tuple(fc.integer({ min: 0, max: 6 }), fc.integer({ min: 0, max: 6 })),
      fc.array(fc.nat(), { minLength: 1000, maxLength: 1000 }),
      (seed, coins, selections) => {
        let state = strategy('repel', seed);
        // Low balances put Pickpocket at its 0-coin and partial-take boundaries.
        state.players[0]!.coins = coins[0];
        state.players[1]!.coins = coins[1];
        state.players[0]!.items.push(
          {
            instanceId: 'bought:0:2',
            itemId: 'pickpocket',
            name: 'Pickpocket',
            visibility: 'secret',
          },
          {
            instanceId: 'bought:0:3',
            itemId: 'lucky-egg',
            name: 'Lucky Egg',
            visibility: 'secret',
          },
        );
        state.players[1]!.items.push(
          {
            instanceId: 'bought:1:4',
            itemId: 'pickpocket',
            name: 'Pickpocket',
            visibility: 'secret',
          },
          { instanceId: 'bought:1:5', itemId: 'repel', name: 'Repel', visibility: 'secret' },
        );
        const log = createGameLog(state);
        let used = 0;
        for (const selection of selections) {
          const choices = legalActions(state, state.activeSeatIndex).enabled;
          // A sole choice or pending roll advances automatically; otherwise pick at random.
          const step =
            choices.length > 1
              ? accepted(state, choices[selection % choices.length]!.kind, {
                  ...choices[selection % choices.length]!.payload,
                })
              : advanceAutomatically(state);
          const records = 'record' in step ? [step.record] : step.records;
          if (records.length !== 1) throw new Error('No legal progress');
          const next = step.state;
          const total = (game: GameState) =>
            game.players.reduce((sum, player) => sum + player.coins, 0);
          const bank = step.events
            .filter((event) => event.kind === 'coin_transfer')
            .reduce(
              (sum, event) =>
                sum +
                (event.source.kind === 'bank' ? event.amount : 0) -
                (event.destination.kind === 'bank' ? event.amount : 0),
              0,
            );
          // Player-to-player transfers (Pickpocket) conserve coins; only bank transfers change the total.
          expect(total(next)).toBe(total(state) + bank);
          for (const event of step.events) {
            if (event.kind === 'uid_destroyed' && event.entity === 'item') {
              used++;
              expect(
                next.players.flatMap((player) => player.items.map((item) => item.instanceId)),
              ).not.toContain(event.instanceId);
            }
          }
          for (const player of next.players) expect(player.coins).toBeGreaterThanOrEqual(0);
          const uids = next.players.flatMap((player) => [
            ...player.items.map((item) => item.instanceId),
            ...player.team.map((pokemon) => pokemon.instanceId),
          ]);
          expect(new Set(uids).size).toBe(uids.length);
          state = next;
          log.actions.push(...records);
        }
        expect(used).toBeGreaterThan(0);
        expect(replay(JSON.parse(JSON.stringify(log)))).toEqual(state);
      },
    ),
    { numRuns: 2, seed: 31 },
  );
});
