import type { GAME_PRESETS } from '../../../engine/index.ts';

/**
 * The setup choices of spec §3, before any game exists. Plain data: the engine checks the
 * finished setup again in `createGame`, so nothing here is a rule the engine relies on.
 */
export type ModeId = keyof typeof GAME_PRESETS;

/** Spec §5.5 presets. Only Greedy is playable this cycle; the others are shown greyed. */
export const PERSONALITIES = [
  { id: 'greedy', enabled: true },
  { id: 'aggressive', enabled: false },
  { id: 'cautious', enabled: false },
  { id: 'opportunist', enabled: false },
] as const;
export type PersonalityId = (typeof PERSONALITIES)[number]['id'];

/** Spec §1, §5.6: Easy and Normal are core; Hard waits for gate G2 and is not offered. */
export const DIFFICULTIES = ['easy', 'normal'] as const;
export type DifficultyId = (typeof DIFFICULTIES)[number];

/** A class as setup offers it. `playable` is false until the engine implements its passive and the browser supports the class. */
export interface ClassOption {
  readonly id: string;
  readonly starterSpeciesIds: readonly string[];
  readonly classItemId: string;
  readonly playable: boolean;
}

export interface SeatChoice {
  readonly classId: string;
  readonly starterSpeciesId: string;
}

export interface OpponentChoice extends SeatChoice {
  readonly personality: PersonalityId;
  readonly difficulty: DifficultyId;
}

export interface GameSetup {
  readonly mode: ModeId;
  readonly human: SeatChoice;
  /** One to three AI rivals (spec §1, §3); rival n takes seat n after the human's seat 0. */
  readonly opponents: readonly OpponentChoice[];
}

/** The setup screens fill this in step by step; Back keeps every earlier answer. */
export interface SetupDraft {
  readonly mode?: ModeId;
  readonly human?: SeatChoice;
  readonly rivals?: readonly OpponentChoice[];
}

/** Spec §1: one human with one to three AIs, so two to four seats. */
export const MAX_RIVALS = 3;

const firstEnabledPersonality = PERSONALITIES.find((entry) => entry.enabled)!.id;

const playableClasses = (classes: readonly ClassOption[]) =>
  classes.filter((option) => option.playable);

/** The most rivals the open classes allow: every seat needs its own class (spec §3). */
export function maxRivals(classes: readonly ClassOption[]): number {
  return Math.min(MAX_RIVALS, playableClasses(classes).length - 1);
}

/**
 * The seat that holds a class, other than `except` (a rival's index): `human`, or the index of the
 * first rival with it. Used to grey a class out with the reason, and to find repeats.
 */
export function classHolder(
  human: SeatChoice,
  rivals: readonly OpponentChoice[],
  classId: string,
  except?: number,
): 'human' | number | undefined {
  if (human.classId === classId) return 'human';
  const index = rivals.findIndex((rival, at) => at !== except && rival.classId === classId);
  return index === -1 ? undefined : index;
}

/**
 * The rivals that repeat the human's class or an earlier rival's. Changing the human's class on
 * Back can make a valid rival repeat; it stays as chosen and setup cannot go on until it is fixed.
 */
export function classConflicts(human: SeatChoice, rivals: readonly OpponentChoice[]): number[] {
  return rivals.flatMap((rival, index) => {
    const holder = classHolder(human, rivals.slice(0, index), rival.classId);
    return holder === undefined ? [] : [index];
  });
}

/** A new rival: the first free class with its first Starter, the first open personality, Easy. */
function newRival(
  classes: readonly ClassOption[],
  human: SeatChoice,
  rivals: readonly OpponentChoice[],
): OpponentChoice | undefined {
  const free = playableClasses(classes).find(
    (option) => classHolder(human, rivals, option.id) === undefined,
  );
  if (!free) return undefined;
  return {
    classId: free.id,
    starterSpeciesId: free.starterSpeciesIds[0]!,
    personality: firstEnabledPersonality,
    difficulty: 'easy',
  };
}

/**
 * The rivals for a new count. Fewer drops the last ones; more adds new rivals after the existing
 * ones, which stay exactly as chosen. Undefined when no free class is left for a new rival.
 */
export function withRivalCount(
  classes: readonly ClassOption[],
  human: SeatChoice,
  rivals: readonly OpponentChoice[],
  count: number,
): readonly OpponentChoice[] | undefined {
  const next = rivals.slice(0, count);
  while (next.length < count) {
    const added = newRival(classes, human, next);
    if (!added) return undefined;
    next.push(added);
  }
  return next;
}

/** Complete only with open classes and personalities, no repeated class and one to three rivals. */
export function completeSetup(
  draft: SetupDraft,
  classes: readonly ClassOption[],
): GameSetup | undefined {
  const { mode, human, rivals } = draft;
  if (!mode || !human || !rivals || rivals.length < 1 || rivals.length > MAX_RIVALS) {
    return undefined;
  }
  const open = new Set(playableClasses(classes).map((option) => option.id));
  const openPersonalities = PERSONALITIES.filter((entry) => entry.enabled).map((entry) => entry.id);
  const usable = [human, ...rivals].every((seat) => open.has(seat.classId));
  if (!usable || classConflicts(human, rivals).length > 0) return undefined;
  if (rivals.some((rival) => !openPersonalities.some((id) => id === rival.personality))) {
    return undefined;
  }
  return { mode, human, opponents: rivals };
}

function pick<T>(items: readonly T[], random: () => number): T {
  return items[Math.min(items.length - 1, Math.floor(random() * items.length))]!;
}

/**
 * Random All (spec §3): every open choice picked at random, classes kept unique. Without
 * `rivalCount` the count is random too. Undefined when the open classes cannot seat that many.
 */
export function randomSetup(
  classes: readonly ClassOption[],
  modes: readonly ModeId[],
  random: () => number,
  rivalCount?: number,
): GameSetup | undefined {
  const most = maxRivals(classes);
  const count = rivalCount ?? 1 + Math.min(most - 1, Math.floor(random() * most));
  if (modes.length === 0 || count < 1 || count > most) return undefined;
  const left = [...playableClasses(classes)];
  const take = () => left.splice(left.indexOf(pick(left, random)), 1)[0]!;
  const humanClass = take();
  const mode = pick(modes, random);
  const human = {
    classId: humanClass.id,
    starterSpeciesId: pick(humanClass.starterSpeciesIds, random),
  };
  const openPersonalities = PERSONALITIES.filter((entry) => entry.enabled).map((entry) => entry.id);
  const opponents = Array.from({ length: count }, (): OpponentChoice => {
    const option = take();
    return {
      classId: option.id,
      starterSpeciesId: pick(option.starterSpeciesIds, random),
      personality: pick(openPersonalities, random),
      difficulty: pick(DIFFICULTIES, random),
    };
  });
  return { mode, human, opponents };
}

/** `?seed=` is for testing only and never shown to players. */
export function seedFromSearch(search: string): number | string | undefined {
  const value = new URLSearchParams(search).get('seed')?.trim();
  if (!value) return undefined;
  return /^-?\d+$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : value;
}

/** A fresh game seed when `?seed=` is absent: a random unsigned 32-bit integer. */
export function freshSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0]!;
}
