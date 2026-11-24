import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createApp } from './app.ts';
import { createFakeJevClient } from './jev/fake.ts';
import { SpendLedger } from './jev/spend.ts';

// Spec §9 Safety: every `/api/ai/*` route is same-origin only, not just `/speak`. Offline: Hono's
// in-memory `app.request()`, a fake Jev client and an empty ledger; no key, no network.
const LOOPBACK = {
  host: 'localhost:5173',
  origin: 'http://localhost:5173',
  'content-type': 'application/json',
};
const POST_ROUTES = ['/api/ai/decide', '/api/ai/fallback', '/api/ai/chat', '/api/ai/outcome'];

const setup = () => {
  const client = createFakeJevClient(() => ({ ok: false, fallbackReason: 'network' }));
  const decided = vi.fn();
  const app = createApp({
    usage: () => new SpendLedger(),
    jevClient: () => client,
    decider: async (...args) => {
      decided(...args);
      throw new Error('a refused request must never reach the decider');
    },
    decisionLog: () => {},
  });
  return { app, client, decided };
};

const post = (app: ReturnType<typeof createApp>, path: string, headers: Record<string, string>) =>
  app.request(path, { method: 'POST', headers, body: '{}' });

beforeEach(() => vi.stubEnv('JEV_ENABLED', 'true'));
afterEach(() => vi.unstubAllEnvs());

describe.each(POST_ROUTES)('POST %s', (path) => {
  test.each([
    ['another Origin', { ...LOOPBACK, origin: 'http://evil.example' }],
    ['no Origin', { host: LOOPBACK.host, 'content-type': 'application/json' }],
    ['an Origin on another port', { ...LOOPBACK, origin: 'http://localhost:9999' }],
    ['an https Origin', { ...LOOPBACK, origin: 'https://localhost:5173' }],
    [
      'a foreign Host (DNS rebinding)',
      { ...LOOPBACK, host: 'rebind.evil.example:8787', origin: 'http://rebind.evil.example:8787' },
    ],
    ['no Host', { origin: LOOPBACK.origin, 'content-type': 'application/json' }],
    ['a null Origin', { ...LOOPBACK, origin: 'null' }],
  ])('is refused with %s, before any body is read or call made', async (_name, headers) => {
    const { app, client, decided } = setup();
    const response = await post(app, path, headers);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'forbidden_origin' });
    expect(client.requests).toHaveLength(0);
    expect(decided).not.toHaveBeenCalled();
  });

  test('is refused as unsupported media for a cross-site "simple" content type', async () => {
    const { app } = setup();
    for (const type of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data']) {
      const response = await post(app, path, { ...LOOPBACK, 'content-type': type });
      expect(response.status).toBe(415);
    }
    const missing = await post(app, path, { host: LOOPBACK.host, origin: LOOPBACK.origin });
    expect(missing.status).toBe(415);
  });

  test.each([
    ['localhost with a dev-proxy port', LOOPBACK],
    ['127.0.0.1', { ...LOOPBACK, host: '127.0.0.1:8787', origin: 'http://127.0.0.1:8787' }],
    ['[::1]', { ...LOOPBACK, host: '[::1]:8787', origin: 'http://[::1]:8787' }],
    [
      'a charset on the JSON type',
      { ...LOOPBACK, 'content-type': 'Application/JSON; charset=utf-8' },
    ],
  ])('passes the guard from the same loopback origin: %s', async (_name, headers) => {
    const { app } = setup();
    // The body is empty on purpose: past the guard it is the route's own 400, not a 403 or 415.
    const response = await post(app, path, headers);
    expect(response.status).toBe(400);
  });
});

describe('GET /api/ai/status', () => {
  // A same-origin GET carries no Origin header, so the status route checks Host (and an Origin, if sent).
  test.each([
    ['a foreign Host (DNS rebinding)', { host: 'rebind.evil.example:8787' }],
    ['no Host', {}],
    [
      'a loopback Host with another site as Origin',
      { host: LOOPBACK.host, origin: 'http://evil.example' },
    ],
  ])('is refused with %s', async (_name, headers) => {
    const { app } = setup();
    const response = await app.request('/api/ai/status', { headers });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'forbidden_origin' });
  });

  test.each([
    ['a Host alone, as a same-origin GET sends', { host: LOOPBACK.host }],
    ['a Host and its own Origin', { host: LOOPBACK.host, origin: LOOPBACK.origin }],
    ['127.0.0.1', { host: '127.0.0.1:8787' }],
  ])('answers %s', async (_name, headers) => {
    const { app } = setup();
    const response = await app.request('/api/ai/status', { headers });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ jevEnabled: true });
  });
});
