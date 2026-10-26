import { useState } from 'react';
import { BoardScreen } from './board/BoardScreen.tsx';
import { CreditsScreen } from './CreditsScreen.tsx';
import { classOptions, content as gameContent, engineContent } from './game/content.ts';
import { rollForFirstPlayer } from './game/firstPlayer.ts';
import {
  completeSetup,
  freshSeed,
  opponentFor,
  randomSetup,
  type ModeId,
  type SetupDraft,
} from './game/setup.ts';
import {
  configForSetup,
  createGameStore,
  MODES,
  opponentSettings,
  type GameStore,
} from './game/store.ts';
import { t } from './i18n/en.ts';
import { ScreenPlaceholder } from './ScreenPlaceholder.tsx';
import type { Route } from './screens.ts';
import { ClassScreen } from './setup/ClassScreen.tsx';
import { FirstPlayerScreen } from './setup/FirstPlayerScreen.tsx';
import { HomeScreen } from './setup/HomeScreen.tsx';
import { ModeScreen } from './setup/ModeScreen.tsx';
import { OpponentScreen } from './setup/OpponentScreen.tsx';
import { ReviewScreen } from './setup/ReviewScreen.tsx';
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
const HOME: Route = { screen: 'home' };

export function App({ seed, random = Math.random, store: givenStore }: AppProps) {
  const [store] = useState(() => givenStore ?? createGameStore());
  const [route, setRoute] = useState<Route>(HOME);
  const [creditsFrom, setCreditsFrom] = useState<Route>(HOME);
  const [draft, setDraft] = useState<SetupDraft>({});
  const [startFailed, setStartFailed] = useState(false);
  const [navigated, setNavigated] = useState(false);

  const go = (next: Route) => {
    setNavigated(true);
    setStartFailed(false);
    setRoute(next);
  };
  const canStart = randomSetup(classOptions, OPEN_MODES, () => 0) !== undefined;
  const setup = completeSetup(draft);

  let screen;
  switch (route.screen) {
    case 'home':
      screen = (
        <HomeScreen
          board={gameContent.board}
          canStart={canStart}
          onNewGame={() => go({ screen: 'setup', step: 'mode' })}
          onRandomAll={() => {
            const picked = randomSetup(classOptions, OPEN_MODES, random);
            if (!picked) return;
            setDraft({ mode: picked.mode, human: picked.human, opponent: picked.opponents[0] });
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
              onBack={() => go(HOME)}
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
        case 'opponents':
          screen = draft.human ? (
            <OpponentScreen
              classes={classOptions}
              human={draft.human}
              opponent={draft.opponent}
              onChange={(opponent) => setDraft({ ...draft, opponent })}
              onNext={() => go({ screen: 'setup', step: 'review' })}
              onBack={() => go({ screen: 'setup', step: 'class' })}
            />
          ) : (
            <MissingStep onHome={() => go(HOME)} />
          );
          break;
        case 'review':
          screen = setup ? (
            <ReviewScreen
              setup={setup}
              failed={startFailed}
              onBack={() => go({ screen: 'setup', step: 'opponents' })}
              onRoll={() => {
                try {
                  store.start(
                    configForSetup(setup, seed ?? freshSeed()),
                    engineContent,
                    opponentSettings(setup),
                  );
                  rollForFirstPlayer(store);
                  go({ screen: 'setup', step: 'firstPlayer' });
                } catch {
                  // The engine re-checks every setup (createGame); say so instead of going blank.
                  store.clear();
                  setStartFailed(true);
                }
              }}
            />
          ) : (
            <MissingStep onHome={() => go(HOME)} />
          );
          break;
        case 'firstPlayer':
          screen = (
            <FirstPlayerScreen
              store={store}
              onToBoard={() => go({ screen: 'play' })}
              onQuit={() => {
                store.clear();
                go(HOME);
              }}
            />
          );
          break;
      }
      break;
    case 'play':
      screen = (
        <BoardScreen
          store={store}
          onHome={() => {
            store.clear();
            go(HOME);
          }}
        />
      );
      break;
    case 'credits':
      screen = <CreditsScreen onBack={() => go(creditsFrom)} />;
      break;
    default:
      screen = <ScreenPlaceholder onNavigate={(next) => go({ screen: next })} />;
  }

  return (
    <div className={`flex min-h-dvh flex-col ${route.screen === 'play' ? 'app-playing' : ''}`}>
      {route.screen !== 'home' && (
        <header className="mx-auto flex w-full max-w-6xl items-center gap-3 px-5 pt-5 sm:px-8">
          <BallIcon className="size-9 drop-shadow-[0_3px_0_rgb(16_38_84/0.35)]" />
          <p className="title-3d text-2xl">{t('app.title')}</p>
        </header>
      )}
      <main
        className={`mx-auto flex w-full max-w-6xl flex-1 flex-col px-5 py-8 sm:px-8 sm:py-12 ${
          route.screen === 'home' ? 'justify-center' : ''
        }`}
      >
        <FocusHeadingContext value={navigated}>
          <div key={route.screen === 'setup' ? route.step : route.screen}>{screen}</div>
        </FocusHeadingContext>
      </main>
      {route.screen !== 'credits' && (
        <footer className="mx-auto w-full max-w-6xl px-5 pb-6 text-sm sm:px-8">
          <button
            type="button"
            className="font-bold underline underline-offset-4"
            onClick={() => {
              setCreditsFrom(route);
              go({ screen: 'credits' });
            }}
          >
            {t('credits.link')}
          </button>
        </footer>
      )}
    </div>
  );
}

/** A setup step reached without its earlier answers (never through the UI): a way back home. */
function MissingStep({ onHome }: { onHome: () => void }) {
  return (
    <Screen
      heading={t('setup.missingHeading')}
      body={t('setup.missingBody')}
      actions={
        <Button variant="primary" onClick={onHome}>
          {t('nav.home')}
        </Button>
      }
    />
  );
}
