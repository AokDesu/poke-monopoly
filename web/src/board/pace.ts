import type { Pace } from '../game/setup.ts';

/**
 * How long the table holds what it tells, per pace (spec §3, AI turns). Presentation numbers, not
 * game rules: they decide when the next step may start and never touch a coin, die, decision or
 * save log. `hold` is null at Step, where every outcome waits for Next.
 */
export interface PaceTiming {
  /** A step that shows no beat (a skip, a phase change, an automatic roll) waits this long. */
  readonly fillerMs: number;
  /** An outcome is held `baseMs + perWordMs × words`, clamped to `minMs`..`maxMs`. */
  readonly hold: {
    readonly baseMs: number;
    readonly perWordMs: number;
    readonly minMs: number;
    readonly maxMs: number;
  } | null;
  /** The viewing seat's own results are never held shorter than this. */
  readonly ownMinMs: number;
  /** A turn's one speech line adds this to the hold of the beat it sits in. */
  readonly speechMs: number;
  /** A finished turn's row folds to one line this long after the turn ends. */
  readonly foldMs: number;
}

export const PACE_TIMING: Readonly<Record<Pace, PaceTiming>> = {
  step: { fillerMs: 250, hold: null, ownMinMs: 2500, speechMs: 1000, foldMs: 1500 },
  readable: {
    fillerMs: 250,
    hold: { baseMs: 1200, perWordMs: 300, minMs: 2500, maxMs: 5000 },
    ownMinMs: 2500,
    speechMs: 1000,
    foldMs: 1500,
  },
  fast: {
    fillerMs: 100,
    hold: { baseMs: 400, perWordMs: 100, minMs: 800, maxMs: 1600 },
    ownMinMs: 800,
    speechMs: 0,
    foldMs: 500,
  },
  instant: {
    fillerMs: 0,
    hold: { baseMs: 0, perWordMs: 0, minMs: 0, maxMs: 0 },
    ownMinMs: 0,
    speechMs: 0,
    foldMs: 0,
  },
};

/** Words a reader reads: tokens with a letter or a digit, so "·" and "→" cost nothing. */
export function wordCount(text: string): number {
  return text.split(/\s+/).filter((token) => /[\p{L}\p{N}]/u.test(token)).length;
}

/** What the hold of one beat depends on. */
export interface HeldBeat {
  readonly text: string;
  /** A choice the viewing seat just made itself is not held: the player knows it already. */
  readonly ownChoice: boolean;
  /** One of the viewing seat's own results (a move, a landing, an Event, a catch, a battle). */
  readonly ownResult: boolean;
}

/**
 * How long the table holds `beat` before the next step, in ms; `Infinity` waits for Next (Step pace).
 * Readable: 1.2 s + 0.3 s per word, between 2.5 s and 5.0 s; the viewing seat's own results at
 * least 2.5 s. The speech line's extra time is added where the line appears (`PaceTiming.speechMs`).
 */
export function holdMs(beat: HeldBeat, pace: Pace): number {
  if (beat.ownChoice) return 0;
  const { hold, ownMinMs } = PACE_TIMING[pace];
  if (!hold) return Infinity;
  const read = Math.min(
    hold.maxMs,
    Math.max(hold.minMs, hold.baseMs + hold.perWordMs * wordCount(beat.text)),
  );
  return beat.ownResult ? Math.max(ownMinMs, read) : read;
}
