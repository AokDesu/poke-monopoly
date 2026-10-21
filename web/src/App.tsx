import { useState } from 'react';
import { classOptions, content as gameContent } from './game/content.ts';
import { opponentFor, randomSetup, type ModeId, type SetupDraft } from './game/setup.ts';
import { createGameStore, MODES, type GameStore } from './game/store.ts';
import { t } from './i18n/th.ts';
import { ScreenPlaceholder } from './ScreenPlaceholder.tsx';
import { SCREENS, type Route } from './screens.ts';
import { ClassScreen } from './setup/ClassScreen.tsx';
import { HomeScreen } from './setup/HomeScreen.tsx';
import { ModeScreen } from './setup/ModeScreen.tsx';
import { Button } from './ui/Button.tsx';
import { FocusHeadingContext, Screen } from './ui/Screen.tsx';

export interface AppProps {
  /** Test-only fixed game seed from `?seed=`; never shown to players. */
  seed?: number | string;
  /** Random All's source of choices. */
  random?: () => number;
  store?: GameStore;
}

const OPEN_MODES = (Object.keys(MODES) as ModeId[]).filter((mode) => MODES[mode].enabled);

export function App({ random = Math.random, store: givenStore }: AppProps) {
  const [store] = useState(() => givenStore ?? createGameStore());
  const [route, setRoute] = useState<Route>({ screen: 'home' });
  const [draft, setDraft] = useState<SetupDraft>({});
  const [navigated, setNavigated] = useState(false);
  void store;

  const go = (next: Route) => {
    setNavigated(true);
    setRoute(next);
  };
  const canStart = randomSetup(classOptions, OPEN_MODES, () => 0) !== undefined;

  let screen;
  switch (route.screen) {
    case 'home':
      screen = (
        <HomeScreen
          board={gameContent.board}
          canStart={canStart}
          onNewGame={() => go({ screen: 'setup', step: 'mode' })}
          onRandomAll={() => {
            const setup = randomSetup(classOptions, OPEN_MODES, random);
            if (!setup) return;
            setDraft({ mode: setup.mode, human: setup.human, opponent: setup.opponents[0] });
            go({ screen: 'setup', step: 'review' });
          }}
        />
      );
      break;
    case 'setup':
      switch (route.step) {
        case 'mode':
          screen = (
            <ModeScreen
              onChoose={(mode) => {
                setDraft({ ...draft, mode });
                go({ screen: 'setup', step: 'class' });
              }}
              onBack={() => go({ screen: 'home' })}
            />
          );
          break;
        case 'class':
          screen = (
            <ClassScreen
              classes={classOptions}
              chosen={draft.human}
              onChoose={(human) => {
                setDraft({
                  ...draft,
                  human,
                  opponent: opponentFor(classOptions, human, draft.opponent),
                });
                go({ screen: 'setup', step: 'opponents' });
              }}
              onBack={() => go({ screen: 'setup', step: 'mode' })}
            />
          );
          break;
        default:
          screen = (
            <Screen
              heading={t('opponents.heading')}
              actions={
                <Button variant="secondary" onClick={() => go({ screen: 'setup', step: 'class' })}>
                  {t('nav.back')}
                </Button>
              }
            />
          );
      }
      break;
    default:
      screen = (
        <ScreenPlaceholder screen={route.screen} onNavigate={(next) => go({ screen: next })} />
      );
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="bg-accent text-on-accent">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-x-8 gap-y-3 px-5 py-4 sm:px-8">
          <p className="text-lg font-bold tracking-[-0.01em]">{t('app.title')}</p>
          <nav aria-label={t('steps.label')}>
            <ol className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
              {SCREENS.map((step) => (
                <li
                  key={step}
                  aria-current={step === route.screen ? 'step' : undefined}
                  className={
                    step === route.screen
                      ? 'border-b-2 border-serial font-bold text-on-accent'
                      : 'border-b-2 border-transparent text-on-accent-soft'
                  }
                >
                  {t(`steps.${step}`)}
                </li>
              ))}
            </ol>
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-5 py-10 sm:px-8 sm:py-16">
        <FocusHeadingContext value={navigated}>
          <div key={route.screen === 'setup' ? route.step : route.screen}>{screen}</div>
        </FocusHeadingContext>
      </main>
    </div>
  );
}
