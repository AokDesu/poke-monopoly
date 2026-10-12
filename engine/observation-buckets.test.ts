import { expect, test } from 'vitest';
import {
  bucketCoinsRelative,
  bucketCount,
  bucketSquaresToStart,
  observationSchema,
  summarizeObservation,
} from './index.ts';
import fixture from './fixtures/start-of-game-2p.json';

test.each([
  [-11, 'far behind'],
  [-10, 'far behind'],
  [-9, 'behind'],
  [-1, 'behind'],
  [0, 'level'],
  [1, 'ahead'],
  [9, 'ahead'],
  [10, 'far ahead'],
  [11, 'far ahead'],
])('coin difference %s maps to %s, including exact thresholds', (difference, expected) => {
  expect(bucketCoinsRelative(20 + Number(difference), 20)).toBe(expected);
});

test.each([
  [0, 'near'],
  [5, 'near'],
  [6, 'near'],
  [7, 'middle'],
  [11, 'middle'],
  [12, 'middle'],
  [13, 'far'],
  [23, 'far'],
  [24, 'far'],
])('distance %s maps to %s, including exact thresholds', (value, expected) => {
  expect(bucketSquaresToStart(Number(value))).toBe(expected);
});

test.each([
  [0, 'none'],
  [1, 'one'],
  [2, 'few'],
  [3, 'few'],
  [4, 'many'],
  [Number.MAX_SAFE_INTEGER, 'many'],
])('count %s maps to %s, including exact thresholds', (value, expected) => {
  expect(bucketCount(Number(value))).toBe(expected);
});

test('every legal board distance, count and coin difference has exactly one named bucket', () => {
  for (let value = 0; value <= 24; value++) {
    expect(['near', 'middle', 'far']).toContain(bucketSquaresToStart(value));
    expect(['none', 'one', 'few', 'many']).toContain(bucketCount(value));
  }
  for (let difference = -100; difference <= 100; difference++) {
    expect(['far behind', 'behind', 'level', 'ahead', 'far ahead']).toContain(
      bucketCoinsRelative(100 + difference, 100),
    );
  }
});

test.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
  'bucket helpers reject invalid engine numbers: %s',
  (value) => {
    expect(() => bucketCount(value)).toThrow(RangeError);
    expect(() => bucketSquaresToStart(value)).toThrow(RangeError);
    expect(() => bucketCoinsRelative(value, 0)).toThrow(RangeError);
    expect(() => bucketCoinsRelative(0, value)).toThrow(RangeError);
  },
);

test('ranking uses cash only and tied seats share their rank; current Lap is capped at the target', () => {
  const observation = observationSchema.parse(fixture.observation['0']);
  const first = observation.public.players[0]!;
  const second = observation.public.players[1]!;
  first.coins = 10;
  first.badges = 999;
  first.creditedLap = 1;
  first.position = 19;
  second.coins = 20;
  observation.public.lapTarget = 3;
  observation.public.players.push({ ...structuredClone(second), actorId: 'p2', seatIndex: 2 });
  observation.public.players.push({ ...structuredClone(first), actorId: 'p3', seatIndex: 3 });
  expect(summarizeObservation(observation).you).toMatchObject({
    coins_rank: '3rd of 4',
    lap: '2 of 3',
    squares_to_start: 'near',
  });
  first.coins = 20;
  first.creditedLap = 3;
  first.position = 0;
  expect(summarizeObservation(observation).you).toMatchObject({
    coins_rank: '1st of 4',
    lap: '3 of 3',
    squares_to_start: 'near',
  });
  first.coins = 15;
  second.coins = 10;
  expect(summarizeObservation(observation).you.coins_rank).toBe('2nd of 4');
  first.coins = 0;
  expect(summarizeObservation(observation).you.coins_rank).toBe('4th of 4');
});

test('missing own seat cannot silently build a state for another seat', () => {
  const observation = observationSchema.parse(fixture.observation['0']);
  observation.own.seatIndex = 999;
  expect(() => summarizeObservation(observation)).toThrow('own seat');
});
