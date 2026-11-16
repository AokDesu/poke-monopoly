import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  SPEND_CONFIG,
  SpendLedger,
  type SpendConfig,
  type UsageLine,
  type UsageRecorder,
} from '../jev/spend.ts';
import {
  createHaikuClient,
  HAIKU_DEADLINE_MS,
  HAIKU_ENDPOINT,
  MAX_RESPONSE_BYTES,
  PINNED_HAIKU_MODEL,
  type HaikuRequest,
} from './client.ts';
import { speechStatus } from './status.ts';

const KEY = 'placeholder-haiku-key-not-real-7f3a91';
const ON = { HAIKU_ENABLED: 'true', ANTHROPIC_API_KEY: KEY };
const REQUEST: HaikuRequest = {
  gameId: 'game-1',
  turnKey: 'turn-4',
  system: 'Write one short line.',
  prompt: 'The table just saw a big trade.',
};

const message = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: PINNED_HAIKU_MODEL,
    content: [{ type: 'text', text: ' Nice roll! ' }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 1200, output_tokens: 12 },
    ...over,
  });

const fakeFetch = (respond: (url: string, init: RequestInit) => Response | Promise<Response>) =>
  vi.fn(async (url: string | URL | Request, init?: RequestInit) =>
    respond(String(url), init ?? {}),
  ) satisfies typeof fetch;

/** A client over a real ledger that keeps its lines in memory. */
const setup = (
  respond: Parameters<typeof fakeFetch>[0],
  options: { env?: NodeJS.ProcessEnv; deadlineMs?: number; config?: SpendConfig } = {},
) => {
  const lines: UsageLine[] = [];
  const config = options.config ?? SPEND_CONFIG;
  const ledger = new SpendLedger({ append: (line) => lines.push(line), config, warn: () => {} });
  const fetch = fakeFetch(respond);
  const client = createHaikuClient({
    usage: () => ledger,
    env: options.env ?? ON,
    fetch,
    config,
    ...(options.deadlineMs !== undefined && { deadlineMs: options.deadlineMs }),
  });
  return { client, fetch, lines, ledger };
};

const ok = () => new Response(message());

describe('the Haiku client (spec §5.2, §9)', () => {
  test('writes one line over the fixed endpoint with the pinned model and no thinking, retries or redirects', async () => {
    const { client, fetch, lines } = setup(ok);
    const result = await client.write(REQUEST);
    expect(result).toEqual({
      ok: true,
      text: 'Nice roll!',
      model: PINNED_HAIKU_MODEL,
      latencyMs: expect.any(Number),
      usage: { inputTokens: 1200, outputTokens: 12 },
    });
    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe(HAIKU_ENDPOINT);
    expect(HAIKU_ENDPOINT).toBe('https://api.anthropic.com/v1/messages');
    expect(init).toMatchObject({ method: 'POST', redirect: 'error' });
    expect(init?.headers).toMatchObject({ 'x-api-key': KEY });
    const body = JSON.parse(String(init?.body));
    expect(body).toEqual({
      model: 'claude-haiku-5-5',
      max_tokens: 80,
      thinking: { type: 'disabled' },
      output_config: { effort: 'low' },
      stream: false,
      system: REQUEST.system,
      messages: [{ role: 'user', content: REQUEST.prompt }],
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      provider: 'haiku',
      gameId: 'game-1',
      turnKey: 'turn-4',
      model: 'claude-haiku-5-5',
      inputTokens: 1200,
      outputTokens: 12,
      status: 'ok',
    });
  });

  test('skips thinking blocks and joins the text blocks', async () => {
    const { client } = setup(
      () =>
        new Response(
          message({
            content: [
              { type: 'thinking', thinking: 'hmm' },
              { type: 'text', text: 'Good ' },
              { type: 'text', text: 'game.' },
            ],
          }),
        ),
    );
    expect(await client.write(REQUEST)).toMatchObject({ ok: true, text: 'Good game.' });
  });
});

describe('Haiku off, keyless or out of budget makes no request', () => {
  test.each([
    ['unset', {}],
    ['false', { HAIKU_ENABLED: 'false' }],
    ['not exactly true', { HAIKU_ENABLED: 'yes' }],
  ])('HAIKU_ENABLED %s → disabled, even with a key', async (_name, flag) => {
    const { client, fetch, lines } = setup(ok, { env: { ANTHROPIC_API_KEY: KEY, ...flag } });
    expect(await client.write(REQUEST)).toEqual({
      ok: false,
      fallbackReason: 'disabled',
      requestSent: false,
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(lines).toEqual([]);
  });

  test.each([
    ['unset', undefined],
    ['empty', '  '],
    ['has a space', 'two words'],
    ['not ASCII', 'clé-secrète'],
  ])('a key that is %s → missing_key', async (_name, key) => {
    const { client, fetch, lines } = setup(ok, {
      env: { HAIKU_ENABLED: 'true', ...(key !== undefined && { ANTHROPIC_API_KEY: key }) },
    });
    expect(await client.write(REQUEST)).toEqual({
      ok: false,
      fallbackReason: 'missing_key',
      requestSent: false,
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(lines).toEqual([]);
  });

  test('a disabled or keyless client never opens the usage ledger', async () => {
    const usage = vi.fn((): UsageRecorder => {
      throw new Error('ledger opened');
    });
    for (const env of [{}, { HAIKU_ENABLED: 'true' }]) {
      const client = createHaikuClient({ usage, env, fetch: fakeFetch(ok) });
      expect((await client.write(REQUEST)).ok).toBe(false);
    }
    expect(usage).not.toHaveBeenCalled();
  });

  test('the Haiku cap refuses a request with budget_exceeded and no network call', async () => {
    const config = { ...SPEND_CONFIG, haikuCapThb: 0.001 };
    const { client, fetch, lines } = setup(ok, { config });
    // 1,200 input and 12 output tokens cost about THB 0.0042: past the cap in one request.
    expect((await client.write(REQUEST)).ok).toBe(true);
    expect(await client.write(REQUEST)).toEqual({
      ok: false,
      fallbackReason: 'budget_exceeded',
      requestSent: false,
    });
    expect(fetch).toHaveBeenCalledOnce();
    expect(lines).toHaveLength(1);
  });

  test('the total cap, spent by Jev, refuses Haiku too', async () => {
    const { client, fetch, ledger } = setup(ok);
    ledger.record({
      time: new Date().toISOString(),
      gameId: 'g',
      requestId: null,
      model: 'jev-1.13.0',
      inputTokens: Math.ceil((1500 / SPEND_CONFIG.thbPerUsd / 0.042) * 1_000_000),
      outputTokens: 0,
      latencyMs: 1,
      status: 'ok',
      turnKey: '1',
      decision: 0,
      decisionMs: 1,
    });
    expect(ledger.budgetExceeded('haiku')).toBe(true);
    expect(await client.write(REQUEST)).toMatchObject({
      fallbackReason: 'budget_exceeded',
      requestSent: false,
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  test('the status route says why speech is off, from the same switches', () => {
    const ledger = { budgetExceeded: (provider?: string) => provider === 'haiku' };
    expect(speechStatus(() => ledger, {})).toEqual({ enabled: false, reason: 'disabled' });
    expect(speechStatus(() => ledger, { HAIKU_ENABLED: 'true' })).toEqual({
      enabled: false,
      reason: 'missing_key',
    });
    expect(speechStatus(() => ledger, ON)).toEqual({ enabled: false, reason: 'budget_exceeded' });
    expect(speechStatus(() => ({ budgetExceeded: () => false }), ON)).toEqual({
      enabled: true,
      reason: null,
    });
  });
});

describe('failures become fallback reasons, each logged once with no tokens spent', () => {
  test.each([
    [401, 'auth'],
    [403, 'auth'],
    [429, 'rate_limited'],
    [500, 'server_error'],
    [503, 'server_error'],
    [529, 'server_error'],
    [400, 'server_error'],
    [404, 'server_error'],
  ] as const)('HTTP %d → %s', async (status, reason) => {
    // The error body even echoes the key: it is never read, so it cannot reach anything.
    const { client, lines } = setup(() => new Response(`{"error":"${KEY}"}`, { status }));
    const result = await client.write(REQUEST);
    expect(result).toMatchObject({ ok: false, fallbackReason: reason, status });
    expect(JSON.stringify(result)).not.toContain(KEY);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      provider: 'haiku',
      status: reason,
      inputTokens: 0,
      outputTokens: 0,
    });
    expect(lines[0]).not.toHaveProperty('estimated');
  });

  test('HTTP 408 → timeout, counted as the estimate like any other timeout', async () => {
    const { client, lines } = setup(() => new Response('', { status: 408 }));
    expect(await client.write(REQUEST)).toMatchObject({ fallbackReason: 'timeout', status: 408 });
    expect(lines[0]).toMatchObject({
      status: 'timeout',
      inputTokens: SPEND_CONFIG.estimatedHaikuInputTokensPerRequest,
      estimated: true,
    });
  });

  test('a network error, including a refused redirect, → network', async () => {
    const { client, lines } = setup(() => {
      throw new TypeError('fetch failed');
    });
    expect(await client.write(REQUEST)).toMatchObject({ ok: false, fallbackReason: 'network' });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ status: 'network', inputTokens: 0 });
  });

  describe('with the deadline driven by fake timers', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    test('a stalled request that ignores its abort signal → timeout at the deadline, counted as the estimate', async () => {
      const { client, lines } = setup(() => new Promise<Response>(() => {}), { deadlineMs: 20 });
      const pending = client.write(REQUEST);
      await vi.advanceTimersByTimeAsync(20);
      expect(await pending).toMatchObject({ ok: false, fallbackReason: 'timeout' });
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatchObject({
        status: 'timeout',
        inputTokens: SPEND_CONFIG.estimatedHaikuInputTokensPerRequest,
        outputTokens: SPEND_CONFIG.estimatedHaikuOutputTokensPerRequest,
        estimated: true,
      });
    });

    test('the deadline defaults to 1,200 ms: a request is still open at 1,199 ms', async () => {
      const { client } = setup(() => new Promise<Response>(() => {}));
      let settled = false;
      const pending = client.write(REQUEST).then((result) => {
        settled = true;
        return result;
      });
      await vi.advanceTimersByTimeAsync(HAIKU_DEADLINE_MS - 1);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(await pending).toMatchObject({ fallbackReason: 'timeout' });
    });

    test('a late answer is discarded: the text is never returned and the request is logged once', async () => {
      const { client, lines } = setup(
        () => new Promise<Response>((resolve) => setTimeout(() => resolve(ok()), 60)),
        { deadlineMs: 15 },
      );
      const pending = client.write(REQUEST);
      await vi.advanceTimersByTimeAsync(15);
      const result = await pending;
      expect(result).toMatchObject({ ok: false, fallbackReason: 'timeout' });
      await vi.advanceTimersByTimeAsync(100);
      expect(JSON.stringify(result)).not.toContain('Nice roll');
      expect(lines).toHaveLength(1);
    });

    test('a fetch that honours its abort signal also ends in timeout', async () => {
      const { client } = setup(
        (_url, init) =>
          new Promise<Response>((_resolve, reject) =>
            init.signal?.addEventListener('abort', () =>
              reject(new DOMException('x', 'AbortError')),
            ),
          ),
        { deadlineMs: 15 },
      );
      const pending = client.write(REQUEST);
      await vi.advanceTimersByTimeAsync(15);
      expect(await pending).toMatchObject({ ok: false, fallbackReason: 'timeout' });
    });
  });

  test('an oversized body → unsafe_response, however it declares its size', async () => {
    const big = 'x'.repeat(MAX_RESPONSE_BYTES + 1);
    const streamed = setup(() => new Response(big));
    const declared = setup(
      () => new Response('{}', { headers: { 'content-length': String(MAX_RESPONSE_BYTES + 1) } }),
    );
    for (const { client, lines } of [streamed, declared]) {
      expect(await client.write(REQUEST)).toMatchObject({
        ok: false,
        fallbackReason: 'unsafe_response',
      });
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatchObject({
        inputTokens: SPEND_CONFIG.estimatedHaikuInputTokensPerRequest,
        estimated: true,
      });
    }
  });

  test('a body of exactly the size cap is read', async () => {
    const padded = message({ pad: '' });
    const pad = 'x'.repeat(MAX_RESPONSE_BYTES - padded.length);
    const { client } = setup(() => new Response(message({ pad })));
    expect(await client.write(REQUEST)).toMatchObject({ ok: true });
  });

  test('a reply containing the key is withdrawn, its tokens still counted', async () => {
    const { client, lines } = setup(
      () => new Response(message({ content: [{ type: 'text', text: `my key is ${KEY}` }] })),
    );
    const result = await client.write(REQUEST);
    expect(result).toMatchObject({ ok: false, fallbackReason: 'unsafe_response' });
    expect(JSON.stringify(result)).not.toContain(KEY);
    expect(lines[0]).toMatchObject({ status: 'unsafe_response', inputTokens: 1200 });
    expect(JSON.stringify(lines)).not.toContain(KEY);
  });

  test('a key hidden in an unused field of the reply is withdrawn too', async () => {
    const { client } = setup(() => new Response(message({ id: KEY })));
    expect(await client.write(REQUEST)).toMatchObject({ fallbackReason: 'unsafe_response' });
  });

  test.each([
    ['not JSON', 'not json at all'],
    ['an empty body', ''],
    ['another model', message({ model: 'claude-haiku-4' })],
    ['no usage', message({ usage: undefined })],
    ['negative usage', message({ usage: { input_tokens: -1, output_tokens: 1 } })],
    ['a cut-off line', message({ stop_reason: 'max_tokens' })],
    ['no stop reason', message({ stop_reason: null })],
    ['no text', message({ content: [] })],
    ['blank text', message({ content: [{ type: 'text', text: '  ' }] })],
    ['a tool call', message({ content: [{ type: 'tool_use', id: 't', name: 'n', input: {} }] })],
    ['an array', '[]'],
  ])('a malformed reply (%s) → unsafe_response', async (_name, body) => {
    const { client, lines } = setup(() => new Response(body));
    expect(await client.write(REQUEST)).toMatchObject({
      ok: false,
      fallbackReason: 'unsafe_response',
    });
    expect(lines).toHaveLength(1);
  });

  test('a refusal → refused, its reported tokens counted', async () => {
    const { client, lines } = setup(
      () => new Response(message({ stop_reason: 'refusal', content: [] })),
    );
    expect(await client.write(REQUEST)).toMatchObject({
      ok: false,
      fallbackReason: 'refused',
      usage: { inputTokens: 1200, outputTokens: 12 },
    });
    expect(lines[0]).toMatchObject({ status: 'refused', inputTokens: 1200, outputTokens: 12 });
  });

  test('a usage log that cannot be written never turns a request into a throw', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const client = createHaikuClient({
        usage: () => ({
          budgetExceeded: () => false,
          record: () => {
            throw new Error('disk full');
          },
        }),
        env: ON,
        fetch: fakeFetch(ok),
      });
      expect(await client.write(REQUEST)).toMatchObject({ ok: true });
      expect(warn).toHaveBeenCalledOnce();
      expect(String(warn.mock.calls[0]![0])).not.toContain(KEY);
    } finally {
      warn.mockRestore();
    }
  });

  test('no usage line, result or warning carries the key or the text', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { client, lines } = setup(ok);
      const result = await client.write(REQUEST);
      expect(JSON.stringify(lines)).not.toMatch(new RegExp(`${KEY}|Nice roll|${REQUEST.prompt}`));
      expect(JSON.stringify(result)).not.toContain(KEY);
    } finally {
      warn.mockRestore();
    }
  });
});
