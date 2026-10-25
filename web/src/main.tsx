import '@fontsource/fredoka/latin-500.css';
import '@fontsource/fredoka/latin-600.css';
import '@fontsource/nunito/latin-400.css';
import '@fontsource/nunito/latin-700.css';
import '@fontsource/nunito/latin-800.css';
import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { ErrorBoundary } from './ErrorBoundary.tsx';
import { seedFromSearch } from './game/setup.ts';
import { t } from './i18n/en.ts';
import './index.css';

const FixtureRoute = lazy(() => import('./board/FixtureRoute.tsx'));
const fixtureName = new URLSearchParams(location.search).get('fixture');

document.title = t('app.title');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      {fixtureName === null ? (
        <App seed={seedFromSearch(location.search)} />
      ) : (
        <Suspense fallback={<p className="p-8">{t('play.heading')}</p>}>
          <FixtureRoute name={fixtureName} />
        </Suspense>
      )}
    </ErrorBoundary>
  </StrictMode>,
);
