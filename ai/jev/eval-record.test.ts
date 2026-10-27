import { access, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { check, resolveConfig } from 'prettier';
import { afterEach, expect, test, vi } from 'vitest';
import {
  DEFAULT_FIXTURES,
  recordFixture,
  recordScenarios,
  runOffline,
  writePlaceholders,
} from '../../eval/jev/index.ts';
import { placeholderResult } from '../../eval/jev/replay.ts';
import { SCENARIOS } from '../../eval/jev/scenarios.ts';
import { createSdkJevClient, PINNED_JEV_MODEL, type JevRequest } from './client.ts';
import { SpendLedger } from './spend.ts';

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
  expect(new Set((await runOffline()).map((row) => row.fixture)).size).toBe(20);
  expect(globalThis.fetch).not.toHaveBeenCalled();
});

test.each([
  [{ CI: 'true' }, 'CI is set'],
  [{ JEV_ENABLED: 'true' }, 'TYPESAFE_API_KEY is not set'],
])(
  'record CLI refuses in a controlled offline environment',
  (env, message) => {
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
  },
  30_000,
); // Each CLI run starts tsx and loads the engine.

test('scenario recording refuses without a key through the ai wrapper, before any network or output', async () => {
  vi.stubEnv('CI', undefined);
  vi.stubEnv('TYPESAFE_API_KEY', undefined);
  vi.stubEnv('JEV_ENABLED', 'true');
  vi.stubEnv('JEV_MODEL', '');
  const fetch = vi.fn(() => {
    throw new Error('network forbidden');
  });
  vi.stubGlobal('fetch', fetch);
  const dir = await mkdtemp(join(tmpdir(), 'jev-never-recorded-'));
  try {
    await expect(recordScenarios(dir)).rejects.toThrow('TYPESAFE_API_KEY is not set');
    expect(fetch).not.toHaveBeenCalled();
    expect(await readdir(dir)).toEqual([]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a scenario recorded through the real wrapper keeps the request ID and never the key', async () => {
  vi.stubEnv('CI', undefined);
  vi.stubEnv('JEV_ENABLED', 'true');
  vi.stubEnv('JEV_MODEL', '');
  const key = 'placeholder-key-not-real-49';
  const dir = await mkdtemp(join(tmpdir(), 'jev-recorded-'));
  const scenarios = SCENARIOS.filter((scenario) => scenario.id === 'encounter-scyther-great');
  let authorization: string | null = null;
  const fetch = async (_url: unknown, init?: RequestInit) => {
    authorization = new Headers(init?.headers).get('authorization');
    const request = JSON.parse(String(init?.body)) as JevRequest;
    const { answers } = placeholderResult('live', request);
    return new Response(
      JSON.stringify({
        model: PINNED_JEV_MODEL,
        answers,
        usage: { input_tokens: 3240, output_tokens: 0 },
      }),
      { headers: { 'content-type': 'application/json', 'x-typesafe-request-id': 'req_live_49' } },
    );
  };
  try {
    await writePlaceholders(dir, scenarios);
    const result = await recordScenarios(
      dir,
      () => createSdkJevClient({ apiKey: key, fetch }),
      scenarios,
      () => new SpendLedger(),
    );
    expect(result.recorded).toEqual(['encounter-scyther-great']);
    expect(authorization).toBe(`Bearer ${key}`);
    const saved = await readFile(join(dir, 'encounter-scyther-great.json'), 'utf8');
    expect(saved).not.toContain(key);
    expect(JSON.parse(saved)).toMatchObject({
      synthetic: false,
      recorded: { requestId: 'req_live_49', usage: { inputTokens: 3240 } },
    });
    // Committed as written: the recording passes `npm run format:check` with no manual step.
    const committed = join(DEFAULT_FIXTURES, 'encounter-scyther-great.json');
    expect(await check(saved, { ...(await resolveConfig(committed)), filepath: committed })).toBe(
      true,
    );
    expect((await runOffline(dir, scenarios)).every((row) => !row.synthetic)).toBe(true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
