import { z } from 'zod';
import {
  defaultUsageLedger,
  SPEND_CONFIG,
  type SpendConfig,
  type UsageLine,
  type UsageRecorder,
} from '../jev/spend.ts';
import { haikuApiKey, haikuEnabled } from './status.ts';

// Spec §5.2, §9: one pinned model, one fixed host. The ID is the published one, read 15 Nov 2026.
export const PINNED_HAIKU_MODEL = 'claude-haiku-5-5';
export const HAIKU_ENDPOINT = 'https://api.anthropic.com/v1/messages';
/**
 * One line of speech has 3,000 ms (issue #214: table talk may wait about 3 s; it never holds up a
 * decision, which keeps Jev's own 1,000 ms and 1,500 ms deadlines); a late answer is discarded.
 */
export const HAIKU_DEADLINE_MS = 3000;
/** A line is at most 140 characters, so a small ceiling; thinking is off, so none of it is spent thinking. */
export const MAX_OUTPUT_TOKENS = 80;
/** A reply is one short message; anything larger is not one. */
export const MAX_RESPONSE_BYTES = 16 * 1024;

/** One request for a line of text. The prompts come from the speech brief, never from this client. */
export interface HaikuRequest {
  gameId: string;
  turnKey: string;
  system: string;
  prompt: string;
}

export interface HaikuUsage {
  inputTokens: number;
  outputTokens: number;
}

export type HaikuFallbackReason =
  | 'disabled'
  | 'missing_key'
  | 'budget_exceeded'
  | 'timeout'
  | 'network'
  | 'rate_limited'
  | 'server_error'
  | 'auth'
  | 'refused'
  | 'unsafe_response';

export interface HaikuSuccess {
  ok: true;
  text: string;
  model: string;
  latencyMs: number;
  /** What the request counts toward the caps (spec §9). */
  usage: HaikuUsage;
}

export interface HaikuFailure {
  ok: false;
  fallbackReason: HaikuFallbackReason;
  status?: number;
  /** Set when no request went out: it spent nothing and wrote no usage line. */
  requestSent?: false;
  /** What a request that did go out counts toward the caps, even though its answer is unusable. */
  usage?: HaikuUsage;
}

export type HaikuResult = HaikuSuccess | HaikuFailure;

/** What the rest of `ai/` depends on, so tests, replays and the sim never need a key or the network. */
export interface HaikuClient {
  /** Never throws and never retries: every unusable answer becomes a `HaikuFailure`. */
  write(request: HaikuRequest): Promise<HaikuResult>;
}

export interface HaikuClientOptions {
  /** The spend guard and usage log; made on first request that could go out. Defaults to the shared ledger. */
  usage?: () => UsageRecorder;
  /** `ANTHROPIC_API_KEY` and `HAIKU_ENABLED`; defaults to the server's environment. */
  env?: NodeJS.ProcessEnv;
  /** Inject a fake for offline tests. Defaults to the global `fetch`. */
  fetch?: typeof fetch;
  deadlineMs?: number;
  config?: SpendConfig;
  now?: () => Date;
}

const count = z.int().nonnegative();
const usageBody = z.looseObject({
  usage: z.looseObject({ input_tokens: count, output_tokens: count }),
});
const messageBody = z.looseObject({
  model: z.string(),
  stop_reason: z.string().nullable(),
  content: z.array(z.looseObject({ type: z.string(), text: z.string().optional() })),
});

/** What one exchange with the provider came to, before it is billed and logged. */
interface Exchange {
  reason: 'ok' | Exclude<HaikuFallbackReason, 'disabled' | 'missing_key' | 'budget_exceeded'>;
  status?: number;
  text?: string;
  /** Tokens the provider reported, even for an answer that is not used. */
  reported?: HaikuUsage;
}

const notSent = (fallbackReason: HaikuFallbackReason): HaikuFailure => ({
  ok: false,
  fallbackReason,
  requestSent: false,
});

/** A body that is not a message still bills what it reports, and one that reports nothing bills nothing. */
const reportedUsage = (json: unknown): HaikuUsage | undefined => {
  const body = usageBody.safeParse(json);
  return body.success
    ? { inputTokens: body.data.usage.input_tokens, outputTokens: body.data.usage.output_tokens }
    : undefined;
};

/** Reads the body up to `MAX_RESPONSE_BYTES`; `undefined` once it is larger. */
const readCapped = async (response: Response): Promise<string | undefined> => {
  const declared = Number(response.headers.get('content-length'));
  if (declared > MAX_RESPONSE_BYTES) {
    await response.body?.cancel();
    return undefined;
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return text + decoder.decode();
    received += value.byteLength;
    if (received > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      return undefined;
    }
    text += decoder.decode(value, { stream: true });
  }
};

const failed = (status: number): Exchange => {
  if (status === 401 || status === 403) return { reason: 'auth', status };
  if (status === 429) return { reason: 'rate_limited', status };
  if (status === 408) return { reason: 'timeout', status };
  // Any other non-200 reply, a 400 or 404 included, is the provider not completing the request.
  return { reason: 'server_error', status };
};

const interpret = (apiKey: string, body: string): Exchange => {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return { reason: 'unsafe_response' };
  }
  const reported = reportedUsage(json);
  const unsafe: Exchange = { reason: 'unsafe_response', ...(reported && { reported }) };
  // A provider must not be able to reflect the credential into a line anyone is shown.
  if (body.includes(apiKey)) return unsafe;
  const message = messageBody.safeParse(json);
  if (!message.success || message.data.model !== PINNED_HAIKU_MODEL) return unsafe;
  if (message.data.stop_reason === 'refusal') {
    return { reason: 'refused', ...(reported && { reported }) };
  }
  // `max_tokens` would be a line cut off mid-sentence.
  if (message.data.stop_reason !== 'end_turn') return unsafe;
  let text = '';
  for (const block of message.data.content) {
    if (block.type === 'thinking' || block.type === 'redacted_thinking') continue;
    if (block.type !== 'text' || block.text === undefined) return unsafe;
    text += block.text;
  }
  text = text.trim();
  if (text === '' || !reported) return unsafe;
  return { reason: 'ok', text, reported };
};

const exchange = async (
  fetchImpl: typeof fetch,
  apiKey: string,
  request: HaikuRequest,
  signal: AbortSignal,
): Promise<Exchange> => {
  try {
    const response = await fetchImpl(HAIKU_ENDPOINT, {
      method: 'POST',
      // A redirect would carry the key to another host.
      redirect: 'error',
      signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: PINNED_HAIKU_MODEL,
        max_tokens: MAX_OUTPUT_TOKENS,
        thinking: { type: 'disabled' },
        output_config: { effort: 'low' },
        stream: false,
        system: request.system,
        messages: [{ role: 'user', content: request.prompt }],
      }),
    });
    if (response.status !== 200) {
      // An error body is never read: it is not ours to log or show.
      await response.body?.cancel();
      return failed(response.status);
    }
    const body = await readCapped(response);
    if (body === undefined) return { reason: 'unsafe_response' };
    return interpret(apiKey, body);
  } catch {
    return { reason: 'network' };
  }
};

/**
 * The real client over plain HTTPS: fixed host, no redirects, no retries, no streaming, thinking
 * off at low effort. With `HAIKU_ENABLED` not `true`, no key or a spent cap, no request is made.
 */
export const createHaikuClient = ({
  usage = defaultUsageLedger,
  env = process.env,
  fetch: fetchImpl = globalThis.fetch,
  deadlineMs = HAIKU_DEADLINE_MS,
  config = SPEND_CONFIG,
  now = () => new Date(),
}: HaikuClientOptions = {}): HaikuClient => ({
  async write(request) {
    if (!haikuEnabled(env)) return notSent('disabled');
    const apiKey = haikuApiKey(env);
    if (!apiKey) return notSent('missing_key');
    const ledger = usage();
    if (ledger.budgetExceeded('haiku')) return notSent('budget_exceeded');

    const time = now().toISOString();
    const started = performance.now();
    const deadline = new AbortController();
    const timer = setTimeout(() => deadline.abort(), deadlineMs);
    // Our own deadline, so `write` returns on time even when `fetch` ignores its abort signal.
    const { promise: expired, resolve } = Promise.withResolvers<Exchange>();
    const onAbort = () => resolve({ reason: 'timeout' });
    deadline.signal.addEventListener('abort', onAbort, { once: true });
    let outcome: Exchange;
    try {
      outcome = await Promise.race([
        exchange(fetchImpl, apiKey, request, deadline.signal),
        expired,
      ]);
      // An answer that lands after the deadline is discarded, never returned.
      if (deadline.signal.aborted) outcome = { reason: 'timeout' };
    } finally {
      clearTimeout(timer);
      deadline.signal.removeEventListener('abort', onAbort);
    }
    const latencyMs = Math.round(performance.now() - started);

    // The tokens the request counts: what was reported, else the estimate for a request whose
    // answer is lost (timeout) or unreadable, else none (it was refused before any work).
    const estimated =
      outcome.reported === undefined &&
      (outcome.reason === 'timeout' || outcome.reason === 'unsafe_response');
    const billed: HaikuUsage =
      outcome.reported ??
      (estimated
        ? {
            inputTokens: config.estimatedHaikuInputTokensPerRequest,
            outputTokens: config.estimatedHaikuOutputTokensPerRequest,
          }
        : { inputTokens: 0, outputTokens: 0 });
    const line: UsageLine = {
      time,
      provider: 'haiku',
      gameId: request.gameId,
      // The provider's request ID is not logged: a header is the provider's text, not ours.
      requestId: null,
      model: PINNED_HAIKU_MODEL,
      ...billed,
      latencyMs,
      status: outcome.reason,
      turnKey: request.turnKey,
      decision: 0,
      decisionMs: latencyMs,
      ...(estimated && { estimated: true }),
    };
    try {
      ledger.record(line);
    } catch (error) {
      console.warn(`Could not write the Haiku usage log: ${String(error)}`);
    }

    if (outcome.reason === 'ok') {
      return { ok: true, text: outcome.text!, model: PINNED_HAIKU_MODEL, latencyMs, usage: billed };
    }
    return {
      ok: false,
      fallbackReason: outcome.reason,
      ...(outcome.status !== undefined && { status: outcome.status }),
      usage: billed,
    };
  },
});
