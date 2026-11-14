import { effectiveForm } from './forms.ts';
import { armShield } from './protection.ts';
import { healStatus } from './status.ts';
import type {
  AbilityEffectId,
  Action,
  EngineEvent,
  GameState,
  LegalAction,
  Player,
  PokemonInstance,
} from './contract/schema.ts';

type Timing =
  'OWN_STRATEGY' | 'CHALLENGE_DECLARE' | 'BEFORE_OWN_ROLL' | 'AFTER_OWN_ROLL' | 'REACTION';

/** One Ability effect: a primitive operation with fixed parameters (Appendix C.1 D1). */
export interface AbilityEffect {
  readonly primitive:
    'fixedMove' | 'moveDebuff' | 'rollBonus' | 'forcePvP' | 'shield' | 'heal' | 'gainBall' | 'peek';
  readonly operation: string;
  readonly timing: Timing;
  /** Targets an opponent with a harmful effect (`hostileAbility`, §4.5). */
  readonly hostile: boolean;
}

/**
 * Engine-owned Ability effects (Appendix C.1/C.2). Content names an effect ID; every primitive,
 * operation, number and timing lives here, so no rule is read from Ability prose (§4.5).
 * `challenge` and `track` are engine adapters for the forcePvP and peek primitives that no core
 * Ability binds; C4 content decides which species carry them.
 */
export const ABILITY_EFFECTS: Readonly<Record<AbilityEffectId, AbilityEffect>> = {
  vine_pull: {
    primitive: 'fixedMove',
    operation: 'displace',
    timing: 'OWN_STRATEGY',
    hostile: true,
  },
  blaze: { primitive: 'rollBonus', operation: 'add', timing: 'BEFORE_OWN_ROLL', hostile: false },
  shell_guard: { primitive: 'shield', operation: 'arm', timing: 'REACTION', hostile: false },
  adaptability: {
    primitive: 'rollBonus',
    operation: 'add',
    timing: 'BEFORE_OWN_ROLL',
    hostile: false,
  },
  lucky_splash: {
    primitive: 'gainBall',
    operation: 'chanceBall',
    timing: 'OWN_STRATEGY',
    hostile: false,
  },
  intimidate: {
    primitive: 'rollBonus',
    operation: 'opponentAdd',
    timing: 'BEFORE_OWN_ROLL',
    hostile: true,
  },
  heal_pulse: { primitive: 'heal', operation: 'removeStatus', timing: 'REACTION', hostile: false },
  string_shot: {
    primitive: 'moveDebuff',
    operation: 'minus',
    timing: 'OWN_STRATEGY',
    hostile: true,
  },
  calculate: {
    primitive: 'rollBonus',
    operation: 'reroll',
    timing: 'AFTER_OWN_ROLL',
    hostile: false,
  },
  quick_flight: {
    primitive: 'fixedMove',
    operation: 'replaceRoll',
    timing: 'OWN_STRATEGY',
    hostile: false,
  },
  dragon_rush: {
    primitive: 'rollBonus',
    operation: 'add',
    timing: 'BEFORE_OWN_ROLL',
    hostile: false,
  },
  challenge: {
    primitive: 'forcePvP',
    operation: 'forceChallenge',
    timing: 'CHALLENGE_DECLARE',
    hostile: true,
  },
  track: { primitive: 'peek', operation: 'topEvent', timing: 'OWN_STRATEGY', hostile: false },
};

/** The decision window a seat is in, if any (Appendix C.3 D3). */
export type AbilityWindow = 'strategy' | 'encounter' | 'attacker' | 'defender' | 'gym';

const WINDOW_TIMINGS: Readonly<Record<AbilityWindow, readonly Timing[]>> = {
  strategy: ['OWN_STRATEGY', 'CHALLENGE_DECLARE'],
  encounter: ['BEFORE_OWN_ROLL'],
  attacker: ['BEFORE_OWN_ROLL'],
  // A PvP defender may use either a B or an R Ability in its window (C.3).
  defender: ['BEFORE_OWN_ROLL', 'REACTION'],
  gym: ['BEFORE_OWN_ROLL'],
};

/** The effect the instance's current form carries; evolved fallback forms inherit it (§4.5). */
export function abilityEffectOf(
  state: GameState,
  pokemon: PokemonInstance,
): AbilityEffectId | undefined {
  return effectiveForm(state.content, pokemon.speciesId).ability?.effect;
}

/**
 * A ready source plus the player's unused allowance for this globalTurnNo; the active player also
 * needs `pokemonAbility` (§4.2, §4.5, C.3). Tired Pokémon may still activate (D2).
 */
export function canActivate(state: GameState, player: Player, pokemon: PokemonInstance): boolean {
  if (!pokemon.abilityReady || player.abilityUsedGlobalTurnNo === state.globalTurnNo) return false;
  return player.seatIndex !== state.activeSeatIndex || state.turnBudgets.pokemonAbility > 0;
}

/** The window open for `seatIndex` in the current phase. */
export function currentWindow(state: GameState, seatIndex: number): AbilityWindow | undefined {
  const phase = state.phase;
  const active = seatIndex === state.activeSeatIndex;
  if (phase.kind === 'strategy' && active) return 'strategy';
  if (phase.kind === 'encounter' && !phase.catchRoll && active) return 'encounter';
  if (phase.kind === 'gym' && phase.battle.step === 'window' && active) return 'gym';
  if (phase.kind === 'pvp') {
    const battle = phase.battle;
    if (battle.step === 'attacker_window' && seatIndex === battle.attackerSeatIndex) {
      return 'attacker';
    }
    if (battle.step === 'defender_window' && seatIndex === battle.defenderSeatIndex) {
      return 'defender';
    }
  }
}

type Payload = Extract<Action, { kind: 'activate_ability' }>['payload'];

/** Legal payloads for one ready source in one window; empty when its effect has no legal use. */
function effectPayloads(
  state: GameState,
  player: Player,
  pokemon: PokemonInstance,
  effect: AbilityEffectId,
): Payload[] {
  const instanceId = pokemon.instanceId;
  switch (effect) {
    case 'heal_pulse':
      // D10: Heal Pulse needs an own Pokémon with a status.
      return player.team
        .filter((member) => member.tired)
        .map((member) => ({ instanceId, targetPokemonInstanceId: member.instanceId }));
    case 'shell_guard':
      // D7: at most one armed shield from any source.
      return player.armedShield ? [] : [{ instanceId }];
    default:
      return [];
  }
}

/** Every enabled activation for `seatIndex` in its current window (C.3: only eligible ones). */
export function abilityChoices(
  state: GameState,
  seatIndex: number,
  window = currentWindow(state, seatIndex),
): LegalAction[] {
  if (!window) return [];
  const player = state.players.find((entry) => entry.seatIndex === seatIndex)!;
  return player.team.flatMap((pokemon) => {
    const effect = abilityEffectOf(state, pokemon);
    if (!effect || !WINDOW_TIMINGS[window].includes(ABILITY_EFFECTS[effect].timing)) return [];
    if (!canActivate(state, player, pokemon)) return [];
    return effectPayloads(state, player, pokemon, effect).map((payload) => ({
      id: ['ability', ...Object.values(payload)].join(':'),
      kind: 'activate_ability' as const,
      payload,
    }));
  });
}

/**
 * Apply one validated activation. Costs are spent at once and stay spent whatever the effect does
 * (D10): source readiness for this Lap, the player's globalTurnNo allowance, and `pokemonAbility`
 * for the active player. The caller continues any window afterwards.
 */
export function activateAbility(next: GameState, action: Action): EngineEvent[] {
  if (action.kind !== 'activate_ability') return [];
  const player = next.players.find((entry) => entry.actorId === action.actorId)!;
  const pokemon = player.team.find((entry) => entry.instanceId === action.payload.instanceId)!;
  const effect = abilityEffectOf(next, pokemon)!;
  pokemon.abilityReady = false;
  player.abilityUsedGlobalTurnNo = next.globalTurnNo;
  if (player.seatIndex === next.activeSeatIndex) next.turnBudgets.pokemonAbility--;
  const activated: EngineEvent = {
    kind: 'ability_activated',
    ownerId: player.actorId,
    instanceId: pokemon.instanceId,
    effect,
  };
  switch (effect) {
    case 'heal_pulse':
      return [
        activated,
        ...healStatus(player, action.payload.targetPokemonInstanceId!, 'tired', 'heal_pulse'),
      ];
    case 'shell_guard':
      return [activated, ...armShield(player, { scope: 'battle_coin_loss', visibility: 'public' })];
    default:
      throw new RangeError(`Ability effect ${effect} is not executable`);
  }
}

/**
 * Qualifying owner Start credit makes every team instance ready again, after income and Lap credit
 * and before Sell (§4.7 step 1). Allowances per globalTurnNo are untouched (AC-4 variant).
 */
export function resetAbilities(player: Player): EngineEvent[] {
  const instanceIds = player.team
    .filter((pokemon) => !pokemon.abilityReady)
    .map((pokemon) => pokemon.instanceId);
  if (!instanceIds.length) return [];
  for (const pokemon of player.team) pokemon.abilityReady = true;
  return [{ kind: 'abilities_reset', ownerId: player.actorId, instanceIds }];
}
