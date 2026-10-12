import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, test, vi } from 'vitest';
import {
  MAX_INPUT_TOKENS,
  MIN_INPUT_TOKENS,
  buildSpikeRequest,
  createSpikeClient,
  estimateCost,
  isEntryPoint,
  parseCalls,
  resultsPath,
  runSpike,
  summarize,
  type CallRecord,
} from './spike.ts';

// Offline only: a placeholder key and a fake fetch. No test reads a real key or calls the network.
const PLACEHOLDER_KEY = 'placeholder-key-not-real-5e1b2d';
const PINNED = 'jev-1.13.0';

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

const answerFor = (body: Record<string, unknown>) => {
  const questions = body.questions as Record<string, { criteria: Record<string, unknown> }>;
  const answers: Record<string, unknown> = {};
  for (const [name, question] of Object.entries(questions)) {
    const labels = Object.keys(question.criteria);
    const first = labels[0] ?? '';
    answers[name] = {
      type: 'choice',
      choice: first,
      confidence: 0.5,
      probabilities: Object.fromEntries(labels.map((label) => [label, label === first ? 1 : 0])),
    };
  }
  return { model: PINNED, answers, usage: { input_tokens: 900, output_tokens: 20 } };
};

type Respond = (
  body: Record<string, unknown>,
  call: number,
  init?: RequestInit,
) => Response | Promise<Response>;

/** Answers `GET /v1/models` with the pinned model, and each `systemone` call from `respond`. */
const fakeFetch = (respond: Respond = (body) => json(answerFor(body))) => {
  const sent: Record<string, unknown>[] = [];
  const headers: Headers[] = [];
  const fetch = async (url: string, init?: RequestInit) => {
    headers.push(new Headers(init?.headers));
    if (url.endsWith('/v1/models')) {
      return json({ models: [{ name: PINNED, description: '', release_date: '2026-09-01' }] });
    }
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    sent.push(body);
    return respond(body, sent.length - 1, init);
  };
  return { fetch, sent, headers };
};

const client = (fetch: ReturnType<typeof fakeFetch>['fetch']) =>
  createSpikeClient({ apiKey: PLACEHOLDER_KEY, fetch });

describe('request builder', () => {
  const requests = Array.from({ length: 200 }, (_, index) => buildSpikeRequest(index));

  test('every request pins jev-1.13.0 and none uses jev-latest', () => {
    for (const request of requests) {
      expect(request.model).toBe(PINNED);
      expect(JSON.stringify(request)).not.toContain('jev-latest');
    }
  });

  test('a strategy Choice of 4 to 12 options with skip, plus a line Choice', () => {
    const counts = new Set<number>();
    for (const request of requests.slice(0, 100)) {
      const { strategy, line } = request.questions;
      expect(strategy?.type).toBe('choice');
      expect(line?.type).toBe('choice');
      const options = Object.keys(strategy?.type === 'choice' ? strategy.criteria : {});
      expect(options).toHaveLength(request.shape.strategyOptions);
      expect(options).toContain('skip');
      counts.add(options.length);
      const lines = Object.keys(line?.type === 'choice' ? line.criteria : {});
      expect(lines.length).toBeGreaterThanOrEqual(3);
      expect(lines.length).toBeLessThanOrEqual(5);
    }
    expect([...counts].sort((a, b) => a - b)).toEqual([4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  test('sizes vary across roughly 600 to 2,500 input tokens', () => {
    const sizes = requests.slice(0, 100).map((request) => request.shape.estimatedInputTokens);
    for (const request of requests) {
      const { targetInputTokens, estimatedInputTokens } = request.shape;
      expect(estimatedInputTokens).toBeGreaterThanOrEqual(targetInputTokens);
      expect(estimatedInputTokens).toBeLessThan(targetInputTokens + 50);
    }
    expect(Math.min(...sizes)).toBeLessThan(MIN_INPUT_TOKENS + 50);
    expect(Math.max(...sizes)).toBeGreaterThanOrEqual(MAX_INPUT_TOKENS);
  });
});

describe('runSpike with a fake fetch', () => {
  test('sends only pinned requests and records each call without the key or state bodies', async () => {
    const { fetch, sent, headers } = fakeFetch((body) =>
      json(answerFor(body), 200, { 'x-typesafe-request-id': `req_${sent.length}` }),
    );
    const result = await runSpike({ client: client(fetch), calls: 5, network: 'home', city: 'X' });

    expect(sent).toHaveLength(5);
    for (const body of sent) expect(body.model).toBe(PINNED);
    expect(headers[0]?.get('authorization')).toBe(`Bearer ${PLACEHOLDER_KEY}`);
    expect(result.modelCheck).toEqual({
      pinnedModelListed: true,
      models: [PINNED],
      errorClass: null,
    });
    expect(result.settings).toEqual({ calls: 5, timeoutMs: 1000, maxRetries: 0 });
    expect(result.calls.map((call) => call.requestId)).toEqual([
      'req_1',
      'req_2',
      'req_3',
      'req_4',
      'req_5',
    ]);
    for (const call of result.calls) {
      expect(call).toMatchObject({ status: 200, inputTokens: 900, outputTokens: 20 });
      expect(call.errorClass).toBeNull();
      expect(call.responseModel).toBe(PINNED);
      expect(call.latencyMs).toBeGreaterThanOrEqual(0);
    }
    expect(result.summary).toMatchObject({ calls: 5, okCalls: 5, meanInputTokens: 900 });

    const saved = JSON.stringify(result);
    expect(saved).not.toContain(PLACEHOLDER_KEY);
    expect(saved).not.toContain('recent_chat');
    expect(saved).not.toContain('Pickpocket');
  });

  test('records 429 with retry-after, 5xx and network failures, and waits after a 429', async () => {
    const { fetch } = fakeFetch((body, call) => {
      if (call === 0) return json({ error: 'slow down' }, 429, { 'retry-after': '2' });
      if (call === 1) return json({ error: 'boom' }, 503, { 'x-typesafe-request-id': 'req_503' });
      if (call === 2) throw new TypeError('fetch failed');
      return json(answerFor(body));
    });
    const sleep = vi.fn(async () => {});
    const result = await runSpike({ client: client(fetch), calls: 4, sleep });

    const [limited, server, network, ok] = result.calls;
    expect(limited).toMatchObject({
      status: 429,
      errorClass: 'RateLimitError',
      retryAfterMs: 2000,
    });
    expect(server).toMatchObject({
      status: 503,
      errorClass: 'InternalServerError',
      requestId: 'req_503',
    });
    expect(network).toMatchObject({ status: null, errorClass: 'APIConnectionError' });
    expect(ok).toMatchObject({ status: 200, errorClass: null });
    expect(sleep).toHaveBeenCalledExactlyOnceWith(2000);
    expect(result.summary).toMatchObject({
      okCalls: 1,
      rateLimited: 1,
      serverErrors: 1,
      retryAfterMs: [2000],
      statuses: { 200: 1, 429: 1, 503: 1, none: 1 },
    });
  });

  test('a request past 1,000 ms is cut off as a timeout, with no retry', async () => {
    // Never answers; rejects only when the SDK aborts the attempt at its timeout.
    const { fetch, sent } = fakeFetch(
      (_body, _call, init) =>
        new Promise<Response>((_, reject) =>
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason)),
        ),
    );
    const result = await runSpike({ client: client(fetch), calls: 1 });

    expect(sent).toHaveLength(1);
    expect(result.calls[0]).toMatchObject({ status: null, errorClass: 'APITimeoutError' });
    expect(result.calls[0]?.latencyMs).toBeGreaterThanOrEqual(990);
  });

  test('a 200 without usage is not counted as a usable answer', async () => {
    const { fetch } = fakeFetch(() => json({ model: PINNED, answers: {} }));
    const result = await runSpike({ client: client(fetch), calls: 1 });
    expect(result.calls[0]).toMatchObject({ status: 200, errorClass: 'InvalidResponse' });
    expect(result.summary.cost).toBeNull();
  });

  test('a failed models.list() is recorded and the calls still run', async () => {
    const { fetch } = fakeFetch();
    const failingModels = async (url: string, init?: RequestInit) =>
      url.endsWith('/v1/models') ? json({ error: 'nope' }, 401) : fetch(url, init);
    const result = await runSpike({ client: client(failingModels), calls: 1 });
    expect(result.modelCheck).toEqual({
      pinnedModelListed: false,
      models: [],
      errorClass: 'AuthenticationError',
    });
    expect(result.calls).toHaveLength(1);
  });
});

const record = (latencyMs: number, overrides: Partial<CallRecord> = {}): CallRecord => ({
  index: 0,
  latencyMs,
  status: 200,
  requestId: null,
  inputTokens: 2500,
  outputTokens: 24,
  errorClass: null,
  retryAfterMs: null,
  responseModel: PINNED,
  shape: { strategyOptions: 4, lineOptions: 3, targetInputTokens: 600, estimatedInputTokens: 600 },
  ...overrides,
});

describe('summarize', () => {
  test('nearest-rank p50, p95 and max over 100 calls', () => {
    const records = Array.from({ length: 100 }, (_, i) => record(i + 1));
    expect(summarize(records).latencyMs).toEqual({ p50: 50, p95: 95, max: 100 });
    expect(summarize(records).p95AboveRequestDeadline).toBe(false);
  });

  test('timeouts count toward p95 and can push it past the request deadline', () => {
    const records = [
      ...Array.from({ length: 90 }, () => record(300)),
      ...Array.from({ length: 10 }, () =>
        record(1003, {
          status: null,
          inputTokens: null,
          outputTokens: null,
          errorClass: 'APITimeoutError',
        }),
      ),
    ];
    const summary = summarize(records);
    expect(summary.latencyMs).toEqual({ p50: 300, p95: 1003, max: 1003 });
    expect(summary.okLatencyMs).toEqual({ p50: 300, p95: 300, max: 300 });
    expect(summary.p95AboveRequestDeadline).toBe(true);
    expect(summary.errorClasses).toEqual({ none: 90, APITimeoutError: 10 });
  });

  test('the spec §9 estimate: 2,500 tokens × 140 requests is about $0.015 per game', () => {
    expect(estimateCost(2500)).toEqual([
      { games: 1, inputTokens: 350_000, usd: 0.0147, thb: 0.4851 },
      { games: 300, inputTokens: 105_000_000, usd: 4.41, thb: 145.53 },
      { games: 1000, inputTokens: 350_000_000, usd: 14.7, thb: 485.1 },
    ]);
    expect(summarize([record(200), record(300, { inputTokens: 1500 })]).meanInputTokens).toBe(2000);
  });
});

describe('command line', () => {
  test('a second run on the same day does not overwrite the first', () => {
    const taken = new Set([
      join('r', 'spike-2026-10-12.json'),
      join('r', 'spike-2026-10-12-2.json'),
    ]);
    expect(resultsPath('r', '2026-10-12', (path) => taken.has(String(path)))).toBe(
      join('r', 'spike-2026-10-12-3.json'),
    );
    expect(resultsPath('r', '2026-10-13', () => false)).toBe(join('r', 'spike-2026-10-13.json'));
  });

  test('--calls takes a positive whole number', () => {
    expect(parseCalls('100')).toBe(100);
    for (const bad of ['0', '-1', '1.5', 'many', '']) expect(() => parseCalls(bad)).toThrow();
  });

  test('the script only runs when invoked directly', () => {
    const script = join(import.meta.dirname, 'spike.ts');
    const url = pathToFileURL(script).href;
    expect(isEntryPoint(url, script)).toBe(true);
    expect(isEntryPoint(url, join(import.meta.dirname, 'other.ts'))).toBe(false);
    expect(isEntryPoint(url, undefined)).toBe(false);
  });
});
