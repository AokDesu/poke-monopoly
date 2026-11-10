import { useEffect, useState } from 'react';
import type { AiStatus } from '../../../engine/contract/decision.ts';
import type { GameStore, SeatView } from '../game/store.ts';
import { AI_DECISION_MS } from '../game/ai.ts';
import { en, t, type MessageKey } from '../i18n/en.ts';
import { content } from '../game/content.ts';
import { seatLabel } from './labels.ts';

export type TurnSpeed = 'normal' | 'fast' | 'instant';
/** Presentation pauses between rival actions, per speed. Normal is readable aloud (issue #123). */
export const STEP_MS = { normal: 2000, fast: 250, instant: 0 } as const;
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
}

/** UI-only timing. Changing speed or skipping a line never cancels or reissues an AI decision. */
export function useTurnPlayback(store: GameStore, view: SeatView | null): TurnPlayback {
  const [speed, setSpeed] = useState<TurnSpeed>('normal');
  const [failure, setFailure] = useState<number | null>(null);
  const [retry, setRetry] = useState(0);
  const [requested, setRequested] = useState<number | null>(null);
  const [dismissed, setDismissed] = useState(-1);
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [statusUnavailable, setStatusUnavailable] = useState(false);
  const game = view?.observation.public;
  const revision = game?.stateRevision;
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
        target:
          last?.lineContext?.targetSeatIndex !== undefined
            ? seatLabel(last.lineContext.targetSeatIndex, view!.seatIndex)
            : t('seat.you'),
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
  const failed = failure === revision;
  const thinking = requested === revision && !failed;

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
    if (
      !view ||
      game?.phase.kind === 'finished' ||
      failed ||
      thinking ||
      lineSequence !== undefined
    )
      return;
    const timer = setTimeout(() => {
      if (store.advance({ human: true })) return;
      if (view.observation.public.activeSeatIndex !== view.seatIndex)
        setRequested(view.observation.public.stateRevision);
    }, STEP_MS[speed]);
    return () => clearTimeout(timer);
  }, [store, view, speed, lineSequence, failed, thinking, retry, game?.phase.kind]);

  useEffect(() => {
    if (!view || requested !== view.observation.public.stateRevision) return;
    const controller = new AbortController();
    void store.playOpponent(controller.signal).catch(() => {
      if (!controller.signal.aborted) setFailure(view.observation.public.stateRevision);
    });
    return () => controller.abort();
  }, [store, view, requested, retry]);

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
  };
}
