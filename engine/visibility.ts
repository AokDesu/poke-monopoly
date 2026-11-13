import type { Action, ActionRecord, EngineEvent, GameState } from './contract/schema.ts';

/** An action whose payload may have fields this seat must not see removed. */
export type SeatAction = Action extends infer A
  ? A extends { payload: infer P }
    ? Omit<A, 'payload'> & { payload: Partial<P> }
    : never
  : never;
/** A seat-safe copy of an `ActionRecord`, numbered within that seat's own feed. */
export type SeatActionRecord = Omit<ActionRecord, 'action'> & { action: SeatAction };

/**
 * Whether `seatIndex` may see an event produced by applying an action to `before` (§4.1, §5.4).
 * A secret item's UID events are its owner's alone; a hostile item use is its user's and target's;
 * shuffle draws, which reveal deck order, are nobody's.
 */
function visibleTo(before: GameState, event: EngineEvent, seatIndex: number): boolean {
  if (event.kind === 'random_result' && event.purpose.startsWith('shuffle:')) return false;
  if (event.kind === 'hostile_item_used') {
    return event.userSeatIndex === seatIndex || event.targetSeatIndex === seatIndex;
  }
  // A chat message is its sender's and recipient's alone (§4.8, §5.4).
  if (event.kind === 'chat_sent') {
    return event.fromSeatIndex === seatIndex || event.toSeatIndex === seatIndex;
  }
  // Items created during play are bought, hence secret (§4.1).
  if (event.kind === 'uid_created' && event.entity === 'item') {
    return (
      before.players.find((player) => player.seatIndex === seatIndex)?.actorId === event.ownerId
    );
  }
  if (event.kind === 'uid_destroyed' && event.entity === 'item') {
    const owner = before.players.find((player) =>
      player.items.some((item) => item.instanceId === event.instanceId),
    );
    const item = owner?.items.find((entry) => entry.instanceId === event.instanceId);
    return item?.visibility === 'public' || owner?.seatIndex === seatIndex;
  }
  return true;
}

/** The events of one accepted action that `seatIndex` may see, in their original order. */
export function eventsVisibleTo(
  before: GameState,
  events: EngineEvent[],
  seatIndex: number,
): EngineEvent[] {
  if (!before.players.some((player) => player.seatIndex === seatIndex)) {
    throw new RangeError('Unknown seat index');
  }
  return structuredClone(events.filter((event) => visibleTo(before, event, seatIndex)));
}

/**
 * The revision an actor sees and must submit as `stateRevisionBefore` (§4.8): accepted records
 * minus those it may not see, so it equals the length of that seat's feed. The engine's own
 * records, and any seat that missed nothing, use the global revision.
 */
export function actorRevision(state: GameState, actorId: string): number {
  const player = state.players.find((candidate) => candidate.actorId === actorId);
  return state.stateRevision - (player?.unseenRecords ?? 0);
}

/**
 * Whether the record is a chat this seat took no part in (§4.8). A seat outside a conversation must
 * not learn that it happened or whom it was with: in a three-seat game, "a chat happened and it was
 * not to me" names the recipient, so the record is absent from the seat's feed, not redacted.
 */
function hiddenChat(before: GameState, record: ActionRecord, seatIndex: number): boolean {
  const { action } = record;
  if (action.kind !== 'chat') return false;
  const actor = before.players.find((player) => player.actorId === action.actorId);
  return actor?.seatIndex !== seatIndex && action.payload.targetSeatIndex !== seatIndex;
}

/**
 * A copy of one accepted record that `seatIndex` may see, or `null` when the seat must not know it
 * happened (a chat between two other seats, §4.8). `before` is the state it was applied to and
 * `shownBefore` is how many records this seat's feed already holds. The copy is numbered in the
 * seat's own feed (`actionSeq = shownBefore + 1`), so a hidden record leaves no gap in the
 * sequence or revision. The full record, with its real numbers, stays in the engine's replay log.
 */
export function actionVisibleTo(
  before: GameState,
  record: ActionRecord,
  seatIndex: number,
  shownBefore: number,
): SeatActionRecord | null {
  const events = eventsVisibleTo(before, record.events, seatIndex);
  if (hiddenChat(before, record, seatIndex)) return null;
  const action: SeatAction = structuredClone(record.action);
  action.actionSeq = shownBefore + 1;
  action.stateRevisionBefore = shownBefore;
  const actor = before.players.find((player) => player.actorId === action.actorId);
  // Another seat's purchase is secret: its price is public, the offer is not (§4.1).
  if (action.kind === 'buy' && actor?.seatIndex !== seatIndex) delete action.payload.offerId;
  if (action.kind === 'use_item' && actor?.seatIndex !== seatIndex) {
    const item = actor?.items.find((entry) => entry.instanceId === action.payload.itemInstanceId);
    if (item?.visibility !== 'public') delete action.payload.itemInstanceId;
    // A hostile item use is its user's and target's alone (§4.1, §4.4).
    if (action.payload.targetSeatIndex !== seatIndex) delete action.payload.targetSeatIndex;
  }
  // Deck order and the drawn card are nobody's until an effect makes them public (§4.6).
  if (action.kind === 'shuffle') delete action.payload.order;
  if (action.kind === 'event_draw') delete action.payload.eventId;
  return { ...structuredClone(record), action, events };
}
