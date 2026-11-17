import type { SeatFeedEntry } from './store.ts';

/** How one AI's accepted decisions were made: by Jev, by the backup bot, or not recorded. */
export interface DecisionTally {
  readonly jev: number;
  readonly backup: number;
  /** Decisions made before the game was resumed from a save: the save keeps the log, not who decided. */
  readonly unrecorded: number;
}

/**
 * Counts each seat's own decisions in the feed the viewer may see. A step the engine applied
 * (a die roll, the only legal action) is not a decision; every other accepted action by a seat is.
 * Only the counts of records are read, never their contents.
 */
export function decisionTally(feed: readonly SeatFeedEntry[]): ReadonlyMap<number, DecisionTally> {
  const tally = new Map<number, { jev: number; backup: number; unrecorded: number }>();
  for (const { before, record, decision } of feed) {
    if (record.action.actorId === 'engine' || record.auto) continue;
    const seat = tally.get(before.activeSeatIndex) ?? { jev: 0, backup: 0, unrecorded: 0 };
    if (decision?.source === 'jev') seat.jev++;
    else if (decision?.source === 'fallback') seat.backup++;
    else seat.unrecorded++;
    tally.set(before.activeSeatIndex, seat);
  }
  return tally;
}
