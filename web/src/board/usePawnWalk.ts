import { useEffect, useState } from 'react';
import { useReducedMotion } from '../ui/three/support.ts';

/** One square of a pawn's walk (spec §3, Board screen; presentation timing, not a game rule). */
export const WALK_STEP_MS = 180;
/**
 * No move in the rules covers more squares than this in one go (a die, a bonus, a pull); a larger
 * change of square (a new game, a reload) is shown at once instead of walked.
 */
const LONGEST_WALK = 12;

interface Pawn {
  readonly seatIndex: number;
  readonly position: number;
}

/**
 * Where each pawn is drawn: a pawn whose square changed walks to it one square every 180 ms, the way
 * every move in the rules goes (forward along the loop), so the player sees the move it makes.
 * With `walk` off (Instant pace, a skip, a read-only board) or reduced motion, pawns jump.
 */
export function usePawnWalk(
  pawns: readonly Pawn[],
  squares: number,
  walk: boolean,
): ReadonlyMap<number, number> {
  const still = useReducedMotion();
  const walking = walk && !still;
  const [shown, setShown] = useState<ReadonlyMap<number, number>>(
    () => new Map(pawns.map((pawn) => [pawn.seatIndex, pawn.position])),
  );
  const drawn = new Map<number, number>();
  let lagging = false;
  let stale = false;
  for (const { seatIndex, position } of pawns) {
    const at = shown.get(seatIndex) ?? position;
    const ahead = (position - at + squares) % squares;
    if (walking && ahead <= LONGEST_WALK) {
      drawn.set(seatIndex, at);
      if (ahead > 0) lagging = true;
    } else {
      drawn.set(seatIndex, position);
      if (at !== position) stale = true;
    }
  }

  useEffect(() => {
    // A pawn that jumped is where it is drawn, so a later walk starts from there.
    if (stale) {
      setShown(new Map(drawn));
      return;
    }
    if (!lagging) return;
    const timer = setTimeout(() => {
      setShown((current) => {
        const next = new Map(current);
        for (const { seatIndex, position } of pawns) {
          const at = next.get(seatIndex);
          if (at !== undefined && at !== position) next.set(seatIndex, (at + 1) % squares);
        }
        return next;
      });
    }, WALK_STEP_MS);
    return () => clearTimeout(timer);
  });
  return drawn;
}
