import { effectiveForm } from './forms.ts';
import { armShield } from './protection.ts';
import { declareHostileAction } from './protection.ts';
import { applyStatus, healStatus } from './status.ts';
import { addSlow, hasSlowKind } from './slows.ts';
import { shuffle } from './rng.ts';
import { forceChallenge, pvpDisabledReason } from './pvp.ts';
import type {
  AbilityEffectId,
  Action,
  EngineEvent,
  GameState,
  LegalAction,
  Player,
  PokemonInstance,
} from './contract/schema.ts';
import { publicRevision } from './revision.ts';

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
export type AbilityWindow = 'strategy' | 'encounter' | 'attacker' | 'defender' | 'gym' | 'reroll';

const WINDOW_TIMINGS: Readonly<Record<AbilityWindow, readonly Timing[]>> = {
  strategy: ['OWN_STRATEGY', 'CHALLENGE_DECLARE'],
  encounter: ['BEFORE_OWN_ROLL'],
  attacker: ['BEFORE_OWN_ROLL'],
  // A PvP defender may use either a B or an R Ability in its window (C.3).
  defender: ['BEFORE_OWN_ROLL', 'REACTION'],
  gym: ['BEFORE_OWN_ROLL'],
  reroll: ['AFTER_OWN_ROLL'],
};

/** Ability numbers (Appendix A, C.2): the engine is their only home. */
const BLAZE_BONUS = 1;
const ADAPTABILITY_BONUS = 1;
const DRAGON_RUSH_BONUS = 2;
const INTIMIDATE_DEBUFF = 1;
const QUICK_FLIGHT_STEPS = 3;
const VINE_PULL_STEPS = -2;
const LUCKY_SPLASH = { faces: [5, 6], ballType: 'great' } as const;

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
      return window === 'strategy' ? [{ instanceId }] : [];
    case 'challenge':
      // forceChallenge: the forced PvP's own legality (tactical action, both teams ready).
      return window !== 'strategy'
        ? []
        : state.players
            .filter(
              (target) =>
                target.seatIndex !== player.seatIndex && !pvpDisabledReason(state, player, target),
            )
            .map((target) => ({ instanceId, targetSeatIndex: target.seatIndex }));
    case 'track':
      // peek needs a deck to look at: a fresh deck, or a discard pile to reshuffle (§4.6).
      return window === 'strategy' &&
        (state.eventDeck.drawPile.length ||
          state.eventDeck.discardPile.length ||
          state.content.events?.length)
        ? [{ instanceId }]
        : [];
    case 'vine_pull':
    case 'string_shot':
      // D10: any opponent at any distance; a slow never targets a pending slow of its kind.
      return window !== 'strategy'
        ? []
        : state.players
            .filter(
              (target) =>
                target.seatIndex !== player.seatIndex &&
                (effect === 'vine_pull' || !hasSlowKind(target, 'minus')),
            )
            .map((target) => ({ instanceId, targetSeatIndex: target.seatIndex }));
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
    return effectPayloads(state, player, pokemon, effect, window).map((payload) => ({
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
    case 'blaze':
      addBattleTerms(next, player.seatIndex, { abilityBonus: BLAZE_BONUS });
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
      // chanceBall: the engine owes one logged d6 before Strategy continues (C.1).
      next.phase = {
        kind: 'chance_roll',
        rollId: `ability:${publicRevision(next)}`,
        seatIndex: player.seatIndex,
      };
      return [activated, { kind: 'phase_changed', from: 'strategy', to: 'chance_roll' }];
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
    case 'string_shot': {
      const target = next.players.find(
        (entry) => entry.seatIndex === action.payload.targetSeatIndex,
      )!;
      activated.targetId = target.actorId;
      const declared = declareHostileAction(next, player, target, 'hostile_ability');
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

/** Lucky Splash's die: a listed face adds one Ball to the owner's pouch; a miss changes nothing. */
export function recordChanceRoll(next: GameState, value: number): EngineEvent[] {
  if (next.phase.kind !== 'chance_roll') return [];
  const { seatIndex } = next.phase;
  const owner = next.players.find((entry) => entry.seatIndex === seatIndex);
  next.phase = { kind: 'strategy' };
  const events: EngineEvent[] = [];
  if (owner && (LUCKY_SPLASH.faces as readonly number[]).includes(value)) {
    owner.balls[LUCKY_SPLASH.ballType]++;
    events.push({ kind: 'ball_gained', ownerId: owner.actorId, ballType: LUCKY_SPLASH.ballType });
  }
  return [...events, { kind: 'phase_changed', from: 'chance_roll', to: 'strategy' }];
}

/**
 * peek `topEvent`: the owner privately learns the top card without drawing or reordering it. An
 * empty draw pile is first filled by a logged shuffle: the discard pile, or every content Event
 * when the deck was never used. Setup draws no RNG, so revision 0 keeps cursor 0 (§4.6, §6.8).
 */
function peekTopEvent(next: GameState, owner: Player): EngineEvent[] {
  const events: EngineEvent[] = [];
  const deck = next.eventDeck;
  if (!deck.drawPile.length) {
    const cards = deck.discardPile.length
      ? deck.discardPile
      : (next.content.events ?? []).map((event) => event.id);
    const draw = shuffle(next.rng, cards, 'shuffle:events');
    next.rng = draw.rng;
    deck.drawPile = draw.value;
    deck.discardPile = [];
    events.push(...draw.events);
  }
  owner.privateResults.push({ kind: 'peek', eventId: deck.drawPile[0]! });
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
