/**
 * The G2 duel: Hard against Normal on paired held-out seeds (spec §5.6 Difficulty, §8 Simulation:
 * Difficulty, §10 C5 gate G2; plan `g2-plan.json`, report `docs/experiments/g2-hard-vs-normal.md`).
 *
 * Each block is one seed with one focal seat, played twice: the treatment arm seats Hard at the
 * focal seat and Normal at the others, the control arm seats Normal everywhere. Every seat plays
 * Greedy through the Jev orchestrator, so the difficulty is the one difference. Over a seed's
 * blocks Hard sits in every seat. Rows come out one per game; `analyzeG2` turns them into the
 * §8 Difficulty table and the verdict of the rule written down in the plan before the run.
 *
 * Nothing here computes a game number or reads a game's hidden state: a policy gets its own
 * observation, as in `npm run sim`, and the engine alone draws Hard's rollouts from it.
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { PERSONALITIES } from '../../ai/fallback/index.ts';
import type { LegalActions, Observation } from '../../engine/index.ts';
import { analyzePaired, type PairedGameRecord, type PairedReport } from '../analysis/paired.ts';
import { createMetrics } from '../metrics.ts';
import {
  createDuelRun,
  createDuelSeat,
  decisionRates,
  jevBudgetExceeded,
  jevRunMode,
  POLICIES,
  type DecisionRates,
  type DuelRun,
  type JevPolicy,
  type JevRunMode,
  type Policy,
  type PolicyChoice,
  type PolicyFacts,
  type PolicyRng,
} from '../policy.ts';
import { EVAL_SEED_FLOOR, playGame, type InvariantCheck, type SimEngine } from '../runner.ts';
import { replays, sanitizeReason } from './run.ts';

export type G2Arm = 'control' | 'treatment';
export const G2_ARMS: readonly G2Arm[] = ['control', 'treatment'];

const numberList = z.array(z.number());

const planSchema = z.object({
  id: z.string(),
  version: z.number().int(),
  game: z.object({
    lapTarget: z.number().int().positive(),
    maxSteps: z.number().int().positive(),
    seats: z.number().int().min(2),
    classPool: z.array(z.string()),
  }),
  policies: z.object({
    treatment: z.string(),
    control: z.string(),
    background: z.string(),
    personality: z.string(),
  }),
  seeds: z.object({
    seedSet: z.literal('eval'),
    first: z.number().int(),
    count: z.number().int().positive(),
  }),
  seedLedger: z.array(
    z.object({
      id: z.string(),
      first: z.number().int(),
      last: z.number().int(),
      status: z.string(),
    }),
  ),
  power: z.object({
    alpha: z.number(),
    power: z.number(),
    assumedScoreSdPerBlock: z.number().positive(),
    gaps: numberList,
    minimumUsefulGap: z.number().positive(),
    recommendedSeeds: z.number().int().positive(),
  }),
  cost: z.object({
    inputTokensPerRequest: z.number().positive(),
    usdPerMillionInputTokens: z.number().nonnegative(),
    thbPerUsd: z.number().positive(),
    requestsPerGame: z.number().positive().nullable(),
  }),
  rule: z.object({
    integrity: z.object({
      illegalAppliedActionCount: z.literal(0),
      invariantFailures: z.literal(0),
      replayFailures: z.literal(0),
      budgetExceededFallbacks: z.literal(0),
      maxAbortedPairShare: z.number().min(0).max(1),
      everyRowLive: z.boolean(),
    }),
    evidence: z.object({
      intervalConfidence: z.number().gt(0).lt(1),
      lowerBoundAbove: z.number(),
      minPointEstimate: z.number(),
    }),
    latency: z.object({
      decisionP95MsMax: z.number().positive(),
      turnP95MsMax: z.number().positive(),
      hardTimeoutRateExcessMax: z.number().min(0),
    }),
  }),
});

export type G2Plan = z.infer<typeof planSchema>;

export function parseG2Plan(raw: unknown): G2Plan {
  return planSchema.parse(raw);
}

export function planSha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/** The smallest tuning-range seed a smoke run may start from, and the last it may reach. */
export const G2_TUNE_FIRST = 100_000;
export const G2_TUNE_LAST = 199_999;

/**
 * Whether the plan can run: its policies are registered, the class pool is the sim's, the seed
 * block is a whole number of class rotations inside the evaluation set, and the plan's seed range
 * is disjoint from every range in `otherLedgers` (the C5 plan's). Runs no game.
 */
export function validateG2Plan(
  plan: G2Plan,
  classIds: readonly string[],
  otherLedgers: readonly { id: string; first: number; last: number }[] = [],
): string[] {
  const problems: string[] = [];
  const named = [plan.policies.treatment, plan.policies.control, plan.policies.background];
  for (const id of new Set(named)) {
    if (!Object.hasOwn(POLICIES, id)) problems.push(`policy ${id} is not registered`);
  }
  if (plan.policies.personality !== PERSONALITIES.greedy.id) {
    problems.push(
      `personality ${plan.policies.personality} is not the Greedy the Jev policies play`,
    );
  }
  if (plan.game.classPool.join() !== classIds.join()) {
    problems.push(`classPool ${plan.game.classPool.join()} differs from the sim's classes`);
  }
  if (plan.game.classPool.length < plan.game.seats) problems.push('fewer classes than seats');
  const { first, count } = plan.seeds;
  const last = first + count - 1;
  if (first < EVAL_SEED_FLOOR)
    problems.push(`seeds start below the evaluation floor ${EVAL_SEED_FLOOR}`);
  if (first % classIds.length !== 0)
    problems.push(`first seed is not a multiple of ${classIds.length}`);
  if (count % classIds.length !== 0)
    problems.push(`seed count is not a multiple of ${classIds.length}`);
  const own = plan.seedLedger.find((entry) => entry.first === first && entry.last === last);
  if (!own) problems.push(`the seed ledger has no entry for ${first} to ${last}`);
  for (const other of otherLedgers) {
    if (first <= other.last && other.first <= last) {
      problems.push(
        `seeds ${first} to ${last} overlap ${other.id} (${other.first} to ${other.last})`,
      );
    }
  }
  if (plan.power.recommendedSeeds !== count)
    problems.push('recommendedSeeds differs from seeds.count');
  return problems;
}

/** One physical game of the design, fully specified. */
export type G2GamePlan = {
  gameId: string;
  /** Names the matched pair. */
  blockId: string;
  arm: G2Arm;
  seed: number;
  seats: number;
  focalSeat: number;
  lapTarget: number;
  maxSteps: number;
  /** The registered policy that decides each seat. */
  seatPolicies: readonly string[];
  /** Position of the block in the plan, which a shard splits on. */
  blockIndex: number;
};

export type G2PlanFilter = {
  /** Moves the seeds to another first seed, for smoke runs in the tuning range. */
  seedBase?: number;
  /** Plays the first `seeds` seeds only: a prefix, chosen before the run. */
  seeds?: number;
  /** Plays the blocks whose index is `index` modulo `count`; both arms of a block stay together. */
  shard?: { index: number; count: number };
};

export function blockIdOf(seats: number, seed: number, focalSeat: number): string {
  return `g2/${seats}p/s${seed}/f${focalSeat}`;
}

/** The games a filter selects, in block order with control before treatment. */
export function planG2Games(plan: G2Plan, filter: G2PlanFilter = {}): G2GamePlan[] {
  const first = filter.seedBase ?? plan.seeds.first;
  const count = filter.seeds ?? plan.seeds.count;
  if (!Number.isInteger(count) || count < 1 || count > plan.seeds.count) {
    throw new RangeError(`--seeds must be 1 to ${plan.seeds.count}; got ${count}`);
  }
  if (filter.seedBase !== undefined && filter.seedBase % plan.game.classPool.length !== 0) {
    throw new RangeError(
      `seed base ${filter.seedBase} is not a multiple of ${plan.game.classPool.length}`,
    );
  }
  const { shard } = filter;
  if (shard && !(shard.count >= 1 && shard.index >= 0 && shard.index < shard.count)) {
    throw new RangeError(`shard ${shard.index}/${shard.count} is not valid`);
  }
  const games: G2GamePlan[] = [];
  let blockIndex = 0;
  for (let offset = 0; offset < count; offset++) {
    const seed = first + offset;
    for (let focalSeat = 0; focalSeat < plan.game.seats; focalSeat++, blockIndex++) {
      if (shard && blockIndex % shard.count !== shard.index) continue;
      const blockId = blockIdOf(plan.game.seats, seed, focalSeat);
      for (const arm of G2_ARMS) {
        games.push({
          gameId: `${blockId}/${arm}`,
          blockId,
          arm,
          seed,
          seats: plan.game.seats,
          focalSeat,
          lapTarget: plan.game.lapTarget,
          maxSteps: plan.game.maxSteps,
          seatPolicies: Array.from({ length: plan.game.seats }, (_, seat) =>
            seat === focalSeat
              ? plan.policies[arm === 'treatment' ? 'treatment' : 'control']
              : plan.policies.background,
          ),
          blockIndex,
        });
      }
    }
  }
  return games;
}

export type G2Mode = JevRunMode;

/** Where a game's Jev decisions come from: the environment's (live with a key) or forced offline. */
export type DuelBackend = {
  mode(): G2Mode;
  create(gameId: string, seed: number): DuelRun;
  budgetExceeded(): boolean;
};

/** The backend of a real run: live with the key in the environment, the fake without, off with the kill switch. */
export const envBackend: DuelBackend = {
  mode: () => jevRunMode(),
  create: (gameId, seed) => createDuelRun(gameId, seed),
  budgetExceeded: jevBudgetExceeded,
};

/** Never live, whatever the environment holds: for tests and dry runs. */
export const offlineBackend: DuelBackend = {
  mode: () => jevRunMode(true),
  create: (gameId, seed) => createDuelRun(gameId, seed, true),
  budgetExceeded: () => false,
};

export type G2Difficulty = 'hard' | 'normal';

export type G2SeatStats = {
  seat: number;
  difficulty: G2Difficulty;
  /** `DecisionStats` counts: decisions, requests, invalid_outputs and fallback:<cause>. */
  counts: Record<string, number>;
  /** Wall time of each decision that involved Jev (not an `auto` one), in ms. */
  decisionMs: number[];
  /** Per AI turn, the summed wall time of its Jev decisions, in ms. */
  turnMs: number[];
};

export type G2Usage = {
  /** `usage-log` from the live ledger's lines for this game; `decision-counts` from the policy counts. */
  source: 'usage-log' | 'decision-counts';
  requests: number;
  inputTokens: number | null;
  estimatedRequests: number;
  thb: number | null;
};

export type G2Provenance = {
  mainSha: string;
  engineVersion: string;
  contentVersion: string;
  planSha256: string;
};

export type G2Row = {
  gameId: string;
  blockId: string;
  arm: G2Arm;
  seed: number;
  seats: number;
  focalSeat: number;
  seatClasses: string[];
  seatPolicies: string[];
  seatPersonalities: string[];
  mode: G2Mode;
  /** Hard's rollout limit in ms in this game, or null when the offline client ran them untimed. */
  rolloutMs: number | null;
  finished: boolean;
  abortReason: string | null;
  turns: number;
  steps: number;
  winners: number[];
  finalCoins: number[];
  illegalAppliedActionCount: number;
  invariantFailures: number;
  replayPass: boolean | null;
  failureReasons: string[];
  seatStats: G2SeatStats[];
  usage: G2Usage;
} & G2Provenance;

/** Wraps a seat's Jev policy and times each decision that reached the orchestrator's question path. */
export class TimedJevPolicy implements Policy {
  readonly wantsFacts = true;
  readonly decisionMs: number[] = [];
  readonly #turns = new Map<number, number>();

  constructor(
    private readonly inner: JevPolicy,
    readonly seat: number,
    readonly difficulty: G2Difficulty,
    private readonly clock: () => number = () => performance.now(),
  ) {}

  get personality() {
    return this.inner.personality;
  }

  async decide(
    observation: Observation,
    legalActions: LegalActions,
    rng: PolicyRng,
    facts?: PolicyFacts,
  ): Promise<PolicyChoice> {
    const started = this.clock();
    const choice = await this.inner.decide(observation, legalActions, rng, facts);
    const ms = this.clock() - started;
    // `auto` decisions ask nobody, so they would only pull the percentiles to zero.
    if (this.inner.decisions.at(-1)?.source !== 'auto') {
      this.decisionMs.push(ms);
      const turn = observation.public.globalTurnNo;
      this.#turns.set(turn, (this.#turns.get(turn) ?? 0) + ms);
    }
    return choice;
  }

  counts() {
    return this.inner.counts();
  }

  stats(): G2SeatStats {
    return {
      seat: this.seat,
      difficulty: this.difficulty,
      counts: this.counts(),
      decisionMs: this.decisionMs.map(round1),
      turnMs: [...this.#turns.values()].map(round1),
    };
  }
}

const round1 = (value: number) => Math.round(value * 10) / 10;

/**
 * Plays one planned game and returns its row, aborted or not; a throw is an abort with its reason.
 * Live, Hard's rollouts get the server's 400 ms limit inside the 1,500 ms decision deadline; the
 * offline fake runs them untimed, so a dry run measures their compute and never their cut-off.
 */
export async function playG2Game(
  engine: SimEngine,
  plan: G2GamePlan,
  checkInvariants: InvariantCheck,
  provenance: G2Provenance,
  backend: DuelBackend = envBackend,
): Promise<G2Row> {
  let run: DuelRun | undefined;
  const runFor = (): DuelRun => (run ??= backend.create(plan.gameId, plan.seed));
  const timed: TimedJevPolicy[] = [];
  const personalities: string[] = [];
  const result = await playGame(
    engine,
    { seats: plan.seats, maxSteps: plan.maxSteps, lapTarget: plan.lapTarget },
    plan.seed,
    (seat) => {
      const hard = plan.seatPolicies[seat.seatIndex] === 'jev-hard';
      const policy = new TimedJevPolicy(
        createDuelSeat(runFor(), hard ? 'hard' : 'normal'),
        seat.seatIndex,
        hard ? 'hard' : 'normal',
      );
      personalities[seat.seatIndex] = policy.personality.id;
      timed.push(policy);
      return policy;
    },
    checkInvariants,
    createMetrics(),
  );
  const reasons: string[] = [];
  if (result.abortReason) reasons.push(`aborted: ${sanitizeReason(result.abortReason)}`);
  if (result.illegalApplied > 0) reasons.push(`illegal applied actions: ${result.illegalApplied}`);
  if (result.violations > 0) reasons.push(`invariant failures: ${result.violations}`);
  let replayPass: boolean | null = null;
  if (result.game && result.outcome.finished) {
    replayPass = replays(result.game);
    if (!replayPass) reasons.push('replay does not reproduce the saved state hash');
  }
  const seatStats = timed.map((policy) => policy.stats());
  const countedRequests = seatStats.reduce((sum, seat) => sum + (seat.counts.requests ?? 0), 0);
  const live = run?.usage() ?? null;
  const usage: G2Usage = live
    ? {
        source: 'usage-log',
        requests: live.requests,
        inputTokens: live.inputTokens,
        estimatedRequests: live.estimatedRequests,
        thb: round6(live.thb),
      }
    : {
        source: 'decision-counts',
        requests: countedRequests,
        inputTokens: null,
        estimatedRequests: 0,
        thb: null,
      };
  return {
    gameId: plan.gameId,
    blockId: plan.blockId,
    arm: plan.arm,
    seed: plan.seed,
    seats: plan.seats,
    focalSeat: plan.focalSeat,
    seatClasses: result.seats.map((seat) => seat.classId),
    seatPolicies: [...plan.seatPolicies],
    seatPersonalities: personalities,
    mode: run?.mode ?? backend.mode(),
    rolloutMs: run?.rolloutMs ?? null,
    finished: result.outcome.finished,
    abortReason: result.abortReason === null ? null : sanitizeReason(result.abortReason),
    turns: result.turns,
    steps: result.game?.records.length ?? 0,
    winners: result.outcome.finished ? result.outcome.winnerSeats : [],
    finalCoins: result.finalCoins,
    illegalAppliedActionCount: result.illegalApplied,
    invariantFailures: result.violations,
    replayPass,
    failureReasons: reasons,
    seatStats,
    usage,
    ...provenance,
  };
}

const round6 = (value: number) => Math.round(value * 1e6) / 1e6;

/** A row as the paired analysis takes it; the focal seat's policy label names the arm's difficulty. */
export function toG2PairedRecord(row: G2Row): PairedGameRecord {
  return {
    blockId: row.blockId,
    arm: row.arm,
    policy: row.seatPolicies[row.focalSeat]!,
    seedSet: row.seed >= EVAL_SEED_FLOOR ? 'eval' : 'tune',
    seed: row.seed,
    seats: row.seats,
    focalSeat: row.focalSeat,
    classBySeat: row.seatClasses,
    personalityBySeat: row.seatPersonalities,
    status: row.finished ? 'completed' : 'aborted',
    winnerSeats: row.winners,
    finalCoins: row.finalCoins,
    diagnostics: {
      steps: row.steps,
      abortReason: row.abortReason,
      invariantFailures: row.invariantFailures,
    },
  };
}

/** Parses a rows file: one JSON row per line. A cut-off last line (an interrupted write) is skipped. */
export function parseG2Rows(text: string): { rows: G2Row[]; skipped: number } {
  const rows: G2Row[] = [];
  let skipped = 0;
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    try {
      const row = JSON.parse(line) as G2Row;
      if (typeof row.gameId === 'string' && typeof row.arm === 'string') rows.push(row);
      else skipped++;
    } catch {
      skipped++;
    }
  }
  return { rows, skipped };
}

// ---------------------------------------------------------------- statistics

/** Nearest-rank percentile of `values`, as `ai/jev/usage-report.ts` takes it; `null` for none. */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)]!;
}

/** The standard normal CDF (Abramowitz and Stegun 7.1.26, error under 1.5e-7). */
export function normalCdf(z: number): number {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const poly =
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t;
  const erf = 1 - poly * Math.exp(-x * x);
  return z >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
}

const Z_ALPHA_2 = 1.959964;
const Z_POWER_80 = 0.841621;

/** Blocks for a two-sided 5% test at 80% power to detect a score gap `gap`, given the per-block SD. */
export function requiredBlocks(gap: number, sd: number): number {
  return Math.ceil((((Z_ALPHA_2 + Z_POWER_80) * sd) / gap) ** 2);
}

/** Power of that test with `blocks` blocks at a true score gap `gap`. */
export function powerAt(blocks: number, gap: number, sd: number): number {
  return normalCdf((gap * Math.sqrt(blocks)) / sd - Z_ALPHA_2);
}

export type PowerRow = {
  gap: number;
  blocks: number;
  seeds: number;
  games: number;
  powerAtRecommended: number;
};

/** The plan's power table: for each assumed gap, the blocks, seeds and games needed and the power at the plan's n. */
export function powerTable(plan: G2Plan): PowerRow[] {
  const sd = plan.power.assumedScoreSdPerBlock;
  const perSeed = plan.game.seats;
  const rotation = plan.game.classPool.length;
  const plannedBlocks = plan.seeds.count * perSeed;
  return plan.power.gaps.map((gap) => {
    const blocks = requiredBlocks(gap, sd);
    // Whole class rotations of seeds, so every class takes every seat equally often.
    const seeds = Math.ceil(blocks / perSeed / rotation) * rotation;
    return {
      gap,
      blocks,
      seeds,
      games: seeds * perSeed * G2_ARMS.length,
      powerAtRecommended: powerAt(plannedBlocks, gap, sd),
    };
  });
}

/** Estimated THB for `requests` Jev requests at the plan's tokens per request and the spend price. */
export function estimateThb(plan: G2Plan, requests: number): number {
  const { inputTokensPerRequest, usdPerMillionInputTokens, thbPerUsd } = plan.cost;
  return (requests * inputTokensPerRequest * usdPerMillionInputTokens * thbPerUsd) / 1_000_000;
}

// ------------------------------------------------------------------ analysis

export type Spread = { n: number; p50: number | null; p95: number | null; max: number | null };

const spread = (values: readonly number[]): Spread => ({
  n: values.length,
  p50: percentile(values, 0.5),
  p95: percentile(values, 0.95),
  max: values.length === 0 ? null : Math.max(...values),
});

export type DifficultyStats = {
  /** Seats of this difficulty over every game of the rows. */
  seatGames: number;
  rates: DecisionRates;
  /** Fallback share of decisions caused by a timeout. */
  timeoutRate: number;
  decisionMs: Spread;
  turnMs: Spread;
};

export type Check = { id: string; pass: boolean; detail: string };

export type G2Verdict = {
  status: 'keep-3-levels' | 'ship-2-levels' | 'no-verdict';
  /** One plain sentence for the report. */
  statement: string;
  checks: Check[];
  reasons: string[];
};

export type G2Report = {
  planId: string;
  planSha256: string;
  /** `live`, or why the rows are not evidence. */
  evidence:
    | 'live'
    | 'not-evidence: fake-client'
    | 'not-evidence: Jev disabled'
    | 'not-evidence: mixed modes'
    | 'none';
  modes: Record<string, number>;
  seedSet: 'tune' | 'eval' | null;
  plannedBlocks: number;
  rowsRead: number;
  counts: PairedReport['counts'];
  /** Hard's treatment-arm record against Normal, with the control arm's Normal beside it. */
  duel: {
    n: number;
    hard: { wins: number; ties: number; losses: number; score: number };
    normal: { wins: number; ties: number; losses: number; score: number };
    scoreDifference: { mean: number; lo: number | null; hi: number | null };
    winDifference: { mean: number; lo: number | null; hi: number | null };
    effectSize: number | null;
    byFocalSeat: Record<
      string,
      { n: number; scoreMean: number; lo: number | null; hi: number | null }
    >;
  } | null;
  difficulty: Record<G2Difficulty, DifficultyStats>;
  usage: {
    games: number;
    requests: number;
    requestsPerGame: number | null;
    inputTokens: number | null;
    thb: number | null;
    thbPerGame: number | null;
    thbBasis: 'usage-log' | 'estimate at the plan tokens per request';
  };
  integrity: {
    illegalAppliedActionCount: number;
    invariantFailures: number;
    replayFailures: number;
    budgetExceededFallbacks: number;
    abortedPairs: number;
    missingBlocks: number;
  };
  verdict: G2Verdict;
  limitations: string[];
};

export type AnalyzeOptions = {
  /** Blocks the run was planned to play; the verdict needs every one. */
  plannedBlocks: number;
  analysisSeed?: number;
  resamples?: number;
};

const LIMITATIONS = [
  'Greedy on every seat through the Jev orchestrator; the verdict is about Hard against Normal at this personality, not every personality.',
  'Two seats. A table of three or four seats is not tested.',
  'The sim sends no Sell Phase question (no Sell facts yet), so Sell decisions use the fallback on both difficulties.',
  'Latency is wall time of Jev decisions on the machine that ran the games; read it with that machine and its load in mind.',
  'Hard and Normal share one Jev model and one orchestrator per game; Normal at the other seat is not a different engine.',
];

/** Turns rows into the §8 Difficulty table and the verdict of the plan's rule. */
export function analyzeG2(rows: readonly G2Row[], plan: G2Plan, options: AnalyzeOptions): G2Report {
  const modes: Record<string, number> = {};
  for (const row of rows) modes[row.mode] = (modes[row.mode] ?? 0) + 1;
  const modeKeys = Object.keys(modes);
  const evidence: G2Report['evidence'] =
    modeKeys.length === 0
      ? 'none'
      : modeKeys.length > 1
        ? 'not-evidence: mixed modes'
        : modeKeys[0] === 'live'
          ? 'live'
          : modeKeys[0] === 'fake'
            ? 'not-evidence: fake-client'
            : 'not-evidence: Jev disabled';

  const paired = analyzePaired(rows.map(toG2PairedRecord), {
    confidence: plan.rule.evidence.intervalConfidence,
    ...(options.analysisSeed !== undefined && { analysisSeed: options.analysisSeed }),
    ...(options.resamples !== undefined && { resamples: options.resamples }),
  });
  const comparison = paired.comparisons.find(
    (entry) =>
      entry.treatmentPolicy === plan.policies.treatment &&
      entry.controlPolicy === plan.policies.control,
  );
  const pooled = comparison?.pooledAcrossSeatCounts;
  const duel: G2Report['duel'] =
    comparison && pooled && pooled.n > 0
      ? {
          n: pooled.n,
          hard: armLine(pooled.arms.treatment),
          normal: armLine(pooled.arms.control),
          scoreDifference: pooled.differences.score,
          winDifference: pooled.differences.win,
          effectSize: pooled.effectSize.score,
          byFocalSeat: Object.fromEntries(
            Object.entries(
              comparison.bySeatCount[String(plan.game.seats)]?.strata.focalSeat ?? {},
            ).map(([seat, result]) => [
              seat,
              {
                n: result.n,
                scoreMean: result.differences.score.mean,
                lo: result.differences.score.lo,
                hi: result.differences.score.hi,
              },
            ]),
          ),
        }
      : null;

  const difficulty = (which: G2Difficulty): DifficultyStats => {
    const seats = rows.flatMap((row) =>
      row.seatStats.filter((stats) => stats.difficulty === which),
    );
    const counts: Record<string, number> = {};
    for (const seat of seats) {
      for (const [key, n] of Object.entries(seat.counts)) counts[key] = (counts[key] ?? 0) + n;
    }
    const rates = decisionRates(counts);
    return {
      seatGames: seats.length,
      rates,
      timeoutRate: rates.fallbackRate.byCause.timeout ?? 0,
      decisionMs: spread(seats.flatMap((seat) => seat.decisionMs)),
      turnMs: spread(seats.flatMap((seat) => seat.turnMs)),
    };
  };
  const stats = { hard: difficulty('hard'), normal: difficulty('normal') };

  const requests = rows.reduce((sum, row) => sum + row.usage.requests, 0);
  const measured = rows.length > 0 && rows.every((row) => row.usage.thb !== null);
  const thb =
    rows.length === 0
      ? null
      : measured
        ? rows.reduce((sum, row) => sum + (row.usage.thb ?? 0), 0)
        : estimateThb(plan, requests);
  const usage: G2Report['usage'] = {
    games: rows.length,
    requests,
    requestsPerGame: rows.length === 0 ? null : requests / rows.length,
    inputTokens: measured ? rows.reduce((sum, row) => sum + (row.usage.inputTokens ?? 0), 0) : null,
    thb,
    thbPerGame: thb === null ? null : thb / rows.length,
    thbBasis: measured ? 'usage-log' : 'estimate at the plan tokens per request',
  };

  const integrity = {
    illegalAppliedActionCount: rows.reduce((sum, row) => sum + row.illegalAppliedActionCount, 0),
    invariantFailures: rows.reduce((sum, row) => sum + row.invariantFailures, 0),
    replayFailures: rows.filter((row) => row.replayPass === false).length,
    budgetExceededFallbacks: rows.reduce(
      (sum, row) =>
        sum +
        row.seatStats.reduce((s, seat) => s + (seat.counts['fallback:budget_exceeded'] ?? 0), 0),
      0,
    ),
    abortedPairs: paired.counts.abortedPairs,
    missingBlocks: Math.max(
      0,
      options.plannedBlocks -
        (paired.counts.completePairs + paired.counts.abortedPairs + paired.counts.invariantPairs),
    ),
  };

  const verdict = decideVerdict(plan, {
    evidence,
    plannedBlocks: options.plannedBlocks,
    counts: paired.counts,
    duel,
    stats,
    integrity,
  });
  return {
    planId: plan.id,
    planSha256: rows[0]?.planSha256 ?? '',
    evidence,
    modes,
    seedSet: paired.seedSet,
    plannedBlocks: options.plannedBlocks,
    rowsRead: rows.length,
    counts: paired.counts,
    duel,
    difficulty: stats,
    usage,
    integrity,
    verdict,
    limitations: [...LIMITATIONS],
  };
}

function armLine(arm: { wins: number; ties: number; losses: number; score: number }) {
  return { wins: arm.wins, ties: arm.ties, losses: arm.losses, score: arm.score };
}

type VerdictInput = {
  evidence: G2Report['evidence'];
  plannedBlocks: number;
  counts: PairedReport['counts'];
  duel: G2Report['duel'];
  stats: Record<G2Difficulty, DifficultyStats>;
  integrity: G2Report['integrity'];
};

/**
 * The rule of `g2-plan.json`, in code. Keep three levels only when integrity, evidence and latency
 * all hold; ship two when integrity holds and evidence or latency fails; no verdict otherwise.
 */
export function decideVerdict(plan: G2Plan, input: VerdictInput): G2Verdict {
  const { rule } = plan;
  const { counts, duel, stats, integrity } = input;
  const integrityChecks: Check[] = [
    {
      id: 'live',
      pass: input.evidence === 'live' || !rule.integrity.everyRowLive,
      detail:
        input.evidence === 'live'
          ? 'every row is from the real service'
          : `rows are ${input.evidence}`,
    },
    {
      id: 'complete',
      pass: integrity.missingBlocks === 0,
      detail: `${integrity.missingBlocks} of ${input.plannedBlocks} planned blocks lack a pair of rows`,
    },
    {
      id: 'illegalAppliedActionCount',
      pass: integrity.illegalAppliedActionCount === 0,
      detail: `${integrity.illegalAppliedActionCount} (must be 0)`,
    },
    {
      id: 'invariantFailures',
      pass: integrity.invariantFailures === 0,
      detail: `${integrity.invariantFailures} (must be 0)`,
    },
    {
      id: 'replay',
      pass: integrity.replayFailures === 0,
      detail: `${integrity.replayFailures} games whose replay differs (must be 0)`,
    },
    {
      id: 'spend',
      pass: integrity.budgetExceededFallbacks === 0,
      detail: `${integrity.budgetExceededFallbacks} decisions fell back on a spent budget (must be 0)`,
    },
    {
      id: 'aborts',
      pass:
        input.plannedBlocks > 0 &&
        counts.abortedPairs / input.plannedBlocks <= rule.integrity.maxAbortedPairShare,
      detail: `${counts.abortedPairs} aborted pairs, at most ${rule.integrity.maxAbortedPairShare * 100}% of planned blocks`,
    },
  ];
  const failedIntegrity = integrityChecks.filter((check) => !check.pass);
  if (failedIntegrity.length > 0 || duel === null) {
    const reasons = failedIntegrity.map((check) => `${check.id}: ${check.detail}`);
    if (duel === null) reasons.push('no scored pair');
    return {
      status: 'no-verdict',
      statement:
        'No G2 verdict: ' +
        reasons.join('; ') +
        '. A run that fails an integrity check is fixed and played again on fresh seeds; it is never read as G2.',
      checks: integrityChecks,
      reasons,
    };
  }

  const { lowerBoundAbove, minPointEstimate } = rule.evidence;
  const diff = duel.scoreDifference;
  const evidenceChecks: Check[] = [
    {
      id: 'evidence-interval',
      pass: diff.lo !== null && diff.lo > lowerBoundAbove,
      detail: `95% interval of the score difference ${fmt(diff.lo)} to ${fmt(diff.hi)}; its lower bound must be above ${lowerBoundAbove}`,
    },
    {
      id: 'evidence-size',
      pass: diff.mean >= minPointEstimate,
      detail: `score difference ${fmt(diff.mean)}; it must be at least ${minPointEstimate}`,
    },
  ];
  const latency = rule.latency;
  const hard = stats.hard;
  const excess = hard.timeoutRate - stats.normal.timeoutRate;
  const latencyChecks: Check[] = [
    {
      id: 'latency-decision-p95',
      pass: hard.decisionMs.p95 !== null && hard.decisionMs.p95 <= latency.decisionP95MsMax,
      detail: `Hard decision p95 ${ms(hard.decisionMs.p95)}; at most ${latency.decisionP95MsMax} ms`,
    },
    {
      id: 'latency-turn-p95',
      pass: hard.turnMs.p95 !== null && hard.turnMs.p95 <= latency.turnP95MsMax,
      detail: `Hard AI turn p95 ${ms(hard.turnMs.p95)}; at most ${latency.turnP95MsMax} ms`,
    },
    {
      id: 'latency-timeouts',
      pass: excess <= latency.hardTimeoutRateExcessMax,
      detail: `Hard timeout fallbacks ${fmt(hard.timeoutRate)} against Normal ${fmt(stats.normal.timeoutRate)} (excess ${fmt(excess)}); at most ${latency.hardTimeoutRateExcessMax}`,
    },
  ];
  const checks = [...integrityChecks, ...evidenceChecks, ...latencyChecks];
  const failed = [...evidenceChecks, ...latencyChecks].filter((check) => !check.pass);
  if (failed.length === 0) {
    return {
      status: 'keep-3-levels',
      statement:
        'Keep three levels: Hard beats Normal with evidence and decides within the latency budget.',
      checks,
      reasons: [],
    };
  }
  const reasons = failed.map((check) => `${check.id}: ${check.detail}`);
  const evidenceFailed = evidenceChecks.some((check) => !check.pass);
  const latencyFailed = latencyChecks.some((check) => !check.pass);
  const why = [
    evidenceFailed
      ? 'Hard is not shown to beat Normal (not enough evidence at this n, or no gain)'
      : '',
    latencyFailed ? 'Hard is outside the latency budget' : '',
  ]
    .filter(Boolean)
    .join(' and ');
  return {
    status: 'ship-2-levels',
    statement: `Ship two levels, Easy and Normal, and cut Hard: ${why}.`,
    checks,
    reasons,
  };
}

const fmt = (value: number | null) => (value === null ? 'n/a' : value.toFixed(3));
const ms = (value: number | null) => (value === null ? 'n/a' : `${Math.round(value)} ms`);

/** The report as plain markdown lines, headed by what the rows are evidence of. */
export function formatG2Report(report: G2Report): string[] {
  const lines: string[] = [];
  const out = (line = '') => lines.push(line);
  out(`## G2 analysis: ${report.planId}`);
  out();
  out(
    report.evidence === 'live'
      ? `Source: live Jev rows (${report.rowsRead} games), seed set ${report.seedSet ?? 'n/a'}.`
      : `**Source: ${report.evidence}. This output proves the plumbing only. It is not evidence about Hard or Normal, and it carries no verdict.**`,
  );
  out();
  out(`**Verdict: ${report.verdict.status}.** ${report.verdict.statement}`);
  out();
  out('| Check | Pass | Detail |');
  out('|---|---|---|');
  for (const check of report.verdict.checks) {
    out(`| ${check.id} | ${check.pass ? 'yes' : 'NO'} | ${check.detail} |`);
  }
  out();
  out(
    `Blocks: ${report.counts.completePairs} scored of ${report.plannedBlocks} planned; ${report.counts.missingPairs} missing, ${report.counts.abortedPairs} aborted, ${report.counts.invariantPairs} with an invariant failure.`,
  );
  out();
  if (report.duel) {
    const { duel } = report;
    out('### Win, tie and loss (score = 1/k per co-winner)');
    out();
    out('| Arm | n | Wins | Ties | Losses | Score |');
    out('|---|---|---|---|---|---|');
    out(
      `| Hard (treatment, vs Normal) | ${duel.n} | ${duel.hard.wins} | ${duel.hard.ties} | ${duel.hard.losses} | ${fmt(duel.hard.score)} |`,
    );
    out(
      `| Normal (control, vs Normal) | ${duel.n} | ${duel.normal.wins} | ${duel.normal.ties} | ${duel.normal.losses} | ${fmt(duel.normal.score)} |`,
    );
    out();
    out('| Paired effect, Hard minus Normal | Mean | 95% interval |');
    out('|---|---|---|');
    out(
      `| Score | ${fmt(duel.scoreDifference.mean)} | ${fmt(duel.scoreDifference.lo)} to ${fmt(duel.scoreDifference.hi)} |`,
    );
    out(
      `| Sole-win rate | ${fmt(duel.winDifference.mean)} | ${fmt(duel.winDifference.lo)} to ${fmt(duel.winDifference.hi)} |`,
    );
    out(`| Standardized score effect (paired d) | ${fmt(duel.effectSize)} | |`);
    out();
    out('| Focal seat | n | Score difference | 95% interval |');
    out('|---|---|---|---|');
    for (const [seat, result] of Object.entries(duel.byFocalSeat)) {
      out(
        `| ${seat} | ${result.n} | ${fmt(result.scoreMean)} | ${fmt(result.lo)} to ${fmt(result.hi)} |`,
      );
    }
    out();
  }
  out('### Decision latency and fallbacks by difficulty');
  out();
  out(
    `Decisions are those that involved Jev (not \`auto\`). Hard's rollout limit is ${report.evidence === 'live' ? '400 ms inside the 1,500 ms deadline' : 'not applied offline (untimed rollouts)'}.`,
  );
  out();
  out(
    '| Difficulty | Decisions | Requests | p50 / p95 / max decision | p50 / p95 AI turn | Fallback rate | Invalid-output rate |',
  );
  out('|---|---|---|---|---|---|---|');
  for (const which of ['hard', 'normal'] as const) {
    const s = report.difficulty[which];
    out(
      `| ${which} | ${s.rates.decisions} | ${s.rates.requests} | ${ms(s.decisionMs.p50)} / ${ms(s.decisionMs.p95)} / ${ms(s.decisionMs.max)} | ${ms(s.turnMs.p50)} / ${ms(s.turnMs.p95)} | ${fmt(s.rates.fallbackRate.total)} | ${fmt(s.rates.invalidOutputRate)} |`,
    );
  }
  out();
  out("Fallback rate by cause (share of that difficulty's decisions):");
  out();
  const causes = [
    ...new Set([
      ...Object.keys(report.difficulty.hard.rates.fallbackRate.byCause),
      ...Object.keys(report.difficulty.normal.rates.fallbackRate.byCause),
    ]),
  ].sort();
  out('| Cause | Hard | Normal |');
  out('|---|---|---|');
  for (const cause of causes) {
    out(
      `| ${cause} | ${fmt(report.difficulty.hard.rates.fallbackRate.byCause[cause] ?? 0)} | ${fmt(report.difficulty.normal.rates.fallbackRate.byCause[cause] ?? 0)} |`,
    );
  }
  if (causes.length === 0) out('| none | 0.000 | 0.000 |');
  out();
  out('### Jev requests and cost');
  out();
  const u = report.usage;
  out(
    `${u.games} games, ${u.requests} Jev requests (${u.requestsPerGame === null ? 'n/a' : u.requestsPerGame.toFixed(1)} per game), ` +
      `${u.thb === null ? 'n/a' : `THB ${u.thb.toFixed(4)}`} (${u.thbBasis}; ${u.thbPerGame === null ? 'n/a' : `THB ${u.thbPerGame.toFixed(5)} per game`}).`,
  );
  out();
  out('### Integrity');
  out();
  out(
    `illegalAppliedActionCount ${report.integrity.illegalAppliedActionCount}, invariant failures ${report.integrity.invariantFailures}, replay failures ${report.integrity.replayFailures}, spent-budget fallbacks ${report.integrity.budgetExceededFallbacks}.`,
  );
  out();
  out('### Limitations');
  out();
  for (const item of report.limitations) out(`- ${item}`);
  return lines;
}
