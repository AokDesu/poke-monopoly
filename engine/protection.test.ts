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
  d6,
  eventsVisibleTo,
  legalActions,
  observe,
  pendingDecision,
  type Action,
  type EngineEvent,
  type GameState,
} from './index.ts';

const files = Object.fromEntries(
  Object.entries(
    import.meta.glob<unknown>('../content/*.json', { eager: true, import: 'default' }),
  ).map(([path, json]) => [path.split('/').at(-1)!.slice(0, -5), json]),
);
const content = toEngineContent(parseContent(files));

/** P0 Fisherman acts; P1 is the target (Nurse Joy or Researcher); P2 Bug Catcher only watches. */
function game(targetClass = 'researcher', seed = 1): GameState {
  const state = createGame(
    createGameConfig({
      seats: ['fisherman', targetClass, 'bug-catcher'].map((classId, seatIndex) => ({
        actorId: `p${seatIndex}`,
        seatIndex,
        classId,
        controller: 'ai' as const,
      })),
      seed,
      lapTarget: 1,
    }),
    content,
  );
  state.phase = { kind: 'strategy' };
  state.globalTurnNo = 4;
  state.turnBudgets = { tacticalAction: 1, catchAttempt: 1, pokemonAbility: 1 };
  for (const player of state.players) {
    player.ownTurnNo = 2;
    player.team[0]!.speciesId = 'eevee';
    player.items = [];
  }
  return state;
}

function give(state: GameState, seat: number, itemId: string, visibility = 'secret' as const) {
  const name = content.items.find((item) => item.id === itemId)!.name;
  const instanceId = `${itemId}:${seat}:${state.players[seat]!.items.length}`;
  state.players[seat]!.items.push({ instanceId, itemId, name, visibility });
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

/** Arm a shield on `seat` as if it had used the item on its own earlier turn. */
function armed(state: GameState, seat: number, visibility: 'public' | 'secret' = 'secret') {
  state.players[seat]!.armedShield = { scope: 'price', visibility };
  return state;
}

function seedWhereAttackerWins(): number {
  for (let seed = 0; seed < 100; seed++) {
    const attacker = d6(createRng(seed), 'a');
    if (attacker.value > d6(attacker.rng, 'b').value) return seed;
  }
  throw new Error('No winning seed');
}

/** Declared, accepted and rolled until the winner P0 owns the reward choice. */
function wonByAttacker(targetClass: string): GameState {
  let state = game(targetClass, seedWhereAttackerWins());
  state = accept(state, 'declare_pvp', { targetSeatIndex: 1 }).state;
  state = accept(state, 'respond_pvp', { accept: true }).state;
  state = advanceAutomatically(advanceAutomatically(state).state).state;
  expect(pendingDecision(state)?.seatIndex).toBe(0);
  return state;
}

const kinds = (events: EngineEvent[]) => events.map((event) => event.kind);

test('using Price Shield arms one shield, spends the tactical action and destroys the item; a second cannot stack (Appendix C.4 D6/D7)', () => {
  const state = game();
  const first = give(state, 0, 'price-shield', 'public');
  const second = give(state, 0, 'price-shield');
  const result = accept(state, 'use_item', { itemInstanceId: first });
  const after = result.state;
  expect(after.players[0]!.armedShield).toEqual({ scope: 'price', visibility: 'public' });
  expect(after.turnBudgets.tacticalAction).toBe(0);
  expect(after.players[0]!.items.map((item) => item.instanceId)).toEqual([second]);
  expect(kinds(result.events)).toEqual(['shield_armed', 'uid_destroyed']);

  after.turnBudgets.tacticalAction = 1;
  const disabled = legalActions(after, 0).disabled.find(
    (choice) => choice.kind === 'use_item' && choice.payload.itemInstanceId === second,
  );
  expect(disabled).toMatchObject({ reasonText: 'A shield is already armed' });
  expect(
    'rejected' in applyAction(after, command(after, 'use_item', { itemInstanceId: second })),
  ).toBe(true);
});

test('Pickpocket into an armed shield transfers zero, consumes the shield once and still counts as an attack; the next Pickpocket works (§4.6, D6, D10)', () => {
  const state = armed(game(), 1);
  const pickpocket = give(state, 0, 'pickpocket');
  const result = accept(state, 'use_item', { itemInstanceId: pickpocket, targetSeatIndex: 1 });
  const after = result.state;
  expect(after.players.map((player) => player.coins)).toEqual([20, 20, 20]);
  expect(after.players[1]!.armedShield).toBeUndefined();
  expect(after.players[0]!.items).toEqual([]);
  expect(after.turnBudgets.tacticalAction).toBe(0);
  expect(after.attackHistory).toEqual([
    expect.objectContaining({ actorId: 'p0', targetId: 'p1', source: 'hostile_item' }),
  ]);
  expect(result.events).toContainEqual(
    expect.objectContaining({
      kind: 'protection_applied',
      source: 'hostile_item',
      protection: 'price',
    }),
  );
  expect(kinds(result.events)).not.toContain('coin_transfer');

  // One-shot: the consumed shield no longer protects.
  after.turnBudgets.tacticalAction = 1;
  const again = give(after, 0, 'pickpocket');
  const second = accept(after, 'use_item', { itemInstanceId: again, targetSeatIndex: 1 }).state;
  expect(second.players.map((player) => player.coins)).toEqual([25, 15, 20]);
});

test('a shielded Repel records no slow (D6 whole-action block)', () => {
  const state = armed(game(), 1);
  const repel = give(state, 0, 'repel');
  const after = accept(state, 'use_item', { itemInstanceId: repel, targetSeatIndex: 1 }).state;
  expect(after.players[1]!.pendingSlows).toBeUndefined();
  expect(after.players[1]!.armedShield).toBeUndefined();
});

test('a PvP coin reward against an armed shield pays the winner nothing and consumes the shield; evolution leaves it armed (§4.4, AC-2)', () => {
  const coins = accept(armed(wonByAttacker('researcher'), 1), 'choose_reward', { kind: 'coins' });
  expect(coins.state.players.map((player) => player.coins)).toEqual([20, 20, 20]);
  expect(coins.state.players[1]!.armedShield).toBeUndefined();
  expect(coins.events).toContainEqual(
    expect.objectContaining({
      kind: 'protection_applied',
      source: 'pvp_coin_loss',
      protection: 'price',
    }),
  );
  expect(coins.events).toContainEqual(
    expect.objectContaining({
      kind: 'battle_reward_resolved',
      coinAmount: 0,
      source: { kind: 'pvp', loserId: 'p1', coinLossBlocked: true },
    }),
  );

  const evolve = accept(armed(wonByAttacker('researcher'), 1), 'choose_reward', {
    kind: 'evolve',
    instanceId: 'starter:0',
    nextFormId: 'vaporeon',
  });
  expect(evolve.state.players[1]!.armedShield).toEqual({ scope: 'price', visibility: 'secret' });
});

test('Nurse Joy loses no coins on a PvP loss and her armed shield is not consumed (§4.4, D7)', () => {
  const result = accept(armed(wonByAttacker('nurse-joy'), 1), 'choose_reward', { kind: 'coins' });
  expect(result.state.players.map((player) => player.coins)).toEqual([20, 20, 20]);
  expect(result.state.players[1]!.armedShield).toEqual({ scope: 'price', visibility: 'secret' });
  expect(result.events).toContainEqual(
    expect.objectContaining({ kind: 'protection_applied', protection: 'nurse_joy' }),
  );
});

test('a declined challenge and a loser with no coins are not coin losses: the shield stays armed (D6)', () => {
  let state = armed(game(), 1);
  state = accept(state, 'declare_pvp', { targetSeatIndex: 1 }).state;
  state = accept(state, 'respond_pvp', { accept: false }).state;
  expect(state.players[1]!.armedShield).toBeDefined();

  const broke = armed(wonByAttacker('researcher'), 1);
  broke.players[1]!.coins = 0;
  const result = accept(broke, 'choose_reward', { kind: 'coins' });
  expect(result.state.players[1]!.armedShield).toBeDefined();
  expect(kinds(result.events)).not.toContain('protection_applied');
});

test('a third seat sees no secret shield, no blocked hostile item and no secret item UID (§4.1, #37, D6)', () => {
  const state = game();
  const shield = give(state, 1, 'price-shield');
  state.activeSeatIndex = 1;
  const arming = accept(state, 'use_item', { itemInstanceId: shield });
  expect(eventsVisibleTo(state, arming.events, 2)).toEqual([]);
  expect(eventsVisibleTo(state, arming.events, 1).map((event) => event.kind)).toEqual([
    'shield_armed',
    'uid_destroyed',
  ]);
  const armedState = arming.state;
  expect(observe(armedState, 2).public.players[1]!.armedShield).toBeUndefined();
  expect(observe(armedState, 1).own.armedShield).toEqual({ scope: 'price', visibility: 'secret' });

  armedState.activeSeatIndex = 0;
  armedState.turnBudgets.tacticalAction = 1;
  const pickpocket = give(armedState, 0, 'pickpocket');
  const blocked = accept(armedState, 'use_item', {
    itemInstanceId: pickpocket,
    targetSeatIndex: 1,
  });
  const third = eventsVisibleTo(armedState, blocked.events, 2);
  expect(third).toEqual([]);
  expect(JSON.stringify(observe(blocked.state, 2))).not.toContain(pickpocket);
  expect(observe(blocked.state, 2).public.attackHistory).toEqual([]);
  expect(observe(blocked.state, 1).public.attackHistory).toHaveLength(1);
});
