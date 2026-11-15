/// <reference types="vite/client" />
import { expect, test } from 'vitest';
import { parseContent, toEngineContent } from '../content/schema.ts';
import {
  advanceAutomatically,
  applyAction,
  checkInvariants,
  createGame,
  createGameConfig,
  createRng,
  eventsVisibleTo,
  legalActions,
  pendingDecision,
  positionOf,
  type Action,
  type ApplyActionResult,
  type GameState,
} from './index.ts';

const files = Object.fromEntries(
  Object.entries(
    import.meta.glob<unknown>('../content/*.json', { eager: true, import: 'default' }),
  ).map(([path, json]) => [path.split('/').at(-1)!.slice(0, -5), json]),
);
const content = toEngineContent(parseContent(files));

/**
 * Seat 0 Main Character (Bulbasaur, Vine Pull), seat 1 Fisherman holding a Pidgey (Quick Flight),
 * seat 2 Bug Catcher (Caterpie, String Shot; Sticky Web class item). Seat `active` is in Strategy.
 */
function game(active = 1): GameState {
  const state = createGame(
    createGameConfig({
      seats: ['main-character', 'fisherman', 'bug-catcher'].map((classId, seatIndex) => ({
        actorId: `p${seatIndex}`,
        seatIndex,
        classId,
        ...(seatIndex === 0 ? { starterSpeciesId: 'bulbasaur' } : {}),
        controller: 'ai' as const,
      })),
      seed: 4,
      lapTarget: 3,
    }),
    content,
  );
  state.phase = { kind: 'strategy' };
  state.activeSeatIndex = active;
  state.globalTurnNo = 9;
  state.turnBudgets = { tacticalAction: 1, catchAttempt: 1, pokemonAbility: 1 };
  for (const player of state.players) player.ownTurnNo = 3;
  const pidgeyOwner = state.players[1]!;
  pidgeyOwner.team = [{ ...pidgeyOwner.team[0]!, speciesId: 'pidgey' }];
  pidgeyOwner.routeProgress = 46; // square 22
  pidgeyOwner.highestRewardedMilestone = 1;
  pidgeyOwner.creditedLap = 1;
  return state;
}

function run(state: GameState, kind: Action['kind'], payload: unknown = {}) {
  const action = {
    actorId: pendingDecision(state)!.actorId,
    kind,
    payload,
    actionSeq: state.stateRevision + 1,
    stateRevisionBefore: state.stateRevision,
  } as Action;
  const result = applyAction(state, action);
  if ('rejected' in result) throw new Error(`Unexpected rejection: ${result.reason}`);
  expect(checkInvariants(state, action, result)).toEqual([]);
  return result;
}

/** Quick Flight in Strategy, skip to Move, then the fixed move. */
function quickFlight(state: GameState) {
  const flown = run(state, 'activate_ability', { instanceId: 'starter:1' }).state;
  const moving = run(flown, 'skip').state;
  expect(moving.phase.kind).toBe('move');
  return run(moving, 'roll');
}

const kinds = (events: { kind: string }[]) => events.map((event) => event.kind);

test('AC-4: Quick Flight under a pending Repel draws no die, moves max(1, 3 − 2) = 1 and clears the slow (C.5 D8)', () => {
  const state = game();
  state.players[1]!.pendingSlows = ['repel'];
  const moved = quickFlight(state);
  expect(kinds(moved.events)).not.toContain('random_result');
  expect(moved.state.players[1]).toMatchObject({ routeProgress: 47 });
  expect(moved.state.players[1]!.pendingSlows).toBeUndefined();
  expect(moved.state.phase.kind).toBe('resolve');
});

test('AC-4 variant: with Sticky Web the fixed move reaches Start: one payment, Lap credit, Ability reset, then Sell before the destination (§4.7, D8)', () => {
  const state = game();
  state.players[1]!.pendingSlows = ['sticky_web'];
  const moved = quickFlight(state);
  expect(moved.state.players[1]).toMatchObject({ routeProgress: 48, creditedLap: 2, coins: 25 });
  expect(kinds(moved.events)).toEqual(['coin_transfer', 'abilities_reset', 'phase_changed']);
  expect(moved.state.players[1]!.team[0]!.abilityReady).toBe(true);
  expect(moved.state.players[1]!.abilityUsedGlobalTurnNo).toBe(9);
  expect(moved.state.phase).toEqual({ kind: 'sell', destinationPosition: 0 });
});

test('AC-4 variant: with both slow kinds pending the fixed move is max(1, min(3 − 2, 2)) = 1 (D8)', () => {
  const state = game();
  state.players[1]!.pendingSlows = ['repel', 'sticky_web'];
  expect(quickFlight(state).state.players[1]!.routeProgress).toBe(47);
});

test('AC-4 variant: Vine Pull pushes 2 back with no income or Resolve, leaving the pushed player’s Repel pending; only user and target see the hostile use (D9, D6)', () => {
  const state = game(0);
  state.players[1]!.routeProgress = 49;
  state.players[1]!.pendingSlows = ['repel'];
  const pushed = run(state, 'activate_ability', { instanceId: 'starter:0', targetSeatIndex: 1 });
  expect(pushed.state.players[1]).toMatchObject({ routeProgress: 47, coins: 20, creditedLap: 1 });
  expect(pushed.state.players[1]!.pendingSlows).toEqual(['repel']);
  expect(pushed.state.phase.kind).toBe('strategy');
  expect(kinds(pushed.events)).toEqual(['ability_activated', 'attack_attempt', 'player_displaced']);
  expect(kinds(eventsVisibleTo(state, pushed.events, 2))).toEqual(['player_displaced']);
  expect(kinds(eventsVisibleTo(state, pushed.events, 1))).toEqual(kinds(pushed.events));
});

test('displacement may go below zero and an old milestone recrossed later pays nothing (§6.5, D9)', () => {
  const state = game(0);
  state.players[1]!.routeProgress = 1;
  state.players[1]!.highestRewardedMilestone = 0;
  state.players[1]!.creditedLap = 0;
  const pushed = run(state, 'activate_ability', { instanceId: 'starter:0', targetSeatIndex: 1 });
  expect(pushed.state.players[1]!.routeProgress).toBe(-1);
  expect(positionOf(-1)).toBe(23);
  const later = structuredClone(pushed.state);
  later.activeSeatIndex = 1;
  later.globalTurnNo = 10;
  later.turnBudgets = { tacticalAction: 1, catchAttempt: 1, pokemonAbility: 1 };
  const moved = quickFlight(later);
  expect(moved.state.players[1]).toMatchObject({ routeProgress: 2, coins: 20, creditedLap: 0 });
});

test('String Shot is a minus slow: it cannot stack on Repel, composes with Sticky Web and clears on the actual move (§4.6, D8)', () => {
  const state = game(2);
  state.players[1]!.pendingSlows = ['repel'];
  const choices = legalActions(state, 2).enabled.map((choice) => choice.id);
  expect(choices).toContain('ability:starter:2:0');
  expect(choices).not.toContain('ability:starter:2:1');
  state.players[1]!.pendingSlows = ['sticky_web'];
  const shot = run(state, 'activate_ability', { instanceId: 'starter:2', targetSeatIndex: 1 });
  expect(shot.state.players[1]!.pendingSlows).toEqual(['sticky_web', 'string_shot']);
  // A d6 of 6 later moves max(1, min(6 − 1, 2)) = 2.
  const mover = structuredClone(shot.state);
  mover.activeSeatIndex = 1;
  mover.phase = { kind: 'move', awaitingResult: true };
  mover.players[1]!.team[0]!.abilityReady = false;
  for (let seed = 0; ; seed++) {
    mover.rng = createRng(seed);
    const step = advanceAutomatically(mover);
    const roll = step.events.find((event) => event.kind === 'random_result');
    if (roll?.kind === 'random_result' && roll.result === 6) {
      expect(step.state.players[1]!.routeProgress).toBe(48);
      expect(step.state.players[1]!.pendingSlows).toBeUndefined();
      break;
    }
  }
});

test('Sticky Web is Bug Catcher’s hostile class item: same-kind targets are greyed out and a Price Shield blocks it (§4.6, D6)', () => {
  const state = game(2);
  const web = state.players[2]!.items[0]!;
  expect(web.itemId).toBe('sticky-web');
  state.players[0]!.pendingSlows = ['sticky_web'];
  expect(
    legalActions(state, 2).disabled.find(
      (choice) => choice.id === `use-item:${web.instanceId}:seat-0`,
    ),
  ).toMatchObject({ reasonText: 'Target is already slowed' });
  const used = run(state, 'use_item', { itemInstanceId: web.instanceId, targetSeatIndex: 1 });
  expect(used.state.players[1]!.pendingSlows).toEqual(['sticky_web']);

  const shielded = game(2);
  shielded.players[1]!.armedShield = { scope: 'price', visibility: 'public' };
  const blocked = run(shielded, 'use_item', {
    itemInstanceId: shielded.players[2]!.items[0]!.instanceId,
    targetSeatIndex: 1,
  });
  expect(blocked.state.players[1]!.pendingSlows).toBeUndefined();
});

test('the move-debuff checker catches a slow cleared at Start instead of on the actual move (§8)', () => {
  const state = game();
  state.phase = { kind: 'end' };
  state.players[2]!.pendingSlows = ['repel'];
  const action = {
    actorId: 'p1',
    kind: 'skip',
    payload: {},
    actionSeq: 1,
    stateRevisionBefore: 0,
  } as Action;
  const result = applyAction(state, action) as Extract<ApplyActionResult, { accepted: true }>;
  expect(result.state.players[2]!.pendingSlows).toEqual(['repel']);
  expect(checkInvariants(state, action, result)).toEqual([]);
  const broken = structuredClone(result);
  delete broken.state.players[2]!.pendingSlows;
  expect(checkInvariants(state, action, broken).map((violation) => violation.invariant)).toContain(
    'move-debuff-until-next-move',
  );
});
