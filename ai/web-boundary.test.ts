import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'vite';
import { expect, test, vi } from 'vitest';

test('production browser chunks contain neither a sentinel server key nor the Jev transport', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'poke-ai-web-'));
  const key = 'server-only-sentinel-key-never-in-a-browser-5a83';
  vi.stubEnv('TYPESAFE_API_KEY', key);
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
      expect(text, file).not.toContain(key);
      expect(text, file).not.toMatch(
        /TYPESAFE_API_KEY|@typesafe-ai|api\.typesafe\.ai|(?:sk|tsai|typesafe)[_-][A-Za-z0-9_-]{24,}/,
      );
    }
  } finally {
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  }
}, 60000);
