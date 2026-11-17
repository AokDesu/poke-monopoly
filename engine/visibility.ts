import { ABILITY_EFFECTS, abilityEffectOf, pendingChanceRollPurpose } from './abilities.ts';
import type {
  Action,
  ActionRecord,
  AttackAttempt,
  EngineEvent,
  GameState,
  SeatAttackAttempt,
} from './contract/schema.ts';

/** An action whose payload may have fields this seat must not see removed. */
export type SeatAction = Action extends infer A
  ? A extends { payload: infer P }
    ? Omit<A, 'payload'> & { payload: Partial<P> }
    : never
  : never;
/** An event as a seat sees it: an attack attempt without its engine-internal `actionSeq`. */
export type SeatEvent = Exclude<EngineEvent, AttackAttempt> | SeatAttackAttempt;
/** A seat-safe copy of an `ActionRecord`, numbered within that seat's own feed. */
export type SeatActionRecord = Omit<ActionRecord, 'action' | 'events'> & {
  action: SeatAction;
  events: SeatEvent[];
};

/** An attack attempt without the global sequence, which counts records a seat may not see (§4.8). */
export function seatAttackAttempt(attempt: AttackAttempt): SeatAttackAttempt {
  const { kind, attackId, actorId, targetId, source, globalTurnNo } = attempt;
  return { kind, attackId, actorId, targetId, source, globalTurnNo };
}

/**
 * Whether `seatIndex` may see an event produced by applying an action to `before` (§4.1, §5.4).
 * A secret item's UID events are its owner's alone; a hostile item use is its user's and target's;
 * shuffle draws, which reveal deck order, are nobody's; a chance roll's die is its roller's.
 */
function visibleTo(before: GameState, event: EngineEvent, seatIndex: number): boolean {
  if (event.kind === 'random_result' && event.purpose.startsWith('shuffle:')) return false;
  const observerId = before.players.find((player) => player.seatIndex === seatIndex)?.actorId;
  if (event.kind === 'random_result' && event.purpose === 'event:e4:item') {
    return seatIndex === before.activeSeatIndex;
  }
  if (event.kind === 'item_gained') return event.ownerId === observerId;
  if (event.kind === 'random_result' && isHiddenChanceRoll(before, event.purpose, seatIndex)) {
    return false;
  }
  if (event.kind === 'hostile_item_used') {
    return event.userSeatIndex === seatIndex || event.targetSeatIndex === seatIndex;
  }
  // A chat message is its sender's and recipient's alone (§4.8, §5.4).
  if (event.kind === 'chat_sent') {
    return event.fromSeatIndex === seatIndex || event.toSeatIndex === seatIndex;
  }
  // A promise question and its answer are the two parties' alone (§4.8 Privacy).
  if (event.kind === 'promise_offered') {
    return event.initiatorSeatIndex === seatIndex || event.responderSeatIndex === seatIndex;
  }
  if (event.kind === 'promise_accepted' || event.kind === 'promise_rejected') {
    return event.promiserSeatIndex === seatIndex || event.recipientSeatIndex === seatIndex;
  }
  if (event.kind === 'attack_attempt') return attackVisibleTo(event, observerId);
  // A hostile Ability's use is its user's and target's, like a hostile item (D6, #37).
  if (event.kind === 'ability_activated' && ABILITY_EFFECTS[event.effect].hostile) {
    return event.ownerId === observerId || event.targetId === observerId;
  }
  if (event.kind === 'ball_gained') return event.ownerId === observerId;
  // A secret shield's arming shows others only the item-count change (D6).
  if (event.kind === 'shield_armed') {
    return event.visibility === 'public' || event.ownerId === observerId;
  }
  // A blocked hostile item/Ability is seen by its user and target; a blocked coin loss is public.
  if (
    event.kind === 'protection_applied' &&
    (event.source === 'hostile_item' || event.source === 'hostile_ability')
  ) {
    return event.actorId === observerId || event.targetId === observerId;
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

/** Lucky Splash's die reveals a private Ball gain, so only the rolling seat sees its face (§4.1). */
function isHiddenChanceRoll(before: GameState, purpose: string, seatIndex: number): boolean {
  return (
    before.phase.kind === 'chance_roll' &&
    purpose === pendingChanceRollPurpose(before) &&
    before.phase.seatIndex !== seatIndex
  );
}

/** PvP declarations are public; hostile item/Ability attempts are the actor's and target's (#37). */
export function attackVisibleTo(attempt: AttackAttempt, observerId: string | undefined): boolean {
  return (
    attempt.source === 'pvp_declaration' ||
    attempt.actorId === observerId ||
    attempt.targetId === observerId
  );
}

/** The events of one accepted action that `seatIndex` may see, in their original order. */
export function eventsVisibleTo(
  before: GameState,
  events: EngineEvent[],
  seatIndex: number,
): SeatEvent[] {
  if (!before.players.some((player) => player.seatIndex === seatIndex)) {
    throw new RangeError('Unknown seat index');
  }
  return structuredClone(events)
    .filter((event) => visibleTo(before, event, seatIndex))
    .map((event) => (event.kind === 'attack_attempt' ? seatAttackAttempt(event) : event));
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

export { publicRevision } from './revision.ts';

/**
 * Whether the record is a chat or promise question or answer this seat took no part in (§4.8). A seat
 * outside a conversation must not learn that it happened or whom it was with: in a three-seat game,
 * "a chat happened and it was not to me" names the recipient, and a `respond` names the responder by
 * its actor, so the record is absent from the seat's feed, not redacted.
 */
function hiddenRecord(before: GameState, record: ActionRecord, seatIndex: number): boolean {
  const { action } = record;
  const actor = before.players.find((player) => player.actorId === action.actorId);
  if (action.kind === 'chat' || action.kind === 'offer_promise') {
    return actor?.seatIndex !== seatIndex && action.payload.targetSeatIndex !== seatIndex;
  }
  if (action.kind === 'respond') {
    return (
      actor?.seatIndex !== seatIndex && before.pendingResponse?.initiatorSeatIndex !== seatIndex
    );
  }
  return false;
}

/**
 * A copy of one accepted record that `seatIndex` may see, or `null` when the seat must not know it
 * happened (a chat or promise between two other seats, §4.8). `before` is the state it was applied to and
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
  if (hiddenRecord(before, record, seatIndex)) return null;
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
  if (
    action.kind === 'activate_ability' &&
    actor?.seatIndex !== seatIndex &&
    action.payload.targetSeatIndex !== undefined &&
    action.payload.targetSeatIndex !== seatIndex
  ) {
    const pokemon = actor?.team.find((entry) => entry.instanceId === action.payload.instanceId);
    const effect = pokemon && abilityEffectOf(before, pokemon);
    if (effect && ABILITY_EFFECTS[effect].hostile) delete action.payload.targetSeatIndex;
  }
  // Deck order and the drawn card are nobody's until an effect makes them public (§4.6).
  if (action.kind === 'shuffle') delete action.payload.order;
  if (action.kind === 'event_draw') delete action.payload.eventId;
  if (
    action.kind === 'dice_result' &&
    action.payload.purpose !== undefined &&
    isHiddenChanceRoll(before, action.payload.purpose, seatIndex)
  ) {
    delete action.payload.value;
  }
  const copy: SeatActionRecord = { ...structuredClone(record), action, events };
  // Whether another seat's Social step had alternatives would tell whether it spent its chat (§4.8).
  if (
    before.phase.kind === 'social' &&
    before.config.socialWindow === true &&
    actor?.seatIndex !== seatIndex
  ) {
    delete copy.auto;
  }
  return copy;
}
