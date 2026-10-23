import { expect, test } from 'vitest';
import { createRng } from '../engine/index.ts';
import { selectLine } from './lines.ts';

test('selectLine picks the same line for the same seed and logs the pick with its line ID', () => {
  const first = selectLine('catch_success', 'greedy', 'neutral', createRng(42));
  const again = selectLine('catch_success', 'greedy', 'neutral', createRng(42));
  expect(again).toEqual(first);
  expect(first.lineId).toMatch(/^catch-success-greedy-neutral-\d+$/);
  expect(first.events).toContainEqual({
    kind: 'line_selected',
    situation: 'catch_success',
    personalityId: 'greedy',
    trustBucket: 'neutral',
    lineId: first.lineId,
  });
});

test('selectLine reaches every Greedy neutral line across seeds', () => {
  const picked = new Set(
    Array.from(
      { length: 30 },
      (_, seed) => selectLine('game_start', 'greedy', 'neutral', createRng(seed)).lineId,
    ),
  );
  expect([...picked].sort()).toEqual([
    'game-start-greedy-neutral-1',
    'game-start-greedy-neutral-2',
    'game-start-greedy-neutral-3',
  ]);
});

test('selectLine refuses a personality or trust bucket the line bank does not cover', () => {
  expect(() => selectLine('game_start', 'greedy', 'high', createRng(1))).toThrow(/greedy at high/);
});
