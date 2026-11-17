import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { AiSpeechEvent } from '../../../engine/index.ts';
import type { GameStore, SeatView, SpectatorView } from '../game/store.ts';
import {
  canSpeakWithoutHaiku,
  detectMoment,
  leaderOf,
  exchangeEvents,
  planTableTalk,
  replyBody,
  requestExchange,
  requestSpeech,
  roundOf,
  speakBody,
  speedAllowsTalk,
  speechEvent,
  spokenLines,
  voiceOff,
  type VoiceReason,
} from '../game/tableTalk.ts';
import type { TurnPlayback } from './useTurnPlayback.ts';

export interface TableTalk {
  /** Every line saved with the game, oldest first. */
  lines: readonly AiSpeechEvent[];
  hidden: boolean;
  setHidden(hidden: boolean): void;
  /** Why generated speech is off, when the server says so. */
  voiceOff: VoiceReason | null;
}

interface Tracking {
  gameId: string;
  /** Feed entries already looked at: a game opened or reloaded never comments on its past. */
  handled: number;
  leader: number | null;
  pending: AbortController | null;
  /** The last round an exchange was asked for, shown or not: one try per round, so a refused line is not retried. */
  exchangeRound: number | null;
}

/**
 * Table talk beside the field log (spec §3, §5.7): after a public moment in the viewer's own feed,
 * one AI seat may say one line, or, when the moment is about another AI, speak to it and be
 * answered once. The request runs beside the game, never in front of it: a step
 * never waits, a slow or failed route shows nothing, and a line that arrives after the game has
 * been paused, hidden or sped up is dropped. Words never touch the engine; a shown line is only
 * saved as an `ai_speech` dialogue event.
 */
export function useTableTalk(
  store: GameStore,
  view: SeatView | SpectatorView | null,
  playback: Pick<TurnPlayback, 'speed' | 'paused' | 'status'>,
): TableTalk {
  const session = useSyncExternalStore(store.subscribe, store.getSession);
  const lines = useMemo(
    () => spokenLines(session?.log.dialogueEvents),
    [session?.log.dialogueEvents],
  );
  const [hidden, setHidden] = useState(false);
  const off = voiceOff(playback.status);
  // An exchange needs Jev for the manipulation check as well as Haiku for the words.
  const exchangeOn = off === null && playback.status?.backupOnly !== true;
  const live = useRef({
    speed: playback.speed,
    paused: playback.paused,
    hidden,
    off,
    exchangeOn,
    lines,
  });
  live.current = {
    speed: playback.speed,
    paused: playback.paused,
    hidden,
    off,
    exchangeOn,
    lines,
  };
  const tracking = useRef<Tracking | null>(null);

  useEffect(() => {
    if (!view) return;
    const gameId = store.getGameId();
    const game = view.observation.public;
    const track = tracking.current;
    if (!track || track.gameId !== gameId) {
      track?.pending?.abort();
      tracking.current = {
        gameId,
        handled: view.feed.length,
        leader: leaderOf(game.players),
        pending: null,
        exchangeRound: null,
      };
      return;
    }
    const previousLeader = track.leader;
    track.leader = leaderOf(game.players);
    const fresh = view.feed.length > track.handled;
    track.handled = view.feed.length;
    const entry = view.feed.at(-1);
    if (!fresh || !entry) return;
    const moment = detectMoment(entry, game, previousLeader);
    const seed = store.getSession()?.log.seed;
    if (!moment || seed === undefined || track.pending) return;
    const now = live.current;
    const round = roundOf(moment.turn, game.players.length);
    const plan = planTableTalk({
      view,
      seed,
      momentKey: view.feed.length,
      spoken: now.lines,
      moment,
      speed: now.speed,
      paused: now.paused,
      hidden: now.hidden,
      exchangeAllowed: now.exchangeOn && track.exchangeRound !== round,
    });
    const { listener } = plan ?? {};
    if (!plan || (!listener && now.off && !canSpeakWithoutHaiku(moment.situation))) return;
    const controller = new AbortController();
    track.pending = controller;
    const momentKey = view.feed.length;
    const body = speakBody({ gameId, plan, game, momentKey });
    // The answer is dropped, never shown late, if the game moved on while the route worked.
    const stillWanted = () => {
      const latest = live.current;
      return (
        !controller.signal.aborted &&
        store.getGameId() === gameId &&
        speedAllowsTalk(latest.speed) &&
        !latest.paused &&
        !latest.hidden
      );
    };
    const settle = () => {
      if (track.pending === controller) track.pending = null;
    };
    if (listener) {
      track.exchangeRound = round;
      const exchange = { ...plan, listener };
      void requestExchange(
        body,
        (quote) => replyBody({ gameId, plan: exchange, game, momentKey, quote }),
        controller.signal,
      ).then((answer) => {
        settle();
        const events = answer && stillWanted() ? exchangeEvents(exchange, answer) : null;
        // The two lines are saved together, opening first: an exchange is shown whole or not at all.
        if (events && store.recordSpeech(events[0])) store.recordSpeech(events[1]);
      });
      return;
    }
    void requestSpeech(body, controller.signal).then((answer) => {
      settle();
      if (!answer || !stillWanted()) return;
      const event = speechEvent(plan, answer, game);
      if (event) store.recordSpeech(event);
    });
  }, [store, view]);

  useEffect(
    () => () => {
      tracking.current?.pending?.abort();
    },
    [],
  );

  return { lines, hidden, setHidden, voiceOff: off };
}
