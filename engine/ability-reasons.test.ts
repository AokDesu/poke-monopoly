/// <reference types="vite/client" />
import { expect, test } from 'vitest';
import { parseContent, toEngineContent } from '../content/schema.ts';
import { abilityChoices, abilityCosts, abilityDisabled } from './abilities.ts';
import {
  advanceAutomatically,
  applyAction,
  createGame,
  createGameConfig,
  disabledActionSchema,
  legalActions,
  pendingDecision,
  type Action,
  type GameState,
  type LegalActions,
  type PokemonInstance,
} from './index.ts';
import { resetAbilities } from './abilities.ts';

const files = Object.fromEntries(
  Object.entries(
    import.meta.glob<unknown>('../content/*.json', { eager: true, import: 'default' }),
  ).map(([path, json]) => [path.split('/').at(-1)!.slice(0, -5), json]),
);
const content = toEngineContent(parseContent(files));

const member = (speciesId: string): PokemonInstance => ({
  instanceId: `t:${speciesId}`,
  speciesId,
  origin: 'caught',
  evolutionStage: 0,
  tired: false,
  abilityReady: true,
});

/** P0 (the active seat) holds one Pokémon per bound Ability; P1 and P2 hold a plain Pidgey each. */
function strategy(species: readonly string[], seed = 1): GameState {
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
  for (const player of state.players) player.ownTurnNo = 2;
  state.players[0]!.team = species.map(member);
  for (const player of state.players.slice(1)) {
    player.team = [{ ...player.team[0]!, speciesId: 'rattata', abilityReady: true }];
  }
  return state;
}

/** instance → 'enabled' or the disabled reason code, for P0's Abilities in the current window. */
function outcomes(state: GameState, seatIndex = 0) {
  const result: Record<string, string[]> = {};
  const add = (id: string, outcome: string) => (result[id] = [...(result[id] ?? []), outcome]);
  const listed = legalActions(state, seatIndex);
  for (const action of listed.enabled) {
    if (action.kind === 'activate_ability') add(action.payload.instanceId, 'enabled');
  }
  for (const action of listed.disabled) {
    if (action.kind === 'activate_ability') {
      add(action.payload.instanceId, action.reasonCode);
    }
  }
  return result;
}

const ALL = [
  'bulbasaur',
  'charmander',
  'squirtle',
  'eevee',
  'magikarp',
  'gyarados',
  'chansey',
  'caterpie',
  'porygon',
  'pidgey',
  'dratini',
];

test('Strategy lists every bound Ability once, enabled or disabled with a reason, never both (§3.1, §4.5, C.3)', () => {
  const state = strategy(ALL);
  const listed = legalActions(state, 0);
  const enabledIds = new Set(listed.enabled.map((action) => action.id));
  for (const action of listed.disabled) expect(enabledIds.has(action.id), action.id).toBe(false);
  expect(outcomes(state)).toEqual({
    // Strategy (S) Abilities need an opponent target: two opponents, so one enabled entry each.
    't:bulbasaur': ['enabled', 'enabled'],
    't:caterpie': ['enabled', 'enabled'],
    't:pidgey': ['enabled'],
    't:magikarp': ['enabled'],
    // B, R and A Abilities do not open in Strategy.
    't:charmander': ['ABILITY_WRONG_TIMING'],
    't:eevee': ['ABILITY_WRONG_TIMING'],
    't:gyarados': ['ABILITY_WRONG_TIMING'],
    't:dratini': ['ABILITY_WRONG_TIMING'],
    't:squirtle': ['ABILITY_WRONG_TIMING'],
    't:chansey': ['ABILITY_WRONG_TIMING'],
    't:porygon': ['ABILITY_WRONG_TIMING'],
  });
  const timing = (id: string) =>
    listed.disabled.find((action) => action.id === `ability:${id}`)!.reasonText;
  expect(timing('t:charmander')).toBe('Usable before your own catch or battle roll');
  expect(timing('t:squirtle')).toBe('Usable as the defender in a battle');
  expect(timing('t:porygon')).toBe('Usable right after your own die is revealed');
  // The enabled output is what `abilityChoices` always listed; the disabled list is additive.
  expect(listed.enabled.filter((action) => action.kind === 'activate_ability')).toEqual(
    abilityChoices(state, 0),
  );
});

test('the instance’s Lap use and the player’s turn allowance are separate reasons (§4.5, D10)', () => {
  const state = strategy(['bulbasaur', 'pidgey', 'charmander']);
  state.players[0]!.team[0]!.abilityReady = false;
  state.players[0]!.abilityUsedGlobalTurnNo = 7;
  state.turnBudgets.pokemonAbility = 0;
  expect(outcomes(state)).toEqual({
    // The spent instance names its Lap use even though the allowance is spent too.
    't:bulbasaur': ['ABILITY_USED_THIS_LAP'],
    // Every other instance is held back by the per-turn allowance, whatever its timing.
    't:pidgey': ['ABILITY_USED_THIS_GLOBAL_TURN'],
    't:charmander': ['ABILITY_USED_THIS_GLOBAL_TURN'],
  });
  expect(legalActions(state, 0).enabled.some((action) => action.kind === 'activate_ability')).toBe(
    false,
  );
});

test('a spent pokemonAbility budget alone reads as the turn allowance, not a Lap use', () => {
  const state = strategy(['pidgey']);
  state.turnBudgets.pokemonAbility = 0;
  expect(outcomes(state)).toEqual({ 't:pidgey': ['ABILITY_USED_THIS_GLOBAL_TURN'] });
});

test('evolution keeps a spent Lap reason and Start makes the Ability enabled again (§4.5, §4.7)', () => {
  const state = strategy(['bulbasaur']);
  state.players[0]!.team[0]!.abilityReady = false;
  state.players[0]!.team[0]!.speciesId = 'ivysaur';
  state.players[0]!.team[0]!.evolutionStage = 1;
  expect(outcomes(state)).toEqual({ 't:bulbasaur': ['ABILITY_USED_THIS_LAP'] });
  resetAbilities(state.players[0]!);
  expect(outcomes(state)).toEqual({ 't:bulbasaur': ['enabled', 'enabled'] });
});

test('String Shot names the targets that are already slowed and keeps the rest enabled (D8, D10)', () => {
  const state = strategy(['caterpie']);
  state.players[1]!.pendingSlows = ['repel'];
  const listed = legalActions(state, 0);
  const targets = (list: LegalActions['enabled']) =>
    list.flatMap((action) =>
      action.kind === 'activate_ability' ? [action.payload.targetSeatIndex] : [],
    );
  expect(targets(listed.enabled)).toEqual([2]);
  expect(targets(listed.disabled)).toEqual([1]);
  expect(listed.disabled.find((action) => action.kind === 'activate_ability')).toMatchObject({
    reasonCode: 'NO_VALID_TARGET',
    reasonText: 'Target is already slowed',
  });
});

test('Vine Pull never reports a target reason: any opponent at any distance is legal (D10)', () => {
  const state = strategy(['bulbasaur']);
  state.players[1]!.pendingSlows = ['repel', 'sticky_web'];
  expect(abilityDisabled(state, 0)).toEqual([]);
});

/** Machop's Challenge is not bound in content (C4); bind it here to reach the C window. */
function withChallenge(): GameState {
  const state = strategy(['machop']);
  state.content.species.find((entry) => entry.id === 'machop')!.ability!.effect = 'challenge';
  return state;
}

test('Challenge needs the tactical action and a battle-ready target, each as the engine words it (§4.5, D10)', () => {
  const state = withChallenge();
  expect(outcomes(state)).toEqual({ 't:machop': ['enabled', 'enabled'] });
  expect(abilityCosts('challenge')).toEqual({ tacticalAction: true });
  expect(abilityCosts('vine_pull')).toEqual({ tacticalAction: false });

  state.turnBudgets.tacticalAction = 0;
  const spent = legalActions(state, 0);
  expect(spent.enabled.some((action) => action.kind === 'activate_ability')).toBe(false);
  expect(
    spent.disabled
      .filter((action) => action.kind === 'activate_ability')
      .map((action) => [action.reasonCode, action.reasonText]),
  ).toEqual([
    ['ALREADY_USED_THIS_TURN', 'Tactical action already used this turn'],
    ['ALREADY_USED_THIS_TURN', 'Tactical action already used this turn'],
  ]);

  state.turnBudgets.tacticalAction = 1;
  state.players[1]!.team.forEach((pokemon) => (pokemon.tired = true));
  const half = legalActions(state, 0);
  expect(
    half.enabled.flatMap((action) =>
      action.kind === 'activate_ability' ? [action.payload.targetSeatIndex] : [],
    ),
  ).toEqual([2]);
  expect(half.disabled.find((action) => action.kind === 'activate_ability')).toMatchObject({
    payload: { targetSeatIndex: 1 },
    reasonCode: 'NO_VALID_TARGET',
    reasonText: 'Both teams need a battle-ready Pokémon',
  });
});

test('Track says why it has no card to look at (§4.6)', () => {
  const state = strategy(['growlithe']);
  state.content.species.find((entry) => entry.id === 'growlithe')!.ability!.effect = 'track';
  expect(outcomes(state)).toEqual({ 't:growlithe': ['enabled'] });
  state.content.events = [];
  expect(abilityDisabled(state, 0)).toMatchObject([
    { reasonCode: 'NO_VALID_TARGET', reasonText: 'No Event card to look at' },
  ]);
});

/** P0 challenges P1 (a voluntary PvP, which P1 accepts): P1's defender window is open. */
function defenderWindow(defender: readonly PokemonInstance[]): GameState {
  const state = strategy(['pidgey']);
  state.players[1]!.team = [...defender];
  state.players[0]!.team[0]!.abilityReady = false;
  const act = (kind: Action['kind'], payload: unknown): GameState => {
    const result = applyAction(state, {
      actorId: pendingDecision(state)!.actorId,
      kind,
      payload,
      actionSeq: state.stateRevision + 1,
      stateRevisionBefore: state.stateRevision,
    } as Action);
    if ('rejected' in result) throw new Error(result.reason);
    return result.state;
  };
  let next = act('declare_pvp', { targetSeatIndex: 1 });
  Object.assign(state, next);
  next = act('respond_pvp', { accept: true });
  return next;
}

test('a defender sees Heal Pulse and Shell Guard disabled with their own reasons, and an off-window Ability as timing (D7, D10)', () => {
  const window = defenderWindow([
    { ...member('chansey'), abilityReady: true },
    { ...member('squirtle'), abilityReady: true },
    { ...member('bulbasaur'), abilityReady: true },
  ]);
  expect(window.phase).toMatchObject({ kind: 'pvp', battle: { step: 'defender_window' } });
  window.players[1]!.armedShield = { scope: 'battle_coin_loss', visibility: 'public' };
  const reasons = Object.fromEntries(
    legalActions(window, 1)
      .disabled.filter((action) => action.kind === 'activate_ability')
      .map((action) => [action.payload.instanceId, [action.reasonCode, action.reasonText]]),
  );
  expect(reasons).toEqual({
    't:chansey': ['NO_VALID_TARGET', 'No Pokémon with a status to heal'],
    't:squirtle': ['NO_VALID_TARGET', 'A shield is already armed'],
    't:bulbasaur': ['ABILITY_WRONG_TIMING', 'Usable in your Strategy phase'],
  });
  // The opponent's window shows the reactor nothing: only its own seat is listed.
  expect(legalActions(window, 0).disabled.map((action) => action.kind)).toEqual(['skip']);
});

test('a disabled Ability cannot be submitted: it rejects as illegal and leaves the state and counters unchanged (§8)', () => {
  const state = strategy(['charmander', 'bulbasaur']);
  state.players[0]!.team[1]!.abilityReady = false;
  const before = structuredClone(state);
  for (const instanceId of ['t:charmander', 't:bulbasaur']) {
    const result = applyAction(state, {
      actorId: 'p0',
      kind: 'activate_ability',
      payload: { instanceId },
      actionSeq: state.stateRevision + 1,
      stateRevisionBefore: state.stateRevision,
    });
    expect(result).toMatchObject({ rejected: true, reason: 'illegal_action' });
  }
  expect(state).toEqual(before);
});

test('a seat outside its window or turn is listed no Ability reasons, so one seat never reads another’s team (§4.1)', () => {
  const state = strategy(ALL);
  expect(abilityDisabled(state, 1)).toEqual([]);
  expect(legalActions(state, 1).disabled.map((action) => action.kind)).toEqual(['skip']);
  expect(legalActions(state, 1).enabled).toEqual([]);
});

test('over seeded random play every listed Ability is enabled or disabled, never both, and every disabled entry parses (§3.1)', () => {
  let seen = 0;
  const reasons = new Set<string>();
  for (let seed = 0; seed < 5; seed++) {
    let state = strategy(
      ['bulbasaur', 'charmander', 'chansey', 'porygon', 'eevee', 'caterpie'],
      seed,
    );
    for (const player of state.players.slice(1)) {
      player.team = [member('gyarados'), member('squirtle'), member('chansey')].map((pokemon) => ({
        ...pokemon,
        instanceId: `${player.actorId}:${pokemon.speciesId}`,
      }));
    }
    for (const player of state.players) player.team[0]!.instanceId = `${player.actorId}:first`;
    let pick = seed + 1;
    for (let step = 0; step < 150 && state.phase.kind !== 'finished'; step++) {
      const auto = advanceAutomatically(state);
      if (auto.records.length > 0) {
        state = auto.state;
        continue;
      }
      const decision = pendingDecision(state);
      if (!decision) break;
      const listed = legalActions(state, decision.seatIndex);
      const ids = new Set(listed.enabled.map((action) => action.id));
      for (const action of listed.disabled) {
        if (action.kind !== 'activate_ability') continue;
        expect(ids.has(action.id), action.id).toBe(false);
        expect(disabledActionSchema.safeParse(action).success).toBe(true);
        reasons.add(action.reasonCode);
        seen++;
      }
      if (listed.enabled.length === 0) break;
      pick = (pick * 48271) % 2147483647;
      const choice = listed.enabled[pick % listed.enabled.length]!;
      const result = applyAction(state, {
        actorId: decision.actorId,
        kind: choice.kind,
        payload: choice.payload,
        actionSeq: state.stateRevision + 1,
        stateRevisionBefore: state.stateRevision,
      } as Action);
      if ('rejected' in result) throw new Error(result.reason);
      state = result.state;
    }
  }
  expect(seen).toBeGreaterThan(30);
  expect(reasons).toContain('ABILITY_WRONG_TIMING');
});
