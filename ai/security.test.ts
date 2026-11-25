import { readFileSync } from 'node:fs';
import { connect, type AddressInfo } from 'node:net';
import { serve } from '@hono/node-server';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createApp } from './app.ts';
import { RequestWindow, SERVER_LIMITS } from './jev/window.ts';
import { CONTENT_SECURITY_POLICY, HTTP_SERVER_OPTIONS } from './security.ts';

// Server audit follow-up (#64), finding 11 (spec §9): security headers, a server-wide rate limit
// and a request read timeout. Offline only: `app.request()` and a server on a loopback port.
const SAME_ORIGIN = {
  host: 'localhost:5173',
  origin: 'http://localhost:5173',
  'content-type': 'application/json',
};

beforeEach(() => {
  vi.stubEnv('JEV_ENABLED', 'false');
  vi.stubEnv('HAIKU_ENABLED', 'false');
});
afterEach(() => vi.unstubAllEnvs());

const status = (app: ReturnType<typeof createApp>, headers: Record<string, string> = {}) =>
  app.request('/api/ai/status', { headers: { host: 'localhost:5173', ...headers } });

describe('security headers', () => {
  test.each([
    ['a status answer', (app: ReturnType<typeof createApp>) => status(app)],
    [
      'a refused request',
      (app: ReturnType<typeof createApp>) =>
        app.request('/api/ai/decide', { method: 'POST', headers: { host: 'evil.example' } }),
    ],
    [
      'a request the route rejects',
      (app: ReturnType<typeof createApp>) =>
        app.request('/api/ai/decide', {
          method: 'POST',
          headers: SAME_ORIGIN,
          body: '{not json',
        }),
    ],
    ['a missing page', (app: ReturnType<typeof createApp>) => app.request('/nowhere')],
  ])('%s carries the headers', async (_name, send) => {
    const response = await send(createApp({ decisionLog: () => {} }));
    expect(response.headers.get('content-security-policy')).toBe(CONTENT_SECURITY_POLICY);
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('x-frame-options')).toBe('DENY');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  });

  test('the policy allows this origin only, no framing, and nothing a plug-in could use', () => {
    const directives = new Map(
      CONTENT_SECURITY_POLICY.split('; ').map((part) => {
        const [name, ...values] = part.split(' ');
        return [name, values];
      }),
    );
    expect(directives.get('default-src')).toEqual(["'self'"]);
    expect(directives.get('frame-ancestors')).toEqual(["'none'"]);
    expect(directives.get('object-src')).toEqual(["'none'"]);
    expect(directives.get('base-uri')).toEqual(["'none'"]);
    // Scripts are this origin's own files (the page has no inline script), never a remote host or eval.
    expect(directives.get('script-src')).toEqual(["'self'", "'wasm-unsafe-eval'"]);
    for (const values of directives.values()) {
      expect(values.join(' ')).not.toMatch(/https?:|\*|unsafe-eval(?!')|unsafe-inline.*script/);
    }
  });

  test('the web page has no inline script, which the policy would refuse', () => {
    const html = readFileSync('web/index.html', 'utf8');
    for (const script of html.matchAll(/<script\b([^>]*)>/g)) {
      expect(script[1]).toMatch(/\bsrc="/);
    }
    expect(html).not.toMatch(/\bon[a-z]+\s*=/i);
  });
});

describe('the rate limit', () => {
  test('past the window a request is a 429 with Retry-After, and the next window serves again', async () => {
    let now = 0;
    const app = createApp({
      decisionLog: () => {},
      limits: { apiWindow: new RequestWindow(3, SERVER_LIMITS.windowMs, () => now) },
    });
    const codes = [];
    for (let i = 0; i < 5; i++) codes.push((await status(app)).status);
    expect(codes).toEqual([200, 200, 200, 429, 429]);
    const refused = await status(app);
    expect(await refused.json()).toEqual({ error: 'rate_limited' });
    expect(refused.headers.get('retry-after')).toBe('60');
    now = SERVER_LIMITS.windowMs;
    expect((await status(app)).status).toBe(200);
  });

  test("a request another site sends does not use up the player's allowance", async () => {
    const app = createApp({
      decisionLog: () => {},
      limits: { apiWindow: new RequestWindow(2) },
    });
    for (let i = 0; i < 20; i++) {
      const forbidden = await status(app, { origin: 'http://evil.example' });
      expect(forbidden.status).toBe(403);
      const post = await app.request('/api/ai/decide', {
        method: 'POST',
        headers: { ...SAME_ORIGIN, origin: 'http://evil.example' },
        body: '{}',
      });
      expect(post.status).toBe(403);
    }
    expect((await status(app)).status).toBe(200);
  });

  test('the routes are limited alike: decide, chat, speak and outcome answer 429 past the window', async () => {
    const app = createApp({ decisionLog: () => {}, limits: { apiWindow: new RequestWindow(0) } });
    for (const path of ['decide', 'fallback', 'chat', 'speak', 'outcome']) {
      const response = await app.request(`/api/ai/${path}`, {
        method: 'POST',
        headers: SAME_ORIGIN,
        body: '{}',
      });
      expect(response.status, path).toBe(429);
    }
  });
});

describe('the read timeout', () => {
  test('a client that stops sending its body is answered 408 and cut off', async () => {
    const server = serve({
      fetch: createApp({ decisionLog: () => {} }).fetch,
      port: 0,
      hostname: '127.0.0.1',
      serverOptions: {
        ...HTTP_SERVER_OPTIONS,
        headersTimeout: 200,
        requestTimeout: 300,
        connectionsCheckingInterval: 50,
      },
    });
    try {
      await new Promise<void>((resolve) => server.once('listening', resolve));
      const { port } = server.address() as AddressInfo;
      const host = `127.0.0.1:${port}`;
      const socket = connect(port, '127.0.0.1');
      const received: Buffer[] = [];
      socket.on('data', (chunk) => received.push(chunk));
      socket.write(
        `POST /api/ai/decide HTTP/1.1\r\nHost: ${host}\r\nOrigin: http://${host}\r\n` +
          'Content-Type: application/json\r\nContent-Length: 1000\r\n\r\n{"gameId":',
      );
      await new Promise<void>((resolve) => socket.once('close', resolve));
      expect(Buffer.concat(received).toString()).toMatch(/^HTTP\/1\.1 408/);
    } finally {
      server.close();
    }
  });

  test("the server's own limits are short and the body is at most 32 KB", () => {
    expect(HTTP_SERVER_OPTIONS.requestTimeout).toBeLessThanOrEqual(30_000);
    expect(HTTP_SERVER_OPTIONS.headersTimeout).toBeLessThan(HTTP_SERVER_OPTIONS.requestTimeout!);
    expect(HTTP_SERVER_OPTIONS.connectionsCheckingInterval).toBeLessThanOrEqual(5_000);
  });
});
