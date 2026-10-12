import type { GameState } from './contract/schema.ts';

/** Canonical JSON: object insertion order is irrelevant, array order is significant. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

/** FNV-1a over canonical JSON UTF-16 code units; a comparison aid, not a signature. */
export function stateHash(state: GameState): string {
  const json = canonicalJson(state);
  let hash = 2166136261;
  for (let i = 0; i < json.length; i++) {
    hash = Math.imul(hash ^ json.charCodeAt(i), 16777619) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}
