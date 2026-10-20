import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: [
      ...configDefaults.exclude,
      '.claude/**',
      '.agents/**',
      '.codex/**',
      '.impeccable/**',
      '.lavish/**',
    ],
    projects: [
      { extends: true, test: { name: 'node', exclude: ['web/**'] } },
      {
        extends: true,
        test: {
          name: 'web',
          include: ['web/**/*.test.{ts,tsx}'],
          environment: 'jsdom',
          setupFiles: ['web/src/test/setup.ts'],
        },
      },
    ],
  },
});
