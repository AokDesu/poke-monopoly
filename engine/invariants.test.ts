/// <reference types="vite/client" />
import { describe, expect, test } from 'vitest';
import {
  applyAction,
  checkInvariants,
  createInvariantChecker,
  fixtureSchema,
  INVARIANTS,
  legalActions,
  type ApplyActionResult,
  type EngineEvent,
  type GameState,
} from './index.ts';
import spec from '../docs/SPEC-v1.0-PokeMonopoly.md?raw';
import source from './invariants.ts?raw';
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

/** Checks a hand-made result with an engine that deterministically returns it on replay. */
function checkFromEngine(before: GameState, action: unknown, result: ApplyActionResult) {
  return createInvariantChecker(() => result)(before, action, result);
}

const ids = (violations: { invariant: string }[]) => violations.map((v) => v.invariant);

const bankToPlayer0 = (amount: number, reason = 'start_income'): EngineEvent => ({
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
    expect(bullets).toHaveLength(10);
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
      'uid-unique': 'active',
      'uid-lifecycle-logged': 'active',
      'rejected-or-stale-unchanged': 'active',
      'catch-consumes-one-ball': 'active',
      'credited-lap-monotonic': 'active',
      'credited-lap-pays-once': 'pending',
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

  test('is pure: engine-only imports, deterministic output and no input mutation', () => {
    const imports = [...source.matchAll(/from '([^']+)'/g)].map((match) => match[1]);
    expect(imports.every((path) => path?.startsWith('./'))).toBe(true);
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
      // Carve-out until issue #23: the engine accepts catch without spending a Ball yet.
      ...choices
        .filter((choice) => choice.kind !== 'catch')
        .map((choice) => command(state, choice.kind, choice.payload)),
    ];
    for (const action of actions) {
      const result = applyAction(state, action);
      expect(checkInvariants(state, action, result), `${name} ${action.kind}`).toEqual([]);
    }
  }
});

test('carve-out until #23: catches do not spend a Ball yet', () => {
  // Fails once issue #23 makes catches spend a Ball; then drop the catch filter above and this test.
  const before = encounter();
  const action = command(before, 'catch', { ballType: 'poke' });
  expect(ids(checkInvariants(before, action, applyAction(before, action)))).toEqual([
    'catch-consumes-one-ball',
  ]);
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
        if (state.phase.kind === 'encounter') state.players[0]!.team.push(state.phase.pokemon);
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

describe('credited-lap-monotonic', () => {
  function crossStart(creditedLap: number) {
    const before = start();
    before.players[0]!.routeProgress = 20;
    const action = command(before, 'roll');
    const result = acceptedResult(
      before,
      action,
      (state) => {
        state.players[0]!.routeProgress = 26;
        state.players[0]!.creditedLap = creditedLap;
        state.players[0]!.coins += 5;
      },
      [bankToPlayer0(5)],
    );
    return checkFromEngine(before, action, result);
  }

  test('one credit for crossing one new milestone passes', () => {
    expect(crossStart(1)).toEqual([]);
  });

  test('a creditedLap beyond the milestone reached is reported', () => {
    expect(ids(crossStart(2))).toEqual(['credited-lap-monotonic']);
  });

  test('a decreasing creditedLap is reported', () => {
    const before = start();
    before.players[0]!.routeProgress = 30;
    before.players[0]!.creditedLap = 1;
    const action = command(before, 'roll');
    const result = acceptedResult(before, action, (state) => {
      state.players[0]!.routeProgress = 22;
      state.players[0]!.creditedLap = 0;
    });
    expect(ids(checkFromEngine(before, action, result))).toEqual(['credited-lap-monotonic']);
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

  test('a dead end with no enabled choice is reported', () => {
    const before = start();
    const action = command(before, 'roll');
    const result = acceptedResult(before, action, (state) => (state.phase = { kind: 'resolve' }));
    expect(ids(checkFromEngine(before, action, result))).toEqual(['game-can-finish']);
  });
});
