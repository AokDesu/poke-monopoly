import { expect, test } from 'vitest';
import { runSim } from './index.ts';

test('sim stub reports zero illegal applied actions', () => {
  expect(runSim(100, 1)).toMatchObject({ games: 100, seed: 1, illegalAppliedActionCount: 0 });
});
