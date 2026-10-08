import { builtinModules } from 'node:module';
import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';

const FOLDERS = ['ai', 'web', 'sim', 'eval'];
const folderImport = (names) => `^(\\.{1,2}/)+(${names.join('|')})(/|$)`;

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
