import { useEffect, useRef, useState } from 'react';
import { BoardScreen } from './board/BoardScreen.tsx';
import { CreditsScreen } from './CreditsScreen.tsx';
import { classOptions, content as gameContent, engineContent } from './game/content.ts';
import { rollForFirstPlayer } from './game/firstPlayer.ts';
import {
  browserStorage,
  clearSave,
  loadSave,
  readMeta,
  readSaveText,
  summarize,
  writeSave,
  readWatchSetup,
  writeWatchSetup,
  clearWatchSetup,
  savedRivals,
  type SavedRival,
  type SaveMeta,
  type SaveStorage,
  type SaveSummary,
} from './game/save.ts';
import {
  canWatch,
  completeSetup,
  completeWatchSetup,
  DEFAULT_WATCH_SETTINGS,
  freshSeed,
  randomAis,
  restoreWatchProgress,
  withRivalCount,
  randomSetup,
  WATCH_MIN_AIS,
  type ModeId,
  type SetupDraft,
  type WatchDraft,
} from './game/setup.ts';
import {
  configForSetup,
  configForWatch,
  createGameStore,
  MODES,
  opponentSettings,
  rematchConfig,
  watchOpponentSettings,
  type GameSession,
  type GameStore,
} from './game/store.ts';
import { t } from './i18n/en.ts';
import { ResultsScreen } from './ResultsScreen.tsx';
import { pendingLine, SavePrompt, type SavePromptProps } from './SavePrompt.tsx';
import type { Route } from './screens.ts';
import { ClassScreen } from './setup/ClassScreen.tsx';
import { FirstPlayerScreen } from './setup/FirstPlayerScreen.tsx';
import { HomeScreen } from './setup/HomeScreen.tsx';
import { ModeScreen } from './setup/ModeScreen.tsx';
import { OpponentScreen } from './setup/OpponentScreen.tsx';
import { ReviewScreen } from './setup/ReviewScreen.tsx';
import { WatchOptionsScreen } from './setup/WatchOptionsScreen.tsx';
import { Button } from './ui/Button.tsx';
import { BallIcon } from './ui/icons.tsx';
import { FocusHeadingContext, Screen } from './ui/Screen.tsx';

export interface AppProps {
  /** Test-only fixed game seed from `?seed=`; never shown to players. */
  seed?: number | string;
  /** Demo mode (`?demo`): shows the "What Jev chose" panel on a rival's decision (issue #220). */
  demo?: boolean;
  /** Random All's source of choices. */
  random?: () => number;
  store?: GameStore;
  /** `undefined` probes the browser. `null` means saving is off. Tests pass a fake. */
  storage?: SaveStorage | null;
}

const OPEN_MODES = (Object.keys(MODES) as ModeId[]).filter((mode) => MODES[mode].enabled);
const HOME: Route = { screen: 'home' };

type SaveOffer =
  | {
      kind: 'continue';
      session: GameSession;
      opponents: SaveMeta['opponents'];
      watch: SaveMeta['watch'];
      chatWords: SaveMeta['chatWords'];
      gameId: SaveMeta['gameId'];
      rivals: SavedRival[];
      summary: SaveSummary;
    }
  | { kind: 'mismatch'; message: string }
  | { kind: 'unreadable' };

function inspect(storage: SaveStorage | null): { offer: SaveOffer | null; unavailable: boolean } {
  if (!storage) return { offer: null, unavailable: true };
  let text: string | null;
  try {
    text = readSaveText(storage);
  } catch {
    return { offer: null, unavailable: true };
  }
  if (!text) return { offer: null, unavailable: false };
  const loaded = loadSave(text);
  if (!loaded.ok) {
    return {
      offer:
        loaded.kind === 'mismatch'
          ? { kind: 'mismatch', message: loaded.message }
          : { kind: 'unreadable' },
      unavailable: false,
    };
  }
  const meta = readMeta(storage);
  return {
    offer: {
      kind: 'continue',
      session: loaded.game,
      opponents: meta.opponents,
      watch: meta.watch,
      chatWords: meta.chatWords,
      gameId: meta.gameId,
      rivals: savedRivals(loaded.game, meta),
      summary: summarize(loaded.game, loaded.resumed),
    },
    unavailable: false,
  };
}

export function App({
  seed,
  demo = false,
  random = Math.random,
  store: givenStore,
  storage: givenStorage,
}: AppProps) {
  const [store] = useState(() => givenStore ?? createGameStore({ demo }));
  const [storage] = useState(() => (givenStorage === undefined ? browserStorage() : givenStorage));
  const [opened] = useState(() => inspect(storage));
  // A reload keeps an unfinished watch setup, unless a saved game is waiting on the Home screen.
  const [restored] = useState(() =>
    storage && !opened.offer
      ? restoreWatchProgress(readWatchSetup(storage), classOptions, OPEN_MODES)
      : undefined,
  );
  const [savingOff, setSavingOff] = useState(opened.unavailable);
  const [offer, setOffer] = useState(opened.offer);
  const [resumeNotice, setResumeNotice] = useState<string | null>(null);
  const [route, setRoute] = useState<Route>(() =>
    restored ? { screen: 'watch', step: restored.step } : HOME,
  );
  const [creditsFrom, setCreditsFrom] = useState<Route>(HOME);
  const [draft, setDraft] = useState<SetupDraft>({});
  const [watch, setWatch] = useState<WatchDraft>(
    () => restored?.draft ?? { settings: DEFAULT_WATCH_SETTINGS },
  );
  const [startFailed, setStartFailed] = useState(false);
  const [navigated, setNavigated] = useState(false);
  const noticeRef = useRef<string | null>(null);
  const resumedAt = useRef<number | null>(null);
  const routeRef = useRef(route);
  routeRef.current = route;

  useEffect(() => {
    return store.subscribe(() => {
      const session = store.getSession();
      if (storage) {
        try {
          if (session) {
            writeSave(storage, session, {
              opponents: store.getOpponents(),
              watch: store.getWatchSettings(),
              chatWords: store.getChatWords(),
              gameId: store.getGameId(),
            });
          } else clearSave(storage);
          setSavingOff(false);
        } catch {
          setSavingOff(true);
        }
      }
      if (noticeRef.current && session && session.state.stateRevision !== resumedAt.current) {
        noticeRef.current = null;
        setResumeNotice(null);
      }
      if (routeRef.current.screen === 'play' && session?.state.phase.kind === 'finished') {
        setNavigated(true);
        setRoute({ screen: 'results' });
      }
    });
  }, [store, storage]);

  // An unfinished watch setup waits in storage so a reload on any watch step, the review included,
  // finds every answer again. Credits is a detour and keeps it; any other screen drops it.
  useEffect(() => {
    if (!storage) return;
    try {
      if (route.screen === 'watch') writeWatchSetup(storage, route.step, watch);
      else if (route.screen !== 'credits') clearWatchSetup(storage);
    } catch {
      setSavingOff(true);
    }
  }, [storage, route, watch]);

  const go = (next: Route) => {
    setNavigated(true);
    setStartFailed(false);
    setRoute(next);
  };
  const canStart = randomSetup(classOptions, OPEN_MODES, () => 0) !== undefined;
  const setup = completeSetup(draft, classOptions);
  const watchSetup = completeWatchSetup(watch, classOptions);
  const continueSaved = () => {
    if (offer?.kind !== 'continue') return;
    try {
      store.restore(
        offer.session,
        [...offer.opponents],
        offer.watch,
        offer.gameId,
        offer.chatWords,
      );
    } catch {
      setOffer({ kind: 'unreadable' });
      return;
    }
    if (offer.summary.aiDecision) {
      resumedAt.current = offer.session.state.stateRevision;
      noticeRef.current = t('game.resumedAiTurn');
      setResumeNotice(t('game.resumedAiTurn'));
    }
    setOffer(null);
    const phase = offer.session.state.phase.kind;
    go(
      phase === 'finished'
        ? { screen: 'results' }
        : phase === 'first_player_roll' && offer.summary.humanSeat !== undefined
          ? { screen: 'setup', step: 'firstPlayer' }
          : { screen: 'play' },
    );
  };
  const discardSave = () => {
    if (storage) {
      try {
        clearSave(storage);
      } catch {
        setSavingOff(true);
      }
    }
    noticeRef.current = null;
    setResumeNotice(null);
    setOffer(null);
    store.clear();
    go({ screen: 'setup', step: 'mode' });
  };
  const playAgain = () => {
    noticeRef.current = null;
    setResumeNotice(null);
    setOffer(null);
    store.clear();
    go(HOME);
  };
  /** Leave from a watched game: Save keeps the game for Continue, End discards it. */
  const leaveWatch = (how: 'save' | 'end') => {
    if (how === 'end') {
      playAgain();
      return;
    }
    noticeRef.current = null;
    setResumeNotice(null);
    setOffer(inspect(storage).offer);
    go(HOME);
  };
  /** Same AIs and settings, a new seed (spec §3, watch path). */
  const watchAgain = () => {
    const session = store.getSession();
    if (!session) {
      playAgain();
      return;
    }
    const settings = store.getOpponents();
    const tableSettings = store.getWatchSettings();
    noticeRef.current = null;
    setResumeNotice(null);
    try {
      store.start(
        rematchConfig(session.state.config, freshSeed()),
        engineContent,
        settings,
        tableSettings,
      );
    } catch {
      playAgain();
      return;
    }
    go({ screen: 'play' });
  };
  const prompt: SavePromptProps | null = offer
    ? offer.kind === 'continue'
      ? {
          kind: 'continue',
          pending: pendingLine(offer.summary),
          rivals: offer.rivals,
          onContinue: continueSaved,
          onNewGame: discardSave,
        }
      : offer.kind === 'mismatch'
        ? { kind: 'mismatch', message: offer.message, onNewGame: discardSave }
        : { kind: 'unreadable', onNewGame: discardSave }
    : null;

  let screen;
  switch (route.screen) {
    case 'home':
      screen = prompt ? (
        <SavePrompt {...prompt} />
      ) : (
        <HomeScreen
          board={gameContent.board}
          canStart={canStart}
          canWatch={canWatch(classOptions)}
          onNewGame={() => go({ screen: 'setup', step: 'mode' })}
          onWatch={() => go({ screen: 'watch', step: 'mode' })}
          onRandomAll={() => {
            const picked = randomSetup(classOptions, OPEN_MODES, random);
            if (!picked) return;
            setDraft({ mode: picked.mode, human: picked.human, rivals: picked.opponents });
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
              rivals={draft.rivals}
              onSelect={(human) => setDraft({ ...draft, human })}
              onNext={() => {
                // The first time through, one rival on the first free class; later answers stay.
                const rivals = draft.rivals?.length
                  ? draft.rivals
                  : (withRivalCount(classOptions, draft.human!, [], 1) ?? []);
                setDraft({ ...draft, rivals });
                go({ screen: 'setup', step: 'opponents' });
              }}
              onBack={() => go({ screen: 'setup', step: 'mode' })}
            />
          );
          break;
        case 'opponents':
          screen = draft.human ? (
            <OpponentScreen
              classes={classOptions}
              human={draft.human}
              rivals={draft.rivals ?? []}
              onChange={(rivals) => setDraft({ ...draft, rivals })}
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
    case 'watch':
      switch (route.step) {
        case 'mode':
          screen = (
            <ModeScreen
              flow="watch"
              onChoose={(mode) => {
                // The first time through, two AIs on the first free classes; later answers stay.
                const ais = watch.ais?.length
                  ? watch.ais
                  : (withRivalCount(classOptions, undefined, [], WATCH_MIN_AIS) ?? []);
                setWatch({ ...watch, mode, ais });
                go({ screen: 'watch', step: 'ais' });
              }}
              onBack={() => go(HOME)}
            />
          );
          break;
        case 'ais':
          screen = (
            <OpponentScreen
              classes={classOptions}
              rivals={watch.ais ?? []}
              onChange={(ais) => setWatch({ ...watch, ais })}
              onRandomAll={() => {
                // Random All fills every seat and never changes how many AIs were asked for.
                const ais = randomAis(classOptions, watch.ais?.length ?? 0, random);
                if (ais) setWatch({ ...watch, ais });
              }}
              onNext={() => go({ screen: 'watch', step: 'options' })}
              onBack={() => go({ screen: 'watch', step: 'mode' })}
            />
          );
          break;
        case 'options':
          screen = watch.ais ? (
            <WatchOptionsScreen
              settings={watch.settings}
              onChange={(settings) => setWatch({ ...watch, settings })}
              onNext={() => go({ screen: 'watch', step: 'review' })}
              onBack={() => go({ screen: 'watch', step: 'ais' })}
            />
          ) : (
            <MissingStep onHome={() => go(HOME)} />
          );
          break;
        case 'review':
          screen = watchSetup ? (
            <ReviewScreen
              setup={watchSetup}
              failed={startFailed}
              onBack={() => go({ screen: 'watch', step: 'options' })}
              onRoll={() => {
                try {
                  store.start(
                    configForWatch(watchSetup, seed ?? freshSeed()),
                    engineContent,
                    watchOpponentSettings(watchSetup),
                    watchSetup.settings,
                  );
                  // No human roll screen: every AI's roll, ties included, is the log's start (§3).
                  rollForFirstPlayer(store);
                  go({ screen: 'play' });
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
      }
      break;
    case 'play':
      screen = (
        <BoardScreen
          store={store}
          notice={resumeNotice ?? undefined}
          onFinished={() => go({ screen: 'results' })}
          savingOff={savingOff}
          onLeave={leaveWatch}
        />
      );
      break;
    case 'results':
      screen = <ResultsScreen store={store} onPlayAgain={playAgain} onWatchAgain={watchAgain} />;
      break;
    case 'credits':
      screen = <CreditsScreen onBack={() => go(creditsFrom)} />;
      break;
    default:
      screen = <MissingStep onHome={() => go(HOME)} />;
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
        {savingOff && (
          <p role="status" className="panel mb-6 px-5 py-3 text-sm font-bold">
            {t('save.off')}
          </p>
        )}
        <FocusHeadingContext value={navigated}>
          <div
            key={
              route.screen === 'setup'
                ? route.step
                : route.screen === 'watch'
                  ? `watch-${route.step}`
                  : route.screen
            }
          >
            {screen}
          </div>
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
