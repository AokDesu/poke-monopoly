import { useMemo } from 'react';
import { t } from '../i18n/en.ts';
import { galleryRows, PENDING_ROWS } from './catalog.tsx';
import type { GalleryFixtures } from './scenes.ts';
import '../board/turn-flow.css';
import '../board/decision-panels.css';
import './gallery.css';

/**
 * Developer-only page (issue #53): every spec §3.1 row that has a screen, shown once with the
 * real component and labelled with its spec row. It is reached only in a dev build with
 * `?gallery`; the production build leaves it out (see `Root.tsx`).
 */
export function GalleryPage({ fixtures }: { fixtures: GalleryFixtures }) {
  const rows = useMemo(() => galleryRows(fixtures), [fixtures]);
  return (
    <div className="app-playing gallery min-h-dvh" data-testid="ui-gallery">
      <main className="mx-auto w-full max-w-[1280px] px-5 py-8 sm:px-8">
        <h1 className="text-3xl font-bold sm:text-4xl">{t('gallery.title')}</h1>
        <p className="mt-3 max-w-[62ch] text-lg text-ink">{t('gallery.intro')}</p>
        {rows.map((row) => (
          <section
            key={row.id}
            className="gallery-row"
            aria-labelledby={`gallery-${row.id}`}
            data-gallery-row={row.id}
            data-spec-row={row.specRow ?? 'ai-turns'}
          >
            <header className="gallery-row-head">
              <h2 id={`gallery-${row.id}`}>{t(row.label)}</h2>
              <p className="gallery-spec">
                {row.specRow === null
                  ? t('gallery.specAiTurns')
                  : t('gallery.specRow', { row: row.specRow })}
              </p>
            </header>
            <div className="gallery-examples">
              {row.examples.map((example) => (
                <div key={example.id} className="gallery-example" data-example={example.id}>
                  <p className="gallery-caption">{t(example.caption)}</p>
                  {example.render()}
                </div>
              ))}
            </div>
          </section>
        ))}
        <section className="gallery-row" aria-labelledby="gallery-pending">
          <header className="gallery-row-head">
            <h2 id="gallery-pending">{t('gallery.pendingHeading')}</h2>
          </header>
          <p className="gallery-pending-intro">{t('gallery.pendingIntro')}</p>
          <ul className="gallery-pending">
            {PENDING_ROWS.map((row) => (
              <li key={row.specRow} data-spec-row={row.specRow}>
                <strong>{t(row.label)}</strong>
                <span className="gallery-spec">{t('gallery.specRow', { row: row.specRow })}</span>
                <span>{t(row.reason)}</span>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </div>
  );
}
