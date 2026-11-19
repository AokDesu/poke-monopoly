/**
 * When demo mode is open (spec §3 AI turns, §11 step 3; issues #220, #247). Two things must both
 * hold: the page asks for it with `?demo`, and the server says its demo setting is on. Either one
 * missing, unreadable or unclear means off: demo mode shows a rival's private options (spec §1).
 */

/** The values of `?demo` that mean on: bare, `1` and `true`. `?demo=0`, `=false` or anything else is off. */
const ON_VALUES = ['', '1', 'true'];

/**
 * Whether the address asks for demo mode. Every `demo` parameter must be an on value, so
 * `?demo=0&demo` is off like `?demo=0`.
 */
export function demoRequested(search: string): boolean {
  const values = new URLSearchParams(search).getAll('demo');
  return values.length > 0 && values.every((value) => ON_VALUES.includes(value));
}

/**
 * The server's demo setting in a `GET /api/ai/status` answer: only a boolean `true` named `demo`
 * is on. It is read as a field, not through the shared strict status schema, so it behaves the
 * same before and after the server adds `demo: boolean` to that schema.
 */
export function demoSettingOf(status: unknown): boolean {
  return typeof status === 'object' && status !== null && 'demo' in status && status.demo === true;
}

/** Asks the server once. A failed, refused, slow, aborted or unreadable answer is off. */
export async function fetchDemoSetting(signal: AbortSignal): Promise<boolean> {
  try {
    const response = await fetch('/api/ai/status', { signal });
    if (!response.ok) return false;
    return demoSettingOf(await response.json());
  } catch {
    return false;
  }
}
