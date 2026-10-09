import {
  APIConnectionError,
  APIError,
  APITimeoutError,
  APIUserAbortError,
  AuthenticationError,
  PermissionDeniedError,
  RateLimitError,
  TypeSafeClient,
  TypeSafeError,
  type EntryType,
  type Fetch,
  type Questions,
} from '@typesafe-ai/sdk';
import { z } from 'zod';

// Spec §5.1: pin the release, because `jev-latest` moves when a new one ships.
export const PINNED_JEV_MODEL = 'jev-1.13.0';
// Spec §5.6: 1,000 ms per request and 1,500 ms per decision.
export const REQUEST_TIMEOUT_MS = 1000;
export const DECISION_DEADLINE_MS = 1500;

/** One Jev request: role-scoped state and the questions of one decision point. The model is pinned here. */
export interface JevRequest {
  state: EntryType;
  questions: Questions;
}

const probability = z.number().min(0).max(1);
const tokenCount = z.int().nonnegative();
const answerSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('choice'),
    choice: z.string(),
    confidence: probability,
    probabilities: z.record(z.string(), probability),
  }),
  z.object({
    type: z.literal('score'),
    score: z.number(),
    confidence: probability,
    probabilities: z.record(z.string(), probability),
  }),
  // Noul answers carry no confidence.
  z.object({ type: z.literal('noul'), noul: probability }),
]);
// The SDK does not validate the body: a non-JSON body arrives as a plain string.
const responseSchema = z.object({
  model: z.string(),
  answers: z.record(z.string(), answerSchema),
  usage: z.object({ input_tokens: tokenCount, output_tokens: tokenCount }),
});

export type JevAnswer = z.infer<typeof answerSchema>;

export interface JevUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface JevSuccess {
  ok: true;
  answers: Record<string, JevAnswer>;
  /** From `x-typesafe-request-id` via `.withResponse()`, for the replay log (spec §6.8). */
  requestId: string | undefined;
  model: string;
  latencyMs: number;
  usage: JevUsage;
}

export type FallbackReason =
  'timeout' | 'rate_limited' | 'server_error' | 'auth' | 'network' | 'schema_mismatch' | 'disabled';

export interface JevFailure {
  ok: false;
  fallbackReason: FallbackReason;
  status?: number;
  retryAfterMs?: number;
}

export type JevResult = JevSuccess | JevFailure;

export interface AskOptions {
  /** Aborts at the decision's deadline; an answer arriving after it fires is discarded. */
  decisionSignal: AbortSignal;
}

/** What the rest of `ai/` depends on, so tests, the offline eval and replays never need a key. */
export interface JevClient {
  /** Never throws and never retries: every unusable answer becomes a `JevFailure`. */
  ask(request: JevRequest, options: AskOptions): Promise<JevResult>;
}

export interface SdkJevClientOptions {
  /** Defaults to `TYPESAFE_API_KEY` from the server's environment. */
  apiKey?: string;
  /** Inject a fake for offline tests. Defaults to the global `fetch`. */
  fetch?: Fetch;
}

/** The deadline for one decision; share it across every request of that decision. */
export const decisionDeadline = (ms = DECISION_DEADLINE_MS): AbortSignal => AbortSignal.timeout(ms);

const fail = (fallbackReason: FallbackReason, status?: number, retryAfterMs?: number) => {
  const failure: JevFailure = { ok: false, fallbackReason };
  if (status !== undefined) failure.status = status;
  if (retryAfterMs !== undefined) failure.retryAfterMs = retryAfterMs;
  return failure;
};

export const disabledJevClient: JevClient = { ask: async () => fail('disabled') };

/** Spec §9 kill switch: `JEV_ENABLED=false` puts every AI on the fallback policy. */
export const jevEnabled = (): boolean => process.env.JEV_ENABLED?.trim().toLowerCase() !== 'false';

/** `JEV_MODEL` may override the pinned model, but only with a pinned `jev-1.*` release. */
export const resolveJevModel = (): string => {
  const model = process.env.JEV_MODEL?.trim() || PINNED_JEV_MODEL;
  if (model === 'jev-latest' || !model.startsWith('jev-1.')) {
    throw new Error(
      `JEV_MODEL "${model}" is not allowed: pin a jev-1.* release such as ${PINNED_JEV_MODEL}.`,
    );
  }
  return model;
};

/** The real wrapper. Construct it with a placeholder key and a fake `fetch` to run offline. */
export const createSdkJevClient = (options: SdkJevClientOptions = {}): JevClient => {
  if (!jevEnabled()) return disabledJevClient;
  const model = resolveJevModel();
  // The key lives only in the server's environment (spec §9) and is never echoed.
  const apiKey = options.apiKey ?? process.env.TYPESAFE_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      'Jev is enabled but TYPESAFE_API_KEY is not set. Set JEV_ENABLED=false to play on the fallback policy.',
    );
  }
  const sdk = new TypeSafeClient({
    apiKey,
    defaultModel: model,
    timeout: REQUEST_TIMEOUT_MS,
    // Spec §5.6: no retries, because the SDK has no total retry budget.
    retry: { maxRetries: 0 },
    dangerouslyAllowBrowser: false,
    // Explicit, so TYPESAFE_LOG_LEVEL=debug cannot make the SDK print request or response bodies.
    logLevel: 'warn',
    ...(options.fetch && { fetch: options.fetch }),
  });
  return { ask: (request, { decisionSignal }) => askSdk(sdk, model, request, decisionSignal) };
};

const askSdk = async (
  sdk: TypeSafeClient,
  model: string,
  request: JevRequest,
  decisionSignal: AbortSignal,
): Promise<JevResult> => {
  if (decisionSignal.aborted) return fail('timeout');
  const requestDeadline = new AbortController();
  const signal = AbortSignal.any([decisionSignal, requestDeadline.signal]);
  const timer = setTimeout(() => requestDeadline.abort(), REQUEST_TIMEOUT_MS);
  // Our own deadline, so `ask` returns on time even when `fetch` ignores its abort signal.
  let onAbort = () => {};
  const deadline = new Promise<JevResult>((resolve) => {
    onAbort = () => resolve(fail('timeout'));
    signal.addEventListener('abort', onAbort, { once: true });
  });
  const started = performance.now();
  const call = (async (): Promise<JevResult> => {
    try {
      const { data, requestId } = await sdk
        .systemOne({ model, state: request.state, questions: request.questions }, { signal })
        .withResponse();
      return toSuccess(data, request, model, requestId, Math.round(performance.now() - started));
    } catch (error) {
      return toFailure(error);
    }
  })();
  try {
    const result = await Promise.race([call, deadline]);
    // A response that lands after either deadline is discarded, never returned as success.
    return signal.aborted ? fail('timeout') : result;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', onAbort);
  }
};

const toSuccess = (
  data: unknown,
  request: JevRequest,
  model: string,
  requestId: string | undefined,
  latencyMs: number,
): JevResult => {
  const parsed = responseSchema.safeParse(data);
  if (!parsed.success || parsed.data.model !== model) return fail('schema_mismatch');
  const { answers, usage } = parsed.data;
  if (!answersMatch(request.questions, answers)) return fail('schema_mismatch');
  return {
    ok: true,
    answers,
    requestId,
    model,
    latencyMs,
    usage: { inputTokens: usage.input_tokens, outputTokens: usage.output_tokens },
  };
};

/** Every question is answered with its own type, and every label is one the question offered. */
const answersMatch = (questions: Questions, answers: Record<string, JevAnswer>): boolean => {
  const names = Object.keys(questions);
  if (Object.keys(answers).length !== names.length) return false;
  return names.every((name) => {
    const question = questions[name];
    const answer = answers[name];
    if (!question || !answer || question.type !== answer.type) return false;
    if (question.type === 'noul' || answer.type === 'noul') return true;
    const labels = Object.keys(question.criteria);
    const known = (label: string) => labels.includes(label);
    if (!Object.keys(answer.probabilities).every(known)) return false;
    if (answer.type === 'choice') return known(answer.choice);
    return answer.score >= 0 && answer.score <= labels.length - 1;
  });
};

const toFailure = (error: unknown): JevFailure => {
  if (error instanceof RateLimitError)
    return fail('rate_limited', error.status, error.retryAfterMs);
  if (error instanceof AuthenticationError || error instanceof PermissionDeniedError) {
    return fail('auth', error.status);
  }
  if (error instanceof APIError) {
    if (error.status === 408) return fail('timeout', error.status);
    if (error.status >= 500) return fail('server_error', error.status);
    // Any other 4xx means the request did not match the API's schema.
    return fail('schema_mismatch', error.status);
  }
  if (error instanceof APITimeoutError || error instanceof APIUserAbortError)
    return fail('timeout');
  if (error instanceof APIConnectionError) return fail('network');
  // The SDK rejects malformed questions (none, or a bad score rubric) before sending.
  if (error instanceof TypeSafeError) return fail('schema_mismatch');
  return fail('network');
};
