/**
 * The people at a shared table (spec §3, local multiplayer). Names are presentation and live in the
 * browser beside the save, never in the engine or its log: a person has a seat index and a name.
 */
export interface Person {
  readonly seatIndex: number;
  readonly name: string;
}

export const MAX_NAME_LENGTH = 16;

/** A name as typed: trimmed, inner runs of spaces collapsed. */
export const cleanName = (value: string): string => value.trim().replace(/\s+/g, ' ');

/** Why a name cannot be used, or undefined. `others` are the other people's names. */
export function nameProblem(
  value: string,
  others: readonly string[],
): 'empty' | 'long' | 'taken' | undefined {
  const name = cleanName(value);
  if (name.length === 0) return 'empty';
  if (name.length > MAX_NAME_LENGTH) return 'long';
  const key = name.toLocaleLowerCase();
  return others.some((other) => cleanName(other).toLocaleLowerCase() === key) ? 'taken' : undefined;
}

/**
 * The names the board's seat labels read. Seat labels are asked for in many places (rows, the field
 * log, battle cards, messages), some of them plain functions, so the store sets this once whenever a
 * game starts, resumes or is cleared, before any listener runs. Empty for every game without people.
 */
let names: ReadonlyMap<number, string> = new Map();

export function setPeople(people: readonly Person[]): void {
  names = new Map(people.map((person) => [person.seatIndex, person.name]));
}

/** The name of the person at a seat, or undefined for an AI seat or a game without people. */
export const personName = (seatIndex: number): string | undefined => names.get(seatIndex);
