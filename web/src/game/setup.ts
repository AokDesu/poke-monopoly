import type { GAME_PRESETS } from '../../../engine/index.ts';

/**
 * The setup choices of spec §3, before any game exists. Plain data: the engine checks the
 * finished setup again in `createGame`, so nothing here is a rule the engine relies on.
 */
export type ModeId = keyof typeof GAME_PRESETS;

/** Spec §5.5 presets: every personality file is open; a closed one would be shown greyed. */
export const PERSONALITIES = [
  { id: 'greedy', enabled: true },
  { id: 'aggressive', enabled: true },
  { id: 'cautious', enabled: true },
  { id: 'opportunist', enabled: true },
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
 * first rival with it. Used to grey a class out with the reason, and to find repeats. A watched
 * game has no human, so `human` is undefined there and only the AIs hold classes.
 */
export function classHolder(
  human: SeatChoice | undefined,
  rivals: readonly OpponentChoice[],
  classId: string,
  except?: number,
): 'human' | number | undefined {
  if (human?.classId === classId) return 'human';
  const index = rivals.findIndex((rival, at) => at !== except && rival.classId === classId);
  return index === -1 ? undefined : index;
}

/**
 * The rivals that repeat the human's class or an earlier rival's. Changing the human's class on
 * Back can make a valid rival repeat; it stays as chosen and setup cannot go on until it is fixed.
 */
export function classConflicts(
  human: SeatChoice | undefined,
  rivals: readonly OpponentChoice[],
): number[] {
  return rivals.flatMap((rival, index) => {
    const holder = classHolder(human, rivals.slice(0, index), rival.classId);
    return holder === undefined ? [] : [index];
  });
}

/** A new rival: the first free class with its first Starter, the first open personality, Easy. */
function newRival(
  classes: readonly ClassOption[],
  human: SeatChoice | undefined,
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
  human: SeatChoice | undefined,
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
 * `count` AI seats, each on its own class taken from `left` (which loses them), with every other
 * choice random among the open ones.
 */
function randomSeats(
  left: ClassOption[],
  count: number,
  random: () => number,
): readonly OpponentChoice[] {
  const openPersonalities = PERSONALITIES.filter((entry) => entry.enabled).map((entry) => entry.id);
  return Array.from({ length: count }, (): OpponentChoice => {
    const option = left.splice(left.indexOf(pick(left, random)), 1)[0]!;
    return {
      classId: option.id,
      starterSpeciesId: pick(option.starterSpeciesIds, random),
      personality: pick(openPersonalities, random),
      difficulty: pick(DIFFICULTIES, random),
    };
  });
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
  const humanClass = left.splice(left.indexOf(pick(left, random)), 1)[0]!;
  const mode = pick(modes, random);
  const human = {
    classId: humanClass.id,
    starterSpeciesId: pick(humanClass.starterSpeciesIds, random),
  };
  const opponents = randomSeats(left, count, random);
  return { mode, human, opponents };
}

/** Presentation speeds between AI actions (spec §3). Watch setup picks the one a game starts at. */
export const TURN_SPEEDS = ['normal', 'fast', 'instant'] as const;
export type TurnSpeed = (typeof TURN_SPEEDS)[number];

/** Spec §3: two to four AIs and no human seat in watch mode. */
export const WATCH_MIN_AIS = 2;
export const WATCH_MAX_AIS = 4;

/** The watch settings that are not an AI's: kept with the game so a resume starts the same way. */
export interface WatchSettings {
  /** Whether the AIs may speak at the table (spec §5.7). Off asks for no lines at all. */
  readonly talk: boolean;
  readonly speed: TurnSpeed;
}

export const DEFAULT_WATCH_SETTINGS: WatchSettings = { talk: true, speed: 'normal' };

/** Every seat of a watched game is an AI: seat n is `ais[n]`. */
export interface WatchSetup {
  readonly mode: ModeId;
  readonly ais: readonly OpponentChoice[];
  readonly settings: WatchSettings;
}

/** The watch screens fill this in step by step; Back keeps every earlier answer. */
export interface WatchDraft {
  readonly mode?: ModeId;
  readonly ais?: readonly OpponentChoice[];
  readonly settings: WatchSettings;
}

/** Spec §3 watch path, from the mode choice to the review; the board follows. */
export const WATCH_STEPS = ['mode', 'ais', 'options', 'review'] as const;
export type WatchStep = (typeof WATCH_STEPS)[number];

/** The most AIs the open classes allow: every seat needs its own class (spec §3). */
export function maxWatchAis(classes: readonly ClassOption[]): number {
  return Math.min(WATCH_MAX_AIS, playableClasses(classes).length);
}

/** Watching needs at least two AIs, so at least two open classes. */
export const canWatch = (classes: readonly ClassOption[]): boolean =>
  maxWatchAis(classes) >= WATCH_MIN_AIS;

/** Complete only with open classes and personalities, no repeated class and two to four AIs. */
export function completeWatchSetup(
  draft: WatchDraft,
  classes: readonly ClassOption[],
): WatchSetup | undefined {
  const { mode, ais, settings } = draft;
  if (!mode || !ais || ais.length < WATCH_MIN_AIS || ais.length > maxWatchAis(classes)) {
    return undefined;
  }
  const open = new Set(playableClasses(classes).map((option) => option.id));
  const openPersonalities = PERSONALITIES.filter((entry) => entry.enabled).map((entry) => entry.id);
  const usable = ais.every(
    (seat) =>
      open.has(seat.classId) &&
      classes
        .find((option) => option.id === seat.classId)
        ?.starterSpeciesIds.includes(seat.starterSpeciesId) &&
      openPersonalities.some((id) => id === seat.personality) &&
      DIFFICULTIES.some((id) => id === seat.difficulty),
  );
  if (!usable || classConflicts(undefined, ais).length > 0) return undefined;
  return { mode, ais, settings };
}

/**
 * Random All for a watched game (spec §3): every AI's class, Starter, personality and difficulty
 * at random among the open choices, classes kept unique, exactly `count` AIs. Undefined when the
 * open classes cannot seat that many.
 */
export function randomAis(
  classes: readonly ClassOption[],
  count: number,
  random: () => number,
): readonly OpponentChoice[] | undefined {
  if (count < WATCH_MIN_AIS || count > maxWatchAis(classes)) return undefined;
  return randomSeats([...playableClasses(classes)], count, random);
}

const WATCH_STEP_REACHED: Record<WatchStep, number> = { mode: 0, ais: 1, options: 2, review: 3 };

/**
 * Reads a saved watch setup (spec §3.1: a reload keeps the answers). Anything that no longer fits
 * today's open classes, personalities or modes is dropped, never repaired, and the step falls back
 * to the first one that still needs an answer.
 */
export function restoreWatchProgress(
  raw: unknown,
  classes: readonly ClassOption[],
  openModes: readonly ModeId[],
): { step: WatchStep; draft: WatchDraft } | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const { step, mode, ais: savedAis, talk, speed } = raw as Record<string, unknown>;
  const savedStep = WATCH_STEPS.find((entry) => entry === step);
  if (!savedStep) return undefined;
  const settings: WatchSettings = {
    talk: typeof talk === 'boolean' ? talk : DEFAULT_WATCH_SETTINGS.talk,
    speed: TURN_SPEEDS.find((entry) => entry === speed) ?? DEFAULT_WATCH_SETTINGS.speed,
  };
  const openMode = openModes.find((entry) => entry === mode);
  const seats: unknown[] = Array.isArray(savedAis) ? savedAis : [];
  const rows = seats.map((entry): OpponentChoice | undefined => {
    const row = (entry ?? {}) as Record<string, unknown>;
    const personality = PERSONALITIES.find((item) => item.id === row.personality)?.id;
    const difficulty = DIFFICULTIES.find((item) => item === row.difficulty);
    if (
      typeof row.classId !== 'string' ||
      typeof row.starterSpeciesId !== 'string' ||
      !personality ||
      !difficulty
    ) {
      return undefined;
    }
    return {
      classId: row.classId,
      starterSpeciesId: row.starterSpeciesId,
      personality,
      difficulty,
    };
  });
  const chosen = rows.every((row) => row !== undefined) ? (rows as OpponentChoice[]) : [];
  const kept =
    openMode && completeWatchSetup({ mode: openMode, ais: chosen, settings }, classes)
      ? chosen
      : undefined;
  // An answer that no longer fits is never repaired in place: the AI step opens on two fresh seats.
  const ais =
    kept ?? (openMode ? withRivalCount(classes, undefined, [], WATCH_MIN_AIS) : undefined);
  const draft: WatchDraft = {
    settings,
    ...(openMode && { mode: openMode }),
    ...(ais && { ais }),
  };
  const reached = !openMode ? 0 : !kept ? 1 : 3;
  const at = Math.min(WATCH_STEP_REACHED[savedStep], reached);
  return { step: WATCH_STEPS[at]!, draft };
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
