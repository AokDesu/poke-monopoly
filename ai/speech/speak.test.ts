import { afterEach, describe, expect, test, vi } from 'vitest';
import { toEngineContent } from '../../content/schema.ts';
import { speakResponseSchema } from '../../engine/contract/speech.ts';
import { createGame, createGameConfig, observe } from '../../engine/index.ts';
import { createApp, MAX_SPEAK_BODY_BYTES } from '../app.ts';
import { createFakeHaikuClient } from '../haiku/fake.ts';
import {
  createHaikuClient,
  PINNED_HAIKU_MODEL,
  type HaikuRequest,
  type HaikuResult,
} from '../haiku/client.ts';
import { SPEND_CONFIG, SpendLedger, type UsageLine, type UsageRecorder } from '../jev/spend.ts';
import { LINES } from '../lines.ts';
import { CONTENT } from '../questions/content.ts';
import { SPEECH_INSTRUCTION } from './index.ts';
import { MAX_SPEECH_GAMES } from './speak.ts';

const KEY = 'placeholder-haiku-key-not-real-4c81e2';
const ON = { HAIKU_ENABLED: 'true', ANTHROPIC_API_KEY: KEY };
const SENTINEL = 'SPEAK-SENTINEL-instance-9d2f';
const CLEAN = 'That went well for me, and the grass looks friendly today.';
const SAME_ORIGIN = {
  host: 'localhost:5173',
  origin: 'http://localhost:5173',
  'content-type': 'application/json',
};

const content = toEngineContent(CONTENT);
const state = createGame(
  createGameConfig({
    seats: ['main-character', 'rival', 'nurse-joy'].map((classId, seatIndex) => ({
      actorId: `player-${seatIndex}`,
      seatIndex,
      classId,
      starterSpeciesId: content.classes.find((entry) => entry.id === classId)!
        .starterSpeciesIds[0]!,
      controller: 'ai' as const,
    })),
    seed: 'SPEAK-SEED',
    lapTarget: 3,
  }),
  content,
);
state.players[0]!.items.push({
  instanceId: SENTINEL,
  itemId: 'repel',
  name: SENTINEL,
  visibility: 'secret',
});
const observation = observe(state, 0);

const request = (over: Record<string, unknown> = {}) => ({
  gameId: 'game-1',
  seatIndex: 0,
  stateRevision: observation.public.stateRevision,
  observation,
  situation: 'catch_success',
  personalityId: 'greedy',
  turnKey: '0:1',
  ...over,
});

const ok = (text: string, inputTokens = 100): HaikuResult => ({
  ok: true,
  text,
  model: PINNED_HAIKU_MODEL,
  latencyMs: 5,
  usage: { inputTokens, outputTokens: 10 },
});

const pause = (ms: number) => new Promise((done) => setTimeout(done, ms));

const noCap: UsageRecorder = { record: () => {}, budgetExceeded: () => false };

/** The app over a fake Haiku client; `logs` collects what the route logs. */
function setup(
  respond: (request: HaikuRequest) => HaikuResult | Promise<HaikuResult> = () => ok(CLEAN),
  speech: Parameters<typeof createApp>[0] = {},
) {
  const client = createFakeHaikuClient(respond);
  const logs: string[] = [];
  const app = createApp({
    usage: () => noCap,
    ...speech,
    speech: { client, env: ON, log: (line) => logs.push(line), ...speech.speech },
  });
  const speak = async (
    body: unknown = request(),
    headers: Record<string, string> = SAME_ORIGIN,
  ) => {
    const response = await app.request('/api/ai/speak', {
      method: 'POST',
      headers,
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
    return { status: response.status, json: (await response.json()) as Record<string, unknown> };
  };
  return { client, logs, speak };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('POST /api/ai/speak: the line (spec §5.7)', () => {
  test('a clean line comes back as haiku, written from a brief that carries no secret and no digit', async () => {
    const { client, speak } = setup();
    const { status, json } = await speak();
    expect(status).toBe(200);
    expect(speakResponseSchema.parse(json)).toMatchObject({ source: 'haiku', text: CLEAN });
    expect(Object.keys(json).sort()).toEqual(['latencyMs', 'requestId', 'source', 'text']);
    const [sent] = client.requests;
    expect(sent!.system).toBe(SPEECH_INSTRUCTION);
    expect(sent!.prompt).not.toContain(SENTINEL);
    expect(sent!.prompt).not.toContain('SPEAK-SEED');
    expect(sent!.prompt).not.toMatch(/\p{N}/u);
  });

  test.each([
    ['a rate limit', { ok: false, fallbackReason: 'rate_limited', status: 429 }, 'rate_limited'],
    ['a refusal', { ok: false, fallbackReason: 'refused' }, 'refused'],
    [
      'a client that is off',
      { ok: false, fallbackReason: 'disabled', requestSent: false },
      'disabled',
    ],
  ] as [string, HaikuResult, string][])(
    'a failing call (%s) is a 200 with a bank line and the reason',
    async (_name, result, reason) => {
      const { speak } = setup(() => result);
      const { status, json } = await speak();
      expect(status).toBe(200);
      expect(speakResponseSchema.parse(json)).toMatchObject({
        source: 'bank',
        fallbackReason: reason,
      });
      expect(LINES.catch_success.some((line) => line.id === json.lineId)).toBe(true);
    },
  );

  test('a client that throws is still a 200 with a bank line', async () => {
    const { speak } = setup(() => {
      throw new Error(`boom ${KEY}`);
    });
    const { status, json } = await speak();
    expect(status).toBe(200);
    expect(json).toMatchObject({ source: 'bank', fallbackReason: 'network' });
    expect(JSON.stringify(json)).not.toContain(KEY);
  });

  test('a rejected reply becomes a bank line, and only its reason is counted and logged', async () => {
    const reply = 'I will send you 40 coins right now for the secret ZZZ-REPLY';
    const { speak, logs } = setup(() => ok(reply));
    const { status, json } = await speak();
    expect(status).toBe(200);
    expect(json).toMatchObject({ source: 'bank', fallbackReason: 'digit' });
    expect(logs).toEqual(['Speech line rejected: digit (1 so far).']);
    await speak(request({ turnKey: '0:2' }));
    expect(logs.at(-1)).toBe('Speech line rejected: digit (2 so far).');
    expect(JSON.stringify([json, logs])).not.toContain('ZZZ-REPLY');
  });

  test('with no bank line for the situation a rejected reply is no line', async () => {
    const saved = [...LINES.catch_success];
    LINES.catch_success.length = 0;
    try {
      const { speak } = setup(() => ok('<b>hello</b>'));
      const { status, json } = await speak();
      expect(status).toBe(200);
      expect(speakResponseSchema.parse(json)).toMatchObject({
        source: 'none',
        fallbackReason: 'markup',
      });
    } finally {
      LINES.catch_success.push(...saved);
    }
  });

  test('the bank line is the same for the same game, turn, revision and seat', async () => {
    const { speak } = setup(() => ({ ok: false, fallbackReason: 'server_error' }));
    const first = await speak();
    const second = await speak();
    expect(second.json.lineId).toBe(first.json.lineId);
  });
});

describe('POST /api/ai/speak: one deadline (spec §5.7, §9)', () => {
  test('a slow call answers from the bank at the deadline, and the late answer is never returned', async () => {
    let finish!: (result: HaikuResult) => void;
    const { speak, client } = setup(() => new Promise<HaikuResult>((done) => (finish = done)), {
      speech: { deadlineMs: 40 },
    });
    const started = performance.now();
    const { status, json } = await speak();
    expect(performance.now() - started).toBeLessThan(40 + 150);
    expect(status).toBe(200);
    expect(json).toMatchObject({ source: 'bank', fallbackReason: 'timeout' });
    finish(ok(CLEAN));
    await Promise.resolve();
    expect(client.requests).toHaveLength(1);
    expect(JSON.stringify(json)).not.toContain(CLEAN);
  });

  test("a late answer's tokens still count toward the game's limit", async () => {
    let finish!: (result: HaikuResult) => void;
    const config = { ...SPEND_CONFIG, haikuMaxInputTokensPerGame: 5_000 };
    const { speak, client } = setup(() => new Promise<HaikuResult>((done) => (finish = done)), {
      speech: { deadlineMs: 20, config },
    });
    expect((await speak()).json.fallbackReason).toBe('timeout');
    // Still in flight: nothing else goes out for this game.
    expect((await speak()).json.fallbackReason).toBe('in_flight');
    finish(ok(CLEAN, 4_000));
    await vi.waitFor(async () => expect((await speak()).json.fallbackReason).toBe('token_limit'));
    expect(client.requests).toHaveLength(1);
  });

  test('a real client that times out writes one estimated usage line, and the route still answers on time', async () => {
    const lines: UsageLine[] = [];
    const ledger = new SpendLedger({ append: (line) => lines.push(line), warn: () => {} });
    // A fetch that ignores its abort signal and answers long after the deadline.
    const lateFetch = vi.fn(async () => {
      // Real time on purpose: the deadline under test is a real timer racing a slow network.
      await pause(120);
      return Response.json({ usage: { input_tokens: 999, output_tokens: 9 } });
    }) as unknown as typeof fetch;
    const { speak } = setup(undefined, {
      usage: () => ledger,
      speech: {
        client: createHaikuClient({
          usage: () => ledger,
          env: ON,
          fetch: lateFetch,
          deadlineMs: 30,
        }),
        deadlineMs: 30,
      },
    });
    const started = performance.now();
    const { status, json } = await speak();
    expect(performance.now() - started).toBeLessThan(30 + 150);
    expect(status).toBe(200);
    expect(json.source).toBe('bank');
    await vi.waitFor(() => expect(lines).toHaveLength(1));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      provider: 'haiku',
      status: 'timeout',
      estimated: true,
      inputTokens: SPEND_CONFIG.estimatedHaikuInputTokensPerRequest,
    });
  });
});

describe('POST /api/ai/speak: hard stops (spec §9)', () => {
  test('a game gets 60 calls and 80,000 input tokens; past either it gets the bank and no call', async () => {
    const calls = setup(() => ok(CLEAN, 100));
    for (let n = 0; n < 60; n++) {
      expect((await calls.speak(request({ turnKey: `0:${n}` }))).json.source).toBe('haiku');
    }
    const sixtyFirst = await calls.speak(request({ turnKey: '0:60' }));
    expect(sixtyFirst.json).toMatchObject({ source: 'bank', fallbackReason: 'call_limit' });
    expect(calls.client.requests).toHaveLength(60);
    // Another game is not affected.
    expect((await calls.speak(request({ gameId: 'game-2' }))).json.source).toBe('haiku');

    const tokens = setup(() => ok(CLEAN, 30_000));
    expect((await tokens.speak()).json.source).toBe('haiku');
    expect((await tokens.speak()).json.source).toBe('haiku');
    expect((await tokens.speak()).json.source).toBe('haiku');
    const fourth = await tokens.speak();
    expect(fourth.json).toMatchObject({ source: 'bank', fallbackReason: 'token_limit' });
    expect(tokens.client.requests).toHaveLength(3);
  });

  test('a call that sent nothing is not counted against the game', async () => {
    const { speak, client } = setup(() => ({
      ok: false,
      fallbackReason: 'missing_key',
      requestSent: false,
    }));
    for (let n = 0; n < 61; n++) await speak(request({ turnKey: `0:${n}` }));
    expect(client.requests).toHaveLength(61);
  });

  test('a timed-out call counts its estimate against the game', async () => {
    const { speak, client } = setup(
      () => ({
        ok: false,
        fallbackReason: 'timeout',
        usage: { inputTokens: SPEND_CONFIG.estimatedHaikuInputTokensPerRequest, outputTokens: 80 },
      }),
      { speech: { config: { ...SPEND_CONFIG, haikuMaxCallsPerGame: 2 } } },
    );
    await speak();
    await speak();
    expect((await speak()).json.fallbackReason).toBe('call_limit');
    expect(client.requests).toHaveLength(2);
  });

  test('one call in flight per game: a second request for the game goes to the bank, another game goes out', async () => {
    const finishers: ((result: HaikuResult) => void)[] = [];
    const { speak, client } = setup(() => new Promise<HaikuResult>((done) => finishers.push(done)));
    const first = speak();
    await vi.waitFor(() => expect(client.requests).toHaveLength(1));
    const busy = await speak();
    expect(busy.json).toMatchObject({ source: 'bank', fallbackReason: 'in_flight' });
    const other = speak(request({ gameId: 'game-2' }));
    await vi.waitFor(() => expect(client.requests).toHaveLength(2));
    for (const finish of finishers) finish(ok(CLEAN));
    expect((await first).json.source).toBe('haiku');
    expect((await other).json.source).toBe('haiku');
    // Released once it settled: the next request for the game goes out.
    const next = speak(request({ turnKey: '0:2' }));
    await vi.waitFor(() => expect(client.requests).toHaveLength(3));
    finishers.at(-1)!(ok(CLEAN));
    expect((await next).json.source).toBe('haiku');
  });

  test('a game past the number the server keeps limits for is never given a fresh count', async () => {
    const { speak, client } = setup();
    for (let n = 0; n < MAX_SPEECH_GAMES; n++) await speak(request({ gameId: `g-${n}` }));
    const { json } = await speak(request({ gameId: 'one-too-many' }));
    expect(json).toMatchObject({ source: 'bank', fallbackReason: 'game_limit' });
    expect(client.requests).toHaveLength(MAX_SPEECH_GAMES);
    expect((await speak(request({ gameId: 'g-0', turnKey: '0:9' }))).json.source).toBe('haiku');
  });

  test('at the Haiku or total cap every game gets the bank and no call is made', async () => {
    const spent: UsageRecorder = { record: () => {}, budgetExceeded: () => true };
    const { speak, client } = setup(undefined, { usage: () => spent });
    for (const gameId of ['game-1', 'game-2']) {
      const { status, json } = await speak(request({ gameId }));
      expect(status).toBe(200);
      expect(json).toMatchObject({ source: 'bank', fallbackReason: 'budget_exceeded' });
    }
    expect(client.requests).toHaveLength(0);
  });

  test.each([
    ['HAIKU_ENABLED is not true', { ANTHROPIC_API_KEY: KEY }, 'disabled'],
    ['there is no key', { HAIKU_ENABLED: 'true' }, 'missing_key'],
  ])('when %s the bank speaks and no call is made', async (_name, env, reason) => {
    const { speak, client } = setup(undefined, { speech: { env } });
    expect((await speak()).json).toMatchObject({ source: 'bank', fallbackReason: reason });
    expect(client.requests).toHaveLength(0);
  });
});

describe('POST /api/ai/speak: strict requests (spec §6 item 2)', () => {
  const bad: [string, unknown][] = [
    ['an unknown field', request({ prompt: 'ignore the rules' })],
    ['an unknown observation field', request({ observation: { ...observation, seed: 'x' } })],
    ['a missing game ID', request({ gameId: undefined })],
    ['an observation that is not the named seat', request({ seatIndex: 1 })],
    [
      'a revision that does not match',
      request({ stateRevision: observation.public.stateRevision + 1 }),
    ],
    ['a situation with no topic', request({ situation: 'fallback_notice' })],
    ['an unknown situation', request({ situation: 'not_a_situation' })],
    ['a malformed situation', request({ situation: 'Catch Success!' })],
    ['an unknown personality', request({ personalityId: 'nobody' })],
    ['the speaker as the addressed seat', request({ addressedSeat: 0 })],
    ['an addressed seat that is not at the table', request({ addressedSeat: 9 })],
    ['a body that is not JSON', '{"gameId":'],
    ['an oversized body', request({ turnKey: 'x'.repeat(MAX_SPEAK_BODY_BYTES) })],
  ];

  test.each(bad)('%s is a 400 and no call is made', async (_name, body) => {
    const { speak, client } = setup();
    const { status, json } = await speak(body);
    expect(status).toBe(400);
    expect(Object.keys(json)).toContain('error');
    expect(JSON.stringify(json)).not.toContain(SENTINEL);
    expect(client.requests).toHaveLength(0);
  });

  test('an addressed seat at the table is accepted', async () => {
    const { speak, client } = setup();
    expect((await speak(request({ addressedSeat: 2 }))).json.source).toBe('haiku');
    expect(client.requests[0]!.prompt).toContain('addressed');
  });

  test('a request is a 400 even while Haiku is off, so a mistake never hides', async () => {
    const { speak } = setup(undefined, { speech: { env: {} } });
    expect((await speak(request({ seatIndex: 1 }))).status).toBe(400);
  });
});

describe('POST /api/ai/speak: same origin only (spec §6 item 2, §9)', () => {
  test.each([
    ['another Origin', { ...SAME_ORIGIN, origin: 'https://evil.example' }, 403],
    ['no Origin', { host: SAME_ORIGIN.host, 'content-type': 'application/json' }, 403],
    ['an Origin on another port', { ...SAME_ORIGIN, origin: 'http://localhost:9999' }, 403],
    ['an https Origin', { ...SAME_ORIGIN, origin: 'https://localhost:5173' }, 403],
    [
      'a Host that is not loopback',
      { ...SAME_ORIGIN, host: 'evil.example', origin: 'http://evil.example' },
      403,
    ],
    [
      'a Host that only starts like loopback',
      { ...SAME_ORIGIN, host: 'localhost.evil.example', origin: 'http://localhost.evil.example' },
      403,
    ],
    ['no Host', { origin: SAME_ORIGIN.origin, 'content-type': 'application/json' }, 403],
    [
      'a form content type',
      { ...SAME_ORIGIN, 'content-type': 'application/x-www-form-urlencoded' },
      415,
    ],
    ['plain text', { ...SAME_ORIGIN, 'content-type': 'text/plain' }, 415],
    ['no content type', { host: SAME_ORIGIN.host, origin: SAME_ORIGIN.origin }, 415],
  ])('%s is refused before any call', async (_name, headers, expected) => {
    const { speak, client, logs } = setup();
    const { status } = await speak(request(), headers);
    expect(status).toBe(expected);
    expect(client.requests).toHaveLength(0);
    expect(logs).toEqual([]);
  });

  test.each([
    ['the Vite dev proxy', SAME_ORIGIN],
    ['the built app', { ...SAME_ORIGIN, host: '127.0.0.1:8787', origin: 'http://127.0.0.1:8787' }],
    ['IPv6 loopback', { ...SAME_ORIGIN, host: '[::1]:8787', origin: 'http://[::1]:8787' }],
    [
      'a JSON charset parameter',
      { ...SAME_ORIGIN, 'content-type': 'application/json; charset=utf-8' },
    ],
  ])('%s is accepted', async (_name, headers) => {
    const { speak } = setup();
    expect((await speak(request(), headers)).status).toBe(200);
  });

  test('a refusal comes before the body is read: an invalid body from another origin is 403, not 400', async () => {
    const { speak } = setup();
    const { status } = await speak('not json', { ...SAME_ORIGIN, origin: 'https://evil.example' });
    expect(status).toBe(403);
  });
});

describe('POST /api/ai/speak: nothing private leaves (spec §9)', () => {
  test('no response, log line or console output holds the key, the request body or the observation', async () => {
    const consoleLines: string[] = [];
    for (const method of ['log', 'info', 'warn', 'error'] as const) {
      vi.spyOn(console, method).mockImplementation((...args) => {
        consoleLines.push(args.map(String).join(' '));
      });
    }
    const replies: HaikuResult[] = [
      ok(CLEAN),
      ok('Sending you 40 coins, ' + KEY),
      { ok: false, fallbackReason: 'unsafe_response' },
    ];
    const { speak, logs } = setup(() => replies.shift()!);
    const seen: unknown[] = [];
    for (let n = 0; n < 3; n++) seen.push(await speak(request({ turnKey: `0:${n}` })));
    seen.push(await speak(request({ seatIndex: 1 })));
    seen.push(await speak(request(), { ...SAME_ORIGIN, origin: 'https://evil.example' }));
    const everything = JSON.stringify([seen, logs, consoleLines]);
    for (const secret of [KEY, SENTINEL, 'SPEAK-SEED', 'player-0', '"observation"']) {
      expect(everything).not.toContain(secret);
    }
  });
});
