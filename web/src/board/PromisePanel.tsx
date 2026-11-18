import type { Observation } from '../../../engine/index.ts';
import {
  memoryEntries,
  pendingOffer,
  promiseRows,
  trustShown,
  type MemoryEntry,
  type PromiseRow,
} from '../game/promises.ts';
import type { SeatFeedEntry } from '../game/store.ts';
import { t } from '../i18n/en.ts';
import { possessive, seatLabel } from './labels.ts';
import './promise-panel.css';

/**
 * Promises and memory (spec §4.8): the promises the seat made or received with the engine's own
 * status and expiry, and the evidence the game recorded about them. It reads only the seat's own
 * observation and its seat-visible feed, so another seat's promise, trust or private result cannot
 * appear here, and nothing is shown that the engine has not recorded: a promise is "offered" until
 * the rival answers, and an outcome appears only when the engine closes the promise.
 */
export function PromisePanel({
  observation,
  feed,
}: {
  observation: Observation;
  feed: readonly SeatFeedEntry[];
}) {
  const own = observation.own.seatIndex;
  const name = (seatIndex: number) => seatLabel(seatIndex, own);
  const pending = pendingOffer(observation);
  const rows = promiseRows(observation).toReversed();
  const memory = memoryEntries(observation, feed);
  const trust = trustShown(observation);
  return (
    <section
      className="panel promise-panel"
      aria-labelledby="promise-panel-heading"
      data-testid="promise-panel"
    >
      <h2 id="promise-panel-heading">{t('promise.panel')}</h2>
      <h3>{t('promise.list')}</h3>
      {pending || rows.length > 0 ? (
        <ul className="promise-list">
          {pending && (
            <li data-promise-status="offered">
              <p>
                <strong>{t('promise.status.offered')}</strong>
              </p>
              <p>{t('promise.offeredRow', { rival: name(pending.rivalSeatIndex) })}</p>
            </li>
          )}
          {rows.map((row) => (
            <li key={`${row.promiserSeatIndex}>${row.recipientSeatIndex}@${row.createdTurn}`}>
              <PromiseItem row={row} own={own} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="panel-note">{t('promise.none')}</p>
      )}
      {rows.some((row) => row.status === 'active') && (
        <p className="panel-note">{t('promise.turnNote')}</p>
      )}
      {trust.length > 0 && (
        <>
          <h3>{t('promise.trustHeading')}</h3>
          <ul className="promise-trust">
            {trust.map((entry) => (
              <li key={entry.seatIndex} data-trust-seat={entry.seatIndex}>
                {t('promise.trust', { rival: name(entry.seatIndex), value: entry.value })}
              </li>
            ))}
          </ul>
        </>
      )}
      <h3>{t('promise.memory')}</h3>
      {memory.length > 0 ? (
        <ol className="promise-memory">
          {memory.map((entry) => (
            <li key={`${entry.kind}:${entry.record}`} data-memory={entry.kind}>
              <MemoryItem entry={entry} own={own} />
            </li>
          ))}
        </ol>
      ) : (
        <p className="panel-note" data-memory-empty>
          {t('promise.memory.empty')}
        </p>
      )}
    </section>
  );
}

function PromiseItem({ row, own }: { row: PromiseRow; own: number }) {
  return (
    <div data-promise-status={row.status}>
      <p>
        <strong>
          {t('promise.row', {
            promiser: seatLabel(row.promiserSeatIndex, own),
            recipient: seatLabel(row.recipientSeatIndex, own),
          })}
        </strong>{' '}
        <span className="promise-status">{t(`promise.status.${row.status}`)}</span>
      </p>
      <p>
        {row.status === 'active'
          ? t('promise.row.active', {
              created: row.createdTurn,
              whose: possessive(row.promiserSeatIndex, own),
              turn: row.closesOwnTurnNo,
            })
          : t('promise.row.closed', { created: row.createdTurn, closed: row.closedTurn! })}
      </p>
    </div>
  );
}

function MemoryItem({ entry, own }: { entry: MemoryEntry; own: number }) {
  const values = {
    promiser: seatLabel(entry.promiserSeatIndex, own),
    recipient: seatLabel(entry.recipientSeatIndex, own),
    turn: entry.turn,
  };
  return (
    <>
      <p>{t(`promise.memory.${entry.kind}`, values)}</p>
      {entry.kind === 'broken' && (
        <>
          <ul className="promise-evidence">
            {entry.evidence.map((attack) => (
              <li key={attack.attackId} data-attack={attack.attackId}>
                <span>
                  {t(`promise.evidence.${attack.source}`, {
                    actor: seatLabel(attack.actorSeatIndex, own),
                    target: seatLabel(attack.targetSeatIndex, own),
                    turn: attack.turn,
                  })}
                </span>{' '}
                <span className="promise-ref">
                  {t('promise.evidence.ref', { attackId: attack.attackId, record: attack.record })}
                </span>
              </li>
            ))}
          </ul>
          <p className="promise-ref">{t('promise.memory.settled', { turn: entry.settledTurn })}</p>
        </>
      )}
      <p className="promise-ref">{t('promise.memory.record', { record: entry.record })}</p>
    </>
  );
}
