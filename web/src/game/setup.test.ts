import { expect, test } from 'vitest';
import { classOptions } from './content.ts';
import { opponentFor, randomSetup, seedFromSearch } from './setup.ts';

test('?seed= is read as a whole number when it is one, a string otherwise, and absent when empty', () => {
  expect(seedFromSearch('?seed=7')).toBe(7);
  expect(seedFromSearch('?seed=-3')).toBe(-3);
  expect(seedFromSearch('?seed=playtest-a')).toBe('playtest-a');
  expect(seedFromSearch('?seed=99999999999999999999')).toBe('99999999999999999999');
  expect(seedFromSearch('?seed=')).toBeUndefined();
  expect(seedFromSearch('')).toBeUndefined();
});

test('the playable classes are the ones whose passive the engine implements (§1)', () => {
  expect(classOptions.filter((option) => option.playable).map((option) => option.id)).toEqual([
    'main-character',
    'researcher',
  ]);
  expect(classOptions.find((option) => option.id === 'nurse-joy')?.playable).toBe(false);
  // Stretch classes stay out of setup until after G2.
  expect(classOptions.map((option) => option.id)).not.toContain('team-rocket');
});

test('Random All never gives the human and the AI the same class (§3)', () => {
  for (const value of [0, 0.25, 0.5, 0.75, 0.999999]) {
    const setup = randomSetup(classOptions, ['quick'], () => value)!;
    expect(setup.opponents[0]!.classId).not.toBe(setup.human.classId);
    expect(setup.mode).toBe('quick');
  }
});

test('a rival on the class the human just took moves to a free class, keeping its other choices', () => {
  const rival = {
    classId: 'researcher',
    starterSpeciesId: 'porygon',
    personality: 'greedy',
    difficulty: 'normal',
  } as const;
  expect(
    opponentFor(classOptions, { classId: 'researcher', starterSpeciesId: 'porygon' }, rival),
  ).toEqual({ ...rival, classId: 'main-character', starterSpeciesId: 'bulbasaur' });
  expect(
    opponentFor(classOptions, { classId: 'main-character', starterSpeciesId: 'squirtle' }, rival),
  ).toBe(rival);
});
