import { join } from 'node:path';
import { ESLint } from 'eslint';
import { expect, test } from 'vitest';

const eslint = new ESLint({ cwd: join(import.meta.dirname, '..', '..') });

const errors = async (filePath: string, code: string, message: string) => {
  const [result] = await eslint.lintText(code, { filePath });
  return result?.messages.filter((m) => m.message === message).length;
};

const readsOf = (name: string) => [
  `export const key = process.env.${name};`,
  `export const key = process.env['${name}'];`,
  `export const { ${name}: key } = process.env;`,
  `export const key = process.env[\`${name}\`];`,
];

const OUTSIDE_AI = [
  'web/key.tsx',
  'engine/key.ts',
  'sim/key.ts',
  'eval/jev/key.ts',
  'content/key.ts',
  'key.js',
];

// Spec §9: both keys and the Haiku switch live only on the server, so lint rejects any mention of
// them outside ai/.
test.each(['TYPESAFE_API_KEY', 'ANTHROPIC_API_KEY', 'HAIKU_ENABLED'])(
  'lint rejects reading %s outside ai/ and allows it inside',
  async (name) => {
    const message = `${name} is read only inside ai/.`;
    for (const filePath of OUTSIDE_AI) {
      for (const code of readsOf(name)) {
        expect(await errors(filePath, code, message), `${filePath}: ${code}`).toBeGreaterThan(0);
      }
    }
    for (const code of readsOf(name)) {
      expect(await errors('ai/jev/key.ts', code, message)).toBe(0);
      expect(await errors('ai/haiku/key.ts', code, message)).toBe(0);
    }
  },
);

const HAIKU_IMPORTERS = ['sim/haiku.ts', 'sim/policy.ts', 'eval/haiku.ts', 'eval/jev/haiku.ts'];

// Spec §5.2, §6.8: replay, simulation and evaluation never call Haiku.
test.each(HAIKU_IMPORTERS)('lint rejects importing ai/haiku/ in %s', async (filePath) => {
  const [result] = await eslint.lintText(
    "import { createHaikuClient } from '../ai/haiku/client.ts';\nimport '../../ai/haiku/fake.ts';\nexport { createHaikuClient };\n",
    { filePath },
  );
  const restricted = result?.messages.filter((m) => m.ruleId === 'no-restricted-imports') ?? [];
  expect(restricted.length, filePath).toBeGreaterThan(0);
});

test('lint allows eval/ and sim/ to import the Jev client but not Haiku’s', async () => {
  const [result] = await eslint.lintText(
    "import { createFakeJevClient } from '../../ai/jev/fake.ts';\nexport { createFakeJevClient };\n",
    { filePath: 'eval/jev/jev.ts' },
  );
  expect(result?.messages.filter((m) => m.ruleId === 'no-restricted-imports')).toEqual([]);
});
