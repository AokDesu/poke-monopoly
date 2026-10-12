import { join } from 'node:path';
import { ESLint } from 'eslint';
import { expect, test } from 'vitest';

const eslint = new ESLint({ cwd: join(import.meta.dirname, '..', '..') });
const KEY_MESSAGE = 'TYPESAFE_API_KEY is read only inside ai/.';

const keyErrors = async (filePath: string, code: string) => {
  const [result] = await eslint.lintText(code, { filePath });
  return result?.messages.filter((message) => message.message === KEY_MESSAGE).length;
};

const reads = [
  'export const key = process.env.TYPESAFE_API_KEY;',
  "export const key = process.env['TYPESAFE_API_KEY'];",
  'export const { TYPESAFE_API_KEY: key } = process.env;',
  'export const key = process.env[`TYPESAFE_API_KEY`];',
];

// Spec §9: the key lives only on the server, so lint rejects any mention of it outside ai/.
test.each([
  'web/key.tsx',
  'engine/key.ts',
  'sim/key.ts',
  'eval/jev/key.ts',
  'content/key.ts',
  'key.js',
])('lint rejects reading the Jev key in %s', async (filePath) => {
  for (const code of reads) expect(await keyErrors(filePath, code)).toBeGreaterThan(0);
});

test('lint allows reading the Jev key inside ai/', async () => {
  for (const code of reads) expect(await keyErrors('ai/jev/key.ts', code)).toBe(0);
});
