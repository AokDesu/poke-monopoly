import type {
  Action,
  ActionRecord,
  ApplyActionResult,
  EngineEvent,
  GameState,
  LegalAction,
  LegalActions,
  Observation,
} from '../engine/index.ts';
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

export type SimOptions = {
  games: number;
  seed: number;
  seats: number;
  maxSteps: number;
  lapTarget: number;
  policy: string;
};

export const DEFAULT_OPTIONS: Omit<SimOptions, 'games' | 'seed'> = {
  seats: 2,
  maxSteps: 5000,
  lapTarget: 2,
  policy: 'random',
};

export type SimSummary = {
  /** True while the engine cannot create or finish a game, so no game was played. */
  rulesPending: boolean;
  games: number;
  seats: number;
  averageTurns: number;
  winners: { bySeat: number[]; byClass: Record<string, number> };
  ties: number;
  aborted: number;
  illegalAppliedActionCount: number;
  invariantFailures: number;
};

export type GameFailure = { seed: number; reasons: string[]; reproduce: string };

type GameResult = {
  seats: SeatSetup[];
  outcome: GameOutcome;
  turns: number;
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
  for (let g = 0; g < options.games; g++) {
    // Game g of seed s uses seed s + g, so `--games 1 --seed <s + g>` replays it alone.
    const seed = options.seed + g;
    const game = playGame(engine, options, seed, createPolicy, checkInvariants);
    summary.illegalAppliedActionCount += game.illegalApplied;
    summary.invariantFailures += game.violations;
    if (game.outcome.finished) {
      finishedGames++;
      finishedTurns += game.turns;
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
  return { summary, failures };
}

/** Until the engine can create and finish games (issues #21, #25), the CLI plays none. */
export function rulesPendingSummary(options: SimOptions): SimSummary {
  return { ...emptySummary(options, []), rulesPending: true };
}

function emptySummary(options: SimOptions, classIds: readonly string[]): SimSummary {
  return {
    rulesPending: false,
    games: 0,
    seats: options.seats,
    averageTurns: 0,
    winners: {
      bySeat: Array.from({ length: options.seats }, () => 0),
      byClass: Object.fromEntries(classIds.map((classId) => [classId, 0])),
    },
    ties: 0,
    aborted: 0,
    illegalAppliedActionCount: 0,
    invariantFailures: 0,
  };
}

/** Non-zero exit when an illegal action was applied, an invariant failed or a game aborted. */
export function failed(summary: SimSummary): boolean {
  return (
    summary.illegalAppliedActionCount > 0 || summary.invariantFailures > 0 || summary.aborted > 0
  );
}

export function reproduceCommand(options: SimOptions, seed: number): string {
  return [
    'npm run sim --',
    `--games 1 --seed ${seed}`,
    `--seats ${options.seats}`,
    `--max-steps ${options.maxSteps}`,
    `--lap-target ${options.lapTarget}`,
    `--policy ${options.policy}`,
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
): GameResult {
  const seats = seatSetup(engine.classIds, options.seats, seed);
  const deciders = seats.map((seat) => ({
    policy: createPolicy(),
    rng: createPolicyRng(`policy:${seed}:${seat.seatIndex}`),
  }));
  let state = engine.createGame({ seed, seats, lapTarget: options.lapTarget });
  const result: GameResult = {
    seats,
    outcome: { finished: false },
    turns: 0,
    abortReason: null,
    illegalApplied: 0,
    violations: 0,
  };
  for (let steps = 0; ; steps++) {
    result.outcome = engine.outcome(state);
    result.turns = state.globalTurnNo;
    if (result.outcome.finished) return result;
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
    state = applied.state;
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

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
