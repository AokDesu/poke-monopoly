/**
 * Paired analysis of matched game records (spec §8 Simulation: paired seeds are analysed as pairs;
 * k co-winners score 1/k each; report win/tie/loss, effect size, uncertainty and n; §10 C5).
 *
 * The input is plain, sanitized rows, one per physical game. The module reads no engine state,
 * runs no game and computes no game odds or prices: it only compares recorded outcomes.
 *
 * Unit of analysis: one matched block holds one game per arm (the same seed, seats, classes and
 * personalities), and only that block's focal seat is scored. The other seats of a game are context.
 * Seats of one game are therefore never counted as independent observations: n is complete blocks.
 *
 * Uncertainty: a stratified percentile bootstrap over paired blocks. A resample redraws whole
 * blocks, so both arms of a block stay together and the arm correlation is kept. Blocks are
 * redrawn inside each (seat count, focal seat) cell, so every resample keeps the seat rotation of
 * the original design. The resampling RNG is seeded from `analysisSeed`, so a result is
 * reproducible. A cell with one block contributes no variance, so read intervals next to n.
 */
import { createRng, int, type RngState } from '../../engine/index.ts';
import { EVAL_SEED_FLOOR } from '../runner.ts';

export type PairedArm = 'treatment' | 'control';
export type PairedSeedSet = 'tune' | 'eval';

/** What a policy-only game left behind, without private state. */
export type PairedDiagnostics = {
  steps: number;
  /** Why an aborted game stopped, such as a step limit; `null` for a completed game. */
  abortReason: string | null;
  /** Invariant violations the run recorded for this game. */
  invariantFailures: number;
};

/**
 * One physical game. The two arms of a block carry the same `seed`, `seats`, `focalSeat`,
 * `classBySeat` and `personalityBySeat`; `policy` is the focal seat's policy in this arm.
 */
export type PairedGameRecord = {
  /** Identifies the matched pair. Unique per pair within an analysis. */
  blockId: string;
  arm: PairedArm;
  /** The focal seat's policy label in this arm. */
  policy: string;
  seedSet: PairedSeedSet;
  seed: number;
  seats: number;
  focalSeat: number;
  /** Class ID per seat. */
  classBySeat: readonly string[];
  /** Personality ID per seat; `unassigned` where the sim assigned none. */
  personalityBySeat: readonly string[];
  status: 'completed' | 'aborted';
  /** Co-winners of a completed game (at least one); empty for an aborted game. */
  winnerSeats: readonly number[];
  /** Final coins per seat. */
  finalCoins: readonly number[];
  diagnostics: PairedDiagnostics;
};

export type PairedOptions = {
  /** Seeds the resampling RNG. Default {@link DEFAULT_ANALYSIS_SEED}. */
  analysisSeed?: number;
  /** Bootstrap resamples per estimate. Default 2000. */
  resamples?: number;
  /** Central interval mass, in (0, 1). Default 0.95. */
  confidence?: number;
  /** When set, any record from the other seed set is rejected. */
  seedSet?: PairedSeedSet;
};

export const DEFAULT_ANALYSIS_SEED = 61;
const DEFAULT_RESAMPLES = 2000;
const DEFAULT_CONFIDENCE = 0.95;

export type MetricEstimate = {
  /** Mean over complete blocks of treatment minus control. */
  mean: number;
  /** Percentile interval bounds; `null` below two complete blocks. */
  lo: number | null;
  hi: number | null;
};

export type ArmSummary = {
  games: number;
  /** Focal seat was the only winner. */
  wins: number;
  /** Focal seat shared the win with other seats. */
  ties: number;
  losses: number;
  /** Mean 1/k credit of the focal seat. */
  score: number;
  /** §8 tie rate: completed games with co-winners, as a share of completed games. */
  tieRate: number;
  meanFinalCoins: number;
};

export type StratumResult = {
  /** Complete pairs: both arms present and completed. */
  n: number;
  arms: { treatment: ArmSummary; control: ArmSummary };
  /** Treatment minus control, per block. `win`, `tie` and `loss` are focal-seat indicators. */
  differences: {
    score: MetricEstimate;
    win: MetricEstimate;
    tie: MetricEstimate;
    loss: MetricEstimate;
    coins: MetricEstimate;
  };
  /** Paired standardized effect (mean block difference over its sample SD); `null` if undefined. */
  effectSize: { score: number | null; coins: number | null };
};

export type StratumDimension = 'seats' | 'focalSeat' | 'focalClass' | 'focalPersonality';

export type ComparisonResult = {
  treatmentPolicy: string;
  controlPolicy: string;
  counts: { blocks: number; completePairs: number; abortedPairs: number };
  overall: StratumResult;
  strata: Record<StratumDimension, Record<string, StratumResult>>;
};

export type PairedReport = {
  /** Always `policy-only`: configured-policy findings, not a Jev or Hard claim. */
  claim: 'policy-only';
  limitations: string[];
  method: string;
  seedSet: PairedSeedSet | null;
  analysisSeed: number;
  resamples: number;
  confidence: number;
  counts: {
    games: number;
    blocks: number;
    completePairs: number;
    /** Blocks with only one arm recorded. */
    missingPairs: number;
    missingBlockIds: string[];
    /** Blocks with both arms where either arm aborted. */
    abortedPairs: number;
    abortedBlockIds: string[];
    abortReasons: Record<string, number>;
    invariantFailures: number;
  };
  comparisons: ComparisonResult[];
};

const LIMITATIONS = [
  'Policy-only: results describe the configured policies and personalities, not Jev or Hard.',
  'Only the focal seat of each block is scored; other seats of a game are context, never extra n.',
  'Both arms share a seed, but their trajectories diverge after the first different decision.',
  'Intervals resample whole blocks within (seat count, focal seat) cells and assume blocks are independent.',
  'No universal pass threshold is applied: read effects by context, with n and uncertainty.',
];

const METHOD =
  'Stratified percentile bootstrap over paired blocks: both arms of a block are resampled together, ' +
  'within (seat count, focal seat) cells, with a deterministic RNG seeded from the analysis seed.';

/** Validates `records` and estimates paired treatment-minus-control effects by comparison and stratum. */
export function analyzePaired(
  records: readonly PairedGameRecord[],
  options: PairedOptions = {},
): PairedReport {
  const analysisSeed = options.analysisSeed ?? DEFAULT_ANALYSIS_SEED;
  const resamples = options.resamples ?? DEFAULT_RESAMPLES;
  const confidence = options.confidence ?? DEFAULT_CONFIDENCE;
  if (!Number.isSafeInteger(analysisSeed)) throw new RangeError('analysisSeed must be an integer');
  if (!Number.isInteger(resamples) || resamples < 1) {
    throw new RangeError('resamples must be a positive integer');
  }
  if (!(confidence > 0 && confidence < 1)) {
    throw new RangeError('confidence must be between 0 and 1');
  }

  for (const record of records) validateRecord(record);
  const seedSet = checkSeedSets(records, options.seedSet);
  const blocks = groupBlocks(records);

  const complete: Pair[] = [];
  const missingBlockIds: string[] = [];
  const abortedBlockIds: string[] = [];
  for (const [blockId, block] of blocks) {
    if (!block.treatment || !block.control) {
      missingBlockIds.push(blockId);
      continue;
    }
    checkMatched(blockId, block.treatment, block.control);
    if (block.treatment.status === 'aborted' || block.control.status === 'aborted') {
      abortedBlockIds.push(blockId);
      continue;
    }
    complete.push({ blockId, treatment: block.treatment, control: block.control });
  }

  const abortReasons: Record<string, number> = {};
  let invariantFailures = 0;
  for (const record of records) {
    invariantFailures += record.diagnostics.invariantFailures;
    if (record.status === 'aborted') {
      const reason = record.diagnostics.abortReason ?? 'unknown';
      abortReasons[reason] = (abortReasons[reason] ?? 0) + 1;
    }
  }

  const comparisons = new Map<
    string,
    { treatment: string; control: string; pairs: Pair[]; aborted: number }
  >();
  const comparisonOf = (treatment: string, control: string) => {
    const key = JSON.stringify([treatment, control]);
    let entry = comparisons.get(key);
    if (!entry) {
      entry = { treatment, control, pairs: [], aborted: 0 };
      comparisons.set(key, entry);
    }
    return entry;
  };
  for (const pair of complete) {
    comparisonOf(pair.treatment.policy, pair.control.policy).pairs.push(pair);
  }
  for (const blockId of abortedBlockIds) {
    const block = blocks.get(blockId)!;
    comparisonOf(block.treatment!.policy, block.control!.policy).aborted += 1;
  }

  const results = [...comparisons.values()]
    .sort((a, b) => compareText(a.treatment, b.treatment) || compareText(a.control, b.control))
    .map((entry): ComparisonResult => {
      const seedKey = `${analysisSeed}|${entry.treatment}|${entry.control}`;
      const estimate = (pairs: Pair[], label: string) =>
        estimateStratum(pairs, `${seedKey}|${label}`, resamples, confidence);
      const strata: ComparisonResult['strata'] = {
        seats: {},
        focalSeat: {},
        focalClass: {},
        focalPersonality: {},
      };
      const dimensions: Record<StratumDimension, (pair: Pair) => string> = {
        seats: (pair) => String(pair.treatment.seats),
        focalSeat: (pair) => String(pair.treatment.focalSeat),
        focalClass: (pair) => pair.treatment.classBySeat[pair.treatment.focalSeat]!,
        focalPersonality: (pair) => pair.treatment.personalityBySeat[pair.treatment.focalSeat]!,
      };
      for (const dimension of Object.keys(dimensions) as StratumDimension[]) {
        const groups = new Map<string, Pair[]>();
        for (const pair of entry.pairs) {
          const value = dimensions[dimension](pair);
          groups.set(value, [...(groups.get(value) ?? []), pair]);
        }
        for (const [value, pairs] of [...groups].sort((a, b) => compareText(a[0], b[0]))) {
          strata[dimension][value] = estimate(pairs, `${dimension}=${value}`);
        }
      }
      return {
        treatmentPolicy: entry.treatment,
        controlPolicy: entry.control,
        counts: {
          blocks: entry.pairs.length + entry.aborted,
          completePairs: entry.pairs.length,
          abortedPairs: entry.aborted,
        },
        overall: estimate(entry.pairs, 'overall'),
        strata,
      };
    });

  return {
    claim: 'policy-only',
    limitations: [...LIMITATIONS],
    method: METHOD,
    seedSet,
    analysisSeed,
    resamples,
    confidence,
    counts: {
      games: records.length,
      blocks: blocks.size,
      completePairs: complete.length,
      missingPairs: missingBlockIds.length,
      missingBlockIds,
      abortedPairs: abortedBlockIds.length,
      abortedBlockIds,
      abortReasons,
      invariantFailures,
    },
    comparisons: results,
  };
}

type Pair = { blockId: string; treatment: PairedGameRecord; control: PairedGameRecord };
type Block = { treatment?: PairedGameRecord; control?: PairedGameRecord };

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function validateRecord(record: PairedGameRecord): void {
  const where = `block ${record.blockId} arm ${record.arm}`;
  const fail = (why: string): never => {
    throw new RangeError(`invalid record (${where}): ${why}`);
  };
  if (typeof record.blockId !== 'string' || record.blockId.length === 0) {
    fail('blockId must be a nonempty string');
  }
  if (record.arm !== 'treatment' && record.arm !== 'control')
    fail('arm must be treatment or control');
  if (record.seedSet !== 'tune' && record.seedSet !== 'eval') fail('seedSet must be tune or eval');
  if (!Number.isSafeInteger(record.seed)) fail('seed must be an integer');
  if (record.seedSet === 'eval' && record.seed < EVAL_SEED_FLOOR) {
    fail(`eval seeds start at ${EVAL_SEED_FLOOR}; got ${record.seed}`);
  }
  if (record.seedSet === 'tune' && record.seed >= EVAL_SEED_FLOOR) {
    fail(`tune seeds stay below ${EVAL_SEED_FLOOR}; got ${record.seed}`);
  }
  if (!Number.isInteger(record.seats) || record.seats < 1) fail('seats must be a positive integer');
  const isSeat = (seat: number) => Number.isInteger(seat) && seat >= 0 && seat < record.seats;
  if (!isSeat(record.focalSeat)) fail(`focal seat ${record.focalSeat} is outside the table`);
  if (record.classBySeat.length !== record.seats) fail('classBySeat needs one entry per seat');
  if (record.personalityBySeat.length !== record.seats) {
    fail('personalityBySeat needs one entry per seat');
  }
  if (record.finalCoins.length !== record.seats) fail('finalCoins needs one entry per seat');
  if (!record.finalCoins.every(Number.isFinite)) fail('finalCoins must be finite numbers');
  if (!record.winnerSeats.every(isSeat)) fail('a winner seat is outside the table');
  if (new Set(record.winnerSeats).size !== record.winnerSeats.length) fail('winner seats repeat');
  if (record.status === 'completed' && record.winnerSeats.length === 0) {
    fail('a completed game needs at least one winner');
  }
  if (record.status === 'aborted' && record.winnerSeats.length > 0) {
    fail('an aborted game has no winners');
  }
  if (record.status !== 'completed' && record.status !== 'aborted') {
    fail('status must be completed or aborted');
  }
}

/** All records must come from one seed set (§8: tuning seeds stay apart from evaluation seeds). */
function checkSeedSets(
  records: readonly PairedGameRecord[],
  expected: PairedSeedSet | undefined,
): PairedSeedSet | null {
  const sets = new Set(records.map((record) => record.seedSet));
  if (sets.size > 1) throw new RangeError('analysis mixes tune and eval records');
  const found = records[0]?.seedSet ?? null;
  if (expected && found && found !== expected) {
    throw new RangeError(`expected ${expected} records; got ${found} records`);
  }
  return found;
}

function groupBlocks(records: readonly PairedGameRecord[]): Map<string, Block> {
  const blocks = new Map<string, Block>();
  const games = new Set<string>();
  for (const record of records) {
    const block = blocks.get(record.blockId) ?? {};
    if (block[record.arm]) {
      throw new RangeError(`duplicate record for block ${record.blockId} arm ${record.arm}`);
    }
    const game = JSON.stringify([
      record.seed,
      record.seats,
      record.focalSeat,
      record.arm,
      record.policy,
    ]);
    if (games.has(game)) {
      throw new RangeError(
        `duplicate game: seed ${record.seed}, ${record.seats} seats, focal seat ${record.focalSeat}, ` +
          `${record.arm} arm, policy ${record.policy} appears under more than one block`,
      );
    }
    games.add(game);
    block[record.arm] = record;
    blocks.set(record.blockId, block);
  }
  return blocks;
}

function checkMatched(blockId: string, a: PairedGameRecord, b: PairedGameRecord): void {
  const differs = (what: string): never => {
    throw new RangeError(`mismatched block ${blockId}: arms differ in ${what}`);
  };
  if (a.seed !== b.seed) differs('seed');
  if (a.seats !== b.seats) differs('seat count');
  if (a.focalSeat !== b.focalSeat) differs('focal seat');
  if (a.classBySeat.join('\u0000') !== b.classBySeat.join('\u0000')) differs('class assignment');
  if (a.personalityBySeat.join('\u0000') !== b.personalityBySeat.join('\u0000')) {
    differs('personality assignment');
  }
}

/** Per-block treatment-minus-control values, in `METRICS` order. */
const METRICS = ['score', 'win', 'tie', 'loss', 'coins'] as const;
type Metric = (typeof METRICS)[number];

type FocalOutcome = { score: number; win: number; tie: number; loss: number; coins: number };

function focalOutcome(record: PairedGameRecord): FocalOutcome {
  const won = record.winnerSeats.includes(record.focalSeat);
  const sole = won && record.winnerSeats.length === 1;
  return {
    score: won ? 1 / record.winnerSeats.length : 0,
    win: sole ? 1 : 0,
    tie: won && !sole ? 1 : 0,
    loss: won ? 0 : 1,
    coins: record.finalCoins[record.focalSeat]!,
  };
}

function summarizeArm(records: readonly PairedGameRecord[]): ArmSummary {
  const outcomes = records.map(focalOutcome);
  const n = records.length;
  const sum = (pick: (outcome: FocalOutcome) => number) =>
    outcomes.reduce((total, outcome) => total + pick(outcome), 0);
  const gameTies = records.filter((record) => record.winnerSeats.length > 1).length;
  return {
    games: n,
    wins: sum((o) => o.win),
    ties: sum((o) => o.tie),
    losses: sum((o) => o.loss),
    score: n === 0 ? 0 : sum((o) => o.score) / n,
    tieRate: n === 0 ? 0 : gameTies / n,
    meanFinalCoins: n === 0 ? 0 : sum((o) => o.coins) / n,
  };
}

function estimateStratum(
  pairs: readonly Pair[],
  seedKey: string,
  resamples: number,
  confidence: number,
): StratumResult {
  const rows = pairs.map((pair) => {
    const t = focalOutcome(pair.treatment);
    const c = focalOutcome(pair.control);
    return METRICS.map((metric) => t[metric] - c[metric]);
  });
  const n = rows.length;

  // Resampling cells keep the seat rotation: blocks are redrawn within (seat count, focal seat).
  const cells = new Map<string, number[]>();
  pairs.forEach((pair, index) => {
    const key = `${pair.treatment.seats}/${pair.treatment.focalSeat}`;
    cells.set(key, [...(cells.get(key) ?? []), index]);
  });
  const cellList = [...cells.entries()].sort((a, b) => compareText(a[0], b[0])).map(([, v]) => v);

  const means = METRICS.map((_, m) => (n === 0 ? 0 : sumOf(rows.map((row) => row[m]!)) / n));
  const bounds = n < 2 ? null : bootstrap(rows, cellList, seedKey, resamples, confidence);

  const estimate = (metric: Metric): MetricEstimate => {
    const m = METRICS.indexOf(metric);
    return { mean: means[m]!, lo: bounds?.[m]!.lo ?? null, hi: bounds?.[m]!.hi ?? null };
  };
  return {
    n,
    arms: {
      treatment: summarizeArm(pairs.map((pair) => pair.treatment)),
      control: summarizeArm(pairs.map((pair) => pair.control)),
    },
    differences: {
      score: estimate('score'),
      win: estimate('win'),
      tie: estimate('tie'),
      loss: estimate('loss'),
      coins: estimate('coins'),
    },
    effectSize: {
      score: standardized(rows.map((row) => row[0]!)),
      coins: standardized(rows.map((row) => row[4]!)),
    },
  };
}

function sumOf(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

/** Mean over sample SD of the block differences (a paired Cohen's d); `null` when SD is 0 or n < 2. */
function standardized(values: readonly number[]): number | null {
  if (values.length < 2) return null;
  const mean = sumOf(values) / values.length;
  const variance = sumOf(values.map((v) => (v - mean) ** 2)) / (values.length - 1);
  return variance === 0 ? null : mean / Math.sqrt(variance);
}

function bootstrap(
  rows: readonly (readonly number[])[],
  cells: readonly (readonly number[])[],
  seedKey: string,
  resamples: number,
  confidence: number,
): { lo: number; hi: number }[] {
  let rng: RngState = createRng(seedKey);
  const total = rows.length;
  const replicates: number[][] = METRICS.map(() => []);
  for (let r = 0; r < resamples; r++) {
    const sums = METRICS.map(() => 0);
    for (const cell of cells) {
      for (let i = 0; i < cell.length; i++) {
        const draw = int(rng, cell.length, 'bootstrap');
        rng = draw.rng;
        const row = rows[cell[draw.value]!]!;
        for (let m = 0; m < sums.length; m++) sums[m]! += row[m]!;
      }
    }
    for (let m = 0; m < sums.length; m++) replicates[m]!.push(sums[m]! / total);
  }
  const tail = (1 - confidence) / 2;
  const loIndex = Math.floor(tail * resamples);
  const hiIndex = Math.min(resamples - 1, Math.ceil((1 - tail) * resamples) - 1);
  return replicates.map((values) => {
    const sorted = [...values].sort((a, b) => a - b);
    return { lo: sorted[loIndex]!, hi: sorted[hiIndex]! };
  });
}
