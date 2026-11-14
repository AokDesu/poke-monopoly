/// <reference types="vite/client" />
import { expect, test } from 'vitest';
import { parseContent, toEngineContent } from '../content/schema.ts';
import { abilityChoices } from './abilities.ts';
import {
  advanceAutomatically,
  applyAction,
  checkInvariants,
  createGame,
  createGameConfig,
  createGameLog,
  createRng,
  d6,
  legalActions,
  pendingDecision,
  replay,
  stateHash,
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
 * P0 Fisherman (Eevee) is active in Strategy at globalTurnNo 7. P1 Researcher owns a ready
 * Chansey (Heal Pulse, R) and a Tired Pikachu; P2 Bug Catcher only watches.
 */
function game(seed = 1): GameState {
  const state = createGame(
    createGameConfig({
      seats: ['fisherman', 'researcher', 'bug-catcher'].map((classId, seatIndex) => ({
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
  state.globalTurnNo = 7;
  state.turnBudgets = { tacticalAction: 1, catchAttempt: 1, pokemonAbility: 1 };
  for (const player of state.players) {
    player.ownTurnNo = 2;
    player.team[0]!.speciesId = 'eevee';
    // Adaptability already used this Lap: only the defender's Heal Pulse can open a window.
    player.team[0]!.abilityReady = false;
  }
  const defender = state.players[1]!;
  defender.team = [
    { ...defender.team[0]!, speciesId: 'chansey', abilityReady: true },
    {
      instanceId: 'caught:1:1',
      speciesId: 'pikachu',
      origin: 'caught',
      evolutionStage: 0,
      tired: true,
      tiredExpiresOwnTurnNo: 3,
      abilityReady: true,
    },
  ];
  return state;
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

/** P0 challenges P1, who accepts: P1's defender window is now open. */
function defending(state = game()): GameState {
  const declared = accept(state, 'declare_pvp', { targetSeatIndex: 1 }).state;
  return accept(declared, 'respond_pvp', { accept: true }).state;
}

const heal = { instanceId: 'starter:1', targetPokemonInstanceId: 'caught:1:1' };

test('a defender heals in its R window before the snapshot: one activation spends the instance and the defender allowance, never the active pokemonAbility (§4.5, C.3, AC-1)', () => {
  const window = defending();
  expect(window.phase).toMatchObject({ kind: 'pvp', battle: { step: 'defender_window' } });
  expect(pendingDecision(window)?.seatIndex).toBe(1);
  expect(legalActions(window, 1).enabled.map((choice) => choice.id)).toEqual([
    'ability:starter:1:caught:1:1',
    'pass-window',
  ]);
  const result = accept(window, 'activate_ability', heal);
  const after = result.state;
  expect(result.events.map((event) => event.kind)).toEqual([
    'ability_activated',
    'status_changed',
    'pvp_confirmed',
  ]);
  expect(after.players[1]!.team.map((pokemon) => [pokemon.abilityReady, pokemon.tired])).toEqual([
    [false, false],
    [true, false],
  ]);
  expect(after.players[1]!.abilityUsedGlobalTurnNo).toBe(7);
  expect(after.turnBudgets).toEqual({ tacticalAction: 0, catchAttempt: 1, pokemonAbility: 1 });
  // The healed Pikachu (battle 2) now beats Chansey (battle 1) for the frozen snapshot.
  expect(after.phase).toMatchObject({
    battle: {
      step: 'attacker_roll',
      snapshot: { defender: { member: { instanceId: 'caught:1:1' } } },
    },
  });
});

test('no eligible Ability means no window: the engine continues without asking (C.3)', () => {
  const state = game();
  // Heal Pulse needs a status (D10).
  state.players[1]!.team[1] = { ...state.players[1]!.team[1]!, tired: false };
  delete state.players[1]!.team[1]!.tiredExpiresOwnTurnNo;
  const confirmed = defending(state);
  expect(confirmed.phase).toMatchObject({ kind: 'pvp', battle: { step: 'attacker_roll' } });
  const passed = accept(defending(), 'skip');
  expect(passed.state.phase).toMatchObject({ battle: { step: 'attacker_roll' } });
  expect(passed.state.players[1]!.abilityUsedGlobalTurnNo).toBeNull();
  expect(passed.state.players[1]!.team[0]!.abilityReady).toBe(true);
});

test('after reacting, a defender cannot activate another ready instance in the same globalTurnNo; a new globalTurnNo allows it (§4.5)', () => {
  const reacted = accept(defending(), 'activate_ability', heal).state;
  const second = structuredClone(reacted);
  second.players[1]!.team.push({
    instanceId: 'caught:1:2',
    speciesId: 'chansey',
    origin: 'caught',
    evolutionStage: 0,
    tired: false,
    abilityReady: true,
  });
  second.players[1]!.team[1]!.tired = true;
  expect(abilityChoices(second, 1, 'defender')).toEqual([]);
  second.globalTurnNo = 8;
  expect(abilityChoices(second, 1, 'defender').map((choice) => choice.id)).toEqual([
    'ability:caught:1:2:caught:1:1',
  ]);
});

test('the same instance stays spent for the rest of the Lap, even in a later globalTurnNo (§4.5)', () => {
  const reacted = accept(defending(), 'activate_ability', heal).state;
  const later = game();
  later.globalTurnNo = 9;
  later.players[1]!.team[0]!.abilityReady = reacted.players[1]!.team[0]!.abilityReady;
  later.players[1]!.abilityUsedGlobalTurnNo = 7;
  expect(defending(later).phase).toMatchObject({ battle: { step: 'attacker_roll' } });
});

test('a qualifying owner Start credit resets instance readiness after income and before Sell, leaving the globalTurnNo allowance spent (§4.7 step 1, AC-4)', () => {
  const state = game();
  state.activeSeatIndex = 1;
  state.phase = { kind: 'move' };
  state.players[1]!.routeProgress = 23;
  state.players[1]!.team[0]!.abilityReady = false;
  state.players[1]!.abilityUsedGlobalTurnNo = 7;
  const rolling = accept(state, 'roll').state;
  const purpose = `move:1:7`;
  const action = {
    actorId: 'engine',
    kind: 'dice_result',
    payload: { purpose, value: d6(rolling.rng, purpose).value },
    actionSeq: rolling.stateRevision + 1,
    stateRevisionBefore: rolling.stateRevision,
  } as Action;
  const result = applyAction(rolling, action) as Extract<ApplyActionResult, { accepted: true }>;
  expect(checkInvariants(rolling, action, result)).toEqual([]);
  expect(result.events.map((event) => event.kind)).toEqual([
    'random_result',
    'coin_transfer',
    'abilities_reset',
    'phase_changed',
  ]);
  expect(result.state.phase.kind).toBe('sell');
  expect(result.state.players[1]!.team[0]!.abilityReady).toBe(true);
  expect(result.state.players[1]!.abilityUsedGlobalTurnNo).toBe(7);
});

test('evolution never resets readiness or the allowance (§4.5, §8)', () => {
  let seed = 0;
  for (; seed < 200; seed++) {
    const attacker = d6(createRng(seed), 'a');
    if (attacker.value < d6(attacker.rng, 'b').value) break; // defender wins
  }
  const reacted = accept(defending(game(seed)), 'activate_ability', heal).state;
  const rolled = advanceAutomatically(advanceAutomatically(reacted).state).state;
  expect(pendingDecision(rolled)?.seatIndex).toBe(1);
  const evolved = accept(rolled, 'choose_reward', {
    kind: 'evolve',
    instanceId: 'caught:1:1',
    nextFormId: 'raichu',
  }).state;
  expect(evolved.players[1]!.team[1]).toMatchObject({ speciesId: 'raichu', abilityReady: true });
  expect(evolved.players[1]!.team[0]!.abilityReady).toBe(false);
  expect(evolved.players[1]!.abilityUsedGlobalTurnNo).toBe(7);
});

test('Shell Guard arms a battle-scoped shield in the R window and is offered only without an armed shield (D7)', () => {
  const state = game();
  state.players[1]!.team[0]!.speciesId = 'squirtle';
  const window = defending(state);
  const armed = accept(window, 'activate_ability', { instanceId: 'starter:1' }).state;
  expect(armed.players[1]!.armedShield).toEqual({
    scope: 'battle_coin_loss',
    visibility: 'public',
  });

  const shielded = game();
  shielded.players[1]!.team[0]!.speciesId = 'squirtle';
  shielded.players[1]!.armedShield = { scope: 'price', visibility: 'secret' };
  shielded.players[1]!.team[1]!.tired = false;
  delete shielded.players[1]!.team[1]!.tiredExpiresOwnTurnNo;
  expect(defending(shielded).phase).toMatchObject({ battle: { step: 'attacker_roll' } });
});

test('wrong, stale and unready activations reject with state and counters unchanged (D10, §8)', () => {
  const window = defending();
  const hash = stateHash(window);
  const wrongActor = { ...command(window, 'activate_ability', heal), actorId: 'p0' };
  expect(applyAction(window, wrongActor)).toMatchObject({ rejected: true, reason: 'wrong_actor' });
  const stale = { ...command(window, 'activate_ability', heal), stateRevisionBefore: 0 };
  expect(applyAction(window, stale)).toMatchObject({ rejected: true });
  const unready = structuredClone(window);
  unready.players[1]!.team[0]!.abilityReady = false;
  expect(applyAction(unready, command(unready, 'activate_ability', heal))).toMatchObject({
    rejected: true,
    reason: 'illegal_action',
  });
  expect(stateHash(window)).toBe(hash);
});

test('the lifecycle checkers catch a readiness reset without Start credit and an activation that keeps its allowance (§8)', () => {
  const window = defending();
  const action = command(window, 'activate_ability', heal);
  const result = applyAction(window, action) as Extract<ApplyActionResult, { accepted: true }>;
  const noSpend = structuredClone(result);
  noSpend.state.players[1]!.abilityUsedGlobalTurnNo = null;
  expect(checkInvariants(window, action, noSpend).map((v) => v.invariant)).toContain(
    'ability-once-per-player-turn',
  );
  const refreshed = structuredClone(result);
  const spentBefore = structuredClone(window);
  spentBefore.players[1]!.team[0]!.abilityReady = false;
  refreshed.state.players[1]!.team[0]!.abilityReady = true;
  expect(checkInvariants(spentBefore, action, refreshed).map((v) => v.invariant)).toContain(
    'ability-once-per-instance-per-lap',
  );
});

test('a log paused at the defender window replays and resumes to the same owner and result (§6.8)', () => {
  const initial = game();
  initial.stateRevision = 0;
  initial.rng = createRng(1);
  const log = createGameLog(structuredClone(initial));
  let state = initial;
  for (const [kind, payload] of [
    ['declare_pvp', { targetSeatIndex: 1 }],
    ['respond_pvp', { accept: true }],
  ] as const) {
    const result = accept(state, kind, payload);
    log.actions.push(result.record);
    state = result.state;
  }
  const resumed = replay(JSON.parse(JSON.stringify(log)));
  expect(resumed).toEqual(state);
  expect(pendingDecision(resumed)?.seatIndex).toBe(1);
  const healed = accept(resumed, 'activate_ability', heal);
  log.actions.push(healed.record);
  expect(replay(JSON.parse(JSON.stringify(log)))).toEqual(healed.state);
});
