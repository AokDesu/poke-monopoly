import {
  advanceAutomatically,
  applyAction,
  createGame,
  createGameLog,
  legalActions,
  observe,
  type Action,
  type ApplyActionResult,
  type Content,
  type GameConfig,
  type GameLog,
  type GameState,
  type LegalActions,
  type Observation,
} from '../../../engine/index.ts';

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

export interface GameStore {
  /** Compatible with React's `useSyncExternalStore`. */
  subscribe(listener: () => void): () => void;
  getSession(): GameSession | null;
  /** Creates the game and its log together (engine contract: `createGameLog(createGame(...))`). */
  start(config: GameConfig, content: Content): void;
  /** Rejected commands change nothing and notify no one. */
  submit(command: Command): ApplyActionResult;
  /** Applies one pending engine result or sole legal choice; false when a decision is needed. */
  advance(): boolean;
  legalActions(seatIndex: number): LegalActions;
  observe(seatIndex: number): Observation;
  clear(): void;
}

export function createGameStore(): GameStore {
  let session: GameSession | null = null;
  const listeners = new Set<() => void>();

  const commit = (next: GameSession | null) => {
    session = next;
    for (const listener of listeners) listener();
  };
  const current = (): GameSession => {
    if (!session) throw new Error('No game in progress');
    return session;
  };

  return {
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSession(): GameSession | null {
      return session;
    },
    start(config: GameConfig, content: Content): void {
      const state = createGame(config, content);
      commit({ state, log: createGameLog(state) });
    },
    submit(command: Command): ApplyActionResult {
      const { state, log } = current();
      const result = applyAction(state, {
        ...command,
        actionSeq: state.stateRevision + 1,
        stateRevisionBefore: state.stateRevision,
      });
      if ('accepted' in result) {
        commit({ state: result.state, log: { ...log, actions: [...log.actions, result.record] } });
      }
      return result;
    },
    advance(): boolean {
      const { state, log } = current();
      const step = advanceAutomatically(state);
      if (step.records.length === 0) return false;
      commit({ state: step.state, log: { ...log, actions: [...log.actions, ...step.records] } });
      return true;
    },
    legalActions(seatIndex: number): LegalActions {
      return legalActions(current().state, seatIndex);
    },
    observe(seatIndex: number): Observation {
      return observe(current().state, seatIndex);
    },
    clear(): void {
      commit(null);
    },
  };
}

export const gameStore = createGameStore();
