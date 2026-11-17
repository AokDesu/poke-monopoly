import { builtinModules } from 'node:module';
import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';

const FOLDERS = ['ai', 'web', 'sim', 'eval'];
const folderImport = (names) => `^(\\.{1,2}/)+(${names.join('|')})(/|$)`;
const ADAPTERS = ['web/src/game/store.ts', 'web/src/game/save.ts', 'web/src/game/content.ts'];

// The Jev and Haiku keys and the Haiku kill switch live only on the server, so only ai/ may name them (spec §7, §9).
const keyOutsideAi = ['TYPESAFE_API_KEY', 'ANTHROPIC_API_KEY', 'HAIKU_ENABLED'].flatMap((name) => {
  const message = `${name} is read only inside ai/.`;
  return [
    { selector: `Identifier[name='${name}']`, message },
    { selector: `Literal[value='${name}']`, message },
    { selector: `TemplateElement[value.raw=/${name}/]`, message },
  ];
});

// Engine is pure rules with no IO (spec §6 item 1, §7 house rules).
const enginePurity = {
  'no-restricted-properties': [
    'error',
    {
      object: 'Math',
      property: 'random',
      message: 'Randomness comes from the seeded RNG in engine/.',
    },
    { object: 'Date', property: 'now', message: 'The engine has no clock.' },
    { object: 'globalThis', property: 'fetch', message: 'The engine has no IO.' },
    { object: 'globalThis', property: 'process', message: 'The engine has no IO.' },
  ],
  'no-restricted-globals': [
    'error',
    { name: 'fetch', message: 'The engine has no IO.' },
    { name: 'process', message: 'The engine has no IO.' },
  ],
  'no-restricted-syntax': [
    'error',
    {
      selector: ":matches(NewExpression, CallExpression)[callee.name='Date']",
      message: 'The engine has no clock.',
    },
    { selector: 'ImportExpression', message: 'The engine has no dynamic imports.' },
    ...keyOutsideAi,
  ],
  'no-restricted-imports': [
    'error',
    {
      paths: builtinModules.map((name) => ({ name, message: 'The engine has no IO.' })),
      patterns: [
        { regex: '^node:', message: 'The engine has no IO.' },
        {
          regex: folderImport(FOLDERS),
          message: 'engine/ must not import from ai, web, sim or eval.',
        },
        { regex: '^@typesafe-ai/', message: 'The Jev SDK belongs in ai/ only.' },
      ],
    },
  ],
};

export default defineConfig([
  globalIgnores([
    'node_modules',
    'web/dist',
    'sim/out',
    '.claude',
    '.agents',
    '.codex',
    '.impeccable',
    '.lavish',
  ]),
  js.configs.recommended,
  tseslint.configs.recommended,
  // This file names the keys to forbid them, so it is the one file outside ai/ the rule skips.
  {
    ignores: ['ai/**', 'eslint.config.js'],
    rules: { 'no-restricted-syntax': ['error', ...keyOutsideAi] },
  },
  { files: ['engine/**/*.{ts,tsx}'], rules: enginePurity },
  {
    files: ['web/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { regex: folderImport(['ai']), message: 'web/ must not import from ai/.' },
            { regex: '^@typesafe-ai/', message: 'The Jev SDK belongs in ai/ only.' },
          ],
        },
      ],
    },
  },
  // web/ calls the engine only through its adapters (spec §6.1). Type imports are allowed elsewhere; tests and web/src/test helpers may import the engine directly.
  {
    files: ['web/**/*.{ts,tsx}'],
    ignores: [...ADAPTERS, 'web/**/*.test.{ts,tsx}', 'web/src/test/**'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: folderImport(['engine']),
              allowTypeImports: true,
              message: `web/ calls the engine only through ${ADAPTERS.join(' or ')}.`,
            },
          ],
        },
      ],
    },
  },
  {
    files: ADAPTERS,
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '^(\\.{1,2}/)+engine(/(?!index\\.ts$)|$)',
              message: 'The adapter uses only the engine public API in engine/index.ts.',
            },
          ],
        },
      ],
    },
  },
  // The sim's replay path never calls Jev or the network (spec §6.8). Its ai/ imports are the offline fallback policy (§5.5) and, in the policy registry only, `--policy jev` (§5.6).
  ...[
    ['sim/**/*.{ts,tsx}', 'ai(?!/fallback/)', 'ai beyond ai/fallback/'],
    [
      'sim/policy.ts',
      'ai(?!/fallback/|/jev-policy\\.ts$)',
      'ai beyond ai/fallback/ and ai/jev-policy.ts',
    ],
  ].map(([files, ai, allowed]) => ({
    files: [files],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: folderImport([ai, 'web']),
              message: `sim/ must not import from web, or from ${allowed}.`,
            },
            { regex: '^@typesafe-ai/', message: 'The Jev SDK belongs in ai/ only.' },
          ],
        },
      ],
    },
  })),
  // Simulation, replay and evaluation never call Haiku (spec §5.2). sim/ is already confined to ai/fallback/ above; eval/ may use the Jev client but not Haiku's.
  {
    files: ['eval/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { regex: '^(\\.{1,2}/)+ai/haiku(/|$)', message: 'eval/ must not import ai/haiku/.' },
          ],
        },
      ],
    },
  },
  {
    files: ['ai/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [{ regex: folderImport(['web']), message: 'ai/ must not import from web/.' }] },
      ],
    },
  },
]);
