import { APIPromise, choice, noul, score } from '@typesafe-ai/sdk';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  createSdkJevClient,
  decisionDeadline,
  PINNED_JEV_MODEL,
  type JevRequest,
  type JevResult,
} from './client.ts';
import { UsageMeter } from './usage.ts';

// Offline only: a placeholder key and a fake fetch. No test reads a real key or calls the network.
const KEY_ENV = 'TYPESAFE_API_KEY';
const PLACEHOLDER_KEY = 'placeholder-key-not-real-7f3c9a';
const REQUEST_ID = 'req_test_123';

const request: JevRequest = {
  state: { you: { id: 'P2', coins_rank: '2nd of 4' }, secret_note: 'state-body-marker' },
  questions: {
    strategy: choice('Pick the ONE action that fits you.', {
      a1: 'Attack P1.',
      skip: 'Do nothing.',
    }),
    sell: noul('Should team[0] be sold now?'),
    risk: score('How risky is the board?', ['low', 'medium', 'high']),
  },
};

const okBody = {
  model: PINNED_JEV_MODEL,
  answers: {
    strategy: {
      type: 'choice',
      choice: 'a1',
      probabilities: { a1: 0.7, skip: 0.3 },
      confidence: 0.4,
    },
    sell: { type: 'noul', noul: 0.2 },
    risk: {
      type: 'score',
      score: 1.2,
      confidence: 0.5,
      probabilities: { 0: 0.1, 1: 0.6, 2: 0.3 },
      legend: { 0: 'low', 1: 'medium', 2: 'high' },
    },
  },
  usage: { input_tokens: 612, output_tokens: 24 },
};

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'x-typesafe-request-id': REQUEST_ID,
      ...headers,
    },
  });

interface SeenRequest {
  url: string;
  headers: Headers;
  body: Record<string, unknown>;
}

/** A fake `fetch` that records each request and answers from `respond`, ignoring its abort signal. */
const fakeFetch = (respond: () => Response | Promise<Response>) => {
  const seen: SeenRequest[] = [];
  const fetch = async (url: string, init?: RequestInit) => {
    seen.push({
      url,
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    });
    return respond();
  };
  return { fetch, seen };
};

const never = () => new Promise<Response>(() => {});
const after = <T>(ms: number, value: () => T) =>
  new Promise<T>((resolve) => setTimeout(() => resolve(value()), ms));

const ask = (fetch: ReturnType<typeof fakeFetch>['fetch'], signal = decisionDeadline()) =>
  createSdkJevClient({ fetch }).ask(request, { decisionSignal: signal });

beforeEach(() => {
  vi.stubEnv(KEY_ENV, PLACEHOLDER_KEY);
  vi.stubEnv('JEV_ENABLED', '');
  vi.stubEnv('JEV_MODEL', '');
  // Neither may change what the wrapper sends or prints.
  vi.stubEnv('TYPESAFE_DEFAULT_MODEL', 'jev-latest');
  vi.stubEnv('TYPESAFE_LOG_LEVEL', 'debug');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('model pinning', () => {
  test('every request body carries the pinned model', async () => {
    const { fetch, seen } = fakeFetch(() => json(okBody));
    const client = createSdkJevClient({ fetch });
    for (let i = 0; i < 3; i++) {
      expect((await client.ask(request, { decisionSignal: decisionDeadline() })).ok).toBe(true);
    }
    expect(seen).toHaveLength(3);
    for (const { url, body } of seen) {
      expect(url).toBe('https://api.typesafe.ai/v1/systemone');
      expect(body.model).toBe('jev-1.13.0');
    }
  });

  test.each(['jev-latest', 'gpt-4', 'jev-2.0.0', 'jev-1'])('JEV_MODEL=%s throws', (model) => {
    vi.stubEnv('JEV_MODEL', model);
    expect(() => createSdkJevClient({ fetch: fakeFetch(never).fetch })).toThrow(/JEV_MODEL/);
  });

  test('JEV_MODEL may pin another jev-1.* release', async () => {
    vi.stubEnv('JEV_MODEL', 'jev-1.14.0');
    const { fetch, seen } = fakeFetch(() => json({ ...okBody, model: 'jev-1.14.0' }));
    expect((await ask(fetch)).ok).toBe(true);
    expect(seen[0]?.body.model).toBe('jev-1.14.0');
  });
});

describe('deadlines', () => {
  test('a fetch that never answers returns timeout within 1,100 ms', async () => {
    const { fetch, seen } = fakeFetch(never);
    const started = performance.now();
    const result = await ask(fetch);
    const elapsed = performance.now() - started;
    expect(result).toEqual({ ok: false, fallbackReason: 'timeout' });
    expect(elapsed).toBeGreaterThanOrEqual(990);
    expect(elapsed).toBeLessThan(1100);
    expect(seen).toHaveLength(1);
  });

  test('an answer that lands after the 1,500 ms decision deadline is discarded', async () => {
    const decision = decisionDeadline();
    const started = performance.now();
    // The decision's first request uses up 1,000 ms without an answer.
    expect(await ask(fakeFetch(never).fetch, decision)).toMatchObject({
      fallbackReason: 'timeout',
    });
    // The second answers successfully at ~1,800 ms: inside its own 1,000 ms, but past the decision.
    let lateAnswerSent = () => {};
    const sent = new Promise<void>((resolve) => (lateAnswerSent = resolve));
    const slow = fakeFetch(() =>
      after(800, () => {
        lateAnswerSent();
        return json(okBody);
      }),
    );
    const result = await ask(slow.fetch, decision);
    const elapsed = performance.now() - started;
    expect(result).toEqual({ ok: false, fallbackReason: 'timeout' });
    expect(elapsed).toBeGreaterThanOrEqual(1490);
    expect(elapsed).toBeLessThan(1600);
    await sent;
    expect(result.ok).toBe(false);
  });

  test('a decision already past its deadline sends nothing', async () => {
    const { fetch, seen } = fakeFetch(() => json(okBody));
    expect(await ask(fetch, AbortSignal.abort())).toEqual({
      ok: false,
      fallbackReason: 'timeout',
      requestSent: false,
    });
    expect(seen).toHaveLength(0);
  });
});

describe('error taxonomy', () => {
  const wrongChoice = {
    ...okBody,
    answers: { ...okBody.answers, strategy: { ...okBody.answers.strategy, choice: 'a9' } },
  };
  const cases: [string, () => Response | Promise<Response>, JevResult][] = [
    [
      '429 with retry-after',
      () => json({ error: 'slow down' }, 429, { 'retry-after': '2' }),
      { ok: false, fallbackReason: 'rate_limited', status: 429, retryAfterMs: 2000 },
    ],
    [
      '429 without retry-after',
      () => json({}, 429),
      { ok: false, fallbackReason: 'rate_limited', status: 429 },
    ],
    [
      '500',
      () => json({ error: 'boom' }, 500),
      { ok: false, fallbackReason: 'server_error', status: 500 },
    ],
    ['503', () => json({}, 503), { ok: false, fallbackReason: 'server_error', status: 503 }],
    [
      '401',
      () => json({ error: 'bad key' }, 401),
      { ok: false, fallbackReason: 'auth', status: 401 },
    ],
    ['403', () => json({}, 403), { ok: false, fallbackReason: 'auth', status: 403 }],
    ['408', () => json({}, 408), { ok: false, fallbackReason: 'timeout', status: 408 }],
    ['422', () => json({}, 422), { ok: false, fallbackReason: 'schema_mismatch', status: 422 }],
    [
      'a non-JSON body',
      () => new Response('<html>oops</html>', { status: 200 }),
      { ok: false, fallbackReason: 'schema_mismatch' },
    ],
    [
      'an empty body',
      () => new Response('', { status: 200 }),
      { ok: false, fallbackReason: 'schema_mismatch' },
    ],
    [
      'a body without usage',
      () => json({ model: okBody.model, answers: okBody.answers }),
      { ok: false, fallbackReason: 'schema_mismatch' },
    ],
    [
      'a choice outside the options',
      () => json(wrongChoice),
      { ok: false, fallbackReason: 'schema_mismatch' },
    ],
    [
      'a missing answer',
      () => json({ ...okBody, answers: { strategy: okBody.answers.strategy } }),
      { ok: false, fallbackReason: 'schema_mismatch' },
    ],
    [
      'an answer from another model',
      () => json({ ...okBody, model: 'jev-1.12.0' }),
      { ok: false, fallbackReason: 'schema_mismatch' },
    ],
    [
      'a connection failure',
      () => Promise.reject(new TypeError('fetch failed')),
      { ok: false, fallbackReason: 'network' },
    ],
  ];

  test.each(cases)(
    '%s maps to its fallback reason and is not retried',
    async (_, respond, expected) => {
      const { fetch, seen } = fakeFetch(respond);
      expect(await ask(fetch)).toEqual(expected);
      expect(seen).toHaveLength(1);
    },
  );

  test('a malformed question is rejected without a request', async () => {
    const { fetch, seen } = fakeFetch(() => json(okBody));
    const client = createSdkJevClient({ fetch });
    const result = await client.ask(
      { state: null, questions: {} },
      { decisionSignal: decisionDeadline() },
    );
    expect(result).toEqual({ ok: false, fallbackReason: 'schema_mismatch', requestSent: false });
    expect(seen).toHaveLength(0);
  });
});

describe('kill switch', () => {
  test.each(['false', 'FALSE', ' false '])(
    'JEV_ENABLED=%s makes zero fetch calls',
    async (value) => {
      vi.stubEnv('JEV_ENABLED', value);
      const { fetch, seen } = fakeFetch(() => json(okBody));
      expect(await ask(fetch)).toEqual({ ok: false, fallbackReason: 'disabled' });
      expect(seen).toHaveLength(0);
    },
  );

  test('a disabled client needs no key', async () => {
    vi.stubEnv('JEV_ENABLED', 'false');
    vi.stubEnv(KEY_ENV, '');
    expect(await ask(fakeFetch(never).fetch)).toEqual({ ok: false, fallbackReason: 'disabled' });
  });

  test('an enabled client without a key throws', () => {
    vi.stubEnv(KEY_ENV, '');
    expect(() => createSdkJevClient({ fetch: fakeFetch(never).fetch })).toThrow(
      /JEV_ENABLED=false/,
    );
  });
});

describe('success results', () => {
  test('carry the request ID from .withResponse(), latency and usage that feeds the meter', async () => {
    const withResponse = vi.spyOn(APIPromise.prototype, 'withResponse');
    const { fetch } = fakeFetch(() => json(okBody));
    const client = createSdkJevClient({ fetch });
    const meter = new UsageMeter();
    const result = await client.ask(request, { decisionSignal: decisionDeadline() });
    meter.record(result);
    meter.record(await client.ask(request, { decisionSignal: decisionDeadline() }));
    expect(withResponse).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      ok: true,
      answers: {
        strategy: okBody.answers.strategy,
        sell: okBody.answers.sell,
        risk: {
          type: 'score',
          score: 1.2,
          confidence: 0.5,
          probabilities: { 0: 0.1, 1: 0.6, 2: 0.3 },
        },
      },
      requestId: REQUEST_ID,
      model: PINNED_JEV_MODEL,
      latencyMs: expect.any(Number),
      usage: { inputTokens: 612, outputTokens: 24 },
    });
    expect(meter.totals()).toEqual({ calls: 2, inputTokens: 1224, outputTokens: 48 });
  });

  test('a missing request ID header leaves requestId undefined', async () => {
    const { fetch } = fakeFetch(
      () =>
        new Response(JSON.stringify(okBody), { headers: { 'content-type': 'application/json' } }),
    );
    expect(await ask(fetch)).toMatchObject({ ok: true, requestId: undefined });
  });
});

describe('the API key', () => {
  test('is read from TYPESAFE_API_KEY in the environment', async () => {
    const { fetch, seen } = fakeFetch(() => json(okBody));
    expect((await ask(fetch)).ok).toBe(true);
    expect(seen[0]?.headers.get('authorization')).toBe(`Bearer ${PLACEHOLDER_KEY}`);
  });

  test('never appears in thrown errors, results or logged output', async () => {
    const logged: unknown[] = [];
    for (const method of ['debug', 'info', 'log', 'warn', 'error'] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => void logged.push(args));
    }
    const writes = (stream: NodeJS.WriteStream) =>
      vi.spyOn(stream, 'write').mockImplementation((chunk: unknown) => {
        logged.push(String(chunk));
        return true;
      });
    writes(process.stdout);
    writes(process.stderr);

    const responders = [
      () => json(okBody),
      () => json({}, 401),
      () => json({}, 429, { 'retry-after': '1' }),
      () => json({}, 500),
      () => new Response('not json'),
      () => Promise.reject(new TypeError('fetch failed')),
    ];
    const results: JevResult[] = [];
    const sentKeys: (string | null)[] = [];
    for (const respond of responders) {
      const { fetch, seen } = fakeFetch(respond);
      results.push(await ask(fetch));
      sentKeys.push(seen[0]?.headers.get('authorization') ?? null);
    }
    results.push(await ask(fakeFetch(never).fetch));

    const thrown: unknown[] = [];
    for (const model of ['jev-latest', 'other']) {
      vi.stubEnv('JEV_MODEL', model);
      try {
        createSdkJevClient({ fetch: fakeFetch(never).fetch });
      } catch (error) {
        thrown.push(error);
      }
    }
    vi.stubEnv('JEV_MODEL', '');
    vi.restoreAllMocks();

    // The key really was in use, so its absence below means something.
    expect(sentKeys.every((header) => header === `Bearer ${PLACEHOLDER_KEY}`)).toBe(true);
    expect(thrown).toHaveLength(2);
    const errorText = thrown
      .map((error) => `${String(error)} ${(error as Error).stack}`)
      .join('\n');
    expect(errorText).not.toContain(PLACEHOLDER_KEY);
    expect(JSON.stringify(results)).not.toContain(PLACEHOLDER_KEY);
    // TYPESAFE_LOG_LEVEL=debug is set, yet nothing is printed: no key, no request bodies.
    expect(logged).toEqual([]);
  });
});
