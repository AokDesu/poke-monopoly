import { useEffect, useState } from 'react';
import type { AiStatus } from '../../../engine/contract/decision.ts';
import type { GameStore, SeatView, SpectatorView } from '../game/store.ts';
import { AI_DECISION_MS } from '../game/ai.ts';
import { inSocialWindow } from '../game/chat.ts';
import type { TurnSpeed } from '../game/setup.ts';
import { en, t, type MessageKey } from '../i18n/en.ts';
import { content } from '../game/content.ts';
import { useHowToPlayOpen } from '../howToPlay/HowToPlay.tsx';
import { seatLabel } from './labels.ts';

/** Presentation pauses between rival actions, per speed. Normal is readable aloud (issue #123). */
export const STEP_MS = { normal: 2000, fast: 250, instant: 0 } as const;
/** Pause before a step that belongs to the human's own seat: never AI-paced (review on #127). */
export const HUMAN_STEP_MS = { normal: 400, fast: 150, instant: 0 } as const;
export const LINE_MS = { normal: 3000, fast: 700, instant: 0 } as const;

export interface TurnPlayback {
  speed: TurnSpeed;
  setSpeed(speed: TurnSpeed): void;
  status: AiStatus | null;
  statusUnavailable: boolean;
  thinking: boolean;
  failed: boolean;
  line: { text: string; sequence: number; name: string } | null;
  skipLine(): void;
  retry(): void;
  paused: boolean;
  setPaused(paused: boolean): void;
  /** Plays exactly one action while paused. Does nothing while `stepBlocked` names a reason. */
  step(): void;
  stepBlocked: string | null;
  /** Runs at the instant pace until the game finishes. */
  skipToEnd(): void;
}

/** UI-only timing. Changing speed or skipping a line never cancels or reissues an AI decision. */
export function useTurnPlayback(
  store: GameStore,
  view: SeatView | SpectatorView | null,
): TurnPlayback {
  const [speed, setSpeed] = useState<TurnSpeed>(() => store.getWatchSettings()?.speed ?? 'normal');
  const [failure, setFailure] = useState<number | null>(null);
  const [retry, setRetry] = useState(0);
  const [requested, setRequested] = useState<number | null>(null);
  const [dismissed, setDismissed] = useState(-1);
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [statusUnavailable, setStatusUnavailable] = useState(false);
  const [paused, setPaused] = useState(false);
  const [stepFrom, setStepFrom] = useState<number | null>(null);
  const game = view?.observation.public;
  // Actions in the log, not the seat's revision: a chat this viewer cannot see still moves it.
  const position = store.getSession()?.log.actions.length;
  const last = view?.feed.at(-1);
  const lineId = last?.decision?.lineId;
  const lineKey = `ai.line.${lineId}` as MessageKey;
  const template = lineId && Object.hasOwn(en, lineKey) ? t(lineKey) : null;
  const encounter =
    last?.before.phase.kind === 'encounter' ? last.before.phase.pokemon.speciesId : undefined;
  const pokemon = content.species.find(
    (species) => species.id === (last?.lineContext?.pokemonSpeciesId ?? encounter),
  );
  const text = template
    ? t(lineKey, {
        turn: last!.before.globalTurnNo,
        ...(last?.lineContext?.targetSeatIndex !== undefined
          ? { target: seatLabel(last.lineContext.targetSeatIndex, view!.seatIndex) }
          : view?.seatIndex !== undefined && { target: t('seat.you') }),
        ...(pokemon && { pokemon: pokemon.name }),
        ...(last?.lineContext?.coins !== undefined && { coins: last.lineContext.coins }),
      })
    : null;
  // Missing slots and unrecognised IDs never turn into arbitrary or incomplete dialogue.
  const line =
    last &&
    text &&
    !/[{}]/.test(text) &&
    speed !== 'instant' &&
    dismissed < last.record.action.actionSeq
      ? {
          text,
          sequence: last.record.action.actionSeq,
          name: seatLabel(last.before.activeSeatIndex, view!.seatIndex),
        }
      : null;
  const lineSequence = line?.sequence;
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
    if (lineSequence === undefined) return;
    const timer = setTimeout(() => setDismissed(lineSequence), LINE_MS[speed]);
    return () => clearTimeout(timer);
  }, [lineSequence, speed]);

  useEffect(() => {
    // The game pauses only in the human's Social window, and there it waits for the player: the
    // sole Skip that follows a message is Continue, not a step to apply (spec §4.2).
    if (!view || finished || held || failed || thinking || lineSequence !== undefined) return;
    if (view.seatIndex !== undefined && inSocialWindow(view)) return;
    // Only rival steps get the readable AI pace. The human's own automatic steps
    // (rolls, phase handoffs) run on their own short pause (review on #127).
    const pause = stepping
      ? 0
      : view.observation.public.activeSeatIndex === view.seatIndex
        ? HUMAN_STEP_MS[speed]
        : STEP_MS[speed];
    const timer = setTimeout(() => {
      if (store.advance({ human: true })) return;
      if (view.seatIndex === undefined || view.legalActions.enabled.length === 0)
        setRequested(position!);
    }, pause);
    return () => clearTimeout(timer);
  }, [store, view, speed, lineSequence, failed, thinking, held, stepping, retry, finished]);

  useEffect(() => {
    if (!view || requested !== position || reading) return;
    const controller = new AbortController();
    void store.playOpponent(controller.signal).catch(() => {
      if (!controller.signal.aborted) setFailure(position!);
    });
    return () => controller.abort();
  }, [store, view, requested, retry, reading]);

  return {
    speed,
    setSpeed: (next) => {
      if (next === 'instant' && last) setDismissed(last.record.action.actionSeq);
      setSpeed(next);
    },
    status,
    statusUnavailable,
    thinking,
    failed,
    line,
    skipLine: () => {
      if (line) setDismissed(line.sequence);
    },
    retry: () => {
      setFailure(null);
      setRetry((value) => value + 1);
    },
    paused,
    setPaused,
    stepBlocked,
    step: () => {
      if (stepBlocked || position === undefined) return;
      if (line) setDismissed(line.sequence);
      setStepFrom(position);
    },
    skipToEnd: () => {
      if (last) setDismissed(last.record.action.actionSeq);
      setSpeed('instant');
      setPaused(false);
    },
  };
}
