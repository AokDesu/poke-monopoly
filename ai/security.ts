import type { ServerOptions } from 'node:http';
import type { MiddlewareHandler } from 'hono';
import { SERVER_LIMITS, type RequestWindow } from './jev/window.ts';

/**
 * Spec §9, #64: what the built web app needs and nothing more. Scripts, fonts and images come from
 * this origin only; styles may be inline because React sets `style` attributes; the 3D scene uses
 * workers, blobs and WebAssembly that the page makes itself. No other site can frame the page, and
 * no form, base tag or plug-in is allowed.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self' blob: data:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

/** On every response, the API's and the static pages': sniffing off, no framing, no referrer sent. */
export const securityHeaders: MiddlewareHandler = async (c, next) => {
  await next();
  c.res.headers.set('Content-Security-Policy', CONTENT_SECURITY_POLICY);
  c.res.headers.set('X-Content-Type-Options', 'nosniff');
  c.res.headers.set('X-Frame-Options', 'DENY');
  c.res.headers.set('Referrer-Policy', 'no-referrer');
};

/**
 * One server-wide limit on `/api/ai/*` requests, counted after the same-origin check so another
 * page in the same browser cannot use up the player's allowance. Past it: 429, before any body is
 * read or any brief built. The web app treats a failed request as a fallback.
 */
export const apiRateLimit =
  (window: RequestWindow): MiddlewareHandler =>
  async (c, next) => {
    if (!window.take()) {
      return c.json({ error: 'rate_limited' }, 429, {
        'Retry-After': String(Math.ceil(SERVER_LIMITS.windowMs / 1000)),
      });
    }
    await next();
  };

/**
 * Read limits for the Node server: the request line and headers within 10 s, the whole request,
 * body included, within 15 s (a body is at most 32 KB), checked every second. A client that sends
 * a body slowly, or stops, is answered 408 and cut off. The server binds 127.0.0.1 only.
 */
export const HTTP_SERVER_OPTIONS: ServerOptions = Object.freeze({
  headersTimeout: 10_000,
  requestTimeout: 15_000,
  connectionsCheckingInterval: 1_000,
});
