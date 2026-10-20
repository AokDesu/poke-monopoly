import { expect, test } from 'vitest';
import { CONTENT_VERSION } from '../content/index.ts';
import { loadContent } from './content.ts';
import { runSim } from './index.ts';

test('sim stub reports zero illegal applied actions', () => {
  expect(runSim(100, 1)).toMatchObject({ games: 100, seed: 1, illegalAppliedActionCount: 0 });
});

test('sim stub reports the Quick 2 Laps default and an explicit --lap-target 3 (§1)', () => {
  expect(runSim(100, 1)).toMatchObject({ lapTarget: 2 });
  expect(runSim(100, 1, 3)).toMatchObject({ lapTarget: 3, illegalAppliedActionCount: 0 });
});

test('sim rejects a Lap target that is not a positive whole number', () => {
  for (const lapTarget of [0, -1, 2.5, Number.NaN]) {
    expect(() => runSim(100, 1, lapTarget)).toThrow(RangeError);
  }
});

test('loadContent reads and validates the real content/*.json from disk', () => {
  const content = loadContent();
  expect(content.species).toHaveLength(19);
  expect(content.contentVersion).toBe(CONTENT_VERSION);
});
