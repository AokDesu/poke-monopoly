import { expect, test } from 'vitest';
import { observationSchema } from '../../engine/index.ts';
import fixture from '../../engine/fixtures/start-of-game-2p.json';
import {
  assertNoComparableNumbers,
  assertStateTokenBudget,
  buildJevState,
  estimateStateTokens,
  STATE_TOKEN_BUDGET,
} from '../../ai/state/index.ts';

test('numeric guard rejects comparable numbers and accepts named buckets and rank/Lap labels', () => {
  expect(() => assertNoComparableNumbers({ coins: 14 })).toThrow('coins');
  expect(() => assertNoComparableNumbers({ coins: 'ahead' })).not.toThrow();
  expect(() =>
    assertNoComparableNumbers({ you: { coins_rank: '2nd of 4', lap: '2 of 3' } }),
  ).not.toThrow();
});

test.each([
  { coins: '14' },
  { nested: [{ chance: 0.5 }] },
  { nested: { id: 14 } },
  { lap: 2 },
  { you: { lap: 2 } },
  { coins: NaN },
  { coins: Infinity },
  { opponents: [{ coins: 10 }] },
  { you: { seat_id: -1 } },
  { board: [{ space_id: 0.5 }] },
])('numeric guard rejects unapproved paths and invalid identifiers: %j', (state) => {
  expect(() => assertNoComparableNumbers(state)).toThrow(TypeError);
});

test('numeric identifier allow-list is limited to explicit state paths', () => {
  expect(() =>
    assertNoComparableNumbers({
      you: { seat_id: 0 },
      opponents: [{ seat_id: 1 }],
      board: [{ space_id: 0 }],
      active_seat_id: 1,
    }),
  ).not.toThrow();
  expect(() => assertNoComparableNumbers({ you: { nested: { seat_id: 14 } } })).toThrow();
  expect(() =>
    assertNoComparableNumbers({ you: { id: '123456789123456789', items: [{ item_id: '42' }] } }),
  ).not.toThrow();
  expect(() => assertNoComparableNumbers({ you: { id: 42 } })).toThrow();
});

test('size estimate includes JSON syntax and the guard permits exactly 4,000 tokens', () => {
  expect(estimateStateTokens({ text: 'hello' })).toBe(JSON.stringify({ text: 'hello' }).length / 4);
  const atLimit = {
    text: 'x'.repeat(STATE_TOKEN_BUDGET * 4 - JSON.stringify({ text: '' }).length),
  };
  expect(estimateStateTokens(atLimit)).toBe(4_000);
  expect(() => assertStateTokenBudget(atLimit)).not.toThrow();
  expect(() => assertStateTokenBudget({ text: atLimit.text + 'x' })).toThrow(RangeError);
  expect(() => assertStateTokenBudget({ text: 'x'.repeat(20_000) })).toThrow('4,000-token');
});

test('builder enforces budget and returns a detached role-scoped state', () => {
  const observation = observationSchema.parse(fixture.observation['0']);
  observation.own.items.push({
    instanceId: 'own-item',
    itemId: 'potion',
    name: 'Potion',
    visibility: 'secret',
  });
  const before = structuredClone(observation);
  const state = buildJevState(observation);
  expect(observation).toEqual(before);
  state.you.items[0]!.name = 'changed';
  expect(observation).toEqual(before);
  observation.own.items[0]!.name = 'x'.repeat(20_000);
  expect(() => buildJevState(observation)).toThrow('4,000-token');
});
