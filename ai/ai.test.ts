import { expect, test } from 'vitest';
import { app } from './app.ts';

test('status reports Jev on', async () => {
  const res = await app.request('/api/ai/status');
  expect(await res.json()).toEqual({ jevEnabled: true });
});
