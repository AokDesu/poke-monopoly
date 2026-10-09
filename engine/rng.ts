/** Immutable state fits GameState.rng; callers retain the returned state after each draw. */
export type RngState = Readonly<{ state: string; cursor: number }>;
export type RandomResultEvent = {
  kind: 'random_result';
  purpose: string;
  result: number;
  drawCounter: number;
};
export type RandomDraw<T> = { value: T; rng: RngState; events: RandomResultEvent[] };

export const RNG_VERSION = 'mulberry32-v1';

/** Numeric seeds wrap to uint32; string seeds use FNV-1a over UTF-16 code units. */
export function createRng(seed: number | string): RngState {
  if (typeof seed === 'number' && Number.isSafeInteger(seed)) {
    return { state: String(seed >>> 0), cursor: 0 };
  }
  if (typeof seed !== 'string' || seed.length === 0) {
    throw new RangeError('seed must be a safe integer or nonempty string');
  }
  let state = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    state = Math.imul(state ^ seed.charCodeAt(i), 16777619) >>> 0;
  }
  return { state: String(state), cursor: 0 };
}

function validate(rng: RngState, purpose: string): void {
  const previous = Number(rng.state);
  if (
    !Number.isInteger(previous) ||
    previous < 0 ||
    previous > 4294967295 ||
    String(previous) !== rng.state ||
    !Number.isSafeInteger(rng.cursor) ||
    rng.cursor < 0 ||
    rng.cursor >= Number.MAX_SAFE_INTEGER ||
    typeof purpose !== 'string' ||
    purpose.length === 0
  ) {
    throw new RangeError('invalid RNG state, cursor or purpose');
  }
}

function draw(rng: RngState, size: number, offset: number, purpose: string): RandomDraw<number> {
  validate(rng, purpose);
  const state = (Number(rng.state) + 0x6d2b79f5) >>> 0;
  let word = Math.imul(state ^ (state >>> 15), state | 1);
  word ^= word + Math.imul(word ^ (word >>> 7), word | 61);
  const unit = ((word ^ (word >>> 14)) >>> 0) / 4294967296;
  const value = Math.floor(unit * size) + offset;
  const drawCounter = rng.cursor + 1;
  return {
    value,
    rng: { state: String(state), cursor: drawCounter },
    events: [{ kind: 'random_result', purpose, result: value, drawCounter }],
  };
}

/** Zero-based integer in [0, n), with at most 2^32 choices. */
export function int(rng: RngState, n: number, purpose = 'int'): RandomDraw<number> {
  if (!Number.isInteger(n) || n < 1 || n > 4294967296) {
    throw new RangeError('n must be an integer between 1 and 2^32');
  }
  return draw(rng, n, 0, purpose);
}

export function d6(rng: RngState, purpose = 'd6'): RandomDraw<number> {
  return draw(rng, 6, 1, purpose);
}

/** Logs the selected entry index, so values may be arbitrary domain objects. */
export function weightedPick<T>(
  rng: RngState,
  entries: readonly { value: T; weight: number }[],
  purpose = 'weightedPick',
): RandomDraw<T> {
  const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
  if (
    entries.some(({ weight }) => !Number.isFinite(weight) || weight < 0) ||
    !Number.isFinite(total) ||
    total <= 0
  ) {
    throw new RangeError('weights must be finite, nonnegative and have a positive finite sum');
  }
  const sample = draw(rng, 4294967296, 0, purpose);
  let target = (sample.value / 4294967296) * total;
  let index = entries.findLastIndex(({ weight }) => weight > 0);
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    if (target < entry.weight) {
      index = i;
      break;
    }
    target -= entry.weight;
  }
  return {
    value: entries[index]!.value,
    rng: sample.rng,
    events: [{ kind: 'random_result', purpose, result: index, drawCounter: sample.rng.cursor }],
  };
}

/** Fisher-Yates; each swap logs its zero-based selected index. Empty/singleton uses no draws. */
export function shuffle<T>(
  rng: RngState,
  input: readonly T[],
  purpose = 'shuffle',
): RandomDraw<T[]> {
  validate(rng, purpose);
  const value = [...input];
  const events: RandomResultEvent[] = [];
  for (let i = value.length - 1; i > 0; i--) {
    const sample = int(rng, i + 1, purpose);
    [value[i], value[sample.value]] = [value[sample.value]!, value[i]!];
    rng = sample.rng;
    events.push(...sample.events);
  }
  return { value, rng, events };
}
