import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { AiStatus } from '../../../engine/contract/decision.ts';
import type { GameStore, SeatView, SpectatorView } from '../game/store.ts';
import { AI_DECISION_MS } from '../game/ai.ts';
import { inSocialWindow } from '../game/chat.ts';
import { rivalOwesAnswer } from '../game/promises.ts';
import type { Pace } from '../game/setup.ts';
import { spokenLines } from '../game/tableTalk.ts';
import { useHowToPlayOpen } from '../howToPlay/HowToPlay.tsx';
import { t } from '../i18n/en.ts';
import { latestTurns, tableBeats, turnSpeech, type Beat, type StorySpeech } from './beats.ts';
import { holdMs, PACE_TIMING } from './pace.ts';

/** The table's story as far as it has been told: what the seat rows show. */
export interface TableStory {
  /** Every beat of the game so far, in order. */
  readonly beats: readonly Beat[];
  /** Beats `[0, shown)` have been told; the rest wait for the hold before them to end. */
  readonly shown: number;
  /** The beat being held now, if any. */
  readonly current: number | null;
  /** The turn each seat played last. */
  readonly turns: ReadonlyMap<number, number>;
  /** The one line each seat said in its last turn, if any. */
  readonly speech: ReadonlyMap<number, StorySpeech>;
}

export interface TurnPlayback {
  /** The pace the player chose, saved with the game. */
  pace: Pace;
  /** Saves the pace and runs at it; choosing one while skipping ends the skip. */
  setPace(pace: Pace): void;
  /** Running at Instant until the viewing seat's turn or the results; every row is still written. */
  skipping: boolean;
  status: AiStatus | null;
  statusUnavailable: boolean;
  thinking: boolean;
  failed: boolean;
  retry(): void;
  paused: boolean;
  setPaused(paused: boolean): void;
  /** Plays exactly one action while paused. Does nothing while `stepBlocked` names a reason. */
  step(): void;
  stepBlocked: string | null;
  /** A beat is being held (at Step pace, until Next). */
  holding: boolean;
  /** Ends the current hold now; while paused with nothing held, plays one step. */
  next(): void;
  nextBlocked: string | null;
  /** Runs at Instant until the viewing seat's turn starts. */
  skipToMyTurn(): void;
  /** Runs at Instant until the game finishes. */
  skipToEnd(): void;
  story: TableStory;
}

interface Hold {
  /** When the beat (or the speech line) appeared. */
  readonly start: number;
  /** The beat held, or null for a speech line that arrived with no beat held. */
  readonly beat: number | null;
  /** The speech line's extra time, added to the beat it sits in. */
  readonly extraMs: number;
}

const NO_STORY: TableStory = {
  beats: [],
  shown: 0,
  current: null,
  turns: new Map(),
  speech: new Map(),
};

/**
 * The pace engine (spec §3, AI turns). Every step the game applies by itself, and every AI request,
 * waits until the beat before it has been held: Readable holds each outcome 1.2 s + 0.3 s per word
 * (2.5-5 s), the viewing seat's own results at least 2.5 s, and a step that tells nothing 250 ms.
 * Only Next ends a hold early: a choice the player makes meanwhile is told once the hold ends.
 * Timing is the screen's alone: a pace, Next, Pause or a skip never cancels, reissues or changes
 * an AI decision, and a request already sent always lands.
 */
export function useTurnPlayback(
  store: GameStore,
  view: SeatView | SpectatorView | null,
): TurnPlayback {
  const pace = useSyncExternalStore(store.subscribe, store.getPace);
  const session = useSyncExternalStore(store.subscribe, store.getSession);
  const [skip, setSkip] = useState<'turn' | 'end' | null>(null);
  const running: Pace = skip ? 'instant' : pace;
  const [failure, setFailure] = useState<number | null>(null);
  const [retry, setRetry] = useState(0);
  const [requested, setRequested] = useState<number | null>(null);
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [statusUnavailable, setStatusUnavailable] = useState(false);
  const [paused, setPaused] = useState(false);
  const [stepFrom, setStepFrom] = useState<number | null>(null);
  const [hold, setHold] = useState<Hold | null>(null);
  const game = view?.observation.public;
  const viewer = view?.seatIndex;
  // Actions in the log, not the seat's revision: a chat this viewer cannot see still moves it.
  const position = session?.log.actions.length;
  const lines = useMemo(
    () => spokenLines(session?.log.dialogueEvents),
    [session?.log.dialogueEvents],
  );
  const beats = useMemo(
    () =>
      view
        ? tableBeats(view.feed, { game: view.observation.public, viewerSeat: view.seatIndex })
        : [],
    [view],
  );
  const turns = useMemo(() => (view ? latestTurns(view.feed) : new Map<number, number>()), [view]);
  const speech = useMemo(() => {
    const said = new Map<number, StorySpeech>();
    if (!view) return said;
    const context = { game: view.observation.public, viewerSeat: view.seatIndex };
    for (const [seat, turn] of turns) {
      const line = turnSpeech(view.feed, lines, seat, turn, context);
      if (line) said.set(seat, line);
    }
    return said;
  }, [view, turns, lines]);

  // A game opened or reloaded is told at once: only what happens from now on is paced.
  const gameId = store.getGameId();
  const [told, setTold] = useState({ gameId, shown: beats.length });
  if (told.gameId !== gameId) {
    setTold({ gameId, shown: beats.length });
    setHold(null);
  }
  const shown = told.gameId === gameId ? Math.min(told.shown, beats.length) : beats.length;
  // A speech line already said when the game opened adds no time; each later one adds it once.
  const spoken = useRef<{ gameId: string; keys: Set<string> } | null>(null);
  if (spoken.current?.gameId !== gameId) {
    spoken.current = {
      gameId,
      keys: new Set([...speech.keys()].map((seat) => `${seat}:${turns.get(seat)}`)),
    };
  }

  const holdFor = (index: number) => {
    // A hold left from a game that was just replaced holds nothing.
    const beat = beats[index];
    if (!beat) return 0;
    const own = viewer !== undefined && beat.seatIndex === viewer;
    return holdMs(
      {
        text: beat.text,
        ownChoice: own && beat.kind === 'choice',
        ownResult: own && beat.kind === 'result',
      },
      running,
    );
  };
  const holdEnds = hold
    ? hold.start + (hold.beat === null ? 0 : holdFor(hold.beat)) + hold.extraMs
    : null;

  const failed = failure === position;
  const thinking = requested === position && !failed;
  const finished = game?.phase.kind === 'finished';
  // A step runs until the next action lands, then the game holds again.
  const stepping = stepFrom === position;
  // The walkthrough holds the game: no automatic step starts and a rival's pending question is
  // withdrawn (it is asked again on Close), so opening and closing it changes nothing.
  const reading = useHowToPlayOpen();
  const held = (paused && !stepping) || reading;
  const stepBlocked = !paused
    ? t('watch.stepWhileRunning')
    : finished
      ? t('watch.stepFinished')
      : failed
        ? t('watch.stepFailed')
        : thinking || stepping
          ? t('watch.stepBusy')
          : null;

  // Skipping to the viewing seat's turn ends when that turn starts; skipping to the results, only
  // when a pace is chosen (`setPace` ends either skip).
  if (skip === 'turn' && (finished || (viewer !== undefined && game?.activeSeatIndex === viewer))) {
    setSkip(null);
  }

  // Tells the next beats, holding each one; a beat with nothing to hold is told with the next.
  useEffect(() => {
    if (!view) return;
    if (holdEnds !== null) {
      if (holdEnds === Infinity) return;
      const timer = setTimeout(() => setHold(null), Math.max(0, holdEnds - Date.now()));
      return () => clearTimeout(timer);
    }
    if (shown >= beats.length) return;
    let next = shown;
    while (next < beats.length && holdFor(next) === 0) next++;
    const found = next < beats.length;
    setTold({ gameId, shown: found ? next + 1 : next });
    if (found) setHold({ start: Date.now(), beat: next, extraMs: 0 });
  });

  // A seat's one speech line adds its time to the beat it sits in (spec §3: inside its beat).
  useEffect(() => {
    if (!view || !game || !spoken.current) return;
    const seat = game.activeSeatIndex;
    const key = `${seat}:${turns.get(seat)}`;
    if (!speech.has(seat) || turns.get(seat) !== game.globalTurnNo || spoken.current.keys.has(key))
      return;
    spoken.current.keys.add(key);
    const extraMs = PACE_TIMING[running].speechMs;
    if (extraMs === 0) return;
    setHold((current) =>
      current
        ? { ...current, extraMs: current.extraMs + extraMs }
        : { start: Date.now(), beat: null, extraMs },
    );
  }, [view, game, speech, turns, running]);

  useEffect(() => {
    if (!game) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
      setStatusUnavailable(true);
    }, AI_DECISION_MS);
    void fetch('/api/ai/status', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('Status unavailable');
        const value: unknown = await response.json();
        if (
          !value ||
          typeof value !== 'object' ||
          !('backupOnly' in value) ||
          typeof value.backupOnly !== 'boolean' ||
          !('jevEnabled' in value) ||
          typeof value.jevEnabled !== 'boolean' ||
          !('reason' in value) ||
          !(
            value.reason === null ||
            ['disabled', 'budget_exceeded', 'missing_key'].includes(String(value.reason))
          )
        )
          throw new Error('Invalid AI status');
        if (!controller.signal.aborted) {
          setStatus(value as AiStatus);
          setStatusUnavailable(false);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setStatusUnavailable(true);
      })
      .finally(() => clearTimeout(timer));
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [game?.globalTurnNo, game?.activeSeatIndex]);

  useEffect(() => {
    // Nothing starts while a beat is held or waits to be told.
    if (!view || finished || hold || shown < beats.length) return;
    if (held || failed || thinking) return;
    // The game pauses only in the human's Social window, and there it waits for the player: the
    // sole Skip that follows a message is Continue, not a step to apply (spec §4.2). A promise
    // question is the exception: the rival owes the answer, so it is asked (spec §4.8).
    if (view.seatIndex !== undefined && inSocialWindow(view) && !rivalOwesAnswer(view)) return;
    const timer = setTimeout(
      () => {
        if (store.advance({ human: true })) return;
        if (view.seatIndex === undefined || view.legalActions.enabled.length === 0)
          setRequested(position!);
      },
      stepping ? 0 : PACE_TIMING[running].fillerMs,
    );
    return () => clearTimeout(timer);
  }, [
    store,
    view,
    running,
    failed,
    thinking,
    held,
    stepping,
    retry,
    finished,
    hold,
    shown,
    beats.length,
  ]);

  useEffect(() => {
    if (!view || requested !== position || reading) return;
    const controller = new AbortController();
    void store.playOpponent(controller.signal).catch(() => {
      if (!controller.signal.aborted) setFailure(position!);
    });
    return () => controller.abort();
  }, [store, view, requested, retry, reading]);

  /** Everything waiting is told at once, with nothing held: before a step or a skip. */
  const tellAll = () => {
    setHold(null);
    setTold({ gameId, shown: beats.length });
  };
  const step = () => {
    if (stepBlocked || position === undefined) return;
    tellAll();
    setStepFrom(position);
  };
  return {
    pace,
    setPace: (value) => {
      setSkip(null);
      store.setPace(value);
    },
    skipping: skip !== null,
    status,
    statusUnavailable,
    thinking,
    failed,
    retry: () => {
      setFailure(null);
      setRetry((value) => value + 1);
    },
    paused,
    setPaused,
    stepBlocked,
    step,
    holding: hold !== null,
    // Ends the hold; with nothing held, starts the next step now (one step while paused).
    next: () => {
      if (hold) setHold(null);
      else if (paused) step();
      else if (position !== undefined && !finished) setStepFrom(position);
    },
    nextBlocked: hold ? null : paused ? stepBlocked : finished ? t('watch.stepFinished') : null,
    skipToMyTurn: () => {
      if (viewer === undefined || finished) return;
      tellAll();
      setPaused(false);
      setSkip('turn');
    },
    skipToEnd: () => {
      tellAll();
      setPaused(false);
      setSkip('end');
    },
    story: view ? { beats, shown, current: hold?.beat ?? null, turns, speech } : NO_STORY,
  };
}
