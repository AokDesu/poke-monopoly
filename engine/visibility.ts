import type { EngineEvent, GameState } from './contract/schema.ts';

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
