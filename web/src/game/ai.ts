export interface AiDecision {
  source: 'jev' | 'fallback';
  fallbackReason?: string;
  lineId?: string;
}
export type OpponentAnswer = AiDecision & { dialogueEvents?: unknown } & (
    { choice: string } | { sellUids: string[] }
  );

/** Presentation/network budget, not a game-rule number. Also advertised by the local server. */
export const AI_DECISION_MS = 1500;

/**
 * Both choices come from the local server. The fallback is prepared in parallel, not chosen by
 * the screen. One completion owns the decision; abort and deadline discard even uncancellable replies.
 */
export async function requestOpponent(
  body: string,
  signal: AbortSignal,
  allowed: (answer: OpponentAnswer) => boolean,
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
  const fetchAnswer = async (path: string): Promise<OpponentAnswer> => {
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
    if ('choice' in value && typeof value.choice === 'string')
      answer = { ...metadata, dialogueEvents, choice: value.choice };
    else if (
      'sellUids' in value &&
      Array.isArray(value.sellUids) &&
      value.sellUids.every((id: unknown) => typeof id === 'string')
    )
      answer = { ...metadata, dialogueEvents, sellUids: value.sellUids };
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
  void fetchAnswer('/api/ai/decide')
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
 * a failure changes nothing. The Shop has no Jev question, so it is not reported.
 */
export function reportOutcome(ids: DecisionIds, answer: OpponentAnswer): void {
  if (ids.decisionPoint === 'shop') return;
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
