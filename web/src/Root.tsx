import { lazy, Suspense } from 'react';
import { App } from './App.tsx';
import { ErrorBoundary } from './ErrorBoundary.tsx';
import { seedFromSearch } from './game/setup.ts';
import { t } from './i18n/en.ts';

const FixtureRoute = lazy(() => import('./board/FixtureRoute.tsx'));
// The gallery is a developer tool. Outside the dev server `__UI_GALLERY__` is the constant
// `false` (see web/vite.config.ts), so this branch and the whole gallery chunk are dropped:
// nothing in the player flow can reach it, and there is no URL to type.
const GalleryPage = __UI_GALLERY__ ? lazy(() => import('./gallery/GalleryRoute.tsx')) : null;

export function Root({ search, dev = __UI_GALLERY__ }: { search: string; dev?: boolean }) {
  const params = new URLSearchParams(search);
  const fixtureName = params.get('fixture');
  return (
    <ErrorBoundary>
      {dev && GalleryPage && params.has('gallery') ? (
        <Suspense fallback={<p className="p-8">{t('play.heading')}</p>}>
          <GalleryPage />
        </Suspense>
      ) : fixtureName === null ? (
        <App seed={seedFromSearch(search)} />
      ) : (
        <Suspense fallback={<p className="p-8">{t('play.heading')}</p>}>
          <FixtureRoute name={fixtureName} />
        </Suspense>
      )}
    </ErrorBoundary>
  );
}
