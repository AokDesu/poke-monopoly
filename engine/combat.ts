import { classBonus } from './classes.ts';
import { effectiveForm } from './forms.ts';
import { battleReadyMembers } from './status.ts';
import {
  battleMemberSnapshotSchema,
  combatantSnapshotSchema,
  GYM_DCS,
  gymSnapshotSchema,
  pvpSnapshotSchema,
  type BattleMemberSnapshot,
  type CombatantSnapshot,
  type GymSnapshot,
  type PvpSnapshot,
} from './contract/combat.ts';
import type { Content, GameState, Player } from './contract/schema.ts';

/** Slots for later engine effect hooks, supplied only before confirmation. No Ability mapping. */
export interface CombatModifiers {
  readonly abilityBonus?: number;
  readonly debuffs?: number;
  readonly members?: readonly {
    readonly instanceId: string;
    readonly battleBonus?: number;
    readonly debuffs?: number;
  }[];
}

function modifier(value: number | undefined): number {
  if (value === undefined) return 0;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError('Combat modifiers must be nonnegative safe integers');
  }
  return value;
}

/** Highest adjusted current-form stat among healthy members; UID breaks equal-stat ties. */
export function highestBattleMember(
  content: Content,
  player: Pick<Player, 'team'>,
  members: CombatModifiers['members'] = [],
): BattleMemberSnapshot | undefined {
  const adjustments = new Map<string, { battleBonus: number; debuffs: number }>();
  for (const entry of members) {
    if (!player.team.some((pokemon) => pokemon.instanceId === entry.instanceId)) {
      throw new RangeError('Combat modifier must target an owned Pokémon');
    }
    if (adjustments.has(entry.instanceId)) throw new RangeError('Duplicate combat modifier UID');
    adjustments.set(entry.instanceId, {
      battleBonus: modifier(entry.battleBonus),
      debuffs: modifier(entry.debuffs),
    });
  }
  let best: BattleMemberSnapshot | undefined;
  for (const pokemon of battleReadyMembers(player)) {
    const printedBattle = effectiveForm(content, pokemon.speciesId).battle;
    const { battleBonus = 0, debuffs = 0 } = adjustments.get(pokemon.instanceId) ?? {};
    const candidate = battleMemberSnapshotSchema.parse({
      instanceId: pokemon.instanceId,
      speciesId: pokemon.speciesId,
      printedBattle,
      battleBonus,
      debuffs,
      effectiveBattle: printedBattle + battleBonus - debuffs,
    });
    if (
      !best ||
      candidate.effectiveBattle > best.effectiveBattle ||
      (candidate.effectiveBattle === best.effectiveBattle && candidate.instanceId < best.instanceId)
    ) {
      best = candidate;
    }
  }
  return best;
}

/** Both roles use this same snapshot; Lucky Egg belongs only to the active turn's owner. */
export function combatSnapshot(
  state: GameState,
  seatIndex: number,
  modifiers: CombatModifiers = {},
  battle: 'pvp' | 'gym' = 'pvp',
): CombatantSnapshot {
  const player = state.players.find((entry) => entry.seatIndex === seatIndex);
  if (!player) throw new RangeError('Unknown combat seat');
  const member = highestBattleMember(state.content, player, modifiers.members);
  if (!member) throw new RangeError('No battle-ready Pokémon');
  return combatantSnapshotSchema.parse({
    seatIndex,
    member,
    classBonus: classBonus(state.content, player.classId, { kind: 'combat', battle }),
    abilityBonus: modifier(modifiers.abilityBonus),
    itemBonus: seatIndex === state.activeSeatIndex ? (state.turnEffects?.itemBonus ?? 0) : 0,
    debuffs: modifier(modifiers.debuffs),
  });
}

/** Call only after both parties confirm their pre-roll choices (order belongs to S00/S06). */
export function pvpSnapshot(
  state: GameState,
  attackerSeatIndex: number,
  defenderSeatIndex: number,
  modifiers: { readonly attacker?: CombatModifiers; readonly defender?: CombatModifiers } = {},
): PvpSnapshot {
  if (attackerSeatIndex === defenderSeatIndex) throw new RangeError('Cannot battle yourself');
  return pvpSnapshotSchema.parse({
    kind: 'pvp',
    attacker: combatSnapshot(state, attackerSeatIndex, modifiers.attacker),
    defender: combatSnapshot(state, defenderSeatIndex, modifiers.defender),
  });
}

/** Gym difficulty is engine-owned; equality with DC wins, as with catching. */
export function gymSnapshot(
  state: GameState,
  seatIndex: number,
  position: number,
  modifiers: CombatModifiers = {},
): GymSnapshot {
  if (position !== 6 && position !== 12 && position !== 18) {
    throw new RangeError('Not a Gym position');
  }
  return gymSnapshotSchema.parse({
    kind: 'gym',
    challenger: combatSnapshot(state, seatIndex, modifiers, 'gym'),
    position,
    dc: GYM_DCS[position],
  });
}

function combatTotal(snapshot: CombatantSnapshot, face: number): number {
  if (!Number.isInteger(face) || face < 1 || face > 6) throw new RangeError('Expected a d6 face');
  return (
    face +
    snapshot.member.effectiveBattle +
    snapshot.classBonus +
    snapshot.abilityBonus +
    snapshot.itemBonus -
    snapshot.debuffs
  );
}

export type CombatOutcome = 'win' | 'tie' | 'loss';

export interface PvpResolution {
  /** Attacker's perspective. A tie has no reward owner. No assets change in this resolver. */
  readonly outcome: CombatOutcome;
  readonly attackerTotal: number;
  readonly defenderTotal: number;
  readonly rewardSeatIndex: number | null;
}

export interface GymResolution {
  readonly outcome: 'win' | 'loss';
  readonly total: number;
  readonly dc: number;
  readonly rewardSeatIndex: number | null;
}

/** No live state or modifier argument exists after confirmation. Dice are supplied by the engine. */
export function resolvePvp(
  snapshot: PvpSnapshot,
  attackerFace: number,
  defenderFace: number,
): PvpResolution {
  const attackerTotal = combatTotal(snapshot.attacker, attackerFace);
  const defenderTotal = combatTotal(snapshot.defender, defenderFace);
  const outcome =
    attackerTotal > defenderTotal ? 'win' : attackerTotal < defenderTotal ? 'loss' : 'tie';
  return {
    outcome,
    attackerTotal,
    defenderTotal,
    rewardSeatIndex:
      outcome === 'tie'
        ? null
        : outcome === 'win'
          ? snapshot.attacker.seatIndex
          : snapshot.defender.seatIndex,
  };
}

export function resolveGym(snapshot: GymSnapshot, face: number): GymResolution {
  const total = combatTotal(snapshot.challenger, face);
  const outcome = total >= snapshot.dc ? 'win' : 'loss';
  return {
    outcome,
    total,
    dc: snapshot.dc,
    rewardSeatIndex: outcome === 'win' ? snapshot.challenger.seatIndex : null,
  };
}
