import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { AiSpeechEvent } from '../../../engine/index.ts';
import type { GameStore, SeatView, SpectatorView } from '../game/store.ts';
import {
  bankAnswer,
  banterDue,
  detectMoment,
  exchangeEvents,
  greeting,
  leaderOf,
  planTableTalk,
  replyBody,
  requestExchange,
  requestSpeech,
  retortAnswer,
  retortEvent,
  sharedFeed,
  speakBody,
  speechEvent,
  speedAllowsTalk,
  spokenLines,
  RECENT_LINES,
  voiceOff,
  type Moment,
  type PublicGame,
  type TalkPlan,
  type VoiceReason,
} from '../game/tableTalk.ts';
import type { TurnPlayback } from './useTurnPlayback.ts';

export interface TableTalk {
  /** Every line saved with the game, oldest first. */
  lines: readonly AiSpeechEvent[];
  hidden: boolean;
  /** False when the game was set up with AI talk off: no lines are asked for and no panel shows. */
  enabled: boolean;
  setHidden(hidden: boolean): void;
  /** Why generated speech is off, when the server says so. */
  voiceOff: VoiceReason | null;
}

interface Tracking {
  gameId: string;
  /** Feed entries already looked at: a game opened or reloaded never comments on its past. */
  handled: number;
  leader: number | null;
  /** The public game before the latest entry: a sale names what was sold from it. */
  game: PublicGame;
  pending: AbortController | null;
}

/**
 * Table talk beside the field log (spec §3, §5.7). A game opens with a greeting; then every round
 * has a line, a casual one when nothing happened, and a public moment in the viewer's own feed (a
 * die, a catch, a battle, coins changing hands, a sale, a Gym win, a change at the top) gets one
 * more, from any AI seat. When the line is addressed to another AI, that AI answers once. The
 * request runs beside the game, never in front of it: a step never waits, a slow, failed or off
 * route is answered from the line bank, and a line that arrives after the game has been paused,
 * hidden or sped up is dropped. Words never touch the engine; a shown line is only saved as an
 * `ai_speech` dialogue event.
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
  // A watched game started with AI talk off never asks for a line (spec §3); other games talk.
  const enabled = store.getWatchSettings()?.talk ?? true;
  const off = voiceOff(playback.status);
  // An answer written by Haiku needs Jev for the manipulation check as well as Haiku for the words.
  const answerOn = off === null && playback.status?.backupOnly !== true;
  const live = useRef({
    speed: playback.speed,
    paused: playback.paused,
    hidden,
    enabled,
    off,
    answerOn,
    lines,
  });
  live.current = {
    speed: playback.speed,
    paused: playback.paused,
    hidden,
    enabled,
    off,
    answerOn,
    lines,
  };
  const tracking = useRef<Tracking | null>(null);

  useEffect(() => {
    if (!view) return;
    const gameId = store.getGameId();
    const game = view.observation.public;
    const seed = store.getSession()?.log.seed;

    /** Plans a line for `moment` and runs it beside the game; false when nothing was asked for. */
    const ask = (track: Tracking, moment: Moment, momentKey: number): boolean => {
      if (seed === undefined || track.pending) return false;
      const now = live.current;
      const plan = planTableTalk({
        view,
        seed,
        momentKey,
        spoken: now.lines,
        moment,
        speed: now.speed,
        paused: now.paused,
        hidden: now.hidden || !now.enabled,
      });
      if (!plan) return false;
      const controller = new AbortController();
      track.pending = controller;
      // The answer is dropped, never shown late, if the game moved on while the route worked.
      const stillWanted = () => {
        const latest = live.current;
        return (
          !controller.signal.aborted &&
          store.getGameId() === gameId &&
          store.getSession()?.state.phase.kind !== 'finished' &&
          speedAllowsTalk(latest.speed) &&
          !latest.paused &&
          !latest.hidden
        );
      };
      void speak({ plan, game, gameId, seed, momentKey, controller, stillWanted }).finally(() => {
        if (track.pending === controller) track.pending = null;
      });
      return true;
    };

    /**
     * One line, or an exchange when the line is addressed to an AI that may answer. Haiku's words
     * are shown only whole and on time; otherwise the bank speaks, the answer included.
     */
    const speak = async (args: {
      plan: TalkPlan;
      game: PublicGame;
      gameId: string;
      seed: string | number;
      momentKey: number;
      controller: AbortController;
      stillWanted: () => boolean;
    }) => {
      const { plan, game, gameId, seed, momentKey, controller, stillWanted } = args;
      const { signal } = controller;
      const { listener } = plan;
      const generated = live.current.off === null;
      // The speaker's own public game, so its revision is the speaker's and not the viewer's (§4.8).
      const speakerGame = store.publicFor(plan.speakerSeat) ?? game;
      const body = speakBody({ gameId, plan, game: speakerGame, momentKey });
      if (listener && generated && live.current.answerOn) {
        const exchange = { ...plan, listener };
        const answer = await requestExchange(
          body,
          (quote) =>
            replyBody({
              gameId,
              plan: exchange,
              game: store.publicFor(exchange.listener.seat) ?? game,
              momentKey,
              quote,
            }),
          signal,
        );
        if (!stillWanted()) return;
        const events = answer ? exchangeEvents(exchange, answer) : null;
        // The two lines are saved together, opening first: an exchange is shown whole or not at all.
        if (events) {
          if (store.recordSpeech(events[0])) store.recordSpeech(events[1]);
          return;
        }
      }
      // A single line, asked of the route only while generated speech is on.
      const route =
        generated && !(listener && live.current.answerOn)
          ? await requestSpeech(body, signal)
          : null;
      if (!stillWanted()) return;
      // Only Haiku's own line is taken from the route: when it answers with a bank line, or with
      // nothing, the table picks its own, steering clear of what was just said.
      const recent = live.current.lines
        .slice(-RECENT_LINES)
        .flatMap((line) => (line.lineId ? [line.lineId] : []));
      const fallback = bankAnswer(plan.situation, plan.personalityId, seed, momentKey, recent);
      const opening =
        (route?.source === 'haiku' && speechEvent(plan, route, game)) ||
        (fallback && speechEvent(plan, fallback, game));
      if (!opening || !store.recordSpeech(opening)) return;
      // A line spoken to the table names no one to answer it; a Haiku line is answered only in an exchange.
      if (!listener || opening.source !== 'bank' || opening.addressedSeatIndex !== listener.seat)
        return;
      const retort = retortAnswer(listener.personalityId, seed, momentKey, [
        ...recent,
        ...(opening.lineId ? [opening.lineId] : []),
      ]);
      const answer = retort && retortEvent({ ...plan, listener }, retort, game);
      if (answer && stillWanted()) store.recordSpeech(answer);
    };

    const track = tracking.current;
    if (!track || track.gameId !== gameId) {
      track?.pending?.abort();
      const fresh: Tracking = {
        gameId,
        handled: sharedFeed(view.feed).length,
        leader: leaderOf(game.players),
        game,
        pending: null,
      };
      tracking.current = fresh;
      // A game that is just beginning opens with a greeting; a game that already has talk (a
      // reload) or is past its first turn does not.
      if (game.globalTurnNo <= 1 && live.current.lines.length === 0) ask(fresh, greeting(game), 0);
      return;
    }
    const previousLeader = track.leader;
    const previous = track.game;
    track.leader = leaderOf(game.players);
    track.game = game;
    // Only the steps a bystander would see trigger and name a moment (§4.8): a private proposal or chat starts
    // no talk and leaves every later key as it would be had it not happened.
    const shared = sharedFeed(view.feed);
    const isFresh = shared.length > track.handled;
    track.handled = shared.length;
    const entry = shared.at(-1);
    if (!isFresh || !entry) return;
    const momentKey = shared.length;
    const moment = detectMoment(entry, game, previousLeader, previous);
    if (moment && ask(track, moment, momentKey)) return;
    // Nothing to say about this step, or nobody to say it: a round still gets its line.
    const banter = banterDue(game, live.current.lines);
    if (banter) ask(track, banter, momentKey);
  }, [store, view]);

  // A cleanup also ends the request in flight, so the next mount starts from nothing: it looks at
  // the game as it finds it, never at a past moment, and greets a game that has not spoken yet.
  useEffect(
    () => () => {
      tracking.current?.pending?.abort();
      tracking.current = null;
    },
    [],
  );

  return { lines, hidden, setHidden, enabled, voiceOff: off };
}
