import { expect, test } from 'vitest';
import { test as fcTest } from '@fast-check/vitest';
import fc from 'fast-check';
import { createRng, d6, int, weightedPick, shuffle, engineEventSchema } from './index.ts';

test('seed 1 pins the first ten d6 results for deterministic replay (spec §6.8)', () => {
  let rng = createRng(1);
  const values = [];
  for (let i = 0; i < 10; i++) {
    const draw = d6(rng, 'movement');
    values.push(draw.value);
    rng = draw.rng;
  }
  expect(values).toEqual([4, 1, 4, 6, 6, 2, 4, 5, 3, 6]);
});

fcTest.prop([fc.integer(), fc.array(fc.integer(), { maxLength: 100 })])(
  'shuffle preserves every occurrence exactly once for any seed (spec §4.6)',
  (seed, input) => {
    const result = shuffle(createRng(seed), input);
    expect([...result.value].sort((a, b) => a - b)).toEqual([...input].sort((a, b) => a - b));
    expect(shuffle(createRng(seed), input)).toEqual(result);
    expect(result.rng.cursor).toBe(Math.max(0, input.length - 1));
  },
);

test('seed 1 yields between 900 and 1100 of each face over 6000 d6 draws', () => {
  let rng = createRng(1);
  const counts = [0, 0, 0, 0, 0, 0];
  for (let i = 0; i < 6000; i++) {
    const result = d6(rng);
    counts[result.value - 1]!++;
    rng = result.rng;
  }
  for (const count of counts) {
    expect(count).toBeGreaterThanOrEqual(900);
    expect(count).toBeLessThanOrEqual(1100);
  }
});

test('shuffle is repeatable, leaves its input untouched and logs each Fisher-Yates choice', () => {
  const initial = createRng(1);
  const input = ['a', 'b', 'c', 'd'];
  const result = shuffle(initial, input, 'event_shuffle');
  expect(result.value).toEqual(['d', 'b', 'a', 'c']);
  expect(result.events).toEqual([
    { kind: 'random_result', purpose: 'event_shuffle', result: 2, drawCounter: 1 },
    { kind: 'random_result', purpose: 'event_shuffle', result: 0, drawCounter: 2 },
    { kind: 'random_result', purpose: 'event_shuffle', result: 1, drawCounter: 3 },
  ]);
  expect(shuffle(initial, input, 'event_shuffle')).toEqual(result);
  expect(input).toEqual(['a', 'b', 'c', 'd']);
  for (const trivial of [[], ['a']]) {
    expect(shuffle(initial, trivial)).toEqual({ value: trivial, rng: initial, events: [] });
  }
});

test('shuffle validates state and purpose even when no draws are needed', () => {
  expect(() => shuffle({ state: 'invalid', cursor: 0 }, [])).toThrow(RangeError);
  expect(() => shuffle(createRng(1), ['only'], '')).toThrow(RangeError);
});

test('weightedPick selects positive-weight entries and logs the selected index in one draw', () => {
  const initial = createRng(1);
  const entries = [
    { value: 'never', weight: 0 },
    { value: 'common', weight: 1 },
    { value: 'rare', weight: 3 },
  ];
  expect(weightedPick(initial, entries, 'species')).toMatchObject({
    value: 'rare',
    rng: { cursor: 1 },
    events: [{ kind: 'random_result', purpose: 'species', result: 2, drawCounter: 1 }],
  });
  for (const weights of [
    [],
    [0, 0],
    [-1, 2],
    [NaN],
    [Infinity],
    [Number.MAX_VALUE, Number.MAX_VALUE],
  ]) {
    expect(() =>
      weightedPick(
        initial,
        weights.map((weight) => ({ value: 'x', weight })),
      ),
    ).toThrow(RangeError);
  }
  expect(d6(initial).value).toBe(4);
});

test('string seeds reproduce across serialization and invalid seeds/state/purpose are rejected', () => {
  const initial = createRng('game-1');
  const first = d6(initial);
  expect(d6(JSON.parse(JSON.stringify(first.rng)))).toEqual(d6(first.rng));
  expect(d6(createRng('game-1'))).toEqual(first);
  for (const seed of ['', NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    expect(() => createRng(seed)).toThrow(RangeError);
  }
  for (const rng of [
    { state: 'bogus', cursor: 0 },
    { state: '-1', cursor: 0 },
    { state: '4294967296', cursor: 0 },
    { state: '01', cursor: 0 },
    { state: '1', cursor: -1 },
    { state: '1', cursor: 0.5 },
    { state: '1', cursor: Number.MAX_SAFE_INTEGER },
  ]) {
    expect(() => d6(rng)).toThrow(RangeError);
  }
  expect(() => d6(initial, '')).toThrow(RangeError);
  expect(d6(initial)).toEqual(first);
});

test('int draws a zero-based choice and rejects invalid bounds without consuming state', () => {
  const initial = createRng(1);
  expect(int(initial, 10, 'shop')).toMatchObject({
    value: 6,
    events: [{ kind: 'random_result', purpose: 'shop', result: 6, drawCounter: 1 }],
  });
  for (const n of [0, -1, 1.5, NaN, Infinity, 4294967297]) {
    expect(() => int(initial, n)).toThrow(RangeError);
  }
  expect(d6(initial).value).toBe(4);
});

test('each draw returns its logged purpose, value and one-based counter without mutating input', () => {
  const initial = createRng(1);
  const first = d6(initial, 'movement');
  const second = d6(first.rng, 'catch');
  expect(first.events).toEqual([
    { kind: 'random_result', purpose: 'movement', result: 4, drawCounter: 1 },
  ]);
  expect(second.events).toEqual([
    { kind: 'random_result', purpose: 'catch', result: 1, drawCounter: 2 },
  ]);
  expect(engineEventSchema.parse(first.events[0])).toEqual(first.events[0]);
  expect(initial).toEqual({ state: '1', cursor: 0 });
  expect(d6(initial, 'movement')).toEqual(first);
});
