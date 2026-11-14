import { catchSnapshot, catchSucceeds } from './catching.ts';
import { resolveGym, resolvePvp, type CombatOutcome } from './combat.ts';
import type { GymSnapshot, PvpSnapshot } from './contract/combat.ts';
import type { GameState, Player } from './contract/schema.ts';

export type BallType = keyof Player['balls'];

export interface CatchOdds {
  /** Lowest d6 face that succeeds; may be 1 or less (always) or above 6 (never). */
  needed: number;
  successFaces: number;
  probability: number;
  /** Whole-number percentage for display (§3, §4.3). */
  percent: number;
}

/** Only the active seat faces the Encounter; its turn effects are the ones the snapshot reads. */
function encounterPlayer(state: GameState, seatIndex: number): Player {
  if (state.phase.kind !== 'encounter') throw new RangeError('No Pokémon to catch');
  if (seatIndex !== state.activeSeatIndex) throw new RangeError('Seat is not in the Encounter');
  return state.players.find((candidate) => candidate.seatIndex === seatIndex)!;
}

/**
 * Exact catch chance for `seatIndex` throwing `ballType` at the current Encounter.
 * Every d6 face runs through the real resolver, so the odds cannot drift from play.
 */
export function catchOdds(state: GameState, seatIndex: number, ballType: BallType): CatchOdds {
  const player = encounterPlayer(state, seatIndex);
  const roll = catchSnapshot(state, player, ballType);
  const successFaces = [1, 2, 3, 4, 5, 6].filter((face) => catchSucceeds(roll, face)).length;
  const { catchDC, classBonus, ballBonus, abilityBonus, itemBonus } = roll;
  return {
    needed: catchDC - classBonus - ballBonus - abilityBonus - itemBonus,
    successFaces,
    probability: successFaces / 6,
    percent: Math.round((100 * successFaces) / 6),
  };
}

/** Odds for each Ball type the seat holds, in pouch order (§4.3: shown for every type held). */
export function oddsForAllBalls(
  state: GameState,
  seatIndex: number,
): ({ ballType: BallType } & CatchOdds)[] {
  const player = encounterPlayer(state, seatIndex);
  return (['poke', 'great', 'ultra'] as const)
    .filter((ballType) => player.balls[ballType] > 0)
    .map((ballType) => ({ ballType, ...catchOdds(state, seatIndex, ballType) }));
}

export interface OutcomeOdds {
  outcomes: number;
  probability: number;
  /** Rounded separately, as for catch odds; displayed percentages may not sum to 100. */
  percent: number;
}

export interface CombatOdds {
  totalOutcomes: number;
  win: OutcomeOdds;
  tie: OutcomeOdds;
  loss: OutcomeOdds;
}

function combatOdds(outcomes: readonly CombatOutcome[]): CombatOdds {
  const odds = (outcome: CombatOutcome): OutcomeOdds => {
    const count = outcomes.filter((entry) => entry === outcome).length;
    return {
      outcomes: count,
      probability: count / outcomes.length,
      percent: Math.round((100 * count) / outcomes.length),
    };
  };
  return { totalOutcomes: outcomes.length, win: odds('win'), tie: odds('tie'), loss: odds('loss') };
}

/** Attacker's perspective; all 36 equally likely pairs use the actual resolver. */
export function pvpOdds(snapshot: PvpSnapshot): CombatOdds {
  const outcomes: CombatOutcome[] = [];
  for (let attackerFace = 1; attackerFace <= 6; attackerFace++) {
    for (let defenderFace = 1; defenderFace <= 6; defenderFace++) {
      outcomes.push(resolvePvp(snapshot, attackerFace, defenderFace).outcome);
    }
  }
  return combatOdds(outcomes);
}

/** All six faces use the actual Gym resolver. Equality is a win, so ties are always zero. */
export function gymOdds(snapshot: GymSnapshot): CombatOdds {
  const outcomes: CombatOutcome[] = [];
  for (let face = 1; face <= 6; face++) outcomes.push(resolveGym(snapshot, face).outcome);
  return combatOdds(outcomes);
}
