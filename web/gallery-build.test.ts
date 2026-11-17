import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { expect, test } from 'vitest';

// The strongest proof that the player flow cannot reach the gallery: build the shipped app and look.
// Run under Vitest's NODE_ENV=test on purpose: no environment setting may switch the gallery on.
test('the production build contains no gallery code, styles or engine snapshots (spec §3.1, issue #53)', () => {
  const out = mkdtempSync(join(tmpdir(), 'poke-gallery-build-'));
  try {
    execFileSync(
      process.execPath,
      [join('node_modules', 'vite', 'bin', 'vite.js'), 'build', 'web', '--outDir', out],
      {
        cwd: process.cwd(),
        stdio: 'pipe',
        timeout: 90_000,
      },
    );
    const files = readdirSync(out, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => join(entry.parentPath, entry.name));
    expect(files.length).toBeGreaterThan(0);
    expect(files.filter((file) => /gallery/i.test(relative(out, file)))).toEqual([]);
    for (const file of files.filter((name) => /\.(js|css|html)$/.test(name))) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(
        /ui-gallery|gallery-fixtures|gallery-row|data-gallery-row/,
      );
    }
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}, 120_000);
