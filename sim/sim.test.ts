import { expect, test } from 'vitest';
import { CONTENT_VERSION } from '../content/index.ts';
import { loadContent } from './content.ts';
import { runSim } from './index.ts';

test('sim stub reports zero illegal applied actions', () => {
  expect(runSim(100, 1)).toMatchObject({ games: 100, seed: 1, illegalAppliedActionCount: 0 });
});

test('loadContent reads and validates the real content/*.json from disk', () => {
  const content = loadContent();
  expect(content.species).toHaveLength(19);
  expect(content.contentVersion).toBe(CONTENT_VERSION);
});
