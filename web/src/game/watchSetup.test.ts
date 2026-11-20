import { describe, expect, test } from 'vitest';
import { classOptions, engineContent } from './content.ts';
import { rollForFirstPlayer } from './firstPlayer.ts';
import { readMeta, writeSave, type SaveStorage } from './save.ts';
import {
  canWatch,
  classConflicts,
  completeWatchSetup,
  DEFAULT_WATCH_SETTINGS,
  maxWatchAis,
  randomAis,
  restoreWatchProgress,
  withRivalCount,
  type ClassOption,
  type OpponentChoice,
  type WatchDraft,
} from './setup.ts';
import { configForWatch, createGameStore, watchOpponentSettings } from './store.ts';

const open = classOptions.filter((option) => option.playable);
const onlyClasses = (...ids: string[]): ClassOption[] =>
  classOptions.map((option) => ({ ...option, playable: ids.includes(option.id) }));
const ai = (classId: string, extra: Partial<OpponentChoice> = {}): OpponentChoice => ({
  classId,
  starterSpeciesId: classOptions.find((option) => option.id === classId)!.starterSpeciesIds[0]!,
  personality: 'greedy',
  difficulty: 'easy',
  ...extra,
});
const draftOf = (
  ais: readonly OpponentChoice[],
  settings = DEFAULT_WATCH_SETTINGS,
): WatchDraft => ({
  mode: 'quick',
  ais,
  settings,
});
const seeded = (seed: number) => {
  let state = seed;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
};

describe('watch seats (§3: two to four AIs, no human, one class each)', () => {
  test('the open classes seat up to four AIs; fewer than two close watching', () => {
    expect(maxWatchAis(classOptions)).toBe(4);
    expect(canWatch(classOptions)).toBe(true);
    expect(maxWatchAis(onlyClasses('fisherman', 'researcher', 'nurse-joy'))).toBe(3);
    expect(canWatch(onlyClasses('fisherman', 'researcher'))).toBe(true);
    expect(canWatch(onlyClasses('fisherman'))).toBe(false);
    expect(canWatch(onlyClasses())).toBe(false);
  });

  test('new AIs take the first free classes and the AIs that stay are not touched', () => {
    const two = withRivalCount(classOptions, undefined, [], 2)!;
    expect(two.map((entry) => entry.classId)).toEqual(open.slice(0, 2).map((entry) => entry.id));
    const changed = [two[0]!, { ...two[1]!, difficulty: 'normal' as const }];
    const four = withRivalCount(classOptions, undefined, changed, 4)!;
    expect(four.slice(0, 2)).toEqual(changed);
    expect(classConflicts(undefined, four)).toEqual([]);
    expect(withRivalCount(classOptions, undefined, four, 3)).toEqual(four.slice(0, 3));
    expect(
      withRivalCount(onlyClasses('fisherman', 'researcher'), undefined, [], 3),
    ).toBeUndefined();
  });

  test('a repeated class is a conflict among the AIs alone', () => {
    expect(classConflicts(undefined, [ai('fisherman'), ai('researcher'), ai('fisherman')])).toEqual(
      [2],
    );
  });
});

describe('completing a watch setup (§3, §3.1)', () => {
  const two = [ai('fisherman'), ai('researcher')];

  test('two, three and four AIs are complete with every seat as chosen', () => {
    for (const count of [2, 3, 4]) {
      const ais = open
        .slice(0, count)
        .map((option, index) => ai(option.id, { difficulty: index % 2 ? 'normal' : 'easy' }));
      expect(completeWatchSetup(draftOf(ais), classOptions)).toEqual({
        mode: 'quick',
        ais,
        settings: DEFAULT_WATCH_SETTINGS,
      });
    }
  });

  test.each([
    ['one AI', [ai('fisherman')]],
    ['five AIs', open.slice(0, 5).map((option) => ai(option.id))],
    ['a repeated class', [ai('fisherman'), ai('fisherman')]],
    [
      'a personality without a file',
      [ai('fisherman'), ai('researcher', { personality: 'sneaky' as never })],
    ],
    [
      'a Starter the class does not have',
      [ai('fisherman'), ai('researcher', { starterSpeciesId: 'bulbasaur' })],
    ],
  ])('%s is never complete', (_name, ais) => {
    expect(completeWatchSetup(draftOf(ais), classOptions)).toBeUndefined();
  });

  test.each(['greedy', 'aggressive', 'cautious', 'opportunist'] as const)(
    'an AI with the %s personality completes',
    (personality) => {
      const ais = [ai('fisherman', { personality }), ai('researcher')];
      expect(completeWatchSetup(draftOf(ais), classOptions)?.ais).toEqual(ais);
    },
  );

  test('a missing mode or AI list is never complete, and neither is a class closed since', () => {
    expect(completeWatchSetup({ ais: two, settings: DEFAULT_WATCH_SETTINGS }, classOptions)).toBe(
      undefined,
    );
    expect(
      completeWatchSetup({ mode: 'quick', settings: DEFAULT_WATCH_SETTINGS }, classOptions),
    ).toBe(undefined);
    expect(completeWatchSetup(draftOf(two), onlyClasses('fisherman'))).toBeUndefined();
  });
});

describe('Random All for a watched game (§3)', () => {
  test.each([2, 3, 4])('%i AIs: exact count, unique open classes, open personalities', (count) => {
    const picked = new Set<string>();
    for (let seed = 1; seed <= 60; seed++) {
      const ais = randomAis(classOptions, count, seeded(seed))!;
      expect(ais).toHaveLength(count);
      expect(new Set(ais.map((entry) => entry.classId)).size).toBe(count);
      expect(completeWatchSetup(draftOf(ais), classOptions), `seed ${seed}`).toBeDefined();
      for (const entry of ais) picked.add(entry.personality);
    }
    expect([...picked].sort()).toEqual(['aggressive', 'cautious', 'greedy', 'opportunist']);
  });

  test('is the same for the same random source and never invents a count it cannot seat', () => {
    expect(randomAis(classOptions, 3, seeded(9))).toEqual(randomAis(classOptions, 3, seeded(9)));
    expect(randomAis(classOptions, 1, seeded(1))).toBeUndefined();
    expect(randomAis(classOptions, 5, seeded(1))).toBeUndefined();
    expect(
      randomAis(onlyClasses('fisherman', 'researcher', 'nurse-joy'), 4, seeded(1)),
    ).toBeUndefined();
    expect(
      randomAis(onlyClasses('fisherman', 'researcher', 'nurse-joy'), 3, seeded(1)),
    ).toHaveLength(3);
  });
});

describe('a watch setup starts a game with every seat as chosen, none human (§3, §3.1)', () => {
  test.each([2, 3, 4])('%i AIs', (count) => {
    const ais = open
      .slice(0, count)
      .map((option, index) => ai(option.id, { difficulty: index % 2 ? 'normal' : 'easy' }));
    const setup = completeWatchSetup(draftOf(ais, { talk: false, pace: 'fast' }), classOptions)!;
    const store = createGameStore();
    store.start(
      configForWatch(setup, 5),
      engineContent,
      watchOpponentSettings(setup),
      setup.settings,
    );
    rollForFirstPlayer(store);

    const seats = store.getSession()!.state.config.seats;
    expect(seats.map((seat) => [seat.seatIndex, seat.controller, seat.classId])).toEqual(
      ais.map((entry, index) => [index, 'ai', entry.classId]),
    );
    expect(seats.map((seat) => seat.starterSpeciesId)).toEqual(
      ais.map((entry) => entry.starterSpeciesId),
    );
    expect(store.getOpponents()).toEqual(
      ais.map((entry, seatIndex) => ({
        seatIndex,
        personality: entry.personality,
        difficulty: entry.difficulty,
      })),
    );
    expect(store.getWatchSettings()).toEqual({ talk: false, pace: 'fast' });
    expect(store.getPace()).toBe('fast');
    expect(store.getView()).toBeNull();

    // Every AI rolled once, in seat order, before any tie re-roll; the game then started.
    const log = store.getSession()!.log.actions;
    expect(store.getSpectatorView()!.observation.public.phase.kind).not.toBe('first_player_roll');
    const firstRound = log.slice(0, count * 2).map((record) => record.action.kind);
    expect(firstRound).toEqual(Array.from({ length: count }, () => ['roll', 'dice_result']).flat());
    expect(log.slice(0, count * 2).flatMap((record) => record.action.actorId)).toEqual(
      ais.flatMap((_, seat) => [`ai-${seat}`, 'engine']),
    );
  });

  test('clearing the store forgets the watch settings', () => {
    const setup = completeWatchSetup(draftOf([ai('fisherman'), ai('researcher')]), classOptions)!;
    const store = createGameStore();
    store.start(
      configForWatch(setup, 5),
      engineContent,
      watchOpponentSettings(setup),
      setup.settings,
    );
    store.clear();
    expect(store.getWatchSettings()).toBeUndefined();
  });
});

describe('saved watch settings (§3.1, §6.9)', () => {
  const memory = (): SaveStorage & { data: Map<string, string> } => {
    const data = new Map<string, string>();
    return {
      data,
      getItem: (key) => data.get(key) ?? null,
      setItem: (key, value) => void data.set(key, value),
      removeItem: (key) => void data.delete(key),
    };
  };
  const started = (settings = { talk: false, pace: 'instant' } as const) => {
    const setup = completeWatchSetup(
      draftOf([ai('fisherman'), ai('researcher', { difficulty: 'normal' })], settings),
      classOptions,
    )!;
    const store = createGameStore();
    store.start(
      configForWatch(setup, 5),
      engineContent,
      watchOpponentSettings(setup),
      setup.settings,
    );
    return { store, setup };
  };

  test('the engine save keeps its opponents and the game keeps talk, starting pace and pace beside it', () => {
    const { store, setup } = started();
    store.setPace('step');
    const storage = memory();
    writeSave(storage, store.getSession()!, {
      opponents: store.getOpponents(),
      watch: store.getWatchSettings(),
      pace: store.getPace(),
    });
    expect(readMeta(storage)).toEqual({
      opponents: watchOpponentSettings(setup),
      watch: { talk: false, pace: 'instant' },
      pace: 'step',
    });
  });

  test('a save from before paces reads each old speed as the pace it became', () => {
    const storage = memory();
    for (const [speed, pace] of [
      ['normal', 'readable'],
      ['fast', 'fast'],
      ['instant', 'instant'],
    ] as const) {
      storage.setItem(
        'poke-monopoly.save-meta',
        JSON.stringify({ opponents: [], watch: { talk: true, speed } }),
      );
      expect(readMeta(storage).watch).toEqual({ talk: true, pace });
      expect(readMeta(storage)).not.toHaveProperty('pace');
    }
  });

  test('a game without watch settings reads back without any', () => {
    const storage = memory();
    const { store } = started();
    writeSave(storage, store.getSession()!, { opponents: store.getOpponents() });
    expect(readMeta(storage)).not.toHaveProperty('watch');
  });

  test.each([
    ['a pace that does not exist', { talk: true, pace: 'warp' }],
    ['an old speed that does not exist', { talk: true, speed: 'toString' }],
    ['a talk flag that is not a boolean', { talk: 'yes', pace: 'fast' }],
    ['a value that is not an object', 'fast'],
  ])('%s is dropped, never repaired', (_name, watch) => {
    const storage = memory();
    storage.setItem('poke-monopoly.save-meta', JSON.stringify({ opponents: [], watch }));
    expect(readMeta(storage)).not.toHaveProperty('watch');
  });

  test('a pace that does not exist is dropped, and the game starts at its own', () => {
    const storage = memory();
    storage.setItem('poke-monopoly.save-meta', JSON.stringify({ opponents: [], pace: 'warp' }));
    expect(readMeta(storage)).not.toHaveProperty('pace');
  });
});

describe('an unfinished watch setup after a reload (§3.1)', () => {
  const modes = ['quick'] as const;
  const saved = (step: string, extra: Record<string, unknown> = {}) => ({
    step,
    mode: 'quick',
    ais: [ai('fisherman'), ai('researcher', { difficulty: 'normal' })],
    talk: false,
    pace: 'fast',
    ...extra,
  });

  test('every answer comes back, on the step it was left on', () => {
    for (const step of ['mode', 'ais', 'options', 'review'] as const) {
      const restored = restoreWatchProgress(saved(step), classOptions, modes);
      expect(restored?.step).toBe(step === 'mode' ? 'mode' : step);
      expect(restored?.draft).toEqual({
        mode: 'quick',
        ais: saved(step).ais,
        settings: { talk: false, pace: 'fast' },
      });
    }
  });

  test('an answer that no longer fits is dropped and the step falls back to the first open one', () => {
    const closedMode = restoreWatchProgress(saved('review'), classOptions, []);
    expect(closedMode).toEqual({
      step: 'mode',
      draft: { settings: { talk: false, pace: 'fast' } },
    });
    const closedClass = restoreWatchProgress(saved('review'), onlyClasses('fisherman'), modes);
    expect(closedClass?.step).toBe('ais');
    expect(closedClass?.draft.ais).toBeUndefined();
    const unknownPersonality = restoreWatchProgress(
      saved('options', {
        ais: [ai('fisherman'), ai('researcher', { personality: 'sneaky' as never })],
      }),
      classOptions,
      modes,
    );
    expect(unknownPersonality?.step).toBe('ais');
    expect(unknownPersonality?.draft.ais).toEqual(withRivalCount(classOptions, undefined, [], 2));
    expect(unknownPersonality?.draft.mode).toBe('quick');
  });

  test('a repeated class is dropped as a whole, never half-kept', () => {
    const restored = restoreWatchProgress(
      saved('review', { ais: [ai('fisherman'), ai('fisherman')] }),
      classOptions,
      modes,
    );
    expect(restored?.step).toBe('ais');
    expect(restored?.draft.ais).toEqual(withRivalCount(classOptions, undefined, [], 2));
  });

  test.each([
    ['nothing', undefined],
    ['text', 'review'],
    ['an unknown step', { step: 'start' }],
  ])('%s restores nothing', (_name, raw) => {
    expect(restoreWatchProgress(raw, classOptions, modes)).toBeUndefined();
  });

  test('rows that are not seats are dropped and the AI step opens on two fresh seats', () => {
    const restored = restoreWatchProgress(
      { step: 'review', mode: 'quick', ais: [null, 3] },
      classOptions,
      modes,
    );
    expect(restored?.step).toBe('ais');
    expect(restored?.draft.ais).toEqual(withRivalCount(classOptions, undefined, [], 2));
  });

  test('unreadable settings fall back to talk on at the Readable pace', () => {
    const restored = restoreWatchProgress(
      saved('options', { talk: 'maybe', pace: 'warp' }),
      classOptions,
      modes,
    );
    expect(restored?.draft.settings).toEqual(DEFAULT_WATCH_SETTINGS);
    expect(DEFAULT_WATCH_SETTINGS.pace).toBe('readable');
  });

  test('a setup saved before paces keeps its speed as the pace it became', () => {
    const old: Record<string, unknown> = { ...saved('options'), speed: 'normal' };
    delete old.pace;
    expect(restoreWatchProgress(old, classOptions, modes)?.draft.settings).toEqual({
      talk: false,
      pace: 'readable',
    });
  });
});
