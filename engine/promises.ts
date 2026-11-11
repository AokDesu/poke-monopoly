import type {
  EngineEvent,
  GameState,
  LegalAction,
  LegalActions,
  NoAttackPromise,
} from './contract/schema.ts';
import { socialOpen } from './social.ts';

type Direction = 'offer' | 'ask';

function player(state: GameState, seatIndex: number) {
  return state.players.find((entry) => entry.seatIndex === seatIndex)!;
}

/** Roles of the two seats once the initiator's direction is known (§4.8 Promise `no_attack`). */
function roles(initiatorSeatIndex: number, otherSeatIndex: number, direction: Direction) {
  return direction === 'offer'
    ? { promiserSeatIndex: initiatorSeatIndex, recipientSeatIndex: otherSeatIndex }
    : { promiserSeatIndex: otherSeatIndex, recipientSeatIndex: initiatorSeatIndex };
}

/**
 * The promiser's turn whose end closes a promise confirmed now. The promise lasts "until the end of
 * the promiser's next turn" (§4.8), so it is their `ownTurnNo` at confirmation plus 1.
 */
export function closesOwnTurnNo(state: GameState, promiserSeatIndex: number): number {
  return player(state, promiserSeatIndex).ownTurnNo + 1;
}

/**
 * A promise is active from confirmation until the end of the promiser's turn `closesOwnTurnNo`:
 * before that turn, or during it. After it, the promiser's `ownTurnNo` stays equal while another
 * seat is active, and the promise is closed (settling it is a later slice's job).
 */
export function promiseActive(state: GameState, promise: NoAttackPromise): boolean {
  const promiser = player(state, promise.promiserSeatIndex);
  return (
    promiser.ownTurnNo < promise.closesOwnTurnNo ||
    (promiser.ownTurnNo === promise.closesOwnTurnNo &&
      state.activeSeatIndex === promise.promiserSeatIndex)
  );
}

/**
 * §4.8 limits: one active promise per directed pair, no renewal (a new promise cannot be offered
 * while the old one is still active, including on its closing turn), and none that would close
 * after the game ends (§4.2 Final Table Round: nobody plays an own turn past `targetOwnTurnNo`).
 */
function promiseAllowed(state: GameState, promiserSeatIndex: number, recipientSeatIndex: number) {
  const closes = closesOwnTurnNo(state, promiserSeatIndex);
  if (state.finalTableRound && closes > state.finalTableRound.targetOwnTurnNo) return false;
  return !(state.promises ?? []).some(
    (promise) =>
      promise.promiserSeatIndex === promiserSeatIndex &&
      promise.recipientSeatIndex === recipientSeatIndex &&
      promiseActive(state, promise),
  );
}

/**
 * The promise offers the active human may make: to each AI seat, in either direction, within the
 * limits. Nothing depends on what any seat holds, so the button leaks no card (§4.8 Privacy).
 */
export function promiseOfferChoices(state: GameState, seatIndex: number, result: LegalActions) {
  if (!socialOpen(state, seatIndex)) return;
  for (const target of state.config.seats) {
    if (target.seatIndex === seatIndex || target.controller !== 'ai') continue;
    for (const direction of ['offer', 'ask'] as const) {
      const { promiserSeatIndex, recipientSeatIndex } = roles(
        seatIndex,
        target.seatIndex,
        direction,
      );
      if (!promiseAllowed(state, promiserSeatIndex, recipientSeatIndex)) continue;
      const action: LegalAction = {
        id: `offer-promise:seat-${target.seatIndex}:${direction}`,
        kind: 'offer_promise',
        payload: { targetSeatIndex: target.seatIndex, direction },
      };
      result.enabled.push(action);
    }
  }
}

/** Opens the question. Nothing changes but the pending record; the answer spends the interaction. */
export function offerPromise(
  next: GameState,
  payload: { targetSeatIndex: number; direction: Direction },
): EngineEvent[] {
  next.pendingResponse = {
    kind: 'promise_offer',
    initiatorSeatIndex: next.activeSeatIndex,
    responderSeatIndex: payload.targetSeatIndex,
    direction: payload.direction,
  };
  return [
    {
      kind: 'promise_offered',
      initiatorSeatIndex: next.activeSeatIndex,
      responderSeatIndex: payload.targetSeatIndex,
      direction: payload.direction,
    },
  ];
}

/**
 * Either answer uses up the turn's social interaction and clears the question; neither spends the
 * tactical action (§4.8 Activation). Accepting records the promise, rejecting records nothing.
 */
export function answerPromise(next: GameState, answer: 'accept' | 'reject'): EngineEvent[] {
  const pending = next.pendingResponse;
  if (pending?.kind !== 'promise_offer') throw new RangeError('No promise offer is pending');
  delete next.pendingResponse;
  next.turnBudgets.socialInteraction = (next.turnBudgets.socialInteraction ?? 0) - 1;
  const { promiserSeatIndex, recipientSeatIndex } = roles(
    pending.initiatorSeatIndex,
    pending.responderSeatIndex,
    pending.direction,
  );
  if (answer === 'reject')
    return [{ kind: 'promise_rejected', promiserSeatIndex, recipientSeatIndex }];
  const closes = closesOwnTurnNo(next, promiserSeatIndex);
  (next.promises ??= []).push({
    promiserSeatIndex,
    recipientSeatIndex,
    createdGlobalTurnNo: next.globalTurnNo,
    closesOwnTurnNo: closes,
  });
  return [
    { kind: 'promise_accepted', promiserSeatIndex, recipientSeatIndex, closesOwnTurnNo: closes },
  ];
}

/** The promises a seat made or received; no other seat's (§4.8 Privacy, §5.4). */
export function promisesOf(state: GameState, seatIndex: number): NoAttackPromise[] {
  return (state.promises ?? []).filter(
    (promise) =>
      promise.promiserSeatIndex === seatIndex || promise.recipientSeatIndex === seatIndex,
  );
}
