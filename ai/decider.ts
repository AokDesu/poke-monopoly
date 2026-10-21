import type {
  AiStatus,
  DecisionFallbackReason,
  DecisionRequest,
} from '../engine/contract/decision.ts';
import { jevEnabled } from './jev/client.ts';

/** What a decider picks: an action ID, or the Pokémon to sell at the Sell Phase. */
export type DeciderPick = { choice: string } | { sellUids: string[] };

export type DeciderAnswer = DeciderPick &
  ({ source: 'jev' } | { source: 'fallback'; fallbackReason: DecisionFallbackReason });

export interface DeciderContext {
  status: AiStatus;
}

/** The pluggable seam `POST /api/ai/decide` calls; the orchestrator (B4) replaces the stub. */
export type Decider = (request: DecisionRequest, context: DeciderContext) => Promise<DeciderAnswer>;

/** Spec §9 kill switch and key presence, read per call so the badge tells the truth. */
export const jevStatus = (): AiStatus => {
  if (!jevEnabled()) return { jevEnabled: false, backupOnly: true, reason: 'disabled' };
  if (!process.env.TYPESAFE_API_KEY?.trim()) {
    return { jevEnabled: true, backupOnly: true, reason: 'missing_key' };
  }
  return { jevEnabled: true, backupOnly: false, reason: null };
};

/** The first enabled action; at the Sell Phase, the Pokémon that action sells. */
export const fallbackAnswer = (
  request: DecisionRequest,
  fallbackReason: DecisionFallbackReason,
): DeciderAnswer => {
  const first = request.enabledActions[0]!;
  if (request.decisionPoint === 'sell') {
    const sellUids = first.kind === 'sell' ? first.payload.pokemonInstanceIds : [];
    return { sellUids, source: 'fallback', fallbackReason };
  }
  return { choice: first.id, source: 'fallback', fallbackReason };
};

/** Until the orchestrator arrives, every decision is the first enabled action. */
export const stubDecider: Decider = async (request, { status }) =>
  fallbackAnswer(request, status.reason ?? 'stub');

/** Spec §3.1: an answer that is not among the engine's options is discarded. */
export const isOption = (request: DecisionRequest, pick: DeciderPick): boolean => {
  if ('choice' in pick) {
    return (
      request.decisionPoint !== 'sell' &&
      request.enabledActions.some((action) => action.id === pick.choice)
    );
  }
  const sellable = new Set(
    request.enabledActions.flatMap((action) =>
      action.kind === 'sell' ? action.payload.pokemonInstanceIds : [],
    ),
  );
  return (
    request.decisionPoint === 'sell' &&
    new Set(pick.sellUids).size === pick.sellUids.length &&
    pick.sellUids.every((uid) => sellable.has(uid))
  );
};
