import { afterEach, expect, test, vi } from 'vitest';
import { reportOutcome } from './ai.ts';

afterEach(() => vi.unstubAllGlobals());

const ids = { gameId: 'g', seatIndex: 1, turnKey: '3:1', stateRevision: 9 };

test('a Shop decision is reported like every other, so the decision log holds it (spec §6 item 8)', () => {
  const transport = vi.fn(async () => new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', transport);
  reportOutcome(
    { ...ids, decisionPoint: 'shop' },
    { choice: 'skip-shop', source: 'fallback', fallbackReason: 'auto' },
  );
  expect(transport).toHaveBeenCalledOnce();
  const [path, init] = transport.mock.calls[0] as unknown as [string, RequestInit];
  expect(path).toBe('/api/ai/outcome');
  expect(JSON.parse(String(init.body))).toEqual({
    ...ids,
    decisionPoint: 'shop',
    choice: 'skip-shop',
    source: 'fallback',
    fallbackReason: 'auto',
  });
});
