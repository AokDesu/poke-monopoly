/// <reference types="vite/client" />
import { expect, test } from 'vitest';
import { parseContent, toEngineContent } from '../content/schema.ts';
import { forceChallenge } from './pvp.ts';
import {
  advanceAutomatically,
  applyAction,
  checkInvariants,
  createGame,
  createGameConfig,
  createRng,
  d6,
  eventsVisibleTo,
  legalActions,
  pendingDecision,
  stateHash,
  type Action,
  type GameState,
} from './index.ts';

const files = Object.fromEntries(
  Object.entries(
    import.meta.glob<unknown>('../content/*.json', { eager: true, import: 'default' }),
  ).map(([path, json]) => [path.split('/').at(-1)!.slice(0, -5), json]),
);
const content = toEngineContent(parseContent(files));

/** P0 Rival acts against P1 Researcher; P2 Fisherman only watches. */
function game(seed = 1): GameState {
  const state = createGame(
    createGameConfig({
      seats: ['rival', 'researcher', 'fisherman'].map((classId, seatIndex) => ({
        actorId: `p${seatIndex}`,
        seatIndex,
        classId,
        controller: 'ai' as const,
      })),
      seed,
      lapTarget: 2,
    }),
    content,
  );
  state.phase = { kind: 'strategy' };
  state.globalTurnNo = 5;
  state.turnBudgets = { tacticalAction: 1, catchAttempt: 1, pokemonAbility: 1 };
  for (const player of state.players) {
    player.ownTurnNo = 2;
    player.items = [];
  }
  return state;
}

function giveTicket(state: GameState, seat = 0): string {
  const instanceId = `ticket:${seat}:${state.players[seat]!.items.length}`;
  state.players[seat]!.items.push({
    instanceId,
    itemId: 'battle-ticket',
    name: 'Battle Ticket',
    visibility: 'secret',
  });
  return instanceId;
}

function command(state: GameState, kind: Action['kind'], payload: unknown = {}): Action {
  return {
    actorId: pendingDecision(state)!.actorId,
    kind,
    payload,
    actionSeq: state.stateRevision + 1,
    stateRevisionBefore: state.stateRevision,
  } as Action;
}

function accept(state: GameState, kind: Action['kind'], payload: unknown = {}) {
  const action = command(state, kind, payload);
  const result = applyAction(state, action);
  if ('rejected' in result) throw new Error(`Unexpected rejection: ${result.reason}`);
  expect(checkInvariants(state, action, result)).toEqual([]);
  return result;
}

function rejectedUnchanged(state: GameState, kind: Action['kind'], payload: unknown) {
  const hash = stateHash(state);
  const result = applyAction(state, command(state, kind, payload));
  expect(result).toMatchObject({ rejected: true, reason: 'illegal_action' });
  expect(stateHash(state)).toBe(hash);
}

const enabledIds = (state: GameState) =>
  legalActions(state, pendingDecision(state)!.seatIndex).enabled.map((choice) => choice.id);

test('Rival forces PvP once per credited Lap: no decline, tactical action spent, only a new credited Lap resets it (§4.4, Appendix A)', () => {
  const state = game();
  expect(enabledIds(state)).toContain('declare-pvp:1:rival');
  const forced = accept(state, 'declare_pvp', { targetSeatIndex: 1, force: 'rival' });
  const after = forced.state;
  expect(after.phase).toMatchObject({
    kind: 'pvp',
    battle: { forced: true, step: 'attacker_roll' },
  });
  expect(pendingDecision(after)).toBeNull(); // the engine rolls; nobody can decline
  expect(after.turnBudgets.tacticalAction).toBe(0);
  expect(after.players[0]!.forcePvpUsedLap).toBe(0);
  expect(forced.events.map((event) => event.kind)).toEqual([
    'attack_attempt',
    'phase_changed',
    'pvp_confirmed',
  ]);

  const sameLap = game();
  sameLap.players[0]!.forcePvpUsedLap = 0;
  sameLap.players[0]!.routeProgress = -2; // forced displacement back across Start credits nothing
  expect(enabledIds(sameLap)).toContain('declare-pvp:1');
  expect(enabledIds(sameLap)).not.toContain('declare-pvp:1:rival');
  sameLap.players[0]!.creditedLap = 1;
  expect(enabledIds(sameLap)).toContain('declare-pvp:1:rival');
});

test('a Battle Ticket forces a battle, consumes exactly one item and counts one private hostile attempt (§4.4, §4.6)', () => {
  const state = game();
  const ticket = giveTicket(state);
  giveTicket(state);
  const result = accept(state, 'use_item', { itemInstanceId: ticket, targetSeatIndex: 1 });
  const after = result.state;
  expect(after.players[0]!.items).toHaveLength(1);
  expect(after.turnBudgets.tacticalAction).toBe(0);
  expect(after.phase).toMatchObject({
    kind: 'pvp',
    battle: { forced: true, step: 'attacker_roll' },
  });
  expect(after.attackHistory).toEqual([
    expect.objectContaining({ actorId: 'p0', targetId: 'p1', source: 'hostile_item' }),
  ]);
  // The watcher sees the public battle, not which secret item started it.
  const watcher = eventsVisibleTo(state, result.events, 2).map((event) => event.kind);
  expect(watcher).toEqual(['phase_changed', 'pvp_confirmed']);
  expect(JSON.stringify(after.phase)).not.toContain('ticket');

  // The battle completes through the normal S06 flow back to the challenger's Strategy.
  let battle = advanceAutomatically(advanceAutomatically(after).state).state;
  if (battle.phase.kind === 'pvp') {
    battle = accept(battle, 'choose_reward', { kind: 'coins' }).state;
  }
  expect(battle.phase.kind).toBe('strategy');
  expect(battle.activeSeatIndex).toBe(0);
});

test('a shielded Battle Ticket is blocked whole: shield consumed, ticket and action spent, attack counted once, no battle (AC-2)', () => {
  const state = game();
  const ticket = giveTicket(state);
  state.players[1]!.armedShield = { scope: 'price', visibility: 'public' };
  const result = accept(state, 'use_item', { itemInstanceId: ticket, targetSeatIndex: 1 });
  const after = result.state;
  expect(after.phase.kind).toBe('strategy');
  expect(after.players[1]!.armedShield).toBeUndefined();
  expect(after.players[0]!.items).toEqual([]);
  expect(after.turnBudgets.tacticalAction).toBe(0);
  expect(after.attackHistory).toHaveLength(1);
  expect(after.players.map((player) => player.abilityUsedGlobalTurnNo)).toEqual([null, null, null]);
  expect(result.events.map((event) => event.kind)).not.toContain('pvp_confirmed');
});

test('a Rival force is not a hostile item: an armed shield protects only the coin loss (AC-2 contrast, D6)', () => {
  let seed = 0;
  for (; seed < 100; seed++) {
    const attacker = d6(createRng(seed), 'a');
    // Rival attacks with +1 against an equal Eevee/Porygon pair (battle 2 each).
    if (attacker.value + 1 > d6(attacker.rng, 'b').value) break;
  }
  let state = game(seed);
  state.players[1]!.armedShield = { scope: 'price', visibility: 'secret' };
  state = accept(state, 'declare_pvp', { targetSeatIndex: 1, force: 'rival' }).state;
  expect(state.players[1]!.armedShield).toBeDefined();
  state = advanceAutomatically(advanceAutomatically(state).state).state;
  const reward = accept(state, 'choose_reward', { kind: 'coins' }).state;
  expect(reward.players.map((player) => player.coins)).toEqual([20, 20, 20]);
  expect(reward.players[1]!.armedShield).toBeUndefined();
});

test('no source bypasses readiness: Rival force and Battle Ticket reject unchanged without battle-ready teams (§4.4)', () => {
  const tiredTarget = game();
  const ticket = giveTicket(tiredTarget);
  tiredTarget.players[1]!.team[0]!.tired = true;
  rejectedUnchanged(tiredTarget, 'declare_pvp', { targetSeatIndex: 1, force: 'rival' });
  rejectedUnchanged(tiredTarget, 'use_item', { itemInstanceId: ticket, targetSeatIndex: 1 });
  expect(
    legalActions(tiredTarget, 0).disabled.find((choice) => choice.id.startsWith('use-item:ticket')),
  ).toMatchObject({ reasonText: 'Both teams need a battle-ready Pokémon' });

  const tiredAttacker = game();
  const own = giveTicket(tiredAttacker);
  tiredAttacker.players[0]!.team[0]!.tired = true;
  rejectedUnchanged(tiredAttacker, 'declare_pvp', { targetSeatIndex: 1, force: 'rival' });
  rejectedUnchanged(tiredAttacker, 'use_item', { itemInstanceId: own, targetSeatIndex: 1 });
});

test('the forcePvP Ability adapter spends the tactical action, records a hostile Ability attempt and respects shields (C.1 forceChallenge)', () => {
  const open = structuredClone(game());
  open.stateRevision = 9;
  const events = forceChallenge(open, open.players[0]!, open.players[1]!);
  expect(open.turnBudgets.tacticalAction).toBe(0);
  expect(open.phase).toMatchObject({ kind: 'pvp', battle: { forced: true } });
  expect(events[0]).toMatchObject({ kind: 'attack_attempt', source: 'hostile_ability' });

  const shielded = structuredClone(game());
  shielded.players[1]!.armedShield = { scope: 'price', visibility: 'public' };
  forceChallenge(shielded, shielded.players[0]!, shielded.players[1]!);
  expect(shielded.turnBudgets.tacticalAction).toBe(0);
  expect(shielded.phase.kind).toBe('strategy');
  expect(shielded.players[1]!.armedShield).toBeUndefined();
});
