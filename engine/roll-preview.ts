import { rerollSeat } from './abilities.ts';
import { catchSucceeds } from './catching.ts';
import { positionOf } from './contract/position.ts';
import type { GameState } from './contract/schema.ts';
import { previewSteps } from './slows.ts';

/**
 * What a Porygon reroll window (Appendix C.6, D11) asks the owner to keep or replace. Read-only:
 * it applies the same resolvers the engine will use once the die is kept, so a screen never has to
 * add or compare numbers itself (§7 house rule 2).
 */
export type PendingDie =
  | {
      kind: 'move';
      die: number;
      /** Steps after pending slows (§4.6, D8). */
      steps: number;
      /** The visible square the move ends on (§6.5). */
      destination: number;
    }
  | {
      kind: 'catch';
      die: number;
      /** The die plus every bonus: what is compared with `dc` (§4.3). */
      total: number;
      dc: number;
      succeeds: boolean;
    };

/** The revealed die `seatIndex` may reroll or keep now, or undefined when no such window is open. */
export function pendingDie(state: GameState, seatIndex: number): PendingDie | undefined {
  if (rerollSeat(state) !== seatIndex) return undefined;
  const { phase } = state;
  if (phase.kind === 'move' && phase.rolled !== undefined) {
    const player = state.players.find((entry) => entry.seatIndex === seatIndex)!;
    const steps = previewSteps(player, phase.rolled);
    return {
      kind: 'move',
      die: phase.rolled,
      steps,
      destination: positionOf(player.routeProgress + steps),
    };
  }
  if (phase.kind === 'encounter' && phase.face !== undefined && phase.catchRoll) {
    const { catchDC, classBonus, ballBonus, abilityBonus, itemBonus } = phase.catchRoll;
    const total = phase.face + classBonus + ballBonus + abilityBonus + itemBonus;
    return {
      kind: 'catch',
      die: phase.face,
      total,
      dc: catchDC,
      succeeds: catchSucceeds(phase.catchRoll, phase.face),
    };
  }
  return undefined;
}
