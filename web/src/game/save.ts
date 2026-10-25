import {
  deserialize,
  resume,
  serialize,
  verifyReplay,
  type Resumed,
  type SavedGame,
} from '../../../engine/index.ts';
import { DIFFICULTIES, PERSONALITIES, type DifficultyId, type PersonalityId } from './setup.ts';

/** Browser key for the engine save text. The value is exactly `serialize`'s output. */
export const SAVE_KEY = 'poke-monopoly.save';
/** Opponent setup the engine does not store. Never written into the exported log. */
export const META_KEY = 'poke-monopoly.save-meta';

export interface SaveStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface SaveMeta {
  readonly opponents: readonly {
    readonly seatIndex: number;
    readonly personality: PersonalityId;
    readonly difficulty: DifficultyId;
  }[];
}

export type LoadResult =
  | { ok: true; game: SavedGame; resumed: Resumed }
  | { ok: false; kind: 'mismatch' | 'unreadable'; message: string };

const EMPTY_META: SaveMeta = { opponents: [] };
const PROBE_KEY = 'poke-monopoly.storage-probe';

/** `null` when storage is missing or throws. Probing must not crash the page. */
export function browserStorage(): SaveStorage | null {
  try {
    const storage = globalThis.localStorage;
    storage.setItem(PROBE_KEY, '1');
    storage.removeItem(PROBE_KEY);
    return storage;
  } catch {
    return null;
  }
}

export function readSaveText(storage: SaveStorage): string | null {
  return storage.getItem(SAVE_KEY);
}

export function writeSave(storage: SaveStorage, game: SavedGame, meta: SaveMeta): void {
  storage.setItem(SAVE_KEY, serialize(game));
  storage.setItem(META_KEY, JSON.stringify({ opponents: meta.opponents }));
}

export function clearSave(storage: SaveStorage): void {
  storage.removeItem(SAVE_KEY);
  storage.removeItem(META_KEY);
}

export function readMeta(storage: SaveStorage): SaveMeta {
  try {
    const raw = storage.getItem(META_KEY);
    if (!raw) return EMPTY_META;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !('opponents' in parsed)) return EMPTY_META;
    const rows = parsed.opponents;
    if (!Array.isArray(rows)) return EMPTY_META;
    return {
      opponents: rows.flatMap((entry) => {
        if (!entry || typeof entry !== 'object') return [];
        const row = entry as Record<string, unknown>;
        const personality = PERSONALITIES.find((item) => item.id === row.personality)?.id;
        const difficulty = DIFFICULTIES.find((item) => item === row.difficulty);
        if (typeof row.seatIndex !== 'number' || !personality || !difficulty) return [];
        return [{ seatIndex: row.seatIndex, personality, difficulty }];
      }),
    };
  } catch {
    return EMPTY_META;
  }
}

/**
 * Loads an engine save. A different engine, content or RNG version keeps the engine's own
 * message. Anything else is unreadable. Neither path throws.
 */
export function loadSave(text: string): LoadResult {
  try {
    const game = deserialize(text);
    const check = verifyReplay(game);
    if (!check.pass) return { ok: false, kind: 'unreadable', message: check.reason };
    return { ok: true, game, resumed: resume(game) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const mismatch =
      message.startsWith('This save was made with') || message.startsWith('This save has format');
    return { ok: false, kind: mismatch ? 'mismatch' : 'unreadable', message };
  }
}

export interface SaveSummary {
  readonly phase: string;
  readonly waiting: 'finished' | 'engine_result' | 'decision';
  readonly seatIndex: number;
  readonly humanSeat: number;
  /** Multi-choice AI decision: the page must ask again and must not start a turn. */
  readonly aiDecision: boolean;
}

export function summarize(game: SavedGame, resumed: Resumed): SaveSummary {
  const humanSeat =
    game.state.config.seats.find((seat) => seat.controller === 'human')?.seatIndex ?? 0;
  const waiting = resumed.waitingFor;
  if (waiting.kind === 'decision') {
    const seat = game.state.config.seats.find((entry) => entry.seatIndex === waiting.seatIndex);
    return {
      phase: waiting.phase,
      waiting: 'decision',
      seatIndex: waiting.seatIndex,
      humanSeat,
      aiDecision: seat?.controller === 'ai' && waiting.legalActions.enabled.length > 1,
    };
  }
  return {
    phase: game.state.phase.kind,
    waiting: waiting.kind,
    seatIndex: game.state.activeSeatIndex,
    humanSeat,
    aiDecision: false,
  };
}

export function saveText(game: SavedGame): string {
  return serialize(game);
}

/** Downloads the engine save. The file is what `deserialize` reads, with no extra fields. */
export function downloadSave(text: string): void {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'poke-monopoly-log.json';
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
