import { useState } from 'react';
import { classOptions, content as gameContent } from './game/content.ts';
import { MODEL_CREDITS } from './game/models.ts';
import { opponentFor, randomSetup, type ModeId, type SetupDraft } from './game/setup.ts';
import { createGameStore, MODES, type GameStore } from './game/store.ts';
import { t } from './i18n/th.ts';
import { ScreenPlaceholder } from './ScreenPlaceholder.tsx';
import type { Route } from './screens.ts';
import { ClassScreen } from './setup/ClassScreen.tsx';
import { HomeScreen } from './setup/HomeScreen.tsx';
import { ModeScreen } from './setup/ModeScreen.tsx';
import { Button } from './ui/Button.tsx';
import { BallIcon } from './ui/icons.tsx';
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
              onSelect={(human) =>
                setDraft({
                  ...draft,
                  human,
                  opponent: opponentFor(classOptions, human, draft.opponent),
                })
              }
              onNext={() => go({ screen: 'setup', step: 'opponents' })}
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
      {route.screen !== 'home' && (
        <header className="mx-auto flex w-full max-w-6xl items-center gap-3 px-5 pt-5 sm:px-8">
          <BallIcon className="size-9 drop-shadow-[0_3px_0_rgb(16_38_84/0.35)]" />
          <p className="title-3d text-2xl">{t('app.title')}</p>
        </header>
      )}
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col justify-center px-5 py-8 sm:px-8 sm:py-12">
        <FocusHeadingContext value={navigated}>
          <div key={route.screen === 'setup' ? route.step : route.screen}>{screen}</div>
        </FocusHeadingContext>
      </main>
      <footer className="mx-auto w-full max-w-6xl px-5 pb-6 text-xs text-ink sm:px-8">
        <p>
          {t('credits.models')}:{' '}
          {MODEL_CREDITS.map((credit, index) => (
            <span key={credit.file}>
              {index > 0 && ' · '}
              <a className="underline underline-offset-2" href={credit.source}>
                {credit.title}
              </a>{' '}
              {t('credits.by')} {credit.author} ({credit.licence})
            </span>
          ))}
        </p>
      </footer>
    </div>
  );
}
