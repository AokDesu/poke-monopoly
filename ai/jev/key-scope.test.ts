import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { expect, test } from 'vitest';

const ROOT = join(import.meta.dirname, '..', '..');
const SKIP = new Set([
  'node_modules',
  '.git',
  'dist',
  'out',
  '.claude',
  '.agents',
  '.codex',
  '.impeccable',
  '.lavish',
]);
const CODE = /\.(c|m)?(t|j)sx?$/;

const codeFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (SKIP.has(entry.name)) return [];
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return codeFiles(path);
    return CODE.test(entry.name) ? [relative(ROOT, path).split(sep).join('/')] : [];
  });

// Spec §9: the key lives only on the server, so only ai/ may name it.
test('the Jev key is read only from the environment, only inside ai/', () => {
  const naming = codeFiles(ROOT).filter((file) =>
    readFileSync(join(ROOT, file), 'utf8').includes('TYPESAFE_API_KEY'),
  );
  expect(naming.length).toBeGreaterThan(0);
  expect(naming.filter((file) => !file.startsWith('ai/'))).toEqual([]);

  const readers = naming.filter((file) => !file.endsWith('.test.ts'));
  expect(readers).toEqual(['ai/jev/client.ts']);
  const source = readFileSync(join(ROOT, 'ai/jev/client.ts'), 'utf8');
  // Exactly one read, straight from the server's environment.
  expect(source.match(/process\.env\.TYPESAFE_API_KEY\b/g)).toHaveLength(1);
});
