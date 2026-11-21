import { effectiveForm } from './forms.ts';
import { armShield } from './protection.ts';
import { declareHostileAction } from './protection.ts';
import { applyStatus, healStatus, pokemonStatuses } from './status.ts';
import { addSlow, hasSlowKind } from './slows.ts';
import { ensureEventDeck } from './events.ts';
import { forceChallenge, pvpDisabledReason } from './pvp.ts';
import type {
  AbilityEffectId,
  Action,
  EngineEvent,
  GameState,
  LegalAction,
  LegalActions,
  Player,
  PokemonInstance,
  ReasonCode,
} from './contract/schema.ts';
import { publicRevision } from './revision.ts';

type Timing =
  'OWN_STRATEGY' | 'CHALLENGE_DECLARE' | 'BEFORE_OWN_ROLL' | 'AFTER_OWN_ROLL' | 'REACTION';

/** One Ability effect: a primitive operation with fixed parameters (Appendix C.1 D1). */
export interface AbilityEffect {
  readonly primitive:
    | 'fixedMove'
    | 'moveDebuff'
    | 'rollBonus'
    | 'forcePvP'
    | 'shield'
    | 'heal'
    | 'gainBall'
    | 'gainCoin'
    | 'peek';
  readonly operation: string;
  readonly timing: Timing;
  /** Targets an opponent with a harmful effect (`hostileAbility`, §4.5). */
  readonly hostile: boolean;
}

/**
 * Engine-owned Ability effects (Appendix C.1/C.2). Content names an effect ID; every primitive,
 * operation, number and timing lives here, so no rule is read from Ability prose (§4.5).
 */
export const ABILITY_EFFECTS: Readonly<Record<AbilityEffectId, AbilityEffect>> = {
  vine_pull: {
    primitive: 'fixedMove',
    operation: 'displace',
    timing: 'OWN_STRATEGY',
    hostile: true,
  },
  blaze: { primitive: 'rollBonus', operation: 'add', timing: 'BEFORE_OWN_ROLL', hostile: false },
  quick_slash: {
    primitive: 'rollBonus',
    operation: 'add',
    timing: 'BEFORE_OWN_ROLL',
    hostile: false,
  },
  shell_guard: { primitive: 'shield', operation: 'arm', timing: 'REACTION', hostile: false },
  block: { primitive: 'shield', operation: 'arm', timing: 'REACTION', hostile: false },
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
  scavenge: {
    primitive: 'gainCoin',
    operation: 'chanceCoin',
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
  thunder_shock: {
    primitive: 'moveDebuff',
    operation: 'cap',
    timing: 'OWN_STRATEGY',
    hostile: true,
  },
  confusion: {
    primitive: 'moveDebuff',
    operation: 'forceReroll',
    timing: 'OWN_STRATEGY',
    hostile: true,
  },
  poison_sting: {
    primitive: 'rollBonus',
    operation: 'memberDebuff',
    timing: 'OWN_STRATEGY',
    hostile: true,
  },
};

/** The decision window a seat is in, if any (Appendix C.3 D3). */
export type AbilityWindow =
  'strategy' | 'encounter' | 'attacker' | 'defender' | 'gym' | 'reroll' | 'pickpocket';

const WINDOW_TIMINGS: Readonly<Record<AbilityWindow, readonly Timing[]>> = {
  strategy: ['OWN_STRATEGY', 'CHALLENGE_DECLARE'],
  encounter: ['BEFORE_OWN_ROLL'],
  attacker: ['BEFORE_OWN_ROLL'],
  // A PvP defender may use either a B or an R Ability in its window (C.3).
  defender: ['BEFORE_OWN_ROLL', 'REACTION'],
  gym: ['BEFORE_OWN_ROLL'],
  pickpocket: ['REACTION'],
  reroll: ['AFTER_OWN_ROLL'],
};

/** Ability numbers (Appendix A, C.2): the engine is their only home. */
const BLAZE_BONUS = 1;
const QUICK_SLASH_BONUS = 1;
const ADAPTABILITY_BONUS = 1;
const DRAGON_RUSH_BONUS = 2;
const INTIMIDATE_DEBUFF = 1;
const QUICK_FLIGHT_STEPS = 3;
const VINE_PULL_STEPS = -2;
const LUCKY_SPLASH = { faces: [5, 6], ballType: 'great' } as const;
const SCAVENGE_COINS = 1;

/** The effect the instance's current form carries; evolved fallback forms inherit it (§4.5). */
export function abilityEffectOf(
  state: GameState,
  pokemon: PokemonInstance,
): AbilityEffectId | undefined {
  return effectiveForm(state.content, pokemon.speciesId).ability?.effect;
}

type Reason = { reasonCode: ReasonCode; reasonText: string };

/** Effects that name an opponent as their target. */
const TARGETED_EFFECTS: readonly AbilityEffectId[] = [
  'vine_pull',
  'string_shot',
  'thunder_shock',
  'confusion',
  'challenge',
];

const TIMING_TEXT: Readonly<Record<Timing, string>> = {
  OWN_STRATEGY: 'Usable in your Strategy phase',
  CHALLENGE_DECLARE: 'Usable when you declare a challenge in Strategy',
  BEFORE_OWN_ROLL: 'Usable before your own catch or battle roll',
  AFTER_OWN_ROLL: 'Usable right after your own die is revealed',
  REACTION: 'Usable as the defender in a battle',
};

/**
 * Why a source cannot activate now whatever the window (§4.5, D10): its own Lap use first, then
 * the player's allowance for this globalTurnNo, which the active player also spends as
 * `pokemonAbility`. Tired Pokémon may still activate (D2).
 */
function activationBlock(
  state: GameState,
  player: Player,
  pokemon: PokemonInstance,
): Reason | undefined {
  if (!pokemon.abilityReady) {
    return {
      reasonCode: 'ABILITY_USED_THIS_LAP',
      reasonText: 'Already used this Lap; ready again after you pass Start',
    };
  }
  if (
    player.abilityUsedGlobalTurnNo === state.globalTurnNo ||
    (player.seatIndex === state.activeSeatIndex && state.turnBudgets.pokemonAbility === 0)
  ) {
    return {
      reasonCode: 'ABILITY_USED_THIS_GLOBAL_TURN',
      reasonText: 'You already used an Ability this turn',
    };
  }
}

/** A window the effect's timing does not cover (C.3 D3). */
function timingBlock(effect: AbilityEffectId, window: AbilityWindow): Reason | undefined {
  const { timing } = ABILITY_EFFECTS[effect];
  return WINDOW_TIMINGS[window].includes(timing)
    ? undefined
    : { reasonCode: 'ABILITY_WRONG_TIMING', reasonText: TIMING_TEXT[timing] };
}

/** Why one opponent is no legal target of a targeted effect (D10); the item rules' wording. */
function targetBlock(
  state: GameState,
  player: Player,
  effect: AbilityEffectId,
  target: Player,
): Reason | undefined {
  const slowKind =
    effect === 'string_shot' ? 'minus' : effect === 'thunder_shock' ? 'cap' : undefined;
  if (slowKind && hasSlowKind(target, slowKind)) {
    return { reasonCode: 'NO_VALID_TARGET', reasonText: 'Target is already slowed' };
  }
  if (effect === 'challenge') return pvpDisabledReason(state, player, target) ?? undefined;
}

/** Why an untargeted effect has no legal use in its own window (D7, D10). */
function effectBlock(
  state: GameState,
  player: Player,
  effect: AbilityEffectId,
  window: AbilityWindow,
): Reason {
  const battle = window === 'attacker' || window === 'defender' || window === 'gym';
  const noTarget = (reasonText: string): Reason => ({ reasonCode: 'NO_VALID_TARGET', reasonText });
  if (
    !battle &&
    (effect === 'blaze' ||
      effect === 'quick_slash' ||
      effect === 'dragon_rush' ||
      effect === 'intimidate')
  ) {
    return { reasonCode: 'ABILITY_WRONG_TIMING', reasonText: 'Works only in a battle' };
  }
  switch (effect) {
    case 'intimidate':
      return noTarget('Needs a Pokémon battle opponent; a Gym has none');
    case 'heal_pulse':
      return noTarget('No Pokémon with a status to heal');
    case 'shell_guard':
    case 'block':
      return noTarget('A shield is already armed');
    case 'track':
      return noTarget('No Event card to look at');
    default:
      return noTarget('No valid target');
  }
}

/**
 * A ready source plus the player's unused allowance for this globalTurnNo; the active player also
 * needs `pokemonAbility` (§4.2, §4.5, C.3). Tired Pokémon may still activate (D2).
 */
export function canActivate(state: GameState, player: Player, pokemon: PokemonInstance): boolean {
  return activationBlock(state, player, pokemon) === undefined;
}

/** The window open for `seatIndex` in the current phase. */
export function currentWindow(state: GameState, seatIndex: number): AbilityWindow | undefined {
  if (state.pendingPickpocket) {
    return seatIndex === state.pendingPickpocket.targetSeatIndex ? 'pickpocket' : undefined;
  }
  const phase = state.phase;
  const active = seatIndex === state.activeSeatIndex;
  if (phase.kind === 'strategy' && active) return 'strategy';
  if (phase.kind === 'encounter' && !phase.catchRoll && active) return 'encounter';
  if (phase.kind === 'gym' && phase.battle.step === 'window' && active) return 'gym';
  if (rerollSeat(state) === seatIndex) return 'reroll';
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

/** The seat whose own die was just revealed and awaits reroll or keep (C.3 A window, D11). */
export function rerollSeat(state: GameState): number | undefined {
  const phase = state.phase;
  if (phase.kind === 'move' && phase.rolled !== undefined) return state.activeSeatIndex;
  if (phase.kind === 'encounter' && phase.face !== undefined && !phase.rerolling) {
    return state.activeSeatIndex;
  }
  if (phase.kind === 'gym' && phase.battle.step === 'reroll' && !phase.battle.rerolling) {
    return state.activeSeatIndex;
  }
  if (phase.kind === 'pvp' && phase.battle.step === 'reroll' && !phase.battle.rerolling) {
    const battle = phase.battle;
    return battle.side === 'attacker' ? battle.attackerSeatIndex : battle.defenderSeatIndex;
  }
}

/** Whether `seatIndex` holds a ready, allowed Calculate for an A window opening now. */
export function canReroll(state: GameState, seatIndex: number): boolean {
  return abilityChoices(state, seatIndex, 'reroll').length > 0;
}

/** The PvP opponent of `seatIndex` while its battle windows are open. */
function battleOpponent(state: GameState, seatIndex: number): number | undefined {
  if (state.phase.kind !== 'pvp') return;
  const { attackerSeatIndex, defenderSeatIndex } = state.phase.battle;
  return seatIndex === attackerSeatIndex ? defenderSeatIndex : attackerSeatIndex;
}

type Payload = Extract<Action, { kind: 'activate_ability' }>['payload'];

/** Legal payloads for one ready source in one window; empty when its effect has no legal use. */
function effectPayloads(
  state: GameState,
  player: Player,
  pokemon: PokemonInstance,
  effect: AbilityEffectId,
  window: AbilityWindow,
): Payload[] {
  const instanceId = pokemon.instanceId;
  const battle = window === 'attacker' || window === 'defender' || window === 'gym';
  switch (effect) {
    case 'blaze':
    case 'quick_slash':
    case 'dragon_rush':
      return battle ? [{ instanceId }] : [];
    case 'adaptability':
      // D2: the scope is chosen on activation and lasts until the end of this globalTurnNo.
      return [
        { instanceId, scope: 'catch' },
        { instanceId, scope: 'combat' },
      ];
    case 'intimidate': {
      // D10: Intimidate needs a PvP opponent; a Gym has none (D5 step 2).
      const opponent = battleOpponent(state, player.seatIndex);
      return window !== 'gym' && battle && opponent !== undefined
        ? [{ instanceId, targetSeatIndex: opponent }]
        : [];
    }
    case 'calculate':
      return window === 'reroll' ? [{ instanceId }] : [];
    case 'quick_flight':
    case 'lucky_splash':
    case 'scavenge':
      return window === 'strategy' ? [{ instanceId }] : [];
    case 'track':
      // peek needs a deck to look at: a fresh deck, or a discard pile to reshuffle (§4.6).
      return window === 'strategy' &&
        (state.eventDeck.drawPile.length ||
          state.eventDeck.discardPile.length ||
          state.content.events?.length)
        ? [{ instanceId }]
        : [];
    case 'poison_sting':
      return state.players
        .filter((target) => target.seatIndex !== player.seatIndex)
        .flatMap((target) =>
          target.team.map((member) => ({
            instanceId,
            targetSeatIndex: target.seatIndex,
            targetPokemonInstanceId: member.instanceId,
          })),
        );
    case 'vine_pull':
    case 'string_shot':
    case 'thunder_shock':
    case 'confusion':
    case 'challenge':
      // D10: any opponent at any distance, subject to each effect's targeting rules.
      return window !== 'strategy'
        ? []
        : state.players
            .filter(
              (target) =>
                target.seatIndex !== player.seatIndex &&
                !targetBlock(state, player, effect, target),
            )
            .map((target) => ({ instanceId, targetSeatIndex: target.seatIndex }));
    case 'heal_pulse':
      // D10: Heal Pulse needs an own Pokémon with a status.
      if (window === 'pickpocket') return [];
      return player.team.flatMap((member) =>
        pokemonStatuses(member).map((status) => ({
          instanceId,
          targetPokemonInstanceId: member.instanceId,
          ...(status === 'tired' ? {} : { status }),
        })),
      );
    case 'shell_guard':
      // D7: at most one armed shield from any source.
      return window === 'pickpocket' || player.armedShield ? [] : [{ instanceId }];
    case 'block':
      return player.armedShield ? [] : [{ instanceId }];
    default:
      return [];
  }
}

/** The stable choice ID of one activation (`ability:<instance>[:<target>…]`). */
function abilityActionId(payload: Payload): string {
  return ['ability', ...Object.values(payload)].join(':');
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
    return effectPayloads(state, player, pokemon, effect, window).map((payload) => ({
      id: abilityActionId(payload),
      kind: 'activate_ability' as const,
      payload,
    }));
  });
}

/**
 * Every activation `seatIndex` holds in its current window that is not enabled, each with the
 * reason the player is shown (§3.1: an unusable control says why). Report-only: it never lists
 * an action `abilityChoices` lists and changes no rule. Reasons keep the instance's Lap use, the
 * player's per-`globalTurnNo` allowance, a window the timing does not cover, a missing target and
 * a spent tactical action apart; the first that applies wins, in that order. Effects without an
 * engine binding never appear here (content marks them planned).
 */
export function abilityDisabled(
  state: GameState,
  seatIndex: number,
  window = currentWindow(state, seatIndex),
): LegalActions['disabled'] {
  if (!window) return [];
  const player = state.players.find((entry) => entry.seatIndex === seatIndex)!;
  return player.team.flatMap((pokemon) => {
    const effect = abilityEffectOf(state, pokemon);
    if (!effect || (window === 'pickpocket' && effect !== 'block')) return [];
    const { instanceId } = pokemon;
    const disabled = (payload: Payload, reason: Reason) => ({
      id: abilityActionId(payload),
      kind: 'activate_ability' as const,
      payload,
      ...reason,
    });
    const blocked = activationBlock(state, player, pokemon) ?? timingBlock(effect, window);
    if (blocked) return [disabled({ instanceId }, blocked)];
    if (TARGETED_EFFECTS.includes(effect)) {
      return state.players.flatMap((target) => {
        const reason =
          target.seatIndex === seatIndex ? undefined : targetBlock(state, player, effect, target);
        return reason ? [disabled({ instanceId, targetSeatIndex: target.seatIndex }, reason)] : [];
      });
    }
    return effectPayloads(state, player, pokemon, effect, window).length
      ? []
      : [disabled({ instanceId }, effectBlock(state, player, effect, window))];
  });
}

/** What activating `effect` spends beyond readiness and the allowance (D10): `forcePvP` also spends the tactical action. */
export function abilityCosts(effect: AbilityEffectId): { tacticalAction: boolean } {
  return { tacticalAction: ABILITY_EFFECTS[effect].primitive === 'forcePvP' };
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
        ...healStatus(
          player,
          action.payload.targetPokemonInstanceId!,
          action.payload.status ?? 'tired',
          'heal_pulse',
        ),
      ];
    case 'shell_guard':
      return [activated, ...armShield(player, { scope: 'battle_coin_loss', visibility: 'public' })];
    case 'block':
      return [
        activated,
        ...armShield(player, {
          scope: 'pvp_pickpocket',
          visibility: next.pendingPickpocket ? 'secret' : 'public',
        }),
      ];
    case 'blaze':
      addBattleTerms(next, player.seatIndex, { abilityBonus: BLAZE_BONUS });
      return [activated];
    case 'quick_slash':
      addBattleTerms(next, player.seatIndex, { abilityBonus: QUICK_SLASH_BONUS });
      return [activated];
    case 'dragon_rush':
      addBattleTerms(next, player.seatIndex, { abilityBonus: DRAGON_RUSH_BONUS });
      addAfterResolution(next, player.seatIndex, pokemon.instanceId);
      return [activated];
    case 'adaptability':
      player.rollEffects = [
        ...(player.rollEffects ?? []).filter((entry) => entry.globalTurnNo === next.globalTurnNo),
        { scope: action.payload.scope!, n: ADAPTABILITY_BONUS, globalTurnNo: next.globalTurnNo },
      ];
      return [activated];
    case 'intimidate': {
      const target = next.players.find(
        (entry) => entry.seatIndex === action.payload.targetSeatIndex,
      )!;
      activated.targetId = target.actorId;
      // A hostile Ability: always an attack attempt; an armed Price Shield blocks it whole (D6).
      const declared = declareHostileAction(next, player, target, 'hostile_ability');
      if (!declared.blocked) addBattleTerms(next, target.seatIndex, { debuffs: INTIMIDATE_DEBUFF });
      return [activated, ...declared.events];
    }
    case 'calculate':
      startReroll(next);
      return [activated];
    case 'lucky_splash':
    case 'scavenge':
      return [activated, beginChanceRoll(next, player, { kind: effect })];
    case 'track':
      return [activated, ...peekTopEvent(next, player)];
    case 'challenge': {
      const target = next.players.find(
        (entry) => entry.seatIndex === action.payload.targetSeatIndex,
      )!;
      activated.targetId = target.actorId;
      // Also spends the tactical action; a Price Shield blocks the whole action (D4 step 3, D10).
      return [activated, ...forceChallenge(next, player, target)];
    }
    case 'quick_flight':
      // replaceRoll: this turn's move uses fixed steps with no die (C.1, C.5).
      next.turnEffects = { ...next.turnEffects, fixedMove: QUICK_FLIGHT_STEPS };
      return [activated];
    case 'vine_pull':
    case 'string_shot':
    case 'thunder_shock':
    case 'confusion':
    case 'poison_sting': {
      const target = next.players.find(
        (entry) => entry.seatIndex === action.payload.targetSeatIndex,
      )!;
      activated.targetId = target.actorId;
      const declared = declareHostileAction(next, player, target, 'hostile_ability');
      if (effect === 'thunder_shock' || effect === 'confusion' || effect === 'poison_sting') {
        // Always record the chance die so the pending roll does not disclose a Price Shield.
        const rolling = beginChanceRoll(next, player, {
          kind: effect,
          ...(declared.blocked ? {} : { targetSeatIndex: target.seatIndex }),
          ...(effect === 'poison_sting' && !declared.blocked
            ? { targetPokemonInstanceId: action.payload.targetPokemonInstanceId! }
            : {}),
        });
        return [activated, ...declared.events, rolling];
      }
      if (declared.blocked) return [activated, ...declared.events];
      if (effect === 'string_shot') {
        addSlow(target, 'string_shot');
        return [activated, ...declared.events];
      }
      // displace: forced movement, never the target's actual move (D9).
      const from = target.routeProgress;
      target.routeProgress += VINE_PULL_STEPS;
      return [
        activated,
        ...declared.events,
        { kind: 'player_displaced', targetId: target.actorId, from, to: target.routeProgress },
      ];
    }
    default:
      throw new RangeError(`Ability effect ${effect} is not executable`);
  }
}

/** Add this battle's Ability terms to one side (§4.4 abilityBonus and debuffs). */
function addBattleTerms(
  next: GameState,
  seatIndex: number,
  terms: { abilityBonus?: number; debuffs?: number },
): void {
  const add = (mods: { abilityBonus: number; debuffs: number } | undefined) => ({
    abilityBonus: (mods?.abilityBonus ?? 0) + (terms.abilityBonus ?? 0),
    debuffs: (mods?.debuffs ?? 0) + (terms.debuffs ?? 0),
  });
  if (next.phase.kind === 'gym') {
    next.phase.battle.modifiers = add(next.phase.battle.modifiers);
  } else if (next.phase.kind === 'pvp') {
    const battle = next.phase.battle;
    const side = seatIndex === battle.attackerSeatIndex ? 'attacker' : 'defender';
    const modifiers = battle.modifiers ?? {
      attacker: { abilityBonus: 0, debuffs: 0 },
      defender: { abilityBonus: 0, debuffs: 0 },
    };
    battle.modifiers = { ...modifiers, [side]: add(modifiers[side]) };
  }
}

function addAfterResolution(next: GameState, seatIndex: number, instanceId: string): void {
  if (next.phase.kind !== 'pvp' && next.phase.kind !== 'gym') return;
  const battle = next.phase.battle;
  battle.afterResolution = [...(battle.afterResolution ?? []), { seatIndex, instanceId }];
}

/** Calculate: the revealed die is replaced by a new logged die, never restored (D11). */
function startReroll(next: GameState): void {
  const phase = next.phase;
  if (phase.kind === 'move') {
    delete phase.rolled;
    phase.awaitingResult = true;
    phase.rerolling = true;
  } else if (phase.kind === 'encounter') {
    phase.rerolling = true;
  } else if ((phase.kind === 'pvp' || phase.kind === 'gym') && phase.battle.step === 'reroll') {
    phase.battle.rerolling = true;
  }
}

export function pendingChanceRollPurpose(state: GameState): string | undefined {
  return state.phase.kind === 'chance_roll' ? `${state.phase.rollId}:chance` : undefined;
}

function beginChanceRoll(
  next: GameState,
  player: Player,
  effect: Extract<GameState['phase'], { kind: 'chance_roll' }>['effect'],
): EngineEvent {
  next.phase = {
    kind: 'chance_roll',
    rollId: `ability:${publicRevision(next)}`,
    seatIndex: player.seatIndex,
    effect,
  };
  return { kind: 'phase_changed', from: 'strategy', to: 'chance_roll' };
}

/** Resolve an Ability's logged chance die before returning to Strategy. */
export function recordChanceRoll(next: GameState, value: number): EngineEvent[] {
  if (next.phase.kind !== 'chance_roll') return [];
  const { seatIndex, effect } = next.phase;
  const owner = next.players.find((entry) => entry.seatIndex === seatIndex);
  next.phase = { kind: 'strategy' };
  const events: EngineEvent[] = [];
  if (
    effect.kind === 'lucky_splash' &&
    owner &&
    (LUCKY_SPLASH.faces as readonly number[]).includes(value)
  ) {
    owner.balls[LUCKY_SPLASH.ballType]++;
    events.push({ kind: 'ball_gained', ownerId: owner.actorId, ballType: LUCKY_SPLASH.ballType });
  } else if (value % 2 === 0) {
    if (effect.kind === 'scavenge' && owner) {
      owner.coins += SCAVENGE_COINS;
      events.push({
        kind: 'coin_transfer',
        source: { kind: 'bank' },
        destination: { kind: 'player', actorId: owner.actorId },
        amount: SCAVENGE_COINS,
        reason: 'scavenge',
      });
    } else if ('targetSeatIndex' in effect) {
      const target = next.players.find((entry) => entry.seatIndex === effect.targetSeatIndex);
      if (target && effect.kind === 'thunder_shock') addSlow(target, 'thunder_shock');
      if (target && effect.kind === 'confusion') target.confused = true;
      if (target && effect.kind === 'poison_sting' && effect.targetPokemonInstanceId) {
        events.push(
          ...applyStatus(target, effect.targetPokemonInstanceId, 'combat_debuff', 'poison_sting'),
        );
      }
    }
  }
  return [...events, { kind: 'phase_changed', from: 'chance_roll', to: 'strategy' }];
}

/**
 * peek `topEvent`: the owner privately learns the top card without drawing or reordering it. An
 * empty draw pile is first filled by a logged shuffle: the discard pile, or every content Event
 * when the deck was never used. Setup draws no RNG, so revision 0 keeps cursor 0 (§4.6, §6.8).
 */
function peekTopEvent(next: GameState, owner: Player): EngineEvent[] {
  const events = ensureEventDeck(next);
  owner.privateResults.push({ kind: 'peek', eventId: next.eventDeck.drawPile[0]! });
  return events;
}

/**
 * D4 step 12 / D5 step 6 (D13): after the result and any reward, each `tiredSelf` source becomes
 * Tired, attacker's first. Status follows the UID, so an evolved source is the new form.
 */
export function applyAfterResolution(
  next: GameState,
  entries: readonly { seatIndex: number; instanceId: string }[] = [],
): EngineEvent[] {
  return entries.flatMap(({ seatIndex, instanceId }) => {
    const owner = next.players.find((entry) => entry.seatIndex === seatIndex)!;
    return applyStatus(owner, instanceId, 'tired', 'dragon_rush');
  });
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
