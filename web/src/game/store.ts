import {
  actionVisibleTo,
  actionVisibleToSpectator,
  advanceAutomatically,
  applyAction,
  battlePreview,
  challengeOdds,
  createGame,
  createGameConfig,
  createGameLog,
  createRng,
  decisionPoint,
  eventsVisibleTo,
  engineEventSchema,
  aiSpeechEventSchema,
  fixtureSchema,
  GAME_PRESETS,
  legalActions,
  observe,
  observeSpectator,
  oddsForAllBalls,
  pendingDecision,
  saleFacts,
  saleQuote,
  winner,
  type SaleQuote,
  type BallType,
  type BattlePreview,
  type CatchOdds,
  type EngineDecisionPoint,
  type Action,
  type AiSpeechEvent,
  type ActionRecord,
  type ApplyActionResult,
  type Content,
  type EngineEvent,
  type GameConfig,
  type GameLog,
  type GameState,
  type LegalActions,
  type Observation,
  type SpectatorObservation,
  type SeatActionRecord,
  type SeatEvent,
} from '../../../engine/index.ts';
import { ChatReplyError, type ChatReplyRequest, type SavedChatWords } from './chat.ts';
import { reportOutcome, requestOpponent, type AiDecision } from './ai.ts';
import { demoChoiceOf } from './demoChoice.ts';
import type { DifficultyId, GameSetup, PersonalityId, WatchSettings, WatchSetup } from './setup.ts';

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

/** The engine's pre-declaration terms and odds against one opponent. */
export type ChallengeOdds = NonNullable<ReturnType<typeof challengeOdds>> & {
  readonly seatIndex: number;
};

/** One accepted action as the human seat may see it (engine contract: `actionVisibleTo`). */
export interface SeatFeedEntry {
  /**
   * What the seat saw just before the action: the public phase, whose turn it was and every team
   * member listed publicly, so a row can name a Pokémon as it was even after a sale or evolution.
   */
  readonly before: Pick<Observation['public'], 'phase' | 'activeSeatIndex' | 'globalTurnNo'> & {
    readonly pokemon: readonly { readonly instanceId: string; readonly speciesId: string }[];
  };
  readonly record: SeatActionRecord;
  readonly decision?: AiDecision;
  readonly lineContext?: { pokemonSpeciesId?: string; coins?: number; targetSeatIndex?: number };
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
  /**
   * The engine's decision owner and kind, which differ from the active seat during a PvP response,
   * window, reroll or reward (§6.4). Null while the engine owes a die or the game is over.
   */
  readonly decision: { readonly seatIndex: number; readonly point: EngineDecisionPoint } | null;
  /** The pending PvP or Gym battle's engine terms and odds, from this seat's reading (§4.4). */
  readonly battle: BattlePreview | null;
  /** Odds of each challenge this seat could declare now, in Strategy only (§4.4). */
  readonly challenges: readonly ChallengeOdds[];
  readonly feed: readonly SeatFeedEntry[];
  readonly opponents: readonly OpponentSettings[];
}

/**
 * What a watcher with no seat may read: the public view and the feed of records every seat may
 * see (engine contract: spectator projection, issue #169). It names no seat: `seatIndex` is absent.
 */
export interface SpectatorView {
  readonly seatIndex?: undefined;
  readonly observation: SpectatorObservation;
  readonly feed: readonly SeatFeedEntry[];
  readonly opponents: readonly OpponentSettings[];
}

/** Finished standings. Coins, badges and the engine's winner only — never a team size. */
export interface GameResults {
  /** Absent when no seat is human. */
  readonly humanSeat?: number;
  readonly standings: readonly {
    readonly actorId: string;
    readonly seatIndex: number;
    readonly coins: number;
    readonly badges: number;
  }[];
  /** Each seat's public starting setup (spec §4.1: the starting kit is public). */
  readonly seats: readonly {
    readonly seatIndex: number;
    readonly classId: string;
    readonly starterSpeciesId?: string;
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
  /** The watcher's view, or null without a game or when a seat is human. Stable between changes. */
  getSpectatorView(): SpectatorView | null;
  /** Creates the game and its log together (engine contract: `createGameLog(createGame(...))`). */
  start(
    config: GameConfig,
    content: Content,
    opponents?: readonly OpponentSettings[],
    watch?: WatchSettings,
  ): void;
  /** Rejected commands change nothing and notify no one. */
  submit(command: Command): ApplyActionResult;
  /** Submits one of the human seat's enabled legal actions by its ID. */
  choose(choiceId: string): ApplyActionResult;
  /** Read-only engine quote; only this human seat's active Sell selection is accessible. */
  quoteSale(pokemonInstanceIds: string[]): SaleQuote;
  /**
   * Applies one pending result or sole choice. Board play and first-player setup opt human
   * steps in. The engine alone decides what is automatic.
   */
  advance(options?: { human?: boolean }): boolean;
  /** Sends an AI seat's own projection to the server, then validates its answer via applyAction. */
  playOpponent(signal: AbortSignal): Promise<boolean>;
  /**
   * The request that asks the recipient of this turn's topic message for its reply (spec §4.8):
   * the recipient's own observation, which holds the message only because it was addressed to
   * that seat. Null unless the human has sent a message in this Social window.
   */
  chatReplyRequest(): ChatReplyRequest | null;
  /**
   * The rival's own words for a topic message, kept with the game so a reload shows the same line
   * and never asks for a second one (spec §5.7: a generated line is never regenerated). Words only:
   * the engine log, its revision and every seat's view are untouched.
   */
  getChatWords(): readonly SavedChatWords[];
  /** Saves one shown line; false when it does not fit the game. Notifies so the save is rewritten. */
  recordChatWords(words: SavedChatWords): boolean;
  /** Setup saved beside the engine log so a resumed AI decision uses the same personality. */
  getOpponents(): readonly OpponentSettings[];
  /** A watched game's talk and starting-speed settings, kept with the game; absent otherwise. */
  getWatchSettings(): WatchSettings | undefined;
  /** Identifies this game to the speech route; changes when a game starts or is restored. */
  getGameId(): string;
  /**
   * Saves one shown table-talk line as an `ai_speech` dialogue event (spec §5.7). Presentation
   * only: changes no state, revision or view. False when the line does not fit the game.
   */
  recordSpeech(event: AiSpeechEvent): boolean;
  /**
   * Replaces the session with a saved game. Applies nothing: dice stay as logged and the
   * pending decision stays pending (spec §3.1, §6.9). `gameId` is the one saved beside the game,
   * so the server's per-game limits (spec §9) carry on across a reload; without one it is new.
   */
  restore(
    session: GameSession,
    settings?: readonly OpponentSettings[],
    watchSettings?: WatchSettings,
    gameId?: string,
    chatWords?: readonly SavedChatWords[],
  ): void;
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
  // The human seat starts conversations, so the Social window is open in every game it plays (§4.2).
  return createGameConfig({
    seats,
    seed,
    lapTarget: MODES[setup.mode].lapTarget,
    socialWindow: true,
  });
}

export function opponentSettings(setup: GameSetup): OpponentSettings[] {
  return setup.opponents.map(({ personality, difficulty }, index) => ({
    seatIndex: index + 1,
    personality,
    difficulty,
  }));
}

/** Every seat of a watched game is an AI, so no seat is 'human' and seat n is `ais[n]` (spec §3). */
export function configForWatch(setup: WatchSetup, seed: GameConfig['seed']): GameConfig {
  const seats = setup.ais.map((choice, seatIndex) => ({
    actorId: `ai-${seatIndex}`,
    seatIndex,
    classId: choice.classId,
    starterSpeciesId: choice.starterSpeciesId,
    controller: 'ai' as const,
  }));
  return createGameConfig({ seats, seed, lapTarget: MODES[setup.mode].lapTarget });
}

export function watchOpponentSettings(setup: WatchSetup): OpponentSettings[] {
  return setup.ais.map(({ personality, difficulty }, seatIndex) => ({
    seatIndex,
    personality,
    difficulty,
  }));
}

/** The same seats, lap target and settings under a new seed: "Watch again" (spec §3). */
export function rematchConfig(config: GameConfig, seed: GameConfig['seed']): GameConfig {
  return createGameConfig({
    seats: config.seats,
    seed,
    lapTarget: config.lapTarget,
    ...(config.socialWindow !== undefined && { socialWindow: config.socialWindow }),
  });
}

/**
 * Whether saved words belong to this game: a human's message to an AI seat that the engine kept,
 * on the turn it was sent, one short line. Anything else is dropped, never shown.
 */
function fitsGame(words: SavedChatWords, state: GameState): boolean {
  const human = humanSeat(state);
  const rival = state.config.seats.find((seat) => seat.seatIndex === words.toSeatIndex);
  return (
    human !== undefined &&
    words.fromSeatIndex === human &&
    rival?.controller === 'ai' &&
    words.text.length > 0 &&
    words.text.length <= 280 &&
    (observe(state, human).own.chats ?? []).some(
      (message) =>
        message.fromSeatIndex === words.fromSeatIndex &&
        message.toSeatIndex === words.toSeatIndex &&
        message.globalTurnNo === words.globalTurnNo,
    )
  );
}

function humanSeat(state: GameState): number | undefined {
  return state.config.seats.find((seat) => seat.controller === 'human')?.seatIndex;
}

/** The public state this viewer sees: the human seat's, or the spectator's when no seat is human. */
function publicOf(state: GameState, seatIndex: number | undefined) {
  return seatIndex === undefined
    ? observeSpectator(state).public
    : observe(state, seatIndex).public;
}

/** The public state a feed entry keeps as its `before` view. */
function beforeOf(
  game: Pick<Observation['public'], 'phase' | 'activeSeatIndex' | 'globalTurnNo' | 'players'>,
): SeatFeedEntry['before'] {
  const { phase, activeSeatIndex, globalTurnNo, players } = game;
  return {
    phase,
    activeSeatIndex,
    globalTurnNo,
    pokemon: players.flatMap((player) =>
      player.team.map(({ instanceId, speciesId }) => ({ instanceId, speciesId })),
    ),
  };
}

/** One record as this viewer may see it, or null for a chat it was not part of (spec §4.8). */
function recordFor(
  state: GameState,
  record: ActionRecord,
  seatIndex: number | undefined,
  shown: number,
): SeatActionRecord | null {
  return seatIndex === undefined
    ? actionVisibleToSpectator(state, record, shown)
    : actionVisibleTo(state, record, seatIndex, shown);
}

function resultsOf(state: GameState): GameResults | null {
  if (state.phase.kind !== 'finished') return null;
  const outcome = winner(state);
  return {
    ...(humanSeat(state) !== undefined && { humanSeat: humanSeat(state) }),
    standings: [...state.players]
      .sort((a, b) => a.seatIndex - b.seatIndex)
      .map((player) => ({
        actorId: player.actorId,
        seatIndex: player.seatIndex,
        coins: player.coins,
        badges: player.badges,
      })),
    seats: state.config.seats.map(({ seatIndex, classId, starterSpeciesId }) => ({
      seatIndex,
      classId,
      ...(starterSpeciesId !== undefined && { starterSpeciesId }),
    })),
    winners: outcome.winners,
    reason: outcome.reason,
  };
}

/** Rebuilds the seat-filtered feed from the log. Recorded dice are applied, never re-rolled. */
function feedFrom(log: GameLog, seatIndex: number | undefined): SeatFeedEntry[] {
  let cursor = log.initialState;
  const feed: SeatFeedEntry[] = [];
  for (const record of log.actions) {
    const before = beforeOf(publicOf(cursor, seatIndex));
    // A chat between two other seats is absent from this seat's feed, not redacted (spec §4.8).
    const visible = recordFor(cursor, record, seatIndex, feed.length);
    if (visible) feed.push({ before, record: visible });
    const applied = applyAction(cursor, record.action);
    if (!('accepted' in applied)) throw new Error('Save log does not replay');
    cursor = applied.state;
  }
  return feed;
}

/**
 * `demo` says whether demo mode is open right now (issue #220, #247): the store then keeps, beside
 * each AI decision, what the "What Jev chose" panel shows. It is read at each AI decision, so a
 * setting that arrives late (the server's, fetched once the page opens) counts from the next one.
 * It is off by default and never changes an action, a save or a request.
 */
export function createGameStore({ demo = () => false }: { demo?: () => boolean } = {}): GameStore {
  let session: GameSession | null = null;
  let view: SeatView | null = null;
  let spectatorView: SpectatorView | null = null;
  let shownFeed: readonly SeatFeedEntry[] = [];
  let results: GameResults | null = null;
  let opponents: readonly OpponentSettings[] = [];
  let watch: WatchSettings | undefined;
  let chatWords: readonly SavedChatWords[] = [];
  let gameToken = '';
  const listeners = new Set<() => void>();

  const publish = (next: GameSession, feed: readonly SeatFeedEntry[]) => {
    session = next;
    shownFeed = feed;
    view = viewOf(next.state, feed);
    spectatorView =
      humanSeat(next.state) === undefined
        ? { observation: observeSpectator(next.state), feed, opponents }
        : null;
    results = resultsOf(next.state);
    for (const listener of listeners) listener();
  };

  const viewOf = (state: GameState, feed: readonly SeatFeedEntry[]): SeatView | null => {
    const seatIndex = humanSeat(state);
    if (seatIndex === undefined) return null;
    const pending = pendingDecision(state);
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
      decision: pending && { seatIndex: pending.seatIndex, point: decisionPoint(state)! },
      battle:
        state.phase.kind === 'pvp' || state.phase.kind === 'gym'
          ? battlePreview(state, seatIndex)
          : null,
      challenges:
        state.phase.kind === 'strategy' && state.activeSeatIndex === seatIndex
          ? state.players.flatMap((player) => {
              const odds =
                player.seatIndex === seatIndex
                  ? null
                  : challengeOdds(state, seatIndex, player.seatIndex);
              return odds ? [{ ...odds, seatIndex: player.seatIndex }] : [];
            })
          : [],
      feed,
      opponents,
    };
  };
  const commit = (
    next: GameSession,
    before: GameState,
    records: readonly ActionRecord[],
    decision?: AiDecision,
  ) => {
    const seatIndex = humanSeat(before);
    let feed = shownFeed;
    if (records.length > 0) {
      const game = publicOf(before, seatIndex);
      const { activeSeatIndex, players } = game;
      const beforeView = beforeOf(game);
      // Each step applies one record (engine contract: `advanceAutomatically` does not loop).
      let shown = feed.length;
      feed = [
        ...feed,
        ...records.flatMap((record): SeatFeedEntry[] => {
          const visible = recordFor(before, record, seatIndex, shown);
          // A chat between two other seats is absent from this seat's feed (spec §4.8).
          if (!visible) return [];
          shown++;
          const sale = visible.events.find(
            (event) => event.kind === 'coin_transfer' && event.reason === 'pokemon_sale',
          );
          const sold = visible.events.find(
            (event) => event.kind === 'uid_destroyed' && event.reason === 'sold',
          );
          const pokemon =
            sold?.kind === 'uid_destroyed'
              ? players
                  .find((player) => player.seatIndex === activeSeatIndex)
                  ?.team.find((entry) => entry.instanceId === sold.instanceId)
              : undefined;
          return [
            {
              before: beforeView,
              record: visible,
              ...(decision && {
                decision,
                lineContext: {
                  ...(pokemon && { pokemonSpeciesId: pokemon.speciesId }),
                  ...(sale?.kind === 'coin_transfer' && { coins: sale.amount }),
                  ...(visible.action.kind === 'use_item' &&
                    visible.action.payload.targetSeatIndex !== undefined && {
                      targetSeatIndex: visible.action.payload.targetSeatIndex,
                    }),
                },
              }),
            },
          ];
        }),
      ];
    }
    publish(next, feed);
  };
  const current = (): GameSession => {
    if (!session) throw new Error('No game in progress');
    return session;
  };
  const submit = (
    command: Command,
    decision?: AiDecision,
    dialogueEvents: EngineEvent[] = [],
  ): ApplyActionResult => {
    const { state, log } = current();
    // A seat submits the revision it observed; it skips chats it was not part of (spec §4.8).
    const seat = state.players.find((player) => player.actorId === command.actorId);
    const revision = seat
      ? observe(state, seat.seatIndex).public.stateRevision
      : state.stateRevision;
    const result = applyAction(state, {
      ...command,
      actionSeq: revision + 1,
      stateRevisionBefore: revision,
    });
    if ('accepted' in result) {
      commit(
        {
          state: result.state,
          log: {
            ...log,
            actions: [...log.actions, result.record],
            ...(dialogueEvents.length > 0 && {
              dialogueEvents: [...(log.dialogueEvents ?? []), ...dialogueEvents],
            }),
          },
        },
        state,
        [result.record],
        decision,
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
    getSpectatorView(): SpectatorView | null {
      return spectatorView;
    },
    start(
      config: GameConfig,
      content: Content,
      settings: readonly OpponentSettings[] = [],
      watchSettings?: WatchSettings,
    ): void {
      const state = createGame(config, content);
      gameToken = crypto.randomUUID();
      opponents = settings;
      watch = watchSettings;
      chatWords = [];
      shownFeed = [];
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
      const owner = state.config.seats.find(
        (seat) => seat.seatIndex === pendingDecision(state)?.seatIndex,
      );
      if (
        !human &&
        owner?.controller === 'human' &&
        legalActions(state, owner.seatIndex).enabled.length > 0
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
    chatReplyRequest(): ChatReplyRequest | null {
      const { state } = current();
      const seatIndex = humanSeat(state);
      if (seatIndex === undefined || state.phase.kind !== 'social') return null;
      if (state.activeSeatIndex !== seatIndex) return null;
      const message = observe(state, seatIndex).own.chats?.findLast(
        (entry) => entry.fromSeatIndex === seatIndex && entry.globalTurnNo === state.globalTurnNo,
      );
      if (!message) return null;
      const rival = opponents.find((opponent) => opponent.seatIndex === message.toSeatIndex);
      // restore() gives every AI seat settings, so a missing one is a bug to surface, never a Greedy rival.
      if (!rival) {
        throw new ChatReplyError('invalid', `No opponent settings for seat ${message.toSeatIndex}`);
      }
      const observation = observe(state, message.toSeatIndex);
      return {
        gameId: gameToken,
        seatIndex: message.toSeatIndex,
        stateRevision: observation.public.stateRevision,
        observation,
        personalityId: rival.personality,
        turnKey: `${state.globalTurnNo}:${message.toSeatIndex}`,
      };
    },
    async playOpponent(signal: AbortSignal): Promise<boolean> {
      const snapshot = current();
      const token = gameToken;
      const { state } = snapshot;
      const seatIndex = pendingDecision(state)?.seatIndex;
      if (
        seatIndex === undefined ||
        state.config.seats.find((seat) => seat.seatIndex === seatIndex)?.controller !== 'ai'
      ) {
        return false;
      }
      const enabledActions = legalActions(state, seatIndex).enabled;
      if (enabledActions.length <= 1) return false;
      // A promise question (§4.8) is asked of its responder at its own decision point, whatever
      // phase the human's turn is in; the engine's pending record says so, not the phase.
      const promiseQuestion = state.pendingResponse?.kind === 'promise_offer';
      const decisionPoint = promiseQuestion ? 'promise_response' : state.phase.kind;
      if (
        !promiseQuestion &&
        (!['strategy', 'encounter', 'sell', 'shop'].includes(decisionPoint) ||
          (state.phase.kind === 'encounter' && state.phase.catchRoll))
      ) {
        // Temporary #55 boundary: the decision API has no Gym, battle, Ability-window or reroll
        // questions yet (Stream B). Take the engine's first listed choice so play continues.
        const choice = enabledActions[0]!;
        const actorId = state.players.find((player) => player.seatIndex === seatIndex)!.actorId;
        const result = submit({ actorId, kind: choice.kind, payload: choice.payload } as Command, {
          source: 'fallback',
          fallbackReason: 'unsupported_decision_point',
        });
        if ('rejected' in result) throw new Error('Opponent action was rejected');
        return true;
      }
      const settings = opponents.find((opponent) => opponent.seatIndex === seatIndex);
      const observation = observe(state, seatIndex);
      const ids = {
        gameId: gameToken,
        seatIndex,
        decisionPoint,
        stateRevision: observation.public.stateRevision,
        turnKey: `${state.globalTurnNo}:${seatIndex}`,
      };
      // Demo mode shows a rival's private options, so only a game with a human seat to show them
      // to keeps anything: a watched game never does (spec §1, issue #220).
      const viewerSeat = humanSeat(state);
      const keepDemo = demo() && viewerSeat !== undefined;
      const answer = await requestOpponent(
        JSON.stringify({
          ...ids,
          observation,
          enabledActions,
          facts:
            decisionPoint === 'encounter'
              ? { catchOdds: oddsForAllBalls(state, seatIndex) }
              : decisionPoint === 'sell'
                ? { sell: saleFacts(state, seatIndex) }
                : {},
          difficulty: settings?.difficulty ?? 'normal',
          personalityId: settings?.personality ?? 'greedy',
        }),
        signal,
        (pick) => {
          if ('choice' in pick) return enabledActions.some((entry) => entry.id === pick.choice);
          if (decisionPoint !== 'sell' || new Set(pick.sellUids).size !== pick.sellUids.length)
            return false;
          const sellable = enabledActions.flatMap((entry) =>
            entry.kind === 'sell' ? entry.payload.pokemonInstanceIds : [],
          );
          return pick.sellUids.every((uid) => sellable.includes(uid));
        },
        keepDemo,
      ).catch((error: unknown) => {
        if (signal.aborted || token !== gameToken || session?.state !== snapshot.state) return null;
        throw error;
      });
      if (!answer || signal.aborted || token !== gameToken || session?.state !== snapshot.state)
        return false;
      reportOutcome(ids, answer);
      const demoChoice =
        keepDemo && viewerSeat !== undefined
          ? demoChoiceOf({
              answer,
              detail: answer.detail,
              decisionPoint,
              enabledActions,
              observation,
              viewerSeat,
            })
          : undefined;
      const decision: AiDecision = {
        source: answer.source,
        fallbackReason: answer.fallbackReason,
        lineId: answer.lineId,
        ...(demoChoice && { demo: demoChoice }),
      };
      const annotations = engineEventSchema.array().safeParse(answer.dialogueEvents ?? []);
      const dialogueEvents = annotations.success
        ? annotations.data.filter(
            (event) =>
              event.kind === 'line_selected' ||
              (event.kind === 'random_result' && event.purpose.startsWith('line:')),
          )
        : [];
      const actorId = state.players.find((player) => player.seatIndex === seatIndex)!.actorId;
      let result: ApplyActionResult;
      if ('choice' in answer && typeof answer.choice === 'string') {
        const choice = enabledActions.find((entry) => entry.id === answer.choice);
        if (!choice) throw new Error('Opponent chose an unavailable action');
        result = submit(
          { actorId, kind: choice.kind, payload: choice.payload } as Command,
          decision,
          dialogueEvents,
        );
      } else if (
        decisionPoint === 'sell' &&
        'sellUids' in answer &&
        Array.isArray(answer.sellUids) &&
        answer.sellUids.every((id: unknown) => typeof id === 'string')
      ) {
        result = submit(
          {
            actorId,
            kind: 'sell',
            payload: { pokemonInstanceIds: answer.sellUids },
          },
          decision,
          dialogueEvents,
        );
      } else {
        throw new Error('Invalid opponent answer');
      }
      if ('rejected' in result) throw new Error('Opponent action was rejected');
      return true;
    },
    getOpponents(): readonly OpponentSettings[] {
      return opponents;
    },
    getWatchSettings(): WatchSettings | undefined {
      return watch;
    },
    getGameId(): string {
      return gameToken;
    },
    getChatWords(): readonly SavedChatWords[] {
      return chatWords;
    },
    recordChatWords(words: SavedChatWords): boolean {
      const game = session;
      if (!game || !fitsGame(words, game.state)) return false;
      const same = (entry: SavedChatWords) =>
        entry.fromSeatIndex === words.fromSeatIndex &&
        entry.toSeatIndex === words.toSeatIndex &&
        entry.globalTurnNo === words.globalTurnNo;
      chatWords = [...chatWords.filter((entry) => !same(entry)), words];
      for (const listener of listeners) listener();
      return true;
    },
    recordSpeech(event: AiSpeechEvent): boolean {
      const game = session;
      const parsed = aiSpeechEventSchema.safeParse(event);
      if (!game || !parsed.success) return false;
      const seats = game.state.config.seats.map((seat) => seat.seatIndex);
      const { speakerSeatIndex, addressedSeatIndex } = parsed.data;
      if (
        !seats.includes(speakerSeatIndex) ||
        (addressedSeatIndex !== undefined &&
          (!seats.includes(addressedSeatIndex) || addressedSeatIndex === speakerSeatIndex))
      )
        return false;
      // Words are not an action: the state, its revision and the views stay as they are, so a line
      // arriving mid-turn neither restarts a pending step nor discards a pending AI answer.
      session = {
        state: game.state,
        log: { ...game.log, dialogueEvents: [...(game.log.dialogueEvents ?? []), parsed.data] },
      };
      for (const listener of listeners) listener();
      return true;
    },
    restore(
      game: GameSession,
      settings: readonly OpponentSettings[] = [],
      watchSettings?: WatchSettings,
      gameId?: string,
      savedWords: readonly SavedChatWords[] = [],
    ): void {
      // A save that lacks a rival's settings plays it as Greedy on Normal, as the save prompt says.
      opponents = [
        ...settings,
        ...game.state.config.seats
          .filter(
            (seat) =>
              seat.controller === 'ai' &&
              !settings.some((entry) => entry.seatIndex === seat.seatIndex),
          )
          .map((seat): OpponentSettings => ({
            seatIndex: seat.seatIndex,
            personality: 'greedy',
            difficulty: 'normal',
          })),
      ];
      watch = watchSettings;
      // Only words that fit this game: a save from another one cannot lend it a line.
      chatWords = savedWords.filter((entry) => fitsGame(entry, game.state));
      gameToken = gameId ?? crypto.randomUUID();
      publish(game, feedFrom(game.log, humanSeat(game.state)));
    },
    getResults(): GameResults | null {
      return results;
    },
    clear(): void {
      session = null;
      view = null;
      spectatorView = null;
      shownFeed = [];
      results = null;
      opponents = [];
      watch = undefined;
      chatWords = [];
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
  events: SeatEvent[];
} {
  const fixture = fixtureSchema.parse(input);
  return {
    observation: observe(fixture.state, 0),
    events: fixture.log.flatMap((record) => eventsVisibleTo(fixture.state, record.events, 0)),
  };
}

/**
 * Dev gallery adapter (issue #53): a store resting on a fixture snapshot, so a screen can be
 * shown in a state that is hard to reach by playing. Config, content and RNG are normalised to
 * the current engine; every command and quote still runs through `applyAction`. `edit` adjusts
 * the snapshot's data (coins, items, seats) before it is sealed into the log.
 */
export function createFixtureStore(
  input: unknown,
  content: Content,
  edit?: (state: GameState) => void,
): GameStore {
  const { state } = fixtureSchema.parse(input);
  edit?.(state);
  state.config = createGameConfig({
    seats: state.config.seats,
    seed: 3,
    lapTarget: 3,
    ...(state.config.socialWindow === true && { socialWindow: true }),
  });
  state.content = structuredClone(content);
  state.rng = createRng(3);
  const store = createGameStore();
  store.restore({ state, log: createGameLog(state) });
  return store;
}
