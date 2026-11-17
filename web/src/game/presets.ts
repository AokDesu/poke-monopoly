import {
  completeSetup,
  DIFFICULTIES,
  MAX_RIVALS,
  maxRivals,
  PERSONALITIES,
  randomSetup,
  type ClassOption,
  type GameSetup,
  type ModeId,
  type OpponentChoice,
  type SeatChoice,
} from './setup.ts';

/**
 * Presets for a quick start (spec §3): named arrangements that fill every seat in one tap. They are
 * plain data with no number in them; the engine still checks the finished setup in `createGame`.
 * A fixed preset names every seat; a random one reuses Random All for every seat.
 */
export type PresetId =
  'one-rival-easy' | 'two-rivals-normal' | 'three-rivals-random' | 'random-all';

export type SetupPreset =
  | {
      readonly id: PresetId;
      readonly kind: 'fixed';
      readonly mode: ModeId;
      readonly human: SeatChoice;
      readonly rivals: readonly OpponentChoice[];
    }
  | {
      readonly id: PresetId;
      readonly kind: 'random';
      /** Fixed number of AI rivals; absent, Random All picks the number too. */
      readonly rivalCount?: number;
    };

export const SETUP_PRESETS: readonly SetupPreset[] = [
  {
    id: 'one-rival-easy',
    kind: 'fixed',
    mode: 'quick',
    human: { classId: 'main-character', starterSpeciesId: 'bulbasaur' },
    rivals: [
      {
        classId: 'fisherman',
        starterSpeciesId: 'magikarp',
        personality: 'greedy',
        difficulty: 'easy',
      },
    ],
  },
  {
    id: 'two-rivals-normal',
    kind: 'fixed',
    mode: 'quick',
    human: { classId: 'researcher', starterSpeciesId: 'porygon' },
    rivals: [
      {
        classId: 'main-character',
        starterSpeciesId: 'charmander',
        personality: 'greedy',
        difficulty: 'normal',
      },
      {
        classId: 'bug-catcher',
        starterSpeciesId: 'caterpie',
        personality: 'greedy',
        difficulty: 'normal',
      },
    ],
  },
  { id: 'three-rivals-random', kind: 'random', rivalCount: 3 },
  { id: 'random-all', kind: 'random' },
];

/** Why a preset cannot be used today. It is shown to the player; the preset is never repaired. */
export type PresetProblem =
  | { readonly kind: 'mode'; readonly mode?: ModeId }
  | { readonly kind: 'class'; readonly classId: string }
  | { readonly kind: 'starter'; readonly classId: string; readonly starterSpeciesId: string }
  | { readonly kind: 'duplicate'; readonly classId: string }
  | { readonly kind: 'personality'; readonly personality: string }
  | { readonly kind: 'difficulty'; readonly difficulty: string }
  | { readonly kind: 'seats'; readonly needed: number; readonly open: number };

/**
 * The first reason `preset` is not legal against today's open modes and classes, or undefined when
 * it is. A preset is legal when its mode is open, every class is open and used once, every Starter
 * belongs to its class, and every personality and difficulty is open.
 */
export function presetProblem(
  preset: SetupPreset,
  classes: readonly ClassOption[],
  openModes: readonly ModeId[],
): PresetProblem | undefined {
  const open = classes.filter((option) => option.playable).length;
  if (preset.kind === 'random') {
    if (openModes.length === 0) return { kind: 'mode' };
    const needed = preset.rivalCount ?? 1;
    return maxRivals(classes) < needed ? { kind: 'seats', needed, open } : undefined;
  }
  if (!openModes.includes(preset.mode)) return { kind: 'mode', mode: preset.mode };
  if (preset.rivals.length < 1 || preset.rivals.length > MAX_RIVALS) {
    return { kind: 'seats', needed: preset.rivals.length, open };
  }
  const seen = new Set<string>();
  for (const seat of [preset.human, ...preset.rivals]) {
    const option = classes.find((entry) => entry.id === seat.classId);
    if (!option?.playable) return { kind: 'class', classId: seat.classId };
    if (!option.starterSpeciesIds.includes(seat.starterSpeciesId)) {
      return { kind: 'starter', classId: seat.classId, starterSpeciesId: seat.starterSpeciesId };
    }
    if (seen.has(seat.classId)) return { kind: 'duplicate', classId: seat.classId };
    seen.add(seat.classId);
  }
  for (const rival of preset.rivals) {
    if (!PERSONALITIES.some((entry) => entry.enabled && entry.id === rival.personality)) {
      return { kind: 'personality', personality: rival.personality };
    }
    if (!DIFFICULTIES.some((id) => id === rival.difficulty)) {
      return { kind: 'difficulty', difficulty: rival.difficulty };
    }
  }
  return undefined;
}

export type AppliedPreset =
  | { readonly ok: true; readonly setup: GameSetup }
  | { readonly ok: false; readonly problem: PresetProblem };

/**
 * The setup a preset fills in: every seat, ready for the review screen. A fixed preset gives its
 * exact seats; a random one goes through Random All's own path. A preset that is no longer legal
 * returns its problem and fills nothing: it is never swapped for something else.
 */
export function applyPreset(
  preset: SetupPreset,
  classes: readonly ClassOption[],
  openModes: readonly ModeId[],
  random: () => number,
): AppliedPreset {
  const problem = presetProblem(preset, classes, openModes);
  if (problem) return { ok: false, problem };
  if (preset.kind === 'random') {
    const setup = randomSetup(classes, openModes, random, preset.rivalCount);
    if (!setup) return { ok: false, problem: { kind: 'mode' } };
    return { ok: true, setup };
  }
  // Copies, so editing a seat afterwards can never reach the preset's own data.
  const draft = {
    mode: preset.mode,
    human: { ...preset.human },
    rivals: preset.rivals.map((rival) => ({ ...rival })),
  };
  const setup = completeSetup(draft, classes);
  // `presetProblem` already covered everything `completeSetup` checks, so this is not reached.
  if (!setup) return { ok: false, problem: { kind: 'class', classId: preset.human.classId } };
  return { ok: true, setup };
}
