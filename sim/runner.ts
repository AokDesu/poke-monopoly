import {
  GAME_PRESETS,
  type Action,
  type ActionRecord,
  type ApplyActionResult,
  type EngineEvent,
  type GameState,
  type LegalAction,
  type LegalActions,
  type Observation,
} from '../engine/index.ts';
import {
  createMetrics,
  emptyMetricsSummary,
  round2,
  type MetricsCollector,
  type MetricsSummary,
} from './metrics.ts';
import { createPolicyRng, POLICIES, type Policy } from './policy.ts';

export type SeatSetup = { seatIndex: number; actorId: string; classId: string };
export type GameSetup = { seed: number; seats: SeatSetup[]; lapTarget: number };
export type GameOutcome = { finished: false } | { finished: true; winnerSeats: number[] };

/** The engine seam the runner drives; the real engine and test fakes both implement it. */
export type SimEngine = {
  /** Classes the runner rotates across seats; a game never repeats a class. */
  classIds: readonly string[];
  createGame(setup: GameSetup): GameState;
  observe(state: GameState, seatIndex: number): Observation;
  legalActions(state: GameState, seatIndex: number): LegalActions;
  applyAction(state: GameState, action: unknown): ApplyActionResult;
  advanceAutomatically(state: GameState): {
    state: GameState;
    records: ActionRecord[];
    events: EngineEvent[];
  };
  outcome(state: GameState): GameOutcome;
};

/** Called after every applied or rejected action; each returned violation is one failure (§8). */
export type InvariantCheck = (
  before: GameState,
  action: Action,
  result: ApplyActionResult,
) => readonly unknown[];

export const noInvariantCheck: InvariantCheck = () => [];

export type SeedSet = 'tune' | 'eval';

/** §8 Variation: tuning seeds stay below this and evaluation seeds start at it. */
export const EVAL_SEED_FLOOR = 1_000_000;

export type SimOptions = {
  games: number;
  seed: number;
  seats: number;
  maxSteps: number;
  lapTarget: number;
  policy: string;
  seedSet: SeedSet;
};

export const DEFAULT_OPTIONS: Omit<SimOptions, 'games' | 'seed'> = {
  seats: 2,
  maxSteps: 5000,
  lapTarget: GAME_PRESETS.quick.lapTarget,
  policy: 'random',
  seedSet: 'tune',
};

export type SimSummary = {
  games: number;
  seedSet: SeedSet;
  seats: number;
  averageTurns: number;
  /** Mean coins per player at the end of a finished game. */
  averageFinalCoins: number;
  winners: { bySeat: number[]; byClass: Record<string, number> };
  ties: number;
  /** Finished games with co-winners, as a share of finished games (§8 Scoring). */
  tieRate: number;
  /** §8 Variation: games each class played in each seat, indexed by seat. */
  classInSeat: Record<string, number[]>;
  aborted: number;
  illegalAppliedActionCount: number;
  invariantFailures: number;
} & MetricsSummary;

export type GameFailure = { seed: number; reasons: string[]; reproduce: string };

type GameResult = {
  seats: SeatSetup[];
  outcome: GameOutcome;
  turns: number;
  finalCoins: number[];
  abortReason: string | null;
  illegalApplied: number;
  violations: number;
};

export function runSim(
  engine: SimEngine,
  options: SimOptions,
  policies: Readonly<Record<string, () => Policy>> = POLICIES,
  checkInvariants: InvariantCheck = noInvariantCheck,
): { summary: SimSummary; failures: GameFailure[] } {
  const createPolicy = policies[options.policy];
  if (!createPolicy) throw new RangeError(`Unknown policy: ${options.policy}`);
  const summary = emptySummary(options, engine.classIds);
  summary.games = options.games;
  const failures: GameFailure[] = [];
  let finishedGames = 0;
  let finishedTurns = 0;
  let finalCoins = 0;
  const metrics = createMetrics();
  for (let g = 0; g < options.games; g++) {
    // Game g of seed s uses seed s + g, so `--games 1 --seed <s + g>` replays it alone.
    const seed = options.seed + g;
    const game = playGame(engine, options, seed, createPolicy, checkInvariants, metrics);
    for (const seat of game.seats) summary.classInSeat[seat.classId]![seat.seatIndex]! += 1;
    summary.illegalAppliedActionCount += game.illegalApplied;
    summary.invariantFailures += game.violations;
    if (game.outcome.finished) {
      finishedGames++;
      finishedTurns += game.turns;
      finalCoins += game.finalCoins.reduce((sum, coins) => sum + coins, 0);
      const { winnerSeats } = game.outcome;
      if (winnerSeats.length > 1) summary.ties++;
      for (const seatIndex of winnerSeats) {
        summary.winners.bySeat[seatIndex]! += 1 / winnerSeats.length;
        const classId = game.seats.find((seat) => seat.seatIndex === seatIndex)!.classId;
        summary.winners.byClass[classId]! += 1 / winnerSeats.length;
      }
    } else {
      summary.aborted++;
    }
    const reasons = [
      ...(game.abortReason ? [`aborted: ${game.abortReason}`] : []),
      ...(game.illegalApplied > 0 ? [`illegal applied actions: ${game.illegalApplied}`] : []),
      ...(game.violations > 0 ? [`invariant failures: ${game.violations}`] : []),
    ];
    if (reasons.length > 0)
      failures.push({ seed, reasons, reproduce: reproduceCommand(options, seed) });
  }
  summary.averageTurns = finishedGames === 0 ? 0 : round2(finishedTurns / finishedGames);
  summary.averageFinalCoins =
    finishedGames === 0 ? 0 : round2(finalCoins / (finishedGames * options.seats));
  summary.tieRate = finishedGames === 0 ? 0 : round2(summary.ties / finishedGames);
  summary.winners.bySeat = summary.winners.bySeat.map(round2);
  summary.winners.byClass = Object.fromEntries(
    Object.entries(summary.winners.byClass).map(([classId, wins]) => [classId, round2(wins)]),
  );
  Object.assign(summary, metrics.summary());
  return { summary, failures };
}

function emptySummary(options: SimOptions, classIds: readonly string[]): SimSummary {
  return {
    games: 0,
    seedSet: options.seedSet,
    seats: options.seats,
    averageTurns: 0,
    averageFinalCoins: 0,
    winners: {
      bySeat: Array.from({ length: options.seats }, () => 0),
      byClass: Object.fromEntries(classIds.map((classId) => [classId, 0])),
    },
    ties: 0,
    tieRate: 0,
    classInSeat: Object.fromEntries(
      classIds.map((classId) => [classId, Array.from({ length: options.seats }, () => 0)]),
    ),
    aborted: 0,
    illegalAppliedActionCount: 0,
    invariantFailures: 0,
    ...emptyMetricsSummary(),
  };
}

/** Non-zero exit when an illegal action was applied, an invariant failed or a game aborted. */
export function failed(summary: SimSummary): boolean {
  return (
    summary.illegalAppliedActionCount > 0 || summary.invariantFailures > 0 || summary.aborted > 0
  );
}

/**
 * Throws when any game seed of the run (`seed` to `seed + games - 1`) falls outside its seed set,
 * so a tuning run never touches an evaluation seed and the reverse.
 */
export function checkSeedSet({ seedSet, seed, games }: SimOptions): void {
  const last = seed + games - 1;
  const range = games === 1 ? `seed ${seed}` : `seeds ${seed} to ${last}`;
  if (seedSet === 'tune' && last >= EVAL_SEED_FLOOR) {
    throw new RangeError(
      `--seed-set tune takes only seeds below ${EVAL_SEED_FLOOR}; this run uses ${range}`,
    );
  }
  if (seedSet === 'eval' && seed < EVAL_SEED_FLOOR) {
    throw new RangeError(
      `--seed-set eval takes only seeds from ${EVAL_SEED_FLOOR}; this run uses ${range}`,
    );
  }
}

export function reproduceCommand(options: SimOptions, seed: number): string {
  return [
    'npm run sim --',
    `--games 1 --seed ${seed}`,
    `--seats ${options.seats}`,
    `--max-steps ${options.maxSteps}`,
    `--lap-target ${options.lapTarget}`,
    `--policy ${options.policy}`,
    ...(options.seedSet === 'eval' ? ['--seed-set eval'] : []),
  ].join(' ');
}

/**
 * Rotates classes by game seed: over consecutive seeds every class takes every seat position
 * equally often, and a single re-run gets the same seats as in the full run.
 */
export function seatSetup(classIds: readonly string[], seats: number, seed: number): SeatSetup[] {
  if (classIds.length < seats) {
    throw new RangeError(`${seats} seats need ${seats} distinct classes; got ${classIds.length}`);
  }
  const offset = seed % classIds.length;
  return Array.from({ length: seats }, (_, seatIndex) => ({
    seatIndex,
    actorId: `seat-${seatIndex}`,
    classId: classIds[(offset + seatIndex) % classIds.length]!,
  }));
}

function playGame(
  engine: SimEngine,
  options: SimOptions,
  seed: number,
  createPolicy: () => Policy,
  checkInvariants: InvariantCheck,
  metrics: MetricsCollector,
): GameResult {
  const seats = seatSetup(engine.classIds, options.seats, seed);
  const result: GameResult = {
    seats,
    outcome: { finished: false },
    turns: 0,
    finalCoins: [],
    abortReason: null,
    illegalApplied: 0,
    violations: 0,
  };
  try {
    const deciders = seats.map((seat) => ({
      policy: createPolicy(),
      rng: createPolicyRng(`policy:${seed}:${seat.seatIndex}`),
    }));
    let state = engine.createGame({ seed, seats, lapTarget: options.lapTarget });
    for (let steps = 0; ; steps++) {
      result.outcome = engine.outcome(state);
      result.turns = state.globalTurnNo;
      if (result.outcome.finished) {
        result.finalCoins = state.players.map((player) => player.coins);
        return result;
      }
      if (steps >= options.maxSteps) {
        result.abortReason = `max steps ${options.maxSteps}`;
        return result;
      }
      const automatic = engine.advanceAutomatically(state);
      const record = automatic.records[0];
      if (record) {
        // The contract advances one step per call, so a single record describes it.
        const applied: ApplyActionResult = {
          accepted: true,
          state: automatic.state,
          events: automatic.events,
          record,
        };
        result.violations += checkInvariants(state, record.action, applied).length;
        metrics.step(state, record.action, automatic.state, automatic.events);
        state = automatic.state;
        continue;
      }
      const seatIndex = state.activeSeatIndex;
      const legal = engine.legalActions(state, seatIndex);
      if (legal.enabled.length === 0) {
        result.abortReason = `no enabled action for seat ${seatIndex}`;
        return result;
      }
      const decider = deciders[seatIndex]!;
      const actionId = decider.policy.decide(engine.observe(state, seatIndex), legal, decider.rng);
      const enabled = legal.enabled.find((choice) => choice.id === actionId);
      const choice = enabled ?? legal.disabled.find((choice) => choice.id === actionId);
      if (!choice) continue;
      const actorId = state.config.seats.find((seat) => seat.seatIndex === seatIndex)!.actorId;
      const action = command(state, actorId, choice);
      const applied = engine.applyAction(state, action);
      result.violations += checkInvariants(state, action, applied).length;
      if ('rejected' in applied) continue;
      if (!enabled) result.illegalApplied++;
      metrics.step(state, action, applied.state, applied.events);
      state = applied.state;
    }
  } catch (error) {
    result.abortReason = `error: ${error instanceof Error ? error.message : String(error)}`;
    return result;
  }
}

function command(state: GameState, actorId: string, choice: LegalAction): Action {
  return {
    actorId,
    actionSeq: state.stateRevision + 1,
    stateRevisionBefore: state.stateRevision,
    kind: choice.kind,
    payload: choice.payload,
  } as Action;
}
