import { useState } from 'react';
import { t } from './i18n/th.ts';
import { ScreenPlaceholder } from './ScreenPlaceholder.tsx';
import { SCREENS, type Screen } from './screens.ts';

export function App() {
  const [screen, setScreen] = useState<Screen>('home');

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-line">
        <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center justify-between gap-x-8 gap-y-3 px-6 py-4">
          <p className="text-lg font-bold">{t('app.title')}</p>
          <nav aria-label={t('steps.label')}>
            <ol className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
              {SCREENS.map((step) => (
                <li
                  key={step}
                  aria-current={step === screen ? 'step' : undefined}
                  className={
                    step === screen
                      ? 'border-b-2 border-accent font-bold text-ink'
                      : 'border-b-2 border-transparent text-ink-soft'
                  }
                >
                  {t(`steps.${step}`)}
                </li>
              ))}
            </ol>
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-14 sm:py-20">
        <ScreenPlaceholder screen={screen} onNavigate={setScreen} />
      </main>
    </div>
  );
}
