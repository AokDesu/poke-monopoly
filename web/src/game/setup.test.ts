import { describe, expect, test } from 'vitest';
import { classOptions, engineContent } from './content.ts';
import { rollForFirstPlayer } from './firstPlayer.ts';
import {
  classConflicts,
  completeSetup,
  maxRivals,
  randomSetup,
  seedFromSearch,
  withRivalCount,
  type ClassOption,
  type OpponentChoice,
  type SeatChoice,
  type SetupDraft,
} from './setup.ts';
import { configForSetup, createGameStore, opponentSettings } from './store.ts';

const open = classOptions.filter((option) => option.playable);
const human: SeatChoice = { classId: 'researcher', starterSpeciesId: 'porygon' };
const rival = (classId: string, personality: OpponentChoice['personality'] = 'greedy') =>
  ({
    classId,
    starterSpeciesId: classOptions.find((option) => option.id === classId)!.starterSpeciesIds[0]!,
    personality,
    difficulty: 'easy',
  }) satisfies OpponentChoice;
const draft = (rivals: readonly OpponentChoice[], seat: SeatChoice = human): SetupDraft => ({
  mode: 'quick',
  human: seat,
  rivals,
});
const onlyClasses = (...ids: string[]): ClassOption[] =>
  classOptions.map((option) => ({ ...option, playable: ids.includes(option.id) }));

test('?seed= is read as a whole number when it is one, a string otherwise, and absent when empty', () => {
  expect(seedFromSearch('?seed=7')).toBe(7);
  expect(seedFromSearch('?seed=-3')).toBe(-3);
  expect(seedFromSearch('?seed=playtest-a')).toBe('playtest-a');
  expect(seedFromSearch('?seed=99999999999999999999')).toBe('99999999999999999999');
  expect(seedFromSearch('?seed=')).toBeUndefined();
  expect(seedFromSearch('')).toBeUndefined();
});

test('the open classes are the ones whose whole kit the browser plays (§1)', () => {
  expect(open.map((option) => option.id)).toEqual([
    'main-character',
    'rival',
    'fisherman',
    'nurse-joy',
    'bug-catcher',
    'researcher',
  ]);
  // Rival's once-per-Lap forced challenge has its Strategy control, so the class is open (issue #135).
  expect(classOptions.find((option) => option.id === 'rival')?.playable).toBe(true);
  // Stretch classes stay out of setup until after G2.
  expect(classOptions.map((option) => option.id)).not.toContain('team-rocket');
});

describe('one to three rivals reach a started game with every seat as chosen (§3, §4.1)', () => {
  for (const count of [1, 2, 3]) {
    test(`${count} rival(s)`, () => {
      // Every open class as the human, the next classes as the rivals: all kits start.
      for (const [index, humanClass] of open.entries()) {
        const rivals = Array.from({ length: count }, (_, at) =>
          rival(open[(index + 1 + at) % open.length]!.id, 'greedy'),
        ).map((entry, at) => ({ ...entry, difficulty: at % 2 === 0 ? 'easy' : 'normal' }) as const);
        const seat = {
          classId: humanClass.id,
          starterSpeciesId: humanClass.starterSpeciesIds[0]!,
        };
        const setup = completeSetup(draft(rivals, seat), classOptions)!;
        expect(setup.opponents).toEqual(rivals);

        const store = createGameStore();
        store.start(configForSetup(setup, 1), engineContent, opponentSettings(setup));
        rollForFirstPlayer(store);
        const { players } = store.getView()!.observation.public;
        expect(players.map((player) => player.classId)).toEqual([
          humanClass.id,
          ...rivals.map((entry) => entry.classId),
        ]);
        // Each seat begins with its chosen Starter.
        expect(players.map((player) => player.team[0]!.speciesId)).toEqual([
          seat.starterSpeciesId,
          ...rivals.map((entry) => entry.starterSpeciesId),
        ]);
        expect(store.getOpponents()).toEqual(
          rivals.map((entry, at) => ({
            seatIndex: at + 1,
            personality: entry.personality,
            difficulty: entry.difficulty,
          })),
        );
      }
    });
  }
});

describe('Random All (§3)', () => {
  test('never repeats a class, never loses the requested count, never picks a closed option', () => {
    for (const count of [1, 2, 3]) {
      for (let step = 0; step < 40; step++) {
        const value = step / 40;
        let n = 0;
        // A deterministic spread of choices, not one constant.
        const random = () => (value + 0.137 * n++) % 1;
        const setup = randomSetup(classOptions, ['quick'], random, count)!;
        const seats = [setup.human, ...setup.opponents];
        expect(setup.opponents).toHaveLength(count);
        expect(new Set(seats.map((seat) => seat.classId)).size).toBe(count + 1);
        for (const seat of seats) {
          const option = open.find((entry) => entry.id === seat.classId)!;
          expect(option.starterSpeciesIds).toContain(seat.starterSpeciesId);
        }
        for (const opponent of setup.opponents) {
          expect(opponent.personality).toBe('greedy');
          expect(['easy', 'normal']).toContain(opponent.difficulty);
        }
      }
    }
  });

  test('without a requested count, picks one to three rivals at random', () => {
    const counts = [0, 0.4, 0.7, 0.999999].map(
      (value) => randomSetup(classOptions, ['quick'], () => value)!.opponents.length,
    );
    expect(Math.min(...counts)).toBe(1);
    expect(Math.max(...counts)).toBe(3);
  });

  test('says no when the open classes cannot seat the requested rivals', () => {
    const two = onlyClasses('main-character', 'researcher');
    expect(maxRivals(two)).toBe(1);
    expect(randomSetup(two, ['quick'], () => 0.5, 2)).toBeUndefined();
    expect(randomSetup(two, ['quick'], () => 0.5)!.opponents).toHaveLength(1);
    expect(randomSetup(onlyClasses('researcher'), ['quick'], () => 0.5)).toBeUndefined();
    expect(randomSetup(classOptions, [], () => 0.5)).toBeUndefined();
    expect(randomSetup(classOptions, ['quick'], () => 0.5, 4)).toBeUndefined();
    expect(randomSetup(classOptions, ['quick'], () => 0.5, 0)).toBeUndefined();
  });
});

describe('changing the number of rivals (§3)', () => {
  const rivals = [rival('main-character'), rival('fisherman'), rival('nurse-joy')];

  test('fewer drops the last ones and keeps the rest exactly', () => {
    expect(withRivalCount(classOptions, human, rivals, 2)).toEqual(rivals.slice(0, 2));
    expect(withRivalCount(classOptions, human, rivals, 1)).toEqual(rivals.slice(0, 1));
  });

  test('more keeps the existing rivals and gives each new one a free class', () => {
    const edited = [{ ...rival('nurse-joy'), difficulty: 'normal' as const }];
    const next = withRivalCount(classOptions, human, edited, 3)!;
    expect(next[0]).toBe(edited[0]);
    expect(new Set([human.classId, ...next.map((entry) => entry.classId)]).size).toBe(4);
    expect(classConflicts(human, next)).toEqual([]);
  });

  test('refuses a count the open classes cannot seat', () => {
    const three = onlyClasses('main-character', 'fisherman', 'researcher');
    expect(withRivalCount(three, human, [], 2)).toHaveLength(2);
    expect(withRivalCount(three, human, [], 3)).toBeUndefined();
  });
});

describe('class conflicts (§3)', () => {
  const rivals = [rival('main-character'), rival('fisherman')];

  test('a rival that repeats the human class stays as chosen and blocks the setup', () => {
    const changed = { classId: 'fisherman', starterSpeciesId: 'magikarp' };
    expect(classConflicts(changed, rivals)).toEqual([1]);
    expect(completeSetup(draft(rivals, changed), classOptions)).toBeUndefined();
    expect(completeSetup(draft(rivals), classOptions)).toBeDefined();
  });

  test('two rivals with one class repeat on the later one', () => {
    expect(classConflicts(human, [rival('fisherman'), rival('fisherman')])).toEqual([1]);
  });

  test('a closed class or personality, no rival and too many rivals never complete', () => {
    const rivalClosed = classOptions.map((option) =>
      option.id === 'rival' ? { ...option, playable: false } : option,
    );
    expect(completeSetup(draft([rival('rival')]), rivalClosed)).toBeUndefined();
    expect(completeSetup(draft([rival('fisherman', 'aggressive')]), classOptions)).toBeUndefined();
    expect(completeSetup(draft([]), classOptions)).toBeUndefined();
    expect(completeSetup({ mode: 'quick', human }, classOptions)).toBeUndefined();
    const four = ['main-character', 'fisherman', 'nurse-joy', 'bug-catcher'].map((id) => rival(id));
    expect(completeSetup(draft(four), classOptions)).toBeUndefined();
    expect(
      completeSetup(
        draft([rival('fisherman')], { classId: 'rival', starterSpeciesId: 'eevee' }),
        rivalClosed,
      ),
    ).toBeUndefined();
  });
});
