import type { GameState } from './contract/schema.ts';
import { pendingRollPurpose } from './turns.ts';

/** The seat entitled to answer now, separate from the owner of the current turn (§6.4).
 * null means the engine owes a result or the game has finished.
 */
export function pendingDecision(state: GameState): { seatIndex: number; actorId: string } | null {
  if (state.phase.kind === 'finished' || pendingRollPurpose(state)) return null;
  let seatIndex = state.activeSeatIndex;
  if (state.phase.kind === 'pvp') {
    const battle = state.phase.battle;
    if (battle.step === 'response') seatIndex = battle.defenderSeatIndex;
    else if (battle.step === 'reward') {
      const winner = state.players.find((player) => player.actorId === battle.request.winnerId);
      if (!winner) return null;
      seatIndex = winner.seatIndex;
    } else return null;
  }
  const seat = state.config.seats.find((entry) => entry.seatIndex === seatIndex);
  return seat ? { seatIndex, actorId: seat.actorId } : null;
}
