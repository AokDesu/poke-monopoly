import { expect, test } from 'vitest';
import { createGame } from '../../../engine/index.ts';
import { classOptions, engineContent } from './content.ts';
import {
  applyPreset,
  presetProblem,
  SETUP_PRESETS,
  type OpenRivalChoices,
  type SetupPreset,
} from './presets.ts';
import { DIFFICULTIES, MAX_RIVALS, PERSONALITIES, type ClassOption, type ModeId } from './setup.ts';
import { configForSetup } from './store.ts';

const OPEN: readonly ModeId[] = ['quick'];

/** A small seeded generator (mulberry32), so the random presets are checked on many draws. */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

const fixed = (rivals: SetupPreset & { kind: 'fixed' }) => rivals;
const sample = fixed(
  SETUP_PRESETS.find((p) => p.kind === 'fixed' && p.rivals.length === 2) as never,
);

const without = (id: string): ClassOption[] => classOptions.filter((option) => option.id !== id);
const closed = (id: string): ClassOption[] =>
  classOptions.map((option) => (option.id === id ? { ...option, playable: false } : option));

test('every preset is legal today and its seats start a Quick game in the engine (§3, #157)', () => {
  for (const preset of SETUP_PRESETS) {
    expect(presetProblem(preset, classOptions, OPEN), preset.id).toBeUndefined();
    for (let seed = 1; seed <= 40; seed++) {
      const applied = applyPreset(preset, classOptions, OPEN, seeded(seed));
      expect(applied.ok, preset.id).toBe(true);
      if (!applied.ok) continue;
      const { setup } = applied;
      const classIds = [setup.human, ...setup.opponents].map((seat) => seat.classId);
      expect(new Set(classIds).size, `${preset.id} #${seed}`).toBe(classIds.length);
      expect(setup.opponents.length).toBeGreaterThanOrEqual(1);
      expect(setup.opponents.length).toBeLessThanOrEqual(MAX_RIVALS);
      expect(setup.mode).toBe('quick');
      // The engine re-checks the seats itself: a preset that it refuses would throw here.
      expect(() => createGame(configForSetup(setup, seed), engineContent)).not.toThrow();
    }
  }
});

test('the set holds one-rival, two-rival and three-rival arrangements and no copy of Random All (#157)', () => {
  expect(SETUP_PRESETS.map((preset) => preset.id)).toEqual([
    'one-rival-easy',
    'two-rivals-normal',
    'three-rivals-random',
  ]);
  const counts = SETUP_PRESETS.map((preset) =>
    preset.kind === 'fixed' ? preset.rivals.length : preset.rivalCount,
  );
  expect(counts).toEqual([1, 2, 3]);
});

test('a fixed preset fills every seat exactly and editing the result never reaches the preset', () => {
  const first = applyPreset(sample, classOptions, OPEN, seeded(1));
  expect(first.ok && first.setup).toMatchObject({
    mode: 'quick',
    human: sample.human,
    opponents: sample.rivals,
  });
  if (!first.ok) return;
  (first.setup.opponents[0] as { difficulty: string }).difficulty = 'easy';
  (first.setup.human as { classId: string }).classId = 'fisherman';
  const second = applyPreset(sample, classOptions, OPEN, seeded(2));
  expect(second.ok && second.setup.opponents).toEqual(sample.rivals);
  expect(second.ok && second.setup.human).toEqual(sample.human);
});

test('Three rivals, random keeps three AIs (§3)', () => {
  for (let seed = 1; seed <= 60; seed++) {
    const three = applyPreset(SETUP_PRESETS[2]!, classOptions, OPEN, seeded(seed));
    expect(three.ok && three.setup.opponents.length).toBe(3);
  }
});

const problems: {
  name: string;
  preset: SetupPreset;
  classes: readonly ClassOption[];
  modes?: readonly ModeId[];
  expected: object;
}[] = [
  {
    name: 'a rival class that is no longer open',
    preset: sample,
    classes: closed('bug-catcher'),
    expected: { kind: 'class', classId: 'bug-catcher' },
  },
  {
    name: 'the player class that is no longer open',
    preset: sample,
    classes: closed('researcher'),
    expected: { kind: 'class', classId: 'researcher' },
  },
  {
    name: 'a class that content no longer has',
    preset: sample,
    classes: without('main-character'),
    expected: { kind: 'class', classId: 'main-character' },
  },
  {
    name: 'a Starter its class no longer offers',
    preset: { ...sample, human: { classId: 'researcher', starterSpeciesId: 'bulbasaur' } },
    classes: classOptions,
    expected: { kind: 'starter', classId: 'researcher', starterSpeciesId: 'bulbasaur' },
  },
  {
    name: 'a class used by two seats',
    preset: {
      ...sample,
      rivals: [
        sample.rivals[0]!,
        { ...sample.rivals[1]!, classId: 'researcher', starterSpeciesId: 'porygon' },
      ],
    },
    classes: classOptions,
    expected: { kind: 'duplicate', classId: 'researcher' },
  },
  {
    name: 'a personality that is not open',
    preset: {
      ...sample,
      rivals: [{ ...sample.rivals[0]!, personality: 'reckless' as never }, sample.rivals[1]!],
    },
    classes: classOptions,
    expected: { kind: 'personality', personality: 'reckless' },
  },
  {
    name: 'a difficulty that is closed',
    preset: {
      ...sample,
      rivals: [{ ...sample.rivals[0]!, difficulty: 'hard' as never }, sample.rivals[1]!],
    },
    classes: classOptions,
    expected: { kind: 'difficulty', difficulty: 'hard' },
  },
  {
    name: 'a closed mode',
    preset: { ...sample, mode: 'standard' },
    classes: classOptions,
    expected: { kind: 'mode', mode: 'standard' },
  },
  {
    name: 'no open mode for a random preset',
    preset: SETUP_PRESETS[2]!,
    classes: classOptions,
    modes: [],
    expected: { kind: 'mode' },
  },
  {
    name: 'too few open classes for three rivals',
    preset: SETUP_PRESETS[2]!,
    classes: classOptions.map((option, index) => ({ ...option, playable: index < 3 })),
    expected: { kind: 'seats', needed: 3, open: 3 },
  },
];

test.each(problems)(
  '$name is explained and never swapped for something else (§3.1, #157)',
  (row) => {
    const modes = row.modes ?? OPEN;
    expect(presetProblem(row.preset, row.classes, modes)).toEqual(row.expected);
    const applied = applyPreset(row.preset, row.classes, modes, seeded(1));
    expect(applied).toEqual({ ok: false, problem: row.expected });
  },
);

test('a preset that no longer fits does not hide the ones that still do', () => {
  const classes = closed('fisherman');
  expect(presetProblem(SETUP_PRESETS[0]!, classes, OPEN)).toBeDefined();
  expect(presetProblem(SETUP_PRESETS[1]!, classes, OPEN)).toBeUndefined();
  expect(presetProblem(SETUP_PRESETS[2]!, classes, OPEN)).toBeUndefined();
});

/** Today's open choices with one personality set to `enabled: false` (what a closed file looks like). */
const closing = (id: string, difficulties: readonly string[] = DIFFICULTIES): OpenRivalChoices => ({
  personalities: PERSONALITIES.map((entry) => ({ ...entry, enabled: entry.id !== id })),
  difficulties,
});

test('a personality set to disabled makes only the presets that name it illegal (§3.1, #157)', () => {
  const choices = closing('greedy');
  // Both fixed presets name Greedy rivals: each is explained, and apply fills nothing.
  for (const preset of [SETUP_PRESETS[0]!, SETUP_PRESETS[1]!]) {
    const expected = { kind: 'personality', personality: 'greedy' };
    expect(presetProblem(preset, classOptions, OPEN, choices), preset.id).toEqual(expected);
    expect(applyPreset(preset, classOptions, OPEN, seeded(1), choices)).toEqual({
      ok: false,
      problem: expected,
    });
  }
  // A random preset still has the other personalities to pick from.
  expect(presetProblem(SETUP_PRESETS[2]!, classOptions, OPEN, choices)).toBeUndefined();
});

test('a closed difficulty is explained through the injected list too (#157)', () => {
  expect(presetProblem(SETUP_PRESETS[0]!, classOptions, OPEN, closing('none', ['normal']))).toEqual(
    {
      kind: 'difficulty',
      difficulty: 'easy',
    },
  );
});

test('a random preset with no open personality is explained, never filled (§3.1, #157)', () => {
  const none: OpenRivalChoices = {
    personalities: PERSONALITIES.map((entry) => ({ ...entry, enabled: false })),
    difficulties: DIFFICULTIES,
  };
  const expected = { kind: 'noPersonality' };
  expect(presetProblem(SETUP_PRESETS[2]!, classOptions, OPEN, none)).toEqual(expected);
  expect(applyPreset(SETUP_PRESETS[2]!, classOptions, OPEN, seeded(1), none)).toEqual({
    ok: false,
    problem: expected,
  });
  expect(
    presetProblem(SETUP_PRESETS[2]!, classOptions, OPEN, { ...none, personalities: [] }),
  ).toEqual(expected);
});
