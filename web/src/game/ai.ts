import type { DecisionDetail } from '../../../engine/contract/decision.ts';
import type { DemoChoice } from './demoChoice.ts';
import { readJevDetail } from './jevDetailAdapter.ts';

export interface AiDecision {
  source: 'jev' | 'fallback';
  fallbackReason?: string;
  lineId?: string;
  /** The demo-only panel's data (issue #220); never set outside demo mode, never saved. */
  demo?: DemoChoice;
}
export type OpponentAnswer = Omit<AiDecision, 'demo'> & {
  dialogueEvents?: unknown;
  /** Jev's detail, read only when the caller asked for it (demo mode). */
  detail?: DecisionDetail;
} & ({ choice: string } | { sellUids: string[] });

/** Presentation/network budget, not a game-rule number. Also advertised by the local server. */
export const AI_DECISION_MS = 1500;

/**
 * Both choices come from the local server. The fallback is prepared in parallel, not chosen by
 * the screen. One completion owns the decision; abort and deadline discard even uncancellable replies.
 * `keepDetail` is demo mode (issue #220): only then is Jev's detail read from the answer. The
 * request is the same either way, so a normal game neither asks for nor keeps it.
 */
export async function requestOpponent(
  body: string,
  signal: AbortSignal,
  allowed: (answer: OpponentAnswer) => boolean,
  keepDetail = false,
): Promise<OpponentAnswer | null> {
  if (signal.aborted) return null;
  const controller = new AbortController();
  const { promise, resolve, reject } = Promise.withResolvers<OpponentAnswer | null>();
  let fallback: OpponentAnswer | undefined;
  let failed = false;
  const abort = () => resolve(null);
  signal.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => {
    if (fallback) resolve({ ...fallback, source: 'fallback', fallbackReason: 'timeout' });
    else reject(new Error('Opponent service did not provide a fallback before the deadline'));
  }, AI_DECISION_MS);
  const fetchAnswer = async (path: string, withDetail = false): Promise<OpponentAnswer> => {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: controller.signal,
      body,
    });
    if (!response.ok) throw new Error('Opponent service failed');
    const value: unknown = await response.json();
    if (
      !value ||
      typeof value !== 'object' ||
      !('source' in value) ||
      !['jev', 'fallback'].includes(String(value.source))
    )
      throw new Error('Invalid opponent answer');
    const metadata: AiDecision = {
      source: value.source as AiDecision['source'],
      ...('fallbackReason' in value &&
        typeof value.fallbackReason === 'string' && { fallbackReason: value.fallbackReason }),
      ...(response.headers.get('x-ai-line-id') && {
        lineId: response.headers.get('x-ai-line-id')!,
      }),
    };
    let answer: OpponentAnswer;
    const annotations = response.headers.get('x-ai-dialogue-events');
    let dialogueEvents: unknown = [];
    if (annotations) {
      try {
        dialogueEvents = JSON.parse(annotations);
      } catch {
        /* Speech never changes an action. */
      }
    }
    // Never read, never kept: outside demo mode the detail is not looked at even when it is sent.
    const detail = withDetail && value.source === 'jev' ? readJevDetail(value) : undefined;
    if ('choice' in value && typeof value.choice === 'string')
      answer = { ...metadata, dialogueEvents, choice: value.choice, ...(detail && { detail }) };
    else if (
      'sellUids' in value &&
      Array.isArray(value.sellUids) &&
      value.sellUids.every((id: unknown) => typeof id === 'string')
    )
      answer = { ...metadata, dialogueEvents, sellUids: value.sellUids, ...(detail && { detail }) };
    else throw new Error('Invalid opponent answer');
    if (!allowed(answer)) throw new Error('Opponent chose an unavailable action');
    return answer;
  };
  // Attach both rejection handlers immediately: a failed speculative fallback is not an unhandled error.
  void fetchAnswer('/api/ai/fallback')
    .then((answer) => {
      if (answer.source !== 'fallback') throw new Error('Invalid fallback source');
      fallback = answer;
      if (failed) resolve({ ...answer, fallbackReason: 'network' });
    })
    .catch(() => {
      if (failed) reject(new Error('Opponent service failed'));
    });
  void fetchAnswer('/api/ai/decide', keepDetail)
    .then(resolve)
    .catch(() => {
      failed = true;
      if (fallback) resolve({ ...fallback, fallbackReason: 'network' });
    });
  try {
    return await promise;
  } finally {
    clearTimeout(timer);
    controller.abort();
    signal.removeEventListener('abort', abort);
  }
}

/** The decision an outcome report names: the request's own identifiers. */
export interface DecisionIds {
  gameId: string;
  seatIndex: number;
  turnKey: string;
  stateRevision: number;
  decisionPoint: string;
}

/**
 * Tells the local server which answer this browser applied: the server's, or its own fallback at
 * the deadline (spec §6.8). The server logs a decision only from this, so a late answer it
 * produced after the deadline never appears as applied. IDs only; best effort, never awaited, and
 * a failure changes nothing. The Shop is reported too: it has no Jev question, but the log holds
 * every AI decision, and its row says the decision was not Jev's.
 */
export function reportOutcome(ids: DecisionIds, answer: OpponentAnswer): void {
  const { source, fallbackReason } = answer;
  void fetch('/api/ai/outcome', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    keepalive: true,
    body: JSON.stringify({
      ...ids,
      ...('choice' in answer ? { choice: answer.choice } : { sellUids: answer.sellUids }),
      source,
      ...(source === 'fallback' && fallbackReason && { fallbackReason }),
    }),
  }).catch(() => {});
}
