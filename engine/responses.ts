import type { GameState, LegalActions, PendingResponse } from './contract/schema.ts';

/**
 * The seat that owes the next command. Normally the active seat; while a `pendingResponse` waits,
 * its responder, who need not be the active seat (§4.2 Social window, §4.4 PvP replies). Every
 * caller that asks "whose move is it" goes through here: `applyAction`, `legalActions`,
 * `advanceAutomatically`, `resume` and the invariant that an unfinished game can always continue.
 */
export function actingSeatIndex(state: GameState): number {
  return state.pendingResponse?.responderSeatIndex ?? state.activeSeatIndex;
}

/** The accept / reject choices of the responder; every other seat gets none while it waits. */
export function responseChoices(
  pending: PendingResponse,
  seatIndex: number,
  result: LegalActions,
): void {
  if (seatIndex !== pending.responderSeatIndex) return;
  result.enabled.push(
    { id: 'respond:accept', kind: 'respond', payload: { answer: 'accept' } },
    { id: 'respond:reject', kind: 'respond', payload: { answer: 'reject' } },
  );
}
