import { builtinModules } from 'node:module';
import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';

const FOLDERS = ['ai', 'web', 'sim', 'eval'];
const folderImport = (names) => `^(\\.{1,2}/)+(${names.join('|')})(/|$)`;
const ADAPTER = 'web/src/game/store.ts';

// The Jev key lives only on the server, so only ai/ may name it (spec §7, §9).
const KEY_MESSAGE = 'TYPESAFE_API_KEY is read only inside ai/.';
const keyOutsideAi = [
  { selector: "Identifier[name='TYPESAFE_API_KEY']", message: KEY_MESSAGE },
  { selector: "Literal[value='TYPESAFE_API_KEY']", message: KEY_MESSAGE },
  { selector: 'TemplateElement[value.raw=/TYPESAFE_API_KEY/]', message: KEY_MESSAGE },
];

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
  { ignores: ['ai/**'], rules: { 'no-restricted-syntax': ['error', ...keyOutsideAi] } },
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
  // web/ calls the engine only through its adapter (spec §6.1). Type imports from the engine are allowed in web/ except in the adapter, which may import only engine/index.ts; test files may import the engine directly.
  {
    files: ['web/**/*.{ts,tsx}'],
    ignores: [ADAPTER, 'web/**/*.test.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: folderImport(['engine']),
              allowTypeImports: true,
              message: `web/ calls the engine only through ${ADAPTER}.`,
            },
          ],
        },
      ],
    },
  },
  {
    files: [ADAPTER],
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
  // The sim's replay path never calls Jev or the network (spec §6.8). Its one ai/ import is the offline fallback policy (§5.5).
  {
    files: ['sim/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: folderImport(['ai(?!/fallback/)', 'web']),
              message: 'sim/ must not import from web, or from ai beyond ai/fallback/.',
            },
            { regex: '^@typesafe-ai/', message: 'The Jev SDK belongs in ai/ only.' },
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
