import { useId } from 'react';
import type { SeatFeedEntry } from '../game/store.ts';
import { t } from '../i18n/en.ts';
import { latestEvent } from './eventCard.ts';
import { seatLabel, ownSeatOf, type ViewedObservation } from './labels.ts';
import { SpaceIcon } from './SpaceIcon.tsx';
import './event-card.css';

/**
 * The last Event card drawn, with the engine's own result (spec §4.6, §3.1). It stays until the
 * next draw, so a human's End step passing the turn on does not take it off the screen, and a
 * resumed save rebuilds it from the log. Only seat-visible records feed it: a rival's secret item
 * is told as "a reward", and no deck order or count reaches this component.
 */
export function EventCard({
  observation,
  feed,
}: {
  observation: ViewedObservation;
  feed: readonly SeatFeedEntry[];
}) {
  const headingId = useId();
  const event = latestEvent(feed, observation);
  if (!event) return null;
  return (
    <section className="event-card panel" aria-labelledby={headingId} data-event-id={event.eventId}>
      <div className="event-card-face">
        <span className="event-card-badge">
          <SpaceIcon kind="event" />
        </span>
        <div>
          <h2 id={headingId}>{t('event.card.heading')}</h2>
          <p className="event-card-text">{event.text}</p>
        </div>
      </div>
      {event.result && (
        <p className="event-card-result" data-message-key={event.result.key}>
          {event.result.text}
        </p>
      )}
      {event.reshuffled && (
        <p className="event-card-notice" data-message-key="event.deckReshuffled">
          {t('event.deckReshuffled')}
        </p>
      )}
      <p className="event-card-meta">
        {t('event.card.drawnBy', {
          name: seatLabel(event.seatIndex, ownSeatOf(observation)),
          turn: event.turn,
        })}
      </p>
    </section>
  );
}
