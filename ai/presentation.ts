import { createRng } from '../engine/index.ts';
import type { DecisionRequest } from '../engine/contract/decision.ts';
import type { DeciderAnswer } from './decider.ts';
import { DECISION_DEADLINE_MS } from './jev/client.ts';
import { LINES, selectLine } from './lines.ts';

/** Spec §3: the backup-bot notice speaks only while Jev is unavailable, never for normal-play fallbacks. */
const UNAVAILABLE = new Set([
  'disabled',
  'missing_key',
  'budget_exceeded',
  'timeout',
  'network',
  'rate_limited',
  'server_error',
  'auth',
]);

/** Additive HTTP headers: existing strict decision JSON and all action selection stay unchanged. */
export function presentationHeaders(
  request: Pick<DecisionRequest, 'gameId' | 'turnKey' | 'stateRevision' | 'personalityId'>,
  answer: DeciderAnswer,
): Record<string, string> {
  const headers: Record<string, string> = { 'x-ai-decision-ms': String(DECISION_DEADLINE_MS) };
  // Separate, reproducible presentation RNG; never read or advance gameplay randomness.
  if (
    answer.source === 'fallback' &&
    UNAVAILABLE.has(answer.fallbackReason) &&
    LINES.fallback_notice.some((line) => line.personality === request.personalityId)
  ) {
    const selection = selectLine(
      'fallback_notice',
      request.personalityId,
      'neutral',
      createRng(`${request.gameId}:${request.turnKey}:${request.stateRevision}:speech`),
    );
    headers['x-ai-line-id'] = selection.lineId;
    headers['x-ai-dialogue-events'] = JSON.stringify(selection.events);
  } else if (
    answer.lineId &&
    Object.values(LINES)
      .flat()
      .some((line) => line.id === answer.lineId && line.personality === request.personalityId)
  ) {
    headers['x-ai-line-id'] = answer.lineId;
    const situation = Object.entries(LINES).find(([, lines]) =>
      lines.some((line) => line.id === answer.lineId),
    )![0];
    headers['x-ai-dialogue-events'] = JSON.stringify([
      {
        kind: 'line_selected',
        situation,
        personalityId: request.personalityId,
        trustBucket: 'neutral',
        lineId: answer.lineId,
      },
    ]);
  }
  return headers;
}
