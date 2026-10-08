import { expect, test } from 'vitest';
import { positionOf } from './index.ts';

test('signed route progress wraps to the visible 24-square board (spec §6.5)', () => {
  expect([-49, -24, -1, 0, 23, 24, 49].map(positionOf)).toEqual([23, 0, 23, 0, 23, 0, 1]);
  for (let progress = -1000; progress <= 1000; progress++) {
    expect(positionOf(progress)).toBeGreaterThanOrEqual(0);
    expect(positionOf(progress)).toBeLessThanOrEqual(23);
    expect(Number.isInteger(positionOf(progress))).toBe(true);
  }
});
