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
  /** One opponent this cycle (issue #36); seats follow this order after the human's seat 0. */
  readonly opponents: readonly OpponentChoice[];
}

/** The setup screens fill this in step by step; Back keeps every earlier answer. */
export interface SetupDraft {
  readonly mode?: ModeId;
  readonly human?: SeatChoice;
  readonly opponent?: OpponentChoice;
}

const firstEnabledPersonality = PERSONALITIES.find((entry) => entry.enabled)!.id;

/** Classes are unique within a game (spec §3): the opponent may take any playable class but the human's. */
export function opponentClasses(classes: readonly ClassOption[], humanClassId: string) {
  return classes.filter((option) => option.playable && option.id !== humanClassId);
}

/**
 * The opponent's choices for the opponent screen: the existing ones when still valid, otherwise
 * the first free class with its first Starter, the first open personality and Easy.
 */
export function opponentFor(
  classes: readonly ClassOption[],
  human: SeatChoice,
  current: OpponentChoice | undefined,
): OpponentChoice | undefined {
  if (current && current.classId !== human.classId) return current;
  const free = opponentClasses(classes, human.classId)[0];
  if (!free) return undefined;
  return {
    classId: free.id,
    starterSpeciesId: free.starterSpeciesIds[0]!,
    personality: current?.personality ?? firstEnabledPersonality,
    difficulty: current?.difficulty ?? 'easy',
  };
}

export function completeSetup(draft: SetupDraft): GameSetup | undefined {
  if (!draft.mode || !draft.human || !draft.opponent) return undefined;
  if (draft.opponent.classId === draft.human.classId) return undefined;
  return { mode: draft.mode, human: draft.human, opponents: [draft.opponent] };
}

function pick<T>(items: readonly T[], random: () => number): T {
  return items[Math.min(items.length - 1, Math.floor(random() * items.length))]!;
}

/**
 * Random All (spec §3): every open choice picked at random, classes kept unique.
 * Returns undefined when content offers fewer playable classes than seats.
 */
export function randomSetup(
  classes: readonly ClassOption[],
  modes: readonly ModeId[],
  random: () => number,
): GameSetup | undefined {
  const playable = classes.filter((option) => option.playable);
  if (playable.length < 2 || modes.length === 0) return undefined;
  const humanClass = pick(playable, random);
  const opponentClass = pick(
    playable.filter((option) => option.id !== humanClass.id),
    random,
  );
  return {
    mode: pick(modes, random),
    human: {
      classId: humanClass.id,
      starterSpeciesId: pick(humanClass.starterSpeciesIds, random),
    },
    opponents: [
      {
        classId: opponentClass.id,
        starterSpeciesId: pick(opponentClass.starterSpeciesIds, random),
        personality: pick(
          PERSONALITIES.filter((entry) => entry.enabled).map((entry) => entry.id),
          random,
        ),
        difficulty: pick(DIFFICULTIES, random),
      },
    ],
  };
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
