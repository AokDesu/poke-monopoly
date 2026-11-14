import { ABILITY_EFFECTS, abilityEffectOf } from './abilities.ts';
import type {
  Action,
  ActionRecord,
  AttackAttempt,
  EngineEvent,
  GameState,
} from './contract/schema.ts';

/** An action whose payload may have fields this seat must not see removed. */
export type SeatAction = Action extends infer A
  ? A extends { payload: infer P }
    ? Omit<A, 'payload'> & { payload: Partial<P> }
    : never
  : never;
/** A seat-safe copy of an `ActionRecord`. */
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
  const observerId = before.players.find((player) => player.seatIndex === seatIndex)?.actorId;
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
): EngineEvent[] {
  if (!before.players.some((player) => player.seatIndex === seatIndex)) {
    throw new RangeError('Unknown seat index');
  }
  return structuredClone(events.filter((event) => visibleTo(before, event, seatIndex)));
}

/** A copy of one accepted record that `seatIndex` may see; `before` is the state it was applied to. */
export function actionVisibleTo(
  before: GameState,
  record: ActionRecord,
  seatIndex: number,
): SeatActionRecord {
  const events = eventsVisibleTo(before, record.events, seatIndex);
  const action: SeatAction = structuredClone(record.action);
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
  return { ...structuredClone(record), action, events };
}
