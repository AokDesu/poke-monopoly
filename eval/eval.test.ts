import { expect, test } from 'vitest';
import { OFFLINE_MESSAGE } from './jev/cli.ts';

test('offline eval stub says there are no fixtures yet', () => {
  expect(OFFLINE_MESSAGE).toContain('no fixtures yet');
});
