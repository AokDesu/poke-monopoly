import {
  loadGame,
  resume,
  serialize,
  type Resumed,
  type SavedGame,
} from '../../../engine/index.ts';
import { t } from '../i18n/en.ts';
import { readSavedChatWords, type SavedChatWords } from './chat.ts';
import { cleanName, MAX_NAME_LENGTH, type Person } from './people.ts';
import {
  DIFFICULTIES,
  PERSONALITIES,
  readPace,
  type DifficultyId,
  type Pace,
  type PersonalityId,
  type WatchDraft,
  type WatchSettings,
  type WatchStep,
} from './setup.ts';

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
  /** Present only for a watched game: its talk setting and starting pace. */
  readonly watch?: WatchSettings;
  /** The pace the game was last played at, kept with every game (spec §3, AI turns). */
  readonly pace?: Pace;
  /** The rivals' words for the human's topic messages, so a reload shows the same lines (spec §5.7). */
  readonly chatWords?: readonly SavedChatWords[];
  /**
   * The id the speech and decision routes know this game by, so the server's per-game limits
   * (spec §9) carry on across a reload. Never part of the exported log.
   */
  readonly gameId?: string;
  /**
   * The prepared scenario this game was opened from (`?demo`, issue #222). Marks the game as
   * prepared so a reload keeps announcing it. Never part of the exported log.
   */
  readonly scene?: string;
  /** The people at a table of several people, named; never part of the exported log. */
  readonly people?: readonly Person[];
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
  storage.setItem(
    META_KEY,
    JSON.stringify({
      opponents: meta.opponents,
      watch: meta.watch,
      pace: meta.pace,
      gameId: meta.gameId,
      scene: meta.scene,
      chatWords: meta.chatWords,
      people: meta.people && meta.people.length > 0 ? meta.people : undefined,
    }),
  );
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
    const watch = 'watch' in parsed ? parsed.watch : undefined;
    const talk = watch && typeof watch === 'object' && 'talk' in watch ? watch.talk : undefined;
    // A save from before paces kept the watched game's starting speed instead.
    const startPace =
      watch && typeof watch === 'object'
        ? readPace('pace' in watch ? watch.pace : 'speed' in watch ? watch.speed : undefined)
        : undefined;
    const pace = 'pace' in parsed ? readPace(parsed.pace) : undefined;
    const gameId = 'gameId' in parsed ? parsed.gameId : undefined;
    const scene = 'scene' in parsed ? parsed.scene : undefined;
    return {
      opponents: rows.flatMap((entry) => {
        if (!entry || typeof entry !== 'object') return [];
        const row = entry as Record<string, unknown>;
        const personality = PERSONALITIES.find((item) => item.id === row.personality)?.id;
        const difficulty = DIFFICULTIES.find((item) => item === row.difficulty);
        if (typeof row.seatIndex !== 'number' || !personality || !difficulty) return [];
        return [{ seatIndex: row.seatIndex, personality, difficulty }];
      }),
      ...(typeof talk === 'boolean' && startPace && { watch: { talk, pace: startPace } }),
      ...(pace && { pace }),
      ...(typeof gameId === 'string' && /^[\w-]{1,64}$/.test(gameId) && { gameId }),
      ...(typeof scene === 'string' && /^[\w-]{1,64}$/.test(scene) && { scene }),
      ...('chatWords' in parsed && { chatWords: readSavedChatWords(parsed.chatWords) }),
      ...('people' in parsed && { people: readSavedPeople(parsed.people) }),
    };
  } catch {
    return EMPTY_META;
  }
}

/** The saved names as plain data: whatever is not a seat number with a usable name is dropped. */
function readSavedPeople(value: unknown): Person[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): Person[] => {
    if (!entry || typeof entry !== 'object') return [];
    const { seatIndex, name } = entry as Record<string, unknown>;
    if (typeof seatIndex !== 'number' || !Number.isInteger(seatIndex) || typeof name !== 'string') {
      return [];
    }
    const clean = cleanName(name);
    return clean.length > 0 && clean.length <= MAX_NAME_LENGTH ? [{ seatIndex, name: clean }] : [];
  });
}

/**
 * The people of a saved game: every human seat when two or more are human, named as the save kept
 * them, or "Player n" when it kept none (a save written by the engine alone). A game with one human
 * seat, and a watched game, has no people.
 */
export function savedPeople(game: SavedGame, meta: SaveMeta): Person[] {
  const humans = game.state.config.seats.filter((seat) => seat.controller === 'human');
  if (humans.length < 2) return [];
  return humans.map(({ seatIndex }) => ({
    seatIndex,
    name:
      meta.people?.find((person) => person.seatIndex === seatIndex)?.name ??
      t('people.defaultName', { n: seatIndex + 1 }),
  }));
}

/** Where an unfinished watch setup waits across a reload; gone once the game starts or setup is left. */
export const WATCH_SETUP_KEY = 'poke-monopoly.watch-setup';

export function writeWatchSetup(storage: SaveStorage, step: WatchStep, draft: WatchDraft): void {
  storage.setItem(
    WATCH_SETUP_KEY,
    JSON.stringify({ step, mode: draft.mode, ais: draft.ais, ...draft.settings }),
  );
}

export function clearWatchSetup(storage: SaveStorage): void {
  storage.removeItem(WATCH_SETUP_KEY);
}

/** The saved watch setup as plain data; `restoreWatchProgress` checks it against today's choices. */
export function readWatchSetup(storage: SaveStorage): unknown {
  try {
    const raw = storage.getItem(WATCH_SETUP_KEY);
    return raw ? (JSON.parse(raw) as unknown) : undefined;
  } catch {
    return undefined;
  }
}

/** One AI seat of a saved game: its class from the engine save, its settings from the meta. */
export interface SavedRival {
  readonly seatIndex: number;
  readonly classId: string;
  /** Absent when the meta has no valid personality and difficulty for this seat. */
  readonly settings?: SaveMeta['opponents'][number];
}

export function savedRivals(game: SavedGame, meta: SaveMeta): SavedRival[] {
  return game.state.config.seats
    .filter((seat) => seat.controller === 'ai')
    .map((seat) => ({
      seatIndex: seat.seatIndex,
      classId: seat.classId,
      settings: meta.opponents.find((row) => row.seatIndex === seat.seatIndex),
    }));
}

/**
 * Loads an engine save. A different engine, content or RNG version keeps the engine's own
 * message. Anything else is unreadable. Neither path throws.
 */
export function loadSave(text: string): LoadResult {
  try {
    const game = loadGame(text);
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
  /** Absent in a watched game, where no seat is human, and at a table of several people. */
  readonly humanSeat?: number;
  /** Every human seat, in seat order. */
  readonly humanSeats: readonly number[];
  readonly turn: number;
  /** Multi-choice AI decision: the page must ask again and must not start a turn. */
  readonly aiDecision: boolean;
}

export function summarize(game: SavedGame, resumed: Resumed): SaveSummary {
  const humanSeats = game.state.config.seats
    .filter((seat) => seat.controller === 'human')
    .map((seat) => seat.seatIndex);
  const humanSeat = humanSeats.length === 1 ? humanSeats[0] : undefined;
  const shared = {
    turn: game.state.globalTurnNo,
    humanSeats,
    ...(humanSeat !== undefined && { humanSeat }),
  };
  const waiting = resumed.waitingFor;
  if (waiting.kind === 'decision') {
    const seat = game.state.config.seats.find((entry) => entry.seatIndex === waiting.seatIndex);
    return {
      phase: waiting.phase,
      waiting: 'decision',
      seatIndex: waiting.seatIndex,
      ...shared,
      aiDecision: seat?.controller === 'ai' && waiting.legalActions.enabled.length > 1,
    };
  }
  return {
    phase: game.state.phase.kind,
    waiting: waiting.kind,
    seatIndex: game.state.activeSeatIndex,
    ...shared,
    aiDecision: false,
  };
}

export function saveText(game: SavedGame): string {
  return serialize(game);
}

/** Downloads the engine save. The file is what `loadGame` reads, with no extra fields. */
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
