import fc from 'fast-check';
import {
  createGameLog,
  GAME_PRESETS,
  pendingDecision,
  type Action,
  type ApplyActionResult,
  type GameLog,
  type GameState,
} from '../engine/index.ts';
import { DEFAULT_OPTIONS, seatSetup, type GameSetup, type SimEngine } from './runner.ts';

/**
 * A generated game (spec §8 Tests layer, issue #26): seats, classes and seed fix the setup, and
 * `choices` is a tape of decisions. The n-th player decision takes enabled choice
 * `choices[n] % enabled.length`; past the end of the tape it takes the first enabled choice, so a
 * shrunk tape is a shorter, simpler game and every game still runs to the end.
 */
export type GamePlan = GameSetup & { choices: number[] };

/**
 * Shared by the `*.property.test.ts` files (separate files run in parallel): a fixed seed so a CI
 * failure reproduces locally (fast-check prints it with the shrunk plan) and at least 200 games per
 * property. Issue #26 budgets 30 s per property in CI; the timeout only guards against a hang, well
 * above that, so a loaded developer machine does not fail a passing property.
 */
export const PROPERTY_RUNS = { seed: 26, numRuns: 200 } as const;
export const PROPERTY_TIMEOUT_MS = 120_000;

/**
 * The engine runs any positive Lap target (§1). Most games use 1, the shortest complete game, so
 * replaying 200 logs fits the budget; a quarter use the Quick preset.
 */
const lapTarget = fc.oneof(
  { weight: 3, arbitrary: fc.constant(1) },
  { weight: 1, arbitrary: fc.constant(GAME_PRESETS.quick.lapTarget) },
);

/** 2 to 4 seats with any mix and order of distinct classes, any seed and any decision tape. */
export function gamePlan(
  classIds: readonly string[],
  { social = false }: { social?: boolean } = {},
): fc.Arbitrary<GamePlan> {
  return fc
    .record({
      seed: fc.nat(),
      classes: fc.shuffledSubarray([...classIds], { minLength: 2, maxLength: 4 }),
      lapTarget,
      choices: fc.array(fc.nat(), { maxLength: 160, size: 'max' }),
    })
    .map(({ seed, classes, lapTarget, choices }) => {
      const seats = seatSetup(classes, classes.length, 0);
      const plan: GamePlan = { seed, seats, lapTarget, choices, ...(social && { social }) };
      return Object.defineProperty(plan, fc.toStringMethod, { value: () => describePlan(plan) });
    });
}

function describePlan({ seed, seats, lapTarget, choices, social }: GamePlan): string {
  const classes = seats.map((seat) => seat.classId).join(',');
  return `{ seed: ${seed}, classes: [${classes}], lapTarget: ${lapTarget}, ${social ? 'social: true, ' : ''}choices: [${choices.join(',')}] }`;
}

/** One applied engine step, automatic or chosen. */
export type Step = { before: GameState; action: Action; result: ApplyActionResult };

export type PlayedGame = {
  state: GameState;
  log: GameLog;
  steps: number;
  finished: boolean;
  /** One line per accepted action, for failure reports. */
  trace: string[];
};

export type PlayOptions = {
  maxSteps?: number;
  /** Called before each player decision, with the action the generator is about to submit. */
  beforeDecision?: (state: GameState, action: Action, log: GameLog) => void;
  /** Called after every applied step, automatic or chosen. */
  afterStep?: (step: Step) => void;
  /** Called once with the played game, at the end or at the step limit. */
  afterGame?: (game: PlayedGame) => void;
};

/** Thrown when a property fails; the message carries the action sequence up to the failure. */
class GameFailure extends Error {}

/**
 * Plays a plan through the engine's own pipeline: `advanceAutomatically` for engine rolls and sole
 * choices, otherwise a choice from `legalActions(...).enabled` submitted to `applyAction`. Every
 * accepted record goes into a `createGameLog` command log, as the app saves it (§6.7, §6.8).
 */
export function playGame(engine: SimEngine, plan: GamePlan, options: PlayOptions = {}): PlayedGame {
  const maxSteps = options.maxSteps ?? DEFAULT_OPTIONS.maxSteps;
  let state = engine.createGame(plan);
  const log = createGameLog(state);
  const trace: string[] = [];
  const fail = (message: string): never => {
    throw new GameFailure(failureReport(plan, trace, message));
  };
  let decision = 0;
  let steps = 0;
  for (; steps < maxSteps && !engine.outcome(state).finished; steps++) {
    const automatic = engine.advanceAutomatically(state);
    const record = automatic.records[0];
    if (record) {
      const result: ApplyActionResult = {
        accepted: true,
        state: automatic.state,
        events: automatic.events,
        record,
      };
      log.actions.push(record);
      trace.push(describeAction(record.action, true));
      guard(fail, () => options.afterStep?.({ before: state, action: record.action, result }));
      state = automatic.state;
      continue;
    }
    const seatIndex = pendingDecision(state)?.seatIndex;
    if (seatIndex === undefined) throw new Error('No pending decision');
    const legal = engine.legalActions(state, seatIndex);
    if (legal.enabled.length === 0) fail(`seat ${seatIndex} has no enabled action`);
    const choice = legal.enabled[(plan.choices[decision++] ?? 0) % legal.enabled.length]!;
    const actorId = state.config.seats.find((seat) => seat.seatIndex === seatIndex)!.actorId;
    const action = {
      actorId,
      actionSeq: state.stateRevision + 1,
      stateRevisionBefore: state.stateRevision,
      kind: choice.kind,
      payload: choice.payload,
    } as Action;
    // The generator only ever submits what legalActions offers as enabled (issue #26).
    const offered = engine
      .legalActions(state, seatIndex)
      .enabled.some(
        (entry) => entry.kind === action.kind && sameJson(entry.payload, action.payload),
      );
    if (!offered) fail(`generated ${describeAction(action, false)} is not an enabled legal action`);
    guard(fail, () => options.beforeDecision?.(state, action, log));
    const result = engine.applyAction(state, action);
    if ('rejected' in result) {
      fail(`enabled ${describeAction(action, false)} was rejected: ${result.reason}`);
    } else {
      log.actions.push(result.record);
      trace.push(describeAction(action, false));
    }
    guard(fail, () => options.afterStep?.({ before: state, action, result }));
    state = result.state;
  }
  const game = { state, log, steps, finished: engine.outcome(state).finished, trace };
  guard(fail, () => options.afterGame?.(game));
  return game;
}

/** Runs a property check and reports a thrown failure with the game so far. */
function guard(fail: (message: string) => never, check: () => void): void {
  try {
    check();
  } catch (error) {
    if (error instanceof GameFailure) throw error;
    fail(error instanceof Error ? error.message : String(error));
  }
}

function failureReport(plan: GamePlan, trace: readonly string[], message: string): string {
  return [
    message,
    `plan: ${describePlan(plan)}`,
    `actions (${trace.length} accepted, * = automatic):`,
    ...trace.map((line, index) => `  ${index + 1}. ${line}`),
  ].join('\n');
}

function describeAction(action: Action, auto: boolean): string {
  return `${auto ? '*' : ' '} r${action.stateRevisionBefore} ${action.actorId} ${action.kind} ${JSON.stringify(action.payload)}`;
}

export function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
