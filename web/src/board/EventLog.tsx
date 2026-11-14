import type { EngineEvent, Observation } from '../../../engine/index.ts';
import type { SeatFeedEntry } from '../game/store.ts';
import { t, type MessageKey } from '../i18n/en.ts';
import { itemName } from '../i18n/names.ts';
import { phaseLabel, playerLabel, reasonLabel, seatLabel } from './labels.ts';
import { turnMessages } from './turnMessages.ts';

function eventMessage(
  event: EngineEvent,
  observation: Observation,
): { key: MessageKey; text: string }[] {
  const seat = (index: number) => seatLabel(index, observation.own.seatIndex);
  const message = (key: MessageKey, values?: Record<string, string | number>) => [
    { key, text: t(key, values) },
  ];
  switch (event.kind) {
    // Spec §5.7: persisted dialogue annotations are not gameplay announcements.
    // Status/evolution/reward records remain in the feed; dedicated UI is a later slice.
    case 'status_changed':
    case 'pokemon_evolved':
    case 'battle_reward_resolved':
    case 'line_selected':
      return [];
    // Chat has its own screen (#57); the flag keeping the Social window closed is off until then.
    case 'chat_sent':
      return [];
    case 'random_result':
      if (event.purpose.startsWith('line:')) return [];
      // Strings/arrays may be internal draw IDs or deck order in historical fixtures. Never dump them.
      return typeof event.result === 'number' &&
        /^(first-player:|move:|catch:|movement$)/.test(event.purpose)
        ? message('board.event.randomRoll', { result: event.result })
        : message('board.event.randomDraw');
    case 'coin_transfer': {
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
      return message(event.effect === 'none_yet' ? 'board.event.noneYet' : 'board.event.space', {
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
  events: readonly EngineEvent[];
  observation: Observation;
  feed?: readonly SeatFeedEntry[];
}) {
  const rows = feed
    ? feed.flatMap((entry) => [
        ...turnMessages(entry),
        ...entry.record.events.flatMap((event) => eventMessage(event, observation)),
      ])
    : events.flatMap((event) => eventMessage(event, observation));
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
