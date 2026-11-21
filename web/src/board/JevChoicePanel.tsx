import { useId, type CSSProperties } from 'react';
import type { SeatFeedEntry, SeatView } from '../game/store.ts';
import { modelNumber, type DemoChoice } from '../game/demoChoice.ts';
import { t } from '../i18n/en.ts';
import { fallbackReasonText } from './AiTurn.tsx';
import { phaseLabel, seatLabel } from './labels.ts';
import { turnMessages } from './turnMessages.ts';

export interface JevChoice {
  readonly entry: SeatFeedEntry;
  readonly choice: DemoChoice;
  /** The game's own record of what followed, in the words of the field log. */
  readonly results: readonly string[];
}

/**
 * The newest rival decision that carries panel data, with what the engine recorded for it. Only
 * a store in demo mode ever puts data in the feed, so outside demo mode this is always undefined.
 * The human seat's own decisions are never a rival's: they are skipped here too.
 */
export function latestJevChoice(view: SeatView): JevChoice | undefined {
  const index = view.feed.findLastIndex(
    ({ before, decision }) =>
      decision?.demo !== undefined && before.activeSeatIndex !== view.seatIndex,
  );
  if (index < 0) return undefined;
  const entry = view.feed[index]!;
  const results = [
    ...turnMessages(entry, view.seatIndex).filter(
      ({ key }) => key.startsWith('ai.action.') && key !== 'ai.action.move',
    ),
    // A catch resolves in the engine's own next record (the die), still on this rival's turn.
    ...view.feed
      .slice(index + 1)
      .filter(
        (later) => later.before.activeSeatIndex === entry.before.activeSeatIndex && !later.decision,
      )
      .flatMap((later) => turnMessages(later, view.seatIndex))
      .filter(({ key }) => key.startsWith('ai.result.')),
  ].map(({ text }) => text);
  return { entry, choice: entry.decision!.demo!, results };
}

/**
 * The demo-only "What Jev chose" panel (spec §3 AI turns, §11 step 3, issues #220 and #247). It
 * computes no number: each one is Jev's, only rounded for display and labelled as model output,
 * not a measured rate. Its banner is shown whenever the panel is, because the options are a
 * rival's private ones (spec §1).
 */
export function JevChoicePanel({ view }: { view: SeatView }) {
  const headingId = useId();
  const shown = latestJevChoice(view);
  if (!shown) return null;
  const { entry, choice, results } = shown;
  return (
    <section className="jev-panel" aria-labelledby={headingId} data-source={choice.source}>
      <p className="jev-banner" role="note">
        {t('demo.banner')}
      </p>
      <h3 id={headingId}>{t('demo.heading')}</h3>
      <p className="jev-decision">
        {t('demo.decision', {
          name: seatLabel(entry.before.activeSeatIndex, view.seatIndex),
          phase: phaseLabel(entry.before.phase.kind),
        })}
      </p>
      {choice.source === 'jev' ? (
        <>
          <table className="jev-options">
            <caption className="sr-only">{t('demo.options')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('demo.col.option')}</th>
                <th scope="col">{t('demo.col.probability')}</th>
              </tr>
            </thead>
            <tbody>
              {choice.rows.map((row) => (
                <tr key={row.id} data-chosen={row.chosen}>
                  <th scope="row">
                    <span>{row.label}</span>
                    {row.chosen && <strong className="jev-chosen">{t('demo.chosen')}</strong>}
                  </th>
                  <td>
                    <span className="jev-number">{modelNumber(row.probability)}</span>
                    <span
                      className="jev-bar"
                      aria-hidden="true"
                      style={{ '--p': row.probability } as CSSProperties}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="jev-summary">
            <span>{t('demo.byJev')}</span>
            {choice.confidence !== undefined && (
              <strong>{t('demo.confidence', { value: modelNumber(choice.confidence) })}</strong>
            )}
          </p>
          <p className="jev-note">{t('demo.modelNote')}</p>
          {choice.perPokemon && <p className="jev-note">{t('demo.sellNote')}</p>}
        </>
      ) : (
        <>
          <p>{t('demo.byBackup')}</p>
          <p className="jev-note">{fallbackReasonText(choice.fallbackReason)}</p>
        </>
      )}
      {results.length > 0 && (
        <div className="jev-result">
          <p className="jev-result-heading">{t('demo.result')}</p>
          <ul>
            {results.map((text, index) => (
              <li key={index}>{text}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
