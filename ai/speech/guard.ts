import type { MiddlewareHandler } from 'hono';

// Loopback only, as the server binds: a name that merely resolves to this machine (DNS rebinding) is refused.
const LOOPBACK_HOST = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/i;

/**
 * Spec §6 item 2, §9: every `/api/ai/*` route is same-origin only, so another web page open in the
 * same browser cannot spend the owner's Jev or Haiku credit or write the decision log. Only a JSON
 * request whose Host is loopback and whose Origin is that same host passes (the port is not fixed:
 * Vite's proxy keeps its own in dev). Refused before any body is read, any brief built or any call made.
 */
export const sameOriginJson: MiddlewareHandler = async (c, next) => {
  const host = c.req.header('host');
  const origin = c.req.header('origin');
  if (
    !host ||
    !LOOPBACK_HOST.test(host) ||
    origin?.toLowerCase() !== `http://${host.toLowerCase()}`
  ) {
    return c.json({ error: 'forbidden_origin' }, 403);
  }
  const type = c.req.header('content-type')?.split(';')[0]?.trim().toLowerCase();
  if (type !== 'application/json') return c.json({ error: 'unsupported_media_type' }, 415);
  await next();
};

/**
 * The Host allow-list for a GET, which a browser sends without an Origin and without a body: the
 * Host must be loopback (a name that resolves here by DNS rebinding is refused) and an Origin, if
 * there is one, must be that same host.
 */
export const loopbackHost: MiddlewareHandler = async (c, next) => {
  const host = c.req.header('host');
  const origin = c.req.header('origin');
  if (
    !host ||
    !LOOPBACK_HOST.test(host) ||
    (origin !== undefined && origin.toLowerCase() !== `http://${host.toLowerCase()}`)
  ) {
    return c.json({ error: 'forbidden_origin' }, 403);
  }
  await next();
};
