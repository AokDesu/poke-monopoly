import type { MiddlewareHandler } from 'hono';

// Loopback only, as the server binds: a name that merely resolves to this machine (DNS rebinding) is refused.
const LOOPBACK_HOST = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/i;

/**
 * Spec §6 item 2, §9: the speech route spends the owner's Haiku credit, so another web page open
 * in the same browser must not be able to call it. Only a JSON request whose Host is loopback and
 * whose Origin is that same host passes (the port is not fixed: Vite's proxy keeps its own in dev).
 * Refused before any body is read, any brief built or any call made.
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
