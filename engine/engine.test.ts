import { test as fcTest } from '@fast-check/vitest';
import fc from 'fast-check';
import { expect, test } from 'vitest';
import { ENGINE_VERSION } from './index.ts';

test('engine exposes a version stamp', () => {
  expect(ENGINE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
});

// Proves the property-test wiring (fast-check + vitest) works for later issues.
fcTest.prop([fc.integer({ min: 1, max: 6 })])('a d6 roll stays on the die', (roll) => {
  expect(roll).toBeGreaterThanOrEqual(1);
  expect(roll).toBeLessThanOrEqual(6);
});
