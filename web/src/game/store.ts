import {
  actionVisibleTo,
  advanceAutomatically,
  applyAction,
  createGame,
  createGameConfig,
  createGameLog,
  eventsVisibleTo,
  fixtureSchema,
  GAME_PRESETS,
  legalActions,
  observe,
  oddsForAllBalls,
  saleQuote,
  winner,
  type SaleQuote,
  type BallType,
  type CatchOdds,
  type Action,
  type ActionRecord,
  type ApplyActionResult,
  type Content,
  type EngineEvent,
  type GameConfig,
  type GameLog,
  type GameState,
  type LegalActions,
  type Observation,
  type SeatActionRecord,
} from '../../../engine/index.ts';
import type { DifficultyId, GameSetup, PersonalityId } from './setup.ts';

/**
 * Rules adapter (spec §6.1). Storage IO lives in `save.ts`; both call the engine only through
 * `engine/index.ts`. This module holds the current state plus the action log and decides nothing.
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
  readonly before: Pick<Observation['public'], 'phase' | 'activeSeatIndex' | 'globalTurnNo'>;
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
  readonly catchOdds: readonly ({ ballType: BallType } & CatchOdds)[];
  readonly feed: readonly SeatFeedEntry[];
  readonly opponents: readonly OpponentSettings[];
}

/** Finished standings. Coins, badges and the engine's winner only — never a team size. */
export interface GameResults {
  readonly humanSeat: number;
  readonly standings: readonly {
    readonly actorId: string;
    readonly seatIndex: number;
    readonly coins: number;
    readonly badges: number;
  }[];
  readonly winners: readonly string[];
  readonly reason: 'coins' | 'badges' | 'co_winners';
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
  /** Read-only engine quote; only this human seat's active Sell selection is accessible. */
  quoteSale(pokemonInstanceIds: string[]): SaleQuote;
  /**
   * Applies one pending result or sole choice. Board play opts human steps in; first-player
   * setup retains its explicit roll confirmation. The engine alone decides what is automatic.
   */
  advance(options?: { human?: boolean }): boolean;
  /** Sends an AI seat's own projection to the server, then validates its answer via applyAction. */
  playOpponent(signal: AbortSignal): Promise<boolean>;
  /** Setup saved beside the engine log so a resumed AI decision uses the same personality. */
  getOpponents(): readonly OpponentSettings[];
  /**
   * Replaces the session with a saved game. Applies nothing: dice stay as logged and the
   * pending decision stays pending (spec §3.1, §6.9).
   */
  restore(session: GameSession, settings?: readonly OpponentSettings[]): void;
  /** Engine winner and coin/badge standings, or null until the game is finished. Stable. */
  getResults(): GameResults | null;
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

function resultsOf(state: GameState): GameResults | null {
  if (state.phase.kind !== 'finished') return null;
  const outcome = winner(state);
  return {
    humanSeat: humanSeat(state) ?? 0,
    standings: [...state.players]
      .sort((a, b) => a.seatIndex - b.seatIndex)
      .map((player) => ({
        actorId: player.actorId,
        seatIndex: player.seatIndex,
        coins: player.coins,
        badges: player.badges,
      })),
    winners: outcome.winners,
    reason: outcome.reason,
  };
}

/** Rebuilds the seat-filtered feed from the log. Recorded dice are applied, never re-rolled. */
function feedFrom(log: GameLog, seatIndex: number): SeatFeedEntry[] {
  let cursor = log.initialState;
  const feed: SeatFeedEntry[] = [];
  for (const record of log.actions) {
    const { phase, activeSeatIndex, globalTurnNo } = observe(cursor, seatIndex).public;
    feed.push({
      before: { phase, activeSeatIndex, globalTurnNo },
      record: actionVisibleTo(cursor, record, seatIndex),
    });
    const applied = applyAction(cursor, record.action);
    if (!('accepted' in applied)) throw new Error('Save log does not replay');
    cursor = applied.state;
  }
  return feed;
}

export function createGameStore(): GameStore {
  let session: GameSession | null = null;
  let view: SeatView | null = null;
  let results: GameResults | null = null;
  let opponents: readonly OpponentSettings[] = [];
  let gameToken = '';
  const listeners = new Set<() => void>();

  const publish = (next: GameSession, feed: readonly SeatFeedEntry[]) => {
    session = next;
    view = viewOf(next.state, feed);
    results = resultsOf(next.state);
    for (const listener of listeners) listener();
  };

  const viewOf = (state: GameState, feed: readonly SeatFeedEntry[]): SeatView | null => {
    const seatIndex = humanSeat(state);
    if (seatIndex === undefined) return null;
    return {
      seatIndex,
      observation: observe(state, seatIndex),
      legalActions: legalActions(state, seatIndex),
      catchOdds:
        state.activeSeatIndex === seatIndex &&
        state.phase.kind === 'encounter' &&
        !state.phase.catchRoll
          ? oddsForAllBalls(state, seatIndex)
          : [],
      feed,
      opponents,
    };
  };
  const commit = (next: GameSession, before: GameState, records: readonly ActionRecord[]) => {
    const seatIndex = humanSeat(before);
    let feed = view?.feed ?? [];
    if (seatIndex !== undefined && records.length > 0) {
      const { phase, activeSeatIndex, globalTurnNo } = observe(before, seatIndex).public;
      // Each step applies one record (engine contract: `advanceAutomatically` does not loop).
      feed = [
        ...feed,
        ...records.map((record) => ({
          before: { phase, activeSeatIndex, globalTurnNo },
          record: actionVisibleTo(before, record, seatIndex),
        })),
      ];
    }
    publish(next, feed);
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
      gameToken = crypto.randomUUID();
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
    quoteSale(pokemonInstanceIds: string[]): SaleQuote {
      const { state } = current();
      const seatIndex = humanSeat(state);
      if (seatIndex === undefined) throw new RangeError('No human seat');
      return saleQuote(state, seatIndex, pokemonInstanceIds);
    },
    advance({ human = false } = {}): boolean {
      const { state, log } = current();
      const active = state.config.seats.find((seat) => seat.seatIndex === state.activeSeatIndex);
      if (
        !human &&
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
    async playOpponent(signal: AbortSignal): Promise<boolean> {
      const snapshot = current();
      const token = gameToken;
      const { state } = snapshot;
      const seatIndex = state.activeSeatIndex;
      if (state.config.seats.find((seat) => seat.seatIndex === seatIndex)?.controller !== 'ai') {
        return false;
      }
      const enabledActions = legalActions(state, seatIndex).enabled;
      if (enabledActions.length <= 1) return false;
      const decisionPoint = state.phase.kind;
      if (!['strategy', 'encounter', 'sell', 'shop'].includes(decisionPoint)) {
        throw new Error('Unsupported opponent decision point');
      }
      const settings = opponents.find((opponent) => opponent.seatIndex === seatIndex);
      const response = await fetch('/api/ai/decide', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal,
        body: JSON.stringify({
          gameId: gameToken,
          seatIndex,
          decisionPoint,
          stateRevision: state.stateRevision,
          observation: observe(state, seatIndex),
          enabledActions,
          facts:
            decisionPoint === 'encounter' ? { catchOdds: oddsForAllBalls(state, seatIndex) } : {},
          difficulty: settings?.difficulty ?? 'normal',
          personalityId: settings?.personality ?? 'greedy',
          turnKey: `${state.globalTurnNo}:${seatIndex}`,
        }),
      });
      if (!response.ok) throw new Error('Opponent service failed');
      const answer: unknown = await response.json();
      if (signal.aborted || token !== gameToken || session !== snapshot) return false;
      if (!answer || typeof answer !== 'object') throw new Error('Invalid opponent answer');
      const actorId = state.players.find((player) => player.seatIndex === seatIndex)!.actorId;
      let result: ApplyActionResult;
      if ('choice' in answer && typeof answer.choice === 'string') {
        const choice = enabledActions.find((entry) => entry.id === answer.choice);
        if (!choice) throw new Error('Opponent chose an unavailable action');
        result = submit({ actorId, kind: choice.kind, payload: choice.payload } as Command);
      } else if (
        decisionPoint === 'sell' &&
        'sellUids' in answer &&
        Array.isArray(answer.sellUids) &&
        answer.sellUids.every((id: unknown) => typeof id === 'string')
      ) {
        result = submit({
          actorId,
          kind: 'sell',
          payload: { pokemonInstanceIds: answer.sellUids },
        });
      } else {
        throw new Error('Invalid opponent answer');
      }
      if ('rejected' in result) throw new Error('Opponent action was rejected');
      return true;
    },
    getOpponents(): readonly OpponentSettings[] {
      return opponents;
    },
    restore(game: GameSession, settings: readonly OpponentSettings[] = []): void {
      opponents = settings;
      gameToken = crypto.randomUUID();
      const seat = humanSeat(game.state);
      publish(game, seat === undefined ? [] : feedFrom(game.log, seat));
    },
    getResults(): GameResults | null {
      return results;
    },
    clear(): void {
      session = null;
      view = null;
      results = null;
      opponents = [];
      gameToken = '';
      for (const listener of listeners) listener();
    },
  };
}

/**
 * Build/dev fixture adapter. Vite runs this in Node; the browser receives only this seat's
 * projection, never fixture snapshots or raw action records. Historical fixture logs are
 * illustrative, so filter their events against the supplied fixture snapshot, not replay().
 */
export function projectBoardFixture(input: unknown): {
  observation: Observation;
  events: EngineEvent[];
} {
  const fixture = fixtureSchema.parse(input);
  return {
    observation: observe(fixture.state, 0),
    events: fixture.log.flatMap((record) => eventsVisibleTo(fixture.state, record.events, 0)),
  };
}
