import { afterEach, expect, test, vi } from 'vitest';
import { app } from './app.ts';

afterEach(() => vi.unstubAllEnvs());

test('status reports Jev on when JEV_ENABLED is unset', async () => {
  vi.stubEnv('JEV_ENABLED', undefined);
  const res = await app.request('/api/ai/status');
  expect(await res.json()).toEqual({ jevEnabled: true });
});

test('status reports Jev off when JEV_ENABLED=false', async () => {
  vi.stubEnv('JEV_ENABLED', 'false');
  const res = await app.request('/api/ai/status');
  expect(await res.json()).toEqual({ jevEnabled: false });
});
