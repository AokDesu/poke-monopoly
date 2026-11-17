import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { AiSpeechEvent } from '../../../engine/index.ts';
import type { GameStore, SeatView, SpectatorView } from '../game/store.ts';
import {
  canSpeakWithoutHaiku,
  detectMoment,
  leaderOf,
  planTableTalk,
  requestSpeech,
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
}

/**
 * Table talk beside the field log (spec §3, §5.7): after a public moment in the viewer's own feed,
 * one AI seat may say one line. The request runs beside the game, never in front of it: a step
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
  const live = useRef({ speed: playback.speed, paused: playback.paused, hidden, off, lines });
  live.current = { speed: playback.speed, paused: playback.paused, hidden, off, lines };
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
    const plan = planTableTalk({
      view,
      seed,
      momentKey: view.feed.length,
      spoken: now.lines,
      moment,
      speed: now.speed,
      paused: now.paused,
      hidden: now.hidden,
    });
    if (!plan || (now.off && !canSpeakWithoutHaiku(moment.situation))) return;
    const controller = new AbortController();
    track.pending = controller;
    const body = speakBody({ gameId, plan, game, momentKey: view.feed.length });
    void requestSpeech(body, controller.signal).then((answer) => {
      if (track.pending === controller) track.pending = null;
      const latest = live.current;
      if (
        !answer ||
        controller.signal.aborted ||
        store.getGameId() !== gameId ||
        !speedAllowsTalk(latest.speed) ||
        latest.paused ||
        latest.hidden
      )
        return;
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
