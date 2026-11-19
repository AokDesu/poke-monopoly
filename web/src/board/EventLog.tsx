import type { SeatEvent } from '../../../engine/index.ts';
import { squareOf } from '../game/content.ts';
import type { SeatFeedEntry } from '../game/store.ts';
import { t, type MessageKey } from '../i18n/en.ts';
import { itemName } from '../i18n/names.ts';
import { ownSeatOf, phaseLabel, playerLabel, reasonLabel, seatLabel } from './labels.ts';
import type { ViewedObservation } from './labels.ts';
import { battleEventMessages } from './battleMessages.ts';
import { eventCardText, eventResultMessage } from './eventCard.ts';
import { turnMessages } from './turnMessages.ts';

/**
 * One seat-filtered event in words. `entryEvents`: the records of the same accepted action;
 * `reshuffled`: a deck refill after the first; `before`: the public phase its record was applied in.
 */
export function eventMessage(
  event: SeatEvent,
  observation: ViewedObservation,
  entryEvents: readonly SeatEvent[],
  reshuffled: boolean,
  before?: SeatFeedEntry['before'],
): { key: MessageKey; text: string }[] {
  const seat = (index: number) => seatLabel(index, ownSeatOf(observation));
  const message = (key: MessageKey, values?: Record<string, string | number>) => [
    { key, text: t(key, values) },
  ];
  switch (event.kind) {
    // Battle, Gym, protection, Ability, status and evolution events are announced in words.
    case 'attack_attempt':
    case 'shield_armed':
    case 'protection_applied':
    case 'ability_activated':
    case 'abilities_reset':
    case 'gym_confirmed':
    case 'gym_resolved':
    case 'badge_awarded':
    case 'pvp_response':
    case 'pvp_confirmed':
    case 'pvp_resolved':
    case 'status_changed':
    case 'pokemon_evolved':
    case 'battle_reward_resolved':
      return battleEventMessages(event, observation, before);
    // Spec §5.7: persisted dialogue annotations are not gameplay announcements.
    // An Event reward's identity is told by `event_resolved`, from the recipient's own copy.
    case 'item_gained':
    case 'line_selected':
      return [];
    case 'player_displaced':
      return message('board.event.displaced', {
        target: playerLabel(observation, event.targetId),
        position: squareOf(event.to),
      });
    // Told to the owner alone (§4.1): a Lucky Splash hit shows in no other seat's log.
    case 'ball_gained':
      return message('board.event.ballGained', {
        owner: playerLabel(observation, event.ownerId),
        ball: t(`board.ball.${event.ballType}`),
      });
    // A chat is private to its two seats and shown in the Social window (#137), not in the shared field log.
    case 'chat_sent':
    case 'promise_offered':
    case 'promise_accepted':
    case 'promise_rejected':
    case 'promise_closed':
      return [];
    case 'event_deck_shuffled':
      return message(reshuffled ? 'event.deckReshuffled' : 'board.event.deckShuffled');
    case 'event_drawn':
      return message('board.event.eventDrawn', {
        name: seat(event.seatIndex),
        text: eventCardText(event.eventId),
      });
    case 'event_resolved':
      return [eventResultMessage(observation, event, entryEvents, before?.pokemon)];
    case 'random_result':
      if (event.purpose.startsWith('line:')) return [];
      // Strings/arrays may be internal draw IDs or deck order in historical fixtures. Never dump them.
      return typeof event.result === 'number' &&
        /^(first-player:|move:|catch:|movement$|pvp:|gym:)/.test(event.purpose)
        ? message('board.event.randomRoll', { result: event.result })
        : message('board.event.randomDraw');
    case 'coin_transfer': {
      // The Event's own result row already says who gained or paid what.
      if (event.reason.startsWith('event:')) return [];
      const endpoint = (value: typeof event.source) =>
        value.kind === 'bank' ? t('board.event.bank') : playerLabel(observation, value.actorId);
      return message('board.event.coins', {
        source: endpoint(event.source),
        destination: endpoint(event.destination),
        amount: event.amount,
        reason: reasonLabel(event.reason),
      });
    }
    case 'uid_created':
      return message(
        event.entity === 'pokemon' ? 'board.event.pokemonCreated' : 'board.event.itemCreated',
        { owner: playerLabel(observation, event.ownerId) },
      );
    case 'uid_destroyed':
      return message(
        event.entity === 'pokemon' ? 'board.event.pokemonDestroyed' : 'board.event.itemDestroyed',
      );
    case 'space_resolved': {
      const square = observation.public.board.find((space) => space.position === event.position)!;
      return message('board.event.space', {
        name: seat(event.seatIndex),
        position: event.position,
        kind: t(`board.kind.${square.kind}`),
      });
    }
    case 'phase_changed':
      return message('board.event.phase', {
        from: phaseLabel(event.from),
        to: phaseLabel(event.to),
      });
    case 'hostile_item_used':
      return message('board.event.hostileItem', {
        user: seat(event.userSeatIndex),
        item: itemName(event.itemId),
        target: seat(event.targetSeatIndex),
      });
    case 'final_table_round':
      return message('board.event.finalRound', { name: seat(event.triggerSeatIndex) });
  }
}

export function EventLog({
  events,
  observation,
  feed,
}: {
  events: readonly SeatEvent[];
  observation: ViewedObservation;
  feed?: readonly SeatFeedEntry[];
}) {
  // The first `event_deck_shuffled` of a game fills the deck; every later one is the deck running out.
  let fills = 0;
  const announce = (list: readonly SeatEvent[], before?: SeatFeedEntry['before']) =>
    list.flatMap((event) =>
      eventMessage(
        event,
        observation,
        list,
        event.kind === 'event_deck_shuffled' && fills++ > 0,
        before,
      ),
    );
  const rows = feed
    ? feed.flatMap((entry) => [
        ...turnMessages(entry, ownSeatOf(observation)),
        ...announce(entry.record.events, entry.before),
      ])
    : announce(events);
  return (
    <section className="panel field-log" aria-labelledby="field-log-heading">
      <h2 id="field-log-heading">{t('board.log')}</h2>
      {rows.length === 0 ? (
        <p className="panel-note">{t('board.logEmpty')}</p>
      ) : (
        <ol role="log" aria-label={t('board.log')} aria-relevant="additions text">
          {rows.map((message, index) => {
            return (
              <li key={index} data-message-key={message.key}>
                <span className="log-marker" aria-hidden="true" />
                <p>{message.text}</p>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
