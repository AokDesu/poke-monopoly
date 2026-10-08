import { expect, test } from 'vitest';
import { CONTENT_VERSION } from './index.ts';

test('content exposes a version stamp', () => {
  expect(CONTENT_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
});
