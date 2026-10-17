import { catchSnapshot, catchSucceeds } from './catching.ts';
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
