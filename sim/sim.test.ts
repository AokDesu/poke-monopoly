import { expect, test } from 'vitest';
import { runSim } from './index.ts';

test('sim stub reports zero illegal applied actions', () => {
  expect(runSim(100, 1)).toMatchObject({ games: 100, seed: 1, illegalAppliedActionCount: 0 });
});

test('sim runs Quick 2 Laps by default and Standard on request with --lap-target 3 (§1)', () => {
  expect(runSim(100, 1)).toMatchObject({ lapTarget: 2 });
  expect(runSim(100, 1, 3)).toMatchObject({ lapTarget: 3, illegalAppliedActionCount: 0 });
});

test('sim rejects a Lap target that is not a positive whole number', () => {
  for (const lapTarget of [0, -1, 2.5, Number.NaN]) {
    expect(() => runSim(100, 1, lapTarget)).toThrow(RangeError);
  }
});
