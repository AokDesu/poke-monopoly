import type { SeatEvent } from '../../../engine/index.ts';
import type { SeatFeedEntry } from '../game/store.ts';
import { content } from '../game/content.ts';
import { t, type MessageKey } from '../i18n/en.ts';
import { itemName, speciesName } from '../i18n/names.ts';
import { ownSeatOf, seatLabel, type ViewedObservation } from './labels.ts';

/**
 * Presentation of the Event deck (spec §4.6, engine contract #162). Everything here reads the
 * seat-filtered records and the public observation; the browser never draws, orders or counts a
 * card itself, and the deck order is not in any record a seat can read.
 */

type Resolved = Extract<SeatEvent, { kind: 'event_resolved' }>;

export interface EventMessage {
  key: MessageKey;
  text: string;
}

/** The card's printed text from `content/events.json`, as a sentence (no code markup). */
export function eventCardText(eventId: string): string {
  const text = content.events.find((card) => card.id === eventId)?.text.replaceAll('`', '') ?? '';
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const coins = (amount: number) =>
  amount === 1 ? t('event.coinOne') : t('event.coins', { amount });

/**
 * The engine's result for one drawn card, in words. `entryEvents` are the other records of the
 * same accepted action: only the recipient's own copy of them names a secret reward.
 */
export function eventResultMessage(
  observation: ViewedObservation,
  resolved: Resolved,
  entryEvents: readonly SeatEvent[],
): EventMessage {
  const own = ownSeatOf(observation);
  const name = seatLabel(resolved.seatIndex, own);
  const { result } = resolved;
  const message = (key: MessageKey, values?: Record<string, string | number>) => ({
    key,
    text: t(key, values),
  });
  switch (result.kind) {
    case 'encounter':
      return message('event.result.encounter', { name, pokemon: speciesName(result.speciesId) });
    case 'coins': {
      const [first] = result.transfers;
      if (!first || result.transfers.every((transfer) => transfer.amount === 0)) {
        return message('event.result.coinsNone');
      }
      if (first.amount < 0) {
        return message('event.result.pay', { name, coins: coins(-first.amount) });
      }
      return message('event.result.gain', {
        names: result.transfers.map(({ seatIndex }) => seatLabel(seatIndex, own)).join(', '),
        coins: coins(first.amount),
      });
    }
    case 'tired': {
      const pokemon = observation.public.players
        .flatMap((player) => player.team)
        .find((member) => member.instanceId === result.instanceId);
      return pokemon
        ? message('event.result.tired', { name, pokemon: speciesName(pokemon.speciesId) })
        : message('event.result.tiredNone', { name });
    }
    case 'item': {
      const item = entryEvents.find((event) => event.kind === 'item_gained');
      if (item) {
        return message('event.result.itemOwn', { name, item: itemName(item.item.itemId) });
      }
      return entryEvents.some((event) => event.kind === 'ball_gained')
        ? message('event.result.ballOwn', { name })
        : message('event.result.rewardOther', { name });
    }
  }
}

/** True for every `event_deck_shuffled` after the game's first fill (§3.1: "Event deck runs out"). */
export function reshuffledIn(feed: readonly SeatFeedEntry[], index: number): boolean {
  const filledBefore = feed
    .slice(0, index)
    .some(({ record }) => record.events.some((event) => event.kind === 'event_deck_shuffled'));
  return filledBefore && feed[index]!.record.events.some((e) => e.kind === 'event_deck_shuffled');
}

export interface DrawnEvent {
  seatIndex: number;
  turn: number;
  eventId: string;
  text: string;
  /** The deck had run out, so the discard pile was shuffled back in for this draw. */
  reshuffled: boolean;
  result: EventMessage | null;
}

/** The most recent card drawn in the feed, so it stays on screen after the turn moves on. */
export function latestEvent(
  feed: readonly SeatFeedEntry[],
  observation: ViewedObservation,
): DrawnEvent | null {
  const index = feed.findLastIndex(({ record }) =>
    record.events.some((event) => event.kind === 'event_drawn'),
  );
  if (index < 0) return null;
  const { before, record } = feed[index]!;
  const drawn = record.events.find((event) => event.kind === 'event_drawn')!;
  const resolved = record.events.find((event) => event.kind === 'event_resolved');
  return {
    seatIndex: drawn.seatIndex,
    turn: before.globalTurnNo,
    eventId: drawn.eventId,
    text: eventCardText(drawn.eventId),
    reshuffled: reshuffledIn(feed, index),
    result: resolved ? eventResultMessage(observation, resolved, record.events) : null,
  };
}
