/// <reference types="vite/client" />
import { describe, expect, test } from 'vitest';
import {
  advanceAutomatically,
  applyAction,
  checkInvariants,
  createGame,
  createGameConfig,
  d6,
  ENGINE_VERSION,
  fixtureSchema,
  INVARIANTS,
  legalActions,
  type ApplyActionResult,
  type EngineEvent,
  type GameState,
} from './index.ts';
import { createInvariantChecker } from './invariants.ts';
import { forceMove } from './testing.ts';
import spec from '../docs/SPEC-v1.0-PokeMonopoly.md?raw';
import startFixture from './fixtures/start-of-game-2p.json';
import encounterFixture from './fixtures/encounter-with-balls.json';

const fixtures = import.meta.glob<unknown>('./fixtures/*.json', { eager: true, import: 'default' });

const start = () => fixtureSchema.parse(startFixture).state;
const encounter = () => fixtureSchema.parse(encounterFixture).state;

function command(state: GameState, kind: string, payload: object = {}, staleBy = 0) {
  const actorId = state.config.seats.find((seat) => seat.seatIndex === state.activeSeatIndex)!;
  return {
    actorId: actorId.actorId,
    actionSeq: state.stateRevision + 1,
    stateRevisionBefore: state.stateRevision + staleBy,
    kind,
    payload,
  };
}

/** An accepted engine result built by hand, as a deliberately broken (or correct) engine would. */
function acceptedResult(
  before: GameState,
  action: ReturnType<typeof command>,
  edit: (state: GameState) => void,
  events: EngineEvent[] = [],
): ApplyActionResult {
  const state = structuredClone(before);
  state.stateRevision = action.actionSeq;
  edit(state);
  return {
    accepted: true,
    state,
    events,
    record: { action: action as never, events: structuredClone(events) },
  };
}

/** A copy of an accepted result after `edit`, with its record holding the edited events. */
function edited(
  result: ApplyActionResult,
  edit: (state: GameState, events: EngineEvent[]) => EngineEvent[],
): ApplyActionResult {
  if (!('accepted' in result)) throw new Error('expected an accepted result');
  const state = structuredClone(result.state);
  const events = edit(state, structuredClone(result.events));
  return {
    ...result,
    state,
    events,
    record: { ...result.record, events: structuredClone(events) },
  };
}

/** A current-version game awaiting seat 0's move roll at `progress`, with `paid` milestones paid. */
function moveState(progress: number, paid = Math.floor(progress / 24)): GameState {
  const scenario = start();
  const state = createGame(
    createGameConfig({ seats: scenario.config.seats, seed: 4, lapTarget: 3 }),
    scenario.content,
  );
  state.phase = { kind: 'move', awaitingResult: true };
  state.globalTurnNo = 1;
  Object.assign(state.players[0]!, {
    routeProgress: progress,
    creditedLap: paid,
    highestRewardedMilestone: paid,
  });
  return state;
}

/** The engine's logged move roll for seat 0; seed 4's first d6 is 6. */
function moveRoll(state: GameState) {
  const purpose = 'move:0:1';
  return {
    actorId: 'engine',
    actionSeq: state.stateRevision + 1,
    stateRevisionBefore: state.stateRevision,
    kind: 'dice_result',
    payload: { purpose, value: d6(state.rng, purpose).value },
  };
}

/** Seat 0 rolls a 6 from square 20, crossing Start: the engine pays and enters Sell. */
function crossing() {
  const before = moveState(20);
  const action = moveRoll(before);
  const result = applyAction(before, action);
  expect(result).toMatchObject({ state: { phase: { kind: 'sell' } } });
  return { before, action, result };
}

/** Checks a hand-made result with an engine that deterministically returns it on replay. */
function checkFromEngine(before: GameState, action: unknown, result: ApplyActionResult) {
  return createInvariantChecker(() => result)(before, action, result);
}

const ids = (violations: { invariant: string }[]) => violations.map((v) => v.invariant);

const bankToPlayer0 = (amount: number, reason = 'event_reward'): EngineEvent => ({
  kind: 'coin_transfer',
  source: { kind: 'bank' },
  destination: { kind: 'player', actorId: 'player-0' },
  amount,
  reason,
});

describe('registry (spec §8)', () => {
  const marker = '**Engine invariants that must hold:**';
  const bullets = spec
    .slice(spec.indexOf(marker) + marker.length, spec.indexOf('**Simulation:**'))
    .split('\n')
    .filter((line) => line.startsWith('- '))
    .map((line) => line.slice(2));

  test('lists every spec §8 invariant sentence and quotes the spec verbatim', () => {
    expect(bullets).toHaveLength(11);
    for (const sentence of bullets.flatMap((bullet) => bullet.split(/(?<=\.) /))) {
      expect(
        INVARIANTS.some((invariant) => invariant.specLine.includes(sentence)),
        sentence,
      ).toBe(true);
    }
    for (const invariant of INVARIANTS) {
      expect(spec, invariant.id).toContain(invariant.specLine);
    }
    expect(new Set(INVARIANTS.map((invariant) => invariant.id)).size).toBe(INVARIANTS.length);
  });

  test('activates this cycle’s invariants and keeps the issue’s pending ones named', () => {
    const status = Object.fromEntries(INVARIANTS.map(({ id, status }) => [id, status]));
    expect(status).toMatchObject({
      'coins-non-negative': 'active',
      'coin-transfer-sourced': 'active',
      'start-income-from-bank': 'active',
      'start-payment-precedes-sell': 'active',
      'forced-movement-no-start-income': 'active',
      'uid-unique': 'active',
      'uid-lifecycle-logged': 'active',
      'rejected-or-stale-unchanged': 'active',
      'catch-consumes-one-ball': 'active',
      'credited-lap-monotonic': 'active',
      'credited-lap-pays-once': 'active',
      'replay-reproduces-state': 'active',
      'game-can-finish': 'active',
      'ability-once-per-instance-per-lap': 'pending',
      'ability-once-per-player-turn': 'pending',
      'evolution-keeps-cooldowns': 'pending',
      'promise-closes-on-own-turn': 'pending',
      'deals-atomic': 'pending',
      'battle-reward-coins-or-evolution': 'pending',
    });
  });

  test('is pure: deterministic output and no input mutation', () => {
    const before = start();
    const action = command(before, 'roll');
    const result = applyAction(before, action);
    const snapshot = structuredClone({ before, result });
    expect(checkInvariants(before, action, result)).toEqual(
      checkInvariants(before, action, result),
    );
    expect({ before, result }).toEqual(snapshot);
  });
});

test('reports no violations over every fixture in engine/fixtures/', () => {
  expect(Object.keys(fixtures)).toHaveLength(9);
  for (const input of Object.values(fixtures)) {
    const { name, state } = fixtureSchema.parse(input);
    const choices = legalActions(state, state.activeSeatIndex).enabled;
    const actions = [
      command(state, 'skip', {}, 7),
      { ...command(state, 'skip'), actorId: 'not-a-player' },
      // Carve-out: historical fixtures record no catch effects, so their catch spends no Ball (#23).
      ...choices
        .filter(
          (choice) => choice.kind !== 'catch' || state.config.engineVersion === ENGINE_VERSION,
        )
        .map((choice) => command(state, choice.kind, choice.payload)),
    ];
    for (const action of actions) {
      const result = applyAction(state, action);
      expect(checkInvariants(state, action, result), `${name} ${action.kind}`).toEqual([]);
    }
  }
});

test('a current-version catch spends exactly 1 Ball and its roll passes (issue #23)', () => {
  const initial = moveState(0);
  const wild = initial.content.species.find((species) => species.id === 'chansey')!;
  initial.phase = { kind: 'encounter', pokemon: { speciesId: wild.id } };
  initial.turnBudgets = { tacticalAction: 1, catchAttempt: 1, pokemonAbility: 1 };
  const choices = legalActions(initial, 0).enabled.filter((choice) => choice.kind === 'catch');
  expect(choices.length).toBeGreaterThan(0);
  for (const choice of choices) {
    const action = command(initial, choice.kind, choice.payload);
    const caught = applyAction(initial, action);
    expect(checkInvariants(initial, action, caught)).toEqual([]);
    const { ballType } = choice.payload as { ballType: 'poke' | 'great' | 'ultra' };
    expect(caught.state.players[0]!.balls[ballType]).toBe(initial.players[0]!.balls[ballType] - 1);
    const roll = advanceAutomatically(caught.state);
    const [record] = roll.records;
    expect(record).toBeDefined();
    const rolled = applyAction(caught.state, record!.action);
    expect(checkInvariants(caught.state, record!.action, rolled)).toEqual([]);
  }
});

describe('coins-non-negative', () => {
  test('zero coins pass', () => {
    const before = start();
    before.players[0]!.coins = 0;
    const action = command(before, 'roll');
    expect(checkInvariants(before, action, applyAction(before, action))).toEqual([]);
  });

  test('negative coins are reported', () => {
    const before = start();
    before.players[0]!.coins = -1;
    const action = command(before, 'roll', {}, 1);
    expect(ids(checkInvariants(before, action, applyAction(before, action)))).toEqual([
      'coins-non-negative',
    ]);
  });
});

describe('coin-transfer-sourced', () => {
  test('coin changes matched by sourced transfers pass', () => {
    const before = start();
    const action = command(before, 'roll');
    const result = acceptedResult(
      before,
      action,
      (state) => {
        state.players[0]!.coins += 5 - 2;
        state.players[1]!.coins += 2;
      },
      [
        bankToPlayer0(5),
        {
          kind: 'coin_transfer',
          source: { kind: 'player', actorId: 'player-0' },
          destination: { kind: 'player', actorId: 'player-1' },
          amount: 2,
          reason: 'deal',
        },
      ],
    );
    expect(checkFromEngine(before, action, result)).toEqual([]);
  });

  test('a transfer without a source is reported', () => {
    const before = start();
    const action = command(before, 'roll');
    const sourceless: Partial<EngineEvent> = bankToPlayer0(5);
    delete (sourceless as { source?: unknown }).source;
    const result = acceptedResult(before, action, (state) => (state.players[0]!.coins += 5), [
      sourceless as EngineEvent,
    ]);
    expect(ids(checkFromEngine(before, action, result))).toEqual(['coin-transfer-sourced']);
  });

  test('a coin change without a transfer is reported', () => {
    const before = start();
    const action = command(before, 'roll');
    const result = acceptedResult(before, action, (state) => (state.players[1]!.coins += 3));
    expect(ids(checkFromEngine(before, action, result))).toEqual(['coin-transfer-sourced']);
  });
});

describe('uid-unique', () => {
  test('distinct instance IDs pass', () => {
    const before = encounter();
    const action = command(before, 'release');
    expect(checkInvariants(before, action, applyAction(before, action))).toEqual([]);
  });

  test('a duplicate instance ID is reported', () => {
    const before = start();
    before.players[1]!.team[0]!.instanceId = before.players[0]!.team[0]!.instanceId;
    const action = command(before, 'roll', {}, 1);
    expect(ids(checkInvariants(before, action, applyAction(before, action)))).toEqual([
      'uid-unique',
    ]);
  });
});

describe('uid-lifecycle-logged', () => {
  const potion = {
    instanceId: 'item-new',
    itemId: 'potion',
    name: 'Potion',
    visibility: 'secret' as const,
  };

  test('logged creation and destruction pass', () => {
    const before = start();
    const action = command(before, 'roll');
    const removed = before.players[1]!.items[0]!.instanceId;
    const result = acceptedResult(
      before,
      action,
      (state) => {
        state.players[0]!.items.push(potion);
        state.players[1]!.items.shift();
      },
      [
        { kind: 'uid_created', instanceId: 'item-new', entity: 'item', ownerId: 'player-0' },
        { kind: 'uid_destroyed', instanceId: removed, entity: 'item', reason: 'used' },
      ],
    );
    expect(checkFromEngine(before, action, result)).toEqual([]);
  });

  test('the wild encounter’s Pokémon gets its instance ID at the catch', () => {
    const before = start();
    const action = command(before, 'roll');
    const wild = encounter().phase;
    const drawn = acceptedResult(before, action, (state) => (state.phase = wild));
    expect(checkFromEngine(before, action, drawn)).toEqual([]);

    const atEncounter = encounter();
    const catchAction = command(atEncounter, 'catch', { ballType: 'poke' });
    const caught = acceptedResult(
      atEncounter,
      catchAction,
      (state) => {
        const { phase } = state;
        if (phase.kind === 'encounter' && 'instanceId' in phase.pokemon) {
          state.players[0]!.team.push(phase.pokemon);
        }
        state.players[0]!.balls.poke -= 1;
        state.phase = { kind: 'move' };
      },
      [{ kind: 'uid_created', instanceId: 'encounter-0', entity: 'pokemon', ownerId: 'player-0' }],
    );
    expect(checkFromEngine(atEncounter, catchAction, caught)).toEqual([]);

    const release = command(atEncounter, 'release');
    const released = acceptedResult(
      atEncounter,
      release,
      (state) => (state.phase = { kind: 'move' }),
    );
    expect(checkFromEngine(atEncounter, release, released)).toEqual([]);
  });

  test('an unlogged creation and destruction are reported', () => {
    const before = start();
    const action = command(before, 'roll');
    const result = acceptedResult(before, action, (state) => {
      state.players[0]!.items.push(potion);
      state.players[1]!.items.shift();
    });
    expect(ids(checkFromEngine(before, action, result))).toEqual([
      'uid-lifecycle-logged',
      'uid-lifecycle-logged',
    ]);
  });
});

describe('rejected-or-stale-unchanged', () => {
  test('a rejected stale action leaves the state hash unchanged', () => {
    const before = start();
    const action = command(before, 'roll', {}, 1);
    const result = applyAction(before, action);
    expect('rejected' in result).toBe(true);
    expect(checkInvariants(before, action, result)).toEqual([]);
  });

  test('a rejection that changes state is reported', () => {
    const before = start();
    const action = command(before, 'roll', {}, 1);
    const state = structuredClone(before);
    state.rng.cursor += 1;
    const result: ApplyActionResult = { rejected: true, reason: 'stale_revision', state };
    expect(ids(checkFromEngine(before, action, result))).toEqual(['rejected-or-stale-unchanged']);
  });

  test('an accepted stale action is reported', () => {
    const before = start();
    const action = command(before, 'roll', {}, 1);
    const result = acceptedResult(before, action, () => {});
    expect(ids(checkFromEngine(before, action, result))).toEqual(['rejected-or-stale-unchanged']);
  });
});

describe('catch-consumes-one-ball', () => {
  test('a catch spending exactly the chosen Ball and a free release pass', () => {
    const before = encounter();
    const catchAction = command(before, 'catch', { ballType: 'great' });
    const caught = acceptedResult(
      before,
      catchAction,
      (state) => (state.players[0]!.balls.great -= 1),
    );
    expect(checkFromEngine(before, catchAction, caught)).toEqual([]);
    const release = command(before, 'release');
    expect(checkInvariants(before, release, applyAction(before, release))).toEqual([]);
  });

  test('a catch that consumed two Balls is reported', () => {
    const before = encounter();
    const action = command(before, 'catch', { ballType: 'poke' });
    const result = acceptedResult(before, action, (state) => (state.players[0]!.balls.poke -= 2));
    expect(ids(checkFromEngine(before, action, result))).toEqual(['catch-consumes-one-ball']);
  });

  test('a release that consumed a Ball is reported', () => {
    const before = encounter();
    const action = command(before, 'release');
    const result = acceptedResult(before, action, (state) => (state.players[0]!.balls.poke -= 1));
    expect(ids(checkFromEngine(before, action, result))).toEqual(['catch-consumes-one-ball']);
  });
});

describe('Start income (spec §8, §6.5)', () => {
  test('a real crossing, its Sell and its resolution pass every invariant', () => {
    let state = moveState(20);
    for (const next of [
      moveRoll,
      (at: GameState) => command(at, 'finish_sell'),
      (at: GameState) => command(at, 'skip'),
    ]) {
      const action = next(state);
      const result = applyAction(state, action);
      expect('accepted' in result).toBe(true);
      expect(checkInvariants(state, action, result)).toEqual([]);
      state = result.state;
    }
    expect(state.players[0]).toMatchObject({ creditedLap: 1, highestRewardedMilestone: 1 });
  });

  test('re-crossing a paid milestone after a forced move pays nothing and passes', () => {
    const before = forceMove(moveState(30), 0, -10);
    const action = moveRoll(before);
    const result = applyAction(before, action);
    expect(result).toMatchObject({ state: { phase: { kind: 'resolve' } } });
    expect(checkInvariants(before, action, result)).toEqual([]);
  });

  test('an owner move past a skipped milestone pays once and passes (§6.5 #22)', () => {
    const before = moveState(44, 0);
    const action = moveRoll(before);
    const result = applyAction(before, action);
    expect(result.state.players[0]).toMatchObject({ creditedLap: 1, highestRewardedMilestone: 2 });
    expect(checkInvariants(before, action, result)).toEqual([]);
  });
});

describe('start-income-from-bank', () => {
  test('Start income paid by a player is reported', () => {
    const { before, action, result } = crossing();
    const broken = edited(result, (state, events) => {
      state.players[1]!.coins -= 5;
      return events.map((event) =>
        event.kind === 'coin_transfer'
          ? { ...event, source: { kind: 'player', actorId: 'player-1' } }
          : event,
      );
    });
    expect(ids(checkFromEngine(before, action, broken))).toEqual(['start-income-from-bank']);
  });
});

describe('credited-lap-monotonic', () => {
  test('a decreasing creditedLap is reported', () => {
    const before = moveState(30);
    const action = moveRoll(before);
    const result = acceptedResult(before, action, (state) => (state.players[0]!.creditedLap = 0));
    expect(ids(checkFromEngine(before, action, result))).toEqual(['credited-lap-monotonic']);
  });

  test('a decreasing rewarded-milestone watermark is reported', () => {
    const before = moveState(30);
    before.players[0]!.creditedLap = 0;
    const action = moveRoll(before);
    const result = acceptedResult(
      before,
      action,
      (state) => (state.players[0]!.highestRewardedMilestone = 0),
    );
    expect(ids(checkFromEngine(before, action, result))).toEqual(['credited-lap-monotonic']);
  });

  test('a creditedLap beyond the rewarded milestone is reported', () => {
    const before = moveState(20);
    before.players[0]!.creditedLap = 1;
    const action = moveRoll(before);
    const result = acceptedResult(before, action, () => {});
    expect(ids(checkFromEngine(before, action, result))).toEqual(['credited-lap-monotonic']);
  });
});

describe('credited-lap-pays-once', () => {
  test('Start income for re-crossing a paid milestone is reported', () => {
    const before = forceMove(moveState(30), 0, -10);
    const action = moveRoll(before);
    const result = acceptedResult(
      before,
      action,
      (state) => {
        state.players[0]!.routeProgress = 26;
        state.players[0]!.coins += 5;
        state.phase = { kind: 'sell', destinationPosition: 2 };
      },
      [bankToPlayer0(5, 'start_income'), { kind: 'phase_changed', from: 'move', to: 'sell' }],
    );
    expect(ids(checkFromEngine(before, action, result))).toEqual([
      'credited-lap-pays-once',
      'credited-lap-pays-once',
    ]);
  });
});

describe('start-payment-precedes-sell', () => {
  test('a Sell Phase entered before the payment is reported', () => {
    const { before, action, result } = crossing();
    const broken = edited(result, (_, events) => [
      ...events.filter((event) => event.kind !== 'coin_transfer'),
      ...events.filter((event) => event.kind === 'coin_transfer'),
    ]);
    expect(ids(checkFromEngine(before, action, broken))).toEqual(['start-payment-precedes-sell']);
  });

  test('a destination resolved before Sell is reported', () => {
    const { before, action, result } = crossing();
    const broken = edited(result, (state, events) => {
      state.phase = { kind: 'end' };
      return [
        ...events.filter((event) => event.kind !== 'phase_changed'),
        { kind: 'space_resolved', seatIndex: 0, position: 2 },
        { kind: 'phase_changed', from: 'move', to: 'end' },
      ];
    });
    expect(ids(checkFromEngine(before, action, broken))).toEqual([
      'start-payment-precedes-sell',
      'start-payment-precedes-sell',
    ]);
  });
});

describe('forced-movement-no-start-income', () => {
  test('Start income for a push outside the owner’s move roll is reported', () => {
    const before = moveState(20);
    before.phase = { kind: 'strategy' };
    const action = command(before, 'skip');
    const result = acceptedResult(
      before,
      action,
      (state) => {
        Object.assign(state.players[0]!, {
          routeProgress: 26,
          creditedLap: 1,
          highestRewardedMilestone: 1,
          coins: state.players[0]!.coins + 5,
        });
        state.phase = { kind: 'sell', destinationPosition: 2 };
      },
      [bankToPlayer0(5, 'start_income'), { kind: 'phase_changed', from: 'strategy', to: 'sell' }],
    );
    expect(ids(checkFromEngine(before, action, result))).toEqual([
      'forced-movement-no-start-income',
    ]);
  });
});

describe('replay-reproduces-state', () => {
  test('re-applying the logged action reproduces the engine result', () => {
    const before = start();
    const action = command(before, 'roll');
    expect(checkInvariants(before, action, applyAction(before, action))).toEqual([]);
  });

  test('a result the logged action does not reproduce is reported', () => {
    const before = start();
    const action = command(before, 'roll');
    const result = applyAction(before, action);
    result.state.rng.cursor += 1;
    expect(ids(checkInvariants(before, action, result))).toEqual(['replay-reproduces-state']);
  });

  test('a record that omits emitted events is reported', () => {
    const before = start();
    const action = command(before, 'roll');
    const result = acceptedResult(before, action, () => {});
    if ('accepted' in result)
      result.events.push({ kind: 'phase_changed', from: 'move', to: 'move' });
    expect(ids(checkFromEngine(before, action, result))).toEqual(['replay-reproduces-state']);
  });
});

describe('game-can-finish', () => {
  test('a state with an enabled choice or a finished game passes', () => {
    const before = start();
    const action = command(before, 'roll');
    expect(checkInvariants(before, action, applyAction(before, action))).toEqual([]);
    const finished = acceptedResult(
      before,
      action,
      (state) => (state.phase = { kind: 'finished' }),
    );
    expect(checkFromEngine(before, action, finished)).toEqual([]);
  });

  test('a roll awaiting the engine’s dice result passes', () => {
    const before = createGame(
      createGameConfig({
        seats: ['main-character', 'rival'].map((classId, seatIndex) => ({
          actorId: `player-${seatIndex}`,
          seatIndex,
          classId,
          controller: seatIndex === 0 ? 'human' : 'ai',
        })),
        seed: 1,
        lapTarget: 3,
      }),
      start().content,
    );
    const action = command(before, 'roll');
    const result = applyAction(before, action);
    expect(result).toMatchObject({ state: { phase: { awaitingResult: true } } });
    expect(checkInvariants(before, action, result)).toEqual([]);
  });

  test('a dead end with no enabled choice is reported', () => {
    const before = start();
    const action = command(before, 'roll');
    const result = acceptedResult(before, action, (state) => (state.phase = { kind: 'resolve' }));
    expect(ids(checkFromEngine(before, action, result))).toEqual(['game-can-finish']);
  });
});
