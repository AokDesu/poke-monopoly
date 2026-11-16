import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'vite';
import { expect, test, vi } from 'vitest';

test('production browser chunks contain neither sentinel server keys nor the Jev or Haiku transport', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'poke-ai-web-'));
  const keys = {
    TYPESAFE_API_KEY: 'server-only-sentinel-key-never-in-a-browser-5a83',
    ANTHROPIC_API_KEY: 'server-only-sentinel-haiku-key-never-in-a-browser-7c19',
  };
  for (const [name, key] of Object.entries(keys)) vi.stubEnv(name, key);
  vi.stubEnv('HAIKU_ENABLED', 'true');
  try {
    const root = resolve(import.meta.dirname, '../web');
    await build({
      root,
      configFile: join(root, 'vite.config.ts'),
      logLevel: 'silent',
      build: { outDir: directory },
    });
    const files = (await readdir(directory, { recursive: true })).filter((file) =>
      /\.(js|html)$/.test(file),
    );
    for (const file of files) {
      const text = await readFile(join(directory, file), 'utf8');
      for (const key of Object.values(keys)) expect(text, file).not.toContain(key);
      expect(text, file).not.toMatch(
        /TYPESAFE_API_KEY|ANTHROPIC_API_KEY|HAIKU_ENABLED|@typesafe-ai|api\.typesafe\.ai|api\.anthropic\.com|(?:sk|tsai|typesafe)[_-][A-Za-z0-9_-]{24,}/,
      );
    }
  } finally {
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  }
}, 60000);
