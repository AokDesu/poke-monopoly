import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { afterEach, expect, test, vi } from 'vitest';
import { recordFixture, runOffline } from '../../eval/jev/index.ts';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

test('record refuses without a key through the ai wrapper, before any network or output', async () => {
  vi.stubEnv('CI', undefined);
  vi.stubEnv('TYPESAFE_API_KEY', undefined);
  vi.stubEnv('JEV_ENABLED', 'true');
  vi.stubEnv('JEV_MODEL', '');
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('network forbidden');
    }),
  );
  const output = join(tmpdir(), `jev-never-written-${crypto.randomUUID()}.json`);
  await expect(recordFixture('does-not-exist.json', output)).rejects.toThrow(
    'TYPESAFE_API_KEY is not set',
  );
  expect(globalThis.fetch).not.toHaveBeenCalled();
  await expect(access(output)).rejects.toThrow('ENOENT');
});

test('offline evaluation needs neither a key nor enabled Jev', async () => {
  vi.stubEnv('TYPESAFE_API_KEY', undefined);
  vi.stubEnv('JEV_ENABLED', 'false');
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('network forbidden');
    }),
  );
  expect(await runOffline()).toHaveLength(3);
  expect(globalThis.fetch).not.toHaveBeenCalled();
});

test.each([
  [{ CI: 'true' }, 'CI is set'],
  [{ JEV_ENABLED: 'true' }, 'TYPESAFE_API_KEY is not set'],
])('record CLI refuses in a controlled offline environment', (env, message) => {
  const result = spawnSync(
    process.execPath,
    [
      '--import',
      'tsx',
      'eval/jev/cli.ts',
      '--record',
      '--input',
      'missing.json',
      '--output',
      'unused.json',
    ],
    { env, encoding: 'utf8' },
  );
  expect(result.status).toBe(1);
  expect(result.stderr).toContain(message);
});
