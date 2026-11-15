import { observe } from './contract/stubs.ts';
import type { ActionRecord, EngineEvent, GameState, Observation } from './contract/schema.ts';
import { publicRevision, type SeatAction, type SeatActionRecord } from './visibility.ts';

/** What a watcher with no seat sees: the public half of an observation (§4.1). */
export type SpectatorObservation = { public: Observation['public'] };

/**
 * The public view of a game, for a watcher who holds no seat (§4.1). It is the public part every
 * seat sees, so it can never show more than a seat does; the Ball pouches, secret items, peek
 * results and chats of `own` are never read. Its revision counts the records the spectator's
 * feed holds, the same count `publicRevision` gives, so a chat leaves no gap.
 */
export function observeSpectator(state: GameState): SpectatorObservation {
  const { public: view } = observe(state, state.players[0]!.seatIndex);
  return { public: { ...view, stateRevision: publicRevision(state) } };
}

function isPublicItem(before: GameState, instanceId: string): boolean {
  return before.players.some((player) =>
    player.items.some((item) => item.instanceId === instanceId && item.visibility === 'public'),
  );
}

/**
 * Only what every seat may see, and nothing a pair of seats shares: a hostile item use and a chat
 * are private even in a two-seat game, where both seats are party to them. Any kind not listed
 * here is hidden, so a new event stays secret until it is deliberately made public.
 */
function publicEvent(before: GameState, event: EngineEvent): boolean {
  switch (event.kind) {
    case 'random_result':
      return !event.purpose.startsWith('shuffle:');
    case 'uid_created':
      return event.entity !== 'item';
    case 'uid_destroyed':
      return event.entity !== 'item' || isPublicItem(before, event.instanceId);
    case 'pokemon_evolved':
    case 'battle_reward_resolved':
    case 'status_changed':
    case 'coin_transfer':
    case 'space_resolved':
    case 'phase_changed':
    case 'final_table_round':
      return true;
    default:
      return false;
  }
}

/** The events of one accepted action a spectator may see, in order; `before` is the state it was applied to. */
export function eventsVisibleToSpectator(before: GameState, events: EngineEvent[]): EngineEvent[] {
  return structuredClone(events.filter((event) => publicEvent(before, event)));
}

/**
 * A copy of one accepted record for a spectator's feed, or `null` for a chat, which must not be
 * known to have happened (§4.8). `shownBefore` is how many records the feed holds; the copy is
 * numbered after them, so a hidden record leaves no gap. A spectator is nobody's buyer, user or
 * target, so every field a seat only sees for itself is dropped (as `actionVisibleTo` does for others).
 */
export function actionVisibleToSpectator(
  before: GameState,
  record: ActionRecord,
  shownBefore: number,
): SeatActionRecord | null {
  if (record.action.kind === 'chat') return null;
  const action: SeatAction = structuredClone(record.action);
  action.actionSeq = shownBefore + 1;
  action.stateRevisionBefore = shownBefore;
  if (action.kind === 'buy') delete action.payload.offerId;
  if (action.kind === 'use_item') {
    if (!isPublicItem(before, action.payload.itemInstanceId ?? '')) {
      delete action.payload.itemInstanceId;
    }
    delete action.payload.targetSeatIndex;
  }
  if (action.kind === 'shuffle') delete action.payload.order;
  if (action.kind === 'event_draw') delete action.payload.eventId;
  const copy: SeatActionRecord = {
    ...structuredClone(record),
    action,
    events: eventsVisibleToSpectator(before, record.events),
  };
  // Whether a Social step had alternatives would tell whether its seat spent a chat (§4.8).
  if (before.phase.kind === 'social' && before.config.socialWindow === true) delete copy.auto;
  return copy;
}
