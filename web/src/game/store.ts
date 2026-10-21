import {
  actionVisibleTo,
  advanceAutomatically,
  applyAction,
  createGame,
  createGameConfig,
  createGameLog,
  GAME_PRESETS,
  legalActions,
  observe,
  type Action,
  type ActionRecord,
  type ApplyActionResult,
  type Content,
  type GameConfig,
  type GameLog,
  type GameState,
  type LegalActions,
  type Observation,
  type SeatActionRecord,
} from '../../../engine/index.ts';
import type { DifficultyId, GameSetup, PersonalityId } from './setup.ts';

/**
 * The only module in web/ that calls the engine (spec §6.1). It holds the current
 * state plus the action log and decides nothing itself; components read from here
 * and never apply rules.
 */
export interface GameSession {
  readonly state: GameState;
  readonly log: GameLog;
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** A player command; the store adds the next sequence number and current revision. */
export type Command = DistributiveOmit<Action, 'actionSeq' | 'stateRevisionBefore'>;

/** An AI seat's setup choices the engine does not read (spec §5.5, §5.6). */
export interface OpponentSettings {
  readonly seatIndex: number;
  readonly personality: PersonalityId;
  readonly difficulty: DifficultyId;
}

/** One accepted action as the human seat may see it (engine contract: `actionVisibleTo`). */
export interface SeatFeedEntry {
  /** What the seat saw just before the action: the public phase and whose turn it was. */
  readonly before: Pick<Observation['public'], 'phase' | 'activeSeatIndex'>;
  readonly record: SeatActionRecord;
}

/**
 * Everything the UI may read about a game: the human seat's role-scoped observation, its
 * legal actions and its redacted action feed (engine contract, issue #37). Never raw state.
 */
export interface SeatView {
  readonly seatIndex: number;
  readonly observation: Observation;
  readonly legalActions: LegalActions;
  readonly feed: readonly SeatFeedEntry[];
  readonly opponents: readonly OpponentSettings[];
}

export interface GameStore {
  /** Compatible with React's `useSyncExternalStore`. */
  subscribe(listener: () => void): () => void;
  /** Full engine data for replay and audit; screens read `getView()` instead. */
  getSession(): GameSession | null;
  /** The human seat's view, or null without a game or a human seat. Stable between changes. */
  getView(): SeatView | null;
  /** Creates the game and its log together (engine contract: `createGameLog(createGame(...))`). */
  start(config: GameConfig, content: Content, opponents?: readonly OpponentSettings[]): void;
  /** Rejected commands change nothing and notify no one. */
  submit(command: Command): ApplyActionResult;
  /** Submits one of the human seat's enabled legal actions by its ID. */
  choose(choiceId: string): ApplyActionResult;
  /**
   * Applies one pending engine result or an AI seat's sole legal choice; false when a decision
   * is needed. Never plays for the human seat: its choices come only through `choose`/`submit`.
   */
  advance(): boolean;
  clear(): void;
}

/** Quick and Standard (spec §1, §4.1); `enabled` says which ones setup may offer. */
export const MODES = GAME_PRESETS;

/** Seat 0 is the human; opponents follow in setup order (spec §3: seats are fixed before the roll). */
export function configForSetup(setup: GameSetup, seed: GameConfig['seed']): GameConfig {
  const seats = [setup.human, ...setup.opponents].map((choice, seatIndex) => ({
    actorId: seatIndex === 0 ? 'human' : `ai-${seatIndex}`,
    seatIndex,
    classId: choice.classId,
    starterSpeciesId: choice.starterSpeciesId,
    controller: seatIndex === 0 ? ('human' as const) : ('ai' as const),
  }));
  return createGameConfig({ seats, seed, lapTarget: MODES[setup.mode].lapTarget });
}

export function opponentSettings(setup: GameSetup): OpponentSettings[] {
  return setup.opponents.map(({ personality, difficulty }, index) => ({
    seatIndex: index + 1,
    personality,
    difficulty,
  }));
}

function humanSeat(state: GameState): number | undefined {
  return state.config.seats.find((seat) => seat.controller === 'human')?.seatIndex;
}

export function createGameStore(): GameStore {
  let session: GameSession | null = null;
  let view: SeatView | null = null;
  let opponents: readonly OpponentSettings[] = [];
  const listeners = new Set<() => void>();

  const viewOf = (state: GameState, feed: readonly SeatFeedEntry[]): SeatView | null => {
    const seatIndex = humanSeat(state);
    if (seatIndex === undefined) return null;
    return {
      seatIndex,
      observation: observe(state, seatIndex),
      legalActions: legalActions(state, seatIndex),
      feed,
      opponents,
    };
  };
  const commit = (next: GameSession, before: GameState, records: readonly ActionRecord[]) => {
    const seatIndex = humanSeat(before);
    let feed = view?.feed ?? [];
    if (seatIndex !== undefined && records.length > 0) {
      const { phase, activeSeatIndex } = observe(before, seatIndex).public;
      // Each step applies one record (engine contract: `advanceAutomatically` does not loop).
      feed = [
        ...feed,
        ...records.map((record) => ({
          before: { phase, activeSeatIndex },
          record: actionVisibleTo(before, record, seatIndex),
        })),
      ];
    }
    session = next;
    view = viewOf(next.state, feed);
    for (const listener of listeners) listener();
  };
  const current = (): GameSession => {
    if (!session) throw new Error('No game in progress');
    return session;
  };
  const submit = (command: Command): ApplyActionResult => {
    const { state, log } = current();
    const result = applyAction(state, {
      ...command,
      actionSeq: state.stateRevision + 1,
      stateRevisionBefore: state.stateRevision,
    });
    if ('accepted' in result) {
      commit(
        { state: result.state, log: { ...log, actions: [...log.actions, result.record] } },
        state,
        [result.record],
      );
    }
    return result;
  };

  return {
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSession(): GameSession | null {
      return session;
    },
    getView(): SeatView | null {
      return view;
    },
    start(config: GameConfig, content: Content, settings: readonly OpponentSettings[] = []): void {
      const state = createGame(config, content);
      opponents = settings;
      view = null;
      commit({ state, log: createGameLog(state) }, state, []);
    },
    submit,
    choose(choiceId: string): ApplyActionResult {
      const { state } = current();
      const seatIndex = humanSeat(state);
      const choice =
        seatIndex === undefined
          ? undefined
          : legalActions(state, seatIndex).enabled.find((entry) => entry.id === choiceId);
      if (!choice) return { rejected: true, reason: 'illegal_action', state };
      const actorId = state.players.find((player) => player.seatIndex === seatIndex)!.actorId;
      return submit({ actorId, kind: choice.kind, payload: choice.payload } as Command);
    },
    advance(): boolean {
      const { state, log } = current();
      const active = state.config.seats.find((seat) => seat.seatIndex === state.activeSeatIndex);
      if (
        active?.controller === 'human' &&
        legalActions(state, active.seatIndex).enabled.length > 0
      ) {
        return false;
      }
      const step = advanceAutomatically(state);
      if (step.records.length === 0) return false;
      commit(
        { state: step.state, log: { ...log, actions: [...log.actions, ...step.records] } },
        state,
        step.records,
      );
      return true;
    },
    clear(): void {
      session = null;
      view = null;
      opponents = [];
      for (const listener of listeners) listener();
    },
  };
}
