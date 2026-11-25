import { abilityChoices } from './abilities.ts';
import { applyAction } from './contract/stubs.ts';
import { gymSnapshotSchema, pvpSnapshotSchema } from './contract/combat.ts';
import type { GymSnapshot, PvpSnapshot } from './contract/combat.ts';
import type { GameState } from './contract/schema.ts';
import { gymSnapshot, pvpSnapshot } from './combat.ts';
import { gymOdds, pvpOdds, type CombatOdds } from './odds.ts';
import { sideModifiers } from './pvp.ts';
import { battleReadyMembers } from './status.ts';
import { actorRevision } from './visibility.ts';

/** The terms of the battle and the exact chances they give (Appendix C.3 D4 step 7, D5 step 3). */
type Terms =
  | { kind: 'pvp'; snapshot: PvpSnapshot; odds: CombatOdds }
  | { kind: 'gym'; snapshot: GymSnapshot; odds: CombatOdds };

/** What taking one open Ability choice would change, by the choice's `LegalAction` ID. */
export type BattleChoicePreview = { id: string } & Terms;

/**
 * A battle's snapshot and odds from the viewer's seat, for screens (§3, §4.4): read-only and built
 * on the same snapshot and resolver code as the real roll. Odds are the challenger's (PvP
 * attacker's, Gym challenger's) and follow `snapshot.kind`.
 */
export type BattlePreview = {
  battleId: string;
  /**
   * True once confirmation froze the terms (nothing can change them, apart from Porygon's reroll
   * of one die); false while Ability windows may still add or remove terms.
   */
  frozen: boolean;
  /**
   * For the viewer's open pre-roll Ability window only: the terms after each enabled activation,
   * so a choice shows its effect before it is taken. Other seats' hidden state never enters them.
   */
  choices: readonly BattleChoicePreview[];
} & Terms;

function termsOf(snapshot: PvpSnapshot | GymSnapshot): Terms {
  return snapshot.kind === 'pvp'
    ? { kind: 'pvp', snapshot, odds: pvpOdds(snapshot) }
    : { kind: 'gym', snapshot, odds: gymOdds(snapshot) };
}

/**
 * The snapshot a pending battle has or would have if every open window closed now. `viewer` is
 * the seat reading it: a seat's own Lucky Egg bonus is its own to know, so another seat's item
 * term (secret until confirmation, §4.1) is left out of a preview that is not frozen yet.
 */
function currentTerms(state: GameState, viewer: number): { terms: Terms; frozen: boolean } | null {
  const phase = state.phase;
  if (phase.kind === 'pvp') {
    const battle = phase.battle;
    if ('snapshot' in battle) {
      return { terms: termsOf(pvpSnapshotSchema.parse(battle.snapshot)), frozen: true };
    }
    const attacker = state.players.find((entry) => entry.seatIndex === battle.attackerSeatIndex)!;
    const defender = state.players.find((entry) => entry.seatIndex === battle.defenderSeatIndex)!;
    if (!battleReadyMembers(attacker).length || !battleReadyMembers(defender).length) return null;
    const open = visibleTo(state, viewer);
    return {
      terms: termsOf(
        pvpSnapshot(open, battle.attackerSeatIndex, battle.defenderSeatIndex, {
          attacker: sideModifiers(open, battle.attackerSeatIndex, battle.modifiers?.attacker),
          defender: sideModifiers(open, battle.defenderSeatIndex, battle.modifiers?.defender),
        }),
      ),
      frozen: false,
    };
  }
  if (phase.kind === 'gym') {
    const battle = phase.battle;
    if ('snapshot' in battle) {
      return { terms: termsOf(gymSnapshotSchema.parse(battle.snapshot)), frozen: true };
    }
    const challenger = state.players.find((entry) => entry.seatIndex === state.activeSeatIndex)!;
    if (!battleReadyMembers(challenger).length) return null;
    const open = visibleTo(state, viewer);
    return {
      terms: termsOf(
        gymSnapshot(
          open,
          state.activeSeatIndex,
          battle.position,
          sideModifiers(open, state.activeSeatIndex, battle.modifiers),
        ),
      ),
      frozen: false,
    };
  }
  return null;
}

/**
 * A copy of the state holding only what `viewer` may know about the terms: another seat's
 * pending Poison Sting is its owner's to see (§4.1, as in `observe`), and the item term belongs to
 * the active turn's owner. Everything else a snapshot reads is public.
 */
function visibleTo(state: GameState, viewer: number): GameState {
  const open = structuredClone(state);
  if (viewer !== state.activeSeatIndex && open.turnEffects) delete open.turnEffects.itemBonus;
  for (const player of open.players) {
    if (player.seatIndex === viewer) continue;
    for (const pokemon of player.team) delete pokemon.combatDebuffed;
  }
  return open;
}

/** Whether `viewer` holds an open Ability window that precedes the snapshot. */
function holdsPreRollWindow(state: GameState, viewer: number): boolean {
  const phase = state.phase;
  if (phase.kind === 'gym') {
    return phase.battle.step === 'window' && viewer === state.activeSeatIndex;
  }
  if (phase.kind !== 'pvp') return false;
  const { step, attackerSeatIndex, defenderSeatIndex } = phase.battle;
  return (
    (step === 'attacker_window' && viewer === attackerSeatIndex) ||
    (step === 'defender_window' && viewer === defenderSeatIndex)
  );
}

/**
 * Each enabled activation in the viewer's window, applied to a copy through the real executor.
 * The other seats' armed shields are removed from that copy first: a shield is secret until it
 * blocks something (D6), and a preview must not show whether Intimidate would be blocked.
 */
function choicePreviews(state: GameState, viewer: number): BattleChoicePreview[] {
  if (!holdsPreRollWindow(state, viewer)) return [];
  const player = state.players.find((entry) => entry.seatIndex === viewer)!;
  const previews: BattleChoicePreview[] = [];
  for (const choice of abilityChoices(state, viewer)) {
    const copy = visibleTo(state, viewer);
    for (const other of copy.players) if (other.seatIndex !== viewer) delete other.armedShield;
    const revision = actorRevision(copy, player.actorId);
    const result = applyAction(copy, {
      actorId: player.actorId,
      kind: choice.kind,
      payload: choice.payload,
      actionSeq: revision + 1,
      stateRevisionBefore: revision,
    });
    if ('rejected' in result) continue;
    const after = currentTerms(result.state, viewer);
    if (after) previews.push({ id: choice.id, ...after.terms });
  }
  return previews;
}

/**
 * The odds of a challenge `attackerSeatIndex` could declare against `defenderSeatIndex` from
 * Strategy, as that attacker reads them before spending the tactical action: the terms if no
 * Ability is used (a later window may change them) and without a Poison Sting that sits on the
 * defender's Pokémon (the attacker cannot see it), or null when a side has no battle-ready
 * Pokémon. Read-only.
 */
export function challengeOdds(
  state: GameState,
  attackerSeatIndex: number,
  defenderSeatIndex: number,
): Extract<Terms, { kind: 'pvp' }> | null {
  const attacker = state.players.find((entry) => entry.seatIndex === attackerSeatIndex);
  const defender = state.players.find((entry) => entry.seatIndex === defenderSeatIndex);
  if (!attacker || !defender) throw new RangeError('Unknown seat index');
  if (!battleReadyMembers(attacker).length || !battleReadyMembers(defender).length) return null;
  const open = visibleTo(state, attackerSeatIndex);
  const snapshot = pvpSnapshot(open, attackerSeatIndex, defenderSeatIndex, {
    attacker: sideModifiers(open, attackerSeatIndex, undefined),
    defender: sideModifiers(open, defenderSeatIndex, undefined),
  });
  return { kind: 'pvp', snapshot, odds: pvpOdds(snapshot) };
}

/**
 * The pending PvP or Gym battle's terms and odds as seat `viewer` may read them, or null when no
 * battle is pending or a side has no battle-ready Pokémon. Read-only: it changes no state, spends
 * nothing and draws no die (§6.1). Every number comes from the engine's own snapshot and resolver.
 */
export function battlePreview(state: GameState, viewer: number): BattlePreview | null {
  if (!state.players.some((player) => player.seatIndex === viewer)) {
    throw new RangeError('Unknown seat index');
  }
  const current = currentTerms(state, viewer);
  if (!current || (state.phase.kind !== 'pvp' && state.phase.kind !== 'gym')) return null;
  return {
    ...current.terms,
    battleId: state.phase.battle.battleId,
    frozen: current.frozen,
    choices: choicePreviews(state, viewer),
  };
}
