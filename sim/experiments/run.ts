/**
 * The C5 exploit experiment runner (spec §8 Simulation, §9 sim limits, §10 C5; plan
 * `docs/experiments/c5-policy-plan.md`). It turns the frozen manifest into games: each block is
 * one seed played twice, once per arm, and the arms differ only in the policy that decides the
 * focal seat. Every game, aborted ones included, leaves one sanitized row.
 *
 * Nothing here computes a game number. Policies are built from factories that take no argument, so
 * none is ever handed the game seed or the engine's private RNG (§5.4); the row carries outcomes
 * and counts, never state, hands, decks or keys.
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  createGameLog,
  deserialize,
  serialize,
  verifyReplay,
  type LegalActions,
  type Observation,
} from '../../engine/index.ts';
import type { PairedGameRecord } from '../analysis/paired.ts';
import { createMetrics, type MetricsSummary } from '../metrics.ts';
import type {
  Policy,
  PolicyChoice,
  PolicyRng,
  SeatFacts,
  SeedlessPolicyFactory,
} from '../policy.ts';
import {
  EVAL_SEED_FLOOR,
  playGame,
  seatSetup,
  type PlayedGame,
  type InvariantCheck,
  type SimEngine,
} from '../runner.ts';
import { exploitMoment } from './moments.ts';

export type Arm = 'control' | 'treatment';
export const ARMS: readonly Arm[] = ['control', 'treatment'];

const scheduleRow = z.object({
  block: z.number().int().nonnegative(),
  seedOffset: z.number().int().nonnegative(),
  focalSeat: z.number().int().nonnegative(),
  focalClass: z.string(),
  backgroundPersonality: z.enum(['greedy', 'aggressive', 'cautious', 'opportunist']),
});

const cell = z.object({
  policy: z.string(),
  seats: z.number().int(),
  social: z.boolean(),
  seedFirst: z.number().int(),
  seedLast: z.number().int(),
  blocks: z.number().int().positive(),
  games: z.number().int().positive(),
});

const manifestSchema = z.object({
  id: z.string(),
  version: z.number().int(),
  game: z.object({
    lapTarget: z.number().int().positive(),
    maxSteps: z.number().int().positive(),
    classPool: z.array(z.string()),
    seatCounts: z.array(z.number().int()),
  }),
  baseline: z.object({ policy: z.string() }),
  policies: z.array(z.object({ id: z.string(), socialWindow: z.boolean() })),
  schedule: z.object({
    seats2: z.array(scheduleRow),
    seats3: z.array(scheduleRow),
    seats4: z.array(scheduleRow),
  }),
  cells: z.array(cell),
  tables: z.object({ gameRow: z.array(z.string()) }),
});

export type Manifest = z.infer<typeof manifestSchema>;
export type ManifestCell = z.infer<typeof cell>;
export type ScheduleRow = z.infer<typeof scheduleRow>;

/** The Social window's human seat, which plays the arm's per-seat policy (plan, Social window). */
const HUMAN_SEAT = 0;

/** The fallback policy of a background personality; Greedy is the registered `fallback`. */
export function backgroundPolicy(personality: ScheduleRow['backgroundPersonality']): string {
  return personality === 'greedy' ? 'fallback' : `fallback-${personality}`;
}

/** Parses the manifest file's JSON; throws on a shape error. Semantic checks are `validateManifest`. */
export function parseManifest(raw: unknown): Manifest {
  return manifestSchema.parse(raw);
}

export function manifestSha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/**
 * Whether the manifest can run on this engine and registry: every named policy is registered, the
 * counts are the frozen design, every schedule row names the class the sim's rotation will seat
 * there, and every cell's seeds are one contiguous range of the cell's own. Returns the problems;
 * an empty list means runnable. Runs no game.
 */
export function validateManifest(
  manifest: Manifest,
  registry: Readonly<Record<string, SeedlessPolicyFactory>>,
  classIds: readonly string[],
): string[] {
  const problems: string[] = [];
  const known = (id: string) => Object.hasOwn(registry, id);
  if (!known(manifest.baseline.policy)) {
    problems.push(`baseline policy ${manifest.baseline.policy} is not registered`);
  }
  for (const { id } of manifest.policies) {
    if (!known(id)) problems.push(`policy ${id} is not registered`);
  }
  for (const personality of ['greedy', 'aggressive', 'cautious', 'opportunist'] as const) {
    if (!known(backgroundPolicy(personality))) {
      problems.push(`background policy ${backgroundPolicy(personality)} is not registered`);
    }
  }
  if (manifest.game.classPool.join() !== classIds.join()) {
    problems.push(`classPool ${manifest.game.classPool.join()} differs from the sim's classes`);
  }
  const policyIds = manifest.policies.map((entry) => entry.id);
  if (manifest.cells.length !== policyIds.length * manifest.game.seatCounts.length) {
    problems.push(`${manifest.cells.length} cells; expected policies × seat counts`);
  }
  const seen = new Set<number>();
  for (const entry of manifest.cells) {
    const label = `${entry.policy}/${entry.seats}p`;
    const policy = manifest.policies.find((candidate) => candidate.id === entry.policy);
    if (!policy) problems.push(`${label}: policy is not in the manifest's policy list`);
    else if (policy.socialWindow !== entry.social) problems.push(`${label}: social differs`);
    const rows = schedule(manifest, entry.seats);
    if (!rows) {
      problems.push(`${label}: no schedule for ${entry.seats} seats`);
      continue;
    }
    if (entry.blocks !== rows.length || entry.games !== rows.length * ARMS.length) {
      problems.push(`${label}: blocks and games differ from the schedule`);
    }
    if (entry.seedLast - entry.seedFirst + 1 !== entry.blocks) {
      problems.push(`${label}: seedFirst to seedLast is not ${entry.blocks} seeds`);
    }
    if (entry.seedFirst % classIds.length !== 0) {
      problems.push(`${label}: seedFirst is not a multiple of ${classIds.length}`);
    }
    for (let seed = entry.seedFirst; seed <= entry.seedLast; seed++) {
      if (seen.has(seed)) problems.push(`${label}: seed ${seed} is in two cells`);
      seen.add(seed);
    }
    for (const row of rows) {
      const classId = seatSetup(classIds, entry.seats, entry.seedFirst + row.seedOffset)[
        row.focalSeat
      ]?.classId;
      if (classId !== row.focalClass) {
        problems.push(`${label} block ${row.block}: focal class ${row.focalClass} is ${classId}`);
      }
      if (row.focalSeat >= entry.seats) problems.push(`${label} block ${row.block}: no such seat`);
    }
  }
  return problems;
}

function schedule(manifest: Manifest, seats: number): readonly ScheduleRow[] | undefined {
  return seats === 2
    ? manifest.schedule.seats2
    : seats === 3
      ? manifest.schedule.seats3
      : seats === 4
        ? manifest.schedule.seats4
        : undefined;
}

/** One physical game of the design, fully specified; the two arms of a block differ in one seat. */
export type GamePlan = {
  gameId: string;
  /** `cell.policy/Np/bB`: names the matched pair. */
  blockId: string;
  cell: { policy: string; seats: number };
  block: number;
  arm: Arm;
  seed: number;
  focalSeat: number;
  focalClass: string;
  backgroundPersonality: string;
  social: boolean;
  lapTarget: number;
  maxSteps: number;
  /** The registered policy that decides each seat. */
  seatPolicies: readonly string[];
};

/**
 * `seedBase` moves the whole manifest to another range, for smoke runs below the evaluation floor
 * (plan, Seeds): cell `i` then starts at `seedBase` plus its offset from the first cell, so the
 * schedule's class rotation holds when `seedBase` is a multiple of the class count.
 */
export function planGame(
  manifest: Manifest,
  entry: ManifestCell,
  block: number,
  arm: Arm,
  seedBase?: number,
): GamePlan {
  const row = schedule(manifest, entry.seats)?.find((candidate) => candidate.block === block);
  if (!row) throw new RangeError(`${entry.policy}/${entry.seats}p has no block ${block}`);
  const firstSeed = Math.min(...manifest.cells.map((candidate) => candidate.seedFirst));
  const seedFirst =
    seedBase === undefined ? entry.seedFirst : seedBase + entry.seedFirst - firstSeed;
  if (seedBase !== undefined && seedBase % manifest.game.classPool.length !== 0) {
    throw new RangeError(
      `seed base ${seedBase} is not a multiple of ${manifest.game.classPool.length}`,
    );
  }
  const focal = arm === 'treatment' ? entry.policy : manifest.baseline.policy;
  const background = backgroundPolicy(row.backgroundPersonality);
  const seatPolicies = Array.from({ length: entry.seats }, (_, seatIndex) =>
    seatIndex === row.focalSeat
      ? focal
      : // With the Social window on, seat 0 is the human: it plays the baseline unless it is focal.
        entry.social && seatIndex === HUMAN_SEAT
        ? manifest.baseline.policy
        : background,
  );
  const blockId = `${entry.policy}/${entry.seats}p/b${block}`;
  return {
    gameId: `${blockId}/${arm}`,
    blockId,
    cell: { policy: entry.policy, seats: entry.seats },
    block,
    arm,
    seed: seedFirst + row.seedOffset,
    focalSeat: row.focalSeat,
    focalClass: row.focalClass,
    backgroundPersonality: row.backgroundPersonality,
    social: entry.social,
    lapTarget: manifest.game.lapTarget,
    maxSteps: manifest.game.maxSteps,
    seatPolicies,
  };
}

/** Where a row came from; the runner's caller reads these (git, the manifest file, the engine). */
export type Provenance = {
  mainSha: string;
  engineVersion: string;
  contentVersion: string;
  manifestSha256: string;
};

export type GameRow = {
  gameId: string;
  cell: { policy: string; seats: number };
  block: number;
  arm: Arm;
  seed: number;
  seatClasses: string[];
  seatPolicies: string[];
  seatPersonalities: string[];
  focalSeat: number;
  focalClass: string;
  backgroundPersonality: string;
  socialWindow: boolean;
  lapTarget: number;
  maxSteps: number;
  finished: boolean;
  /** Why the game stopped unfinished, cut to one short line; `null` for a finished game. */
  abortReason: string | null;
  turns: number;
  steps: number;
  winners: number[];
  focalWinCredit: number;
  finalCoins: number[];
  illegalAppliedActionCount: number;
  invariantFailures: number;
  /** `null` for an unfinished game, which has no save to replay. */
  replayPass: boolean | null;
  /** Every reason this game counts as a failing seed; empty when none. */
  failureReasons: string[];
  focalOpportunities: Record<string, number>;
  focalUses: Record<string, number>;
  hostility: MetricsSummary['hostility'];
  promises: MetricsSummary['promises'];
  mainSha: string;
  engineVersion: string;
  contentVersion: string;
  manifestSha256: string;
};

/** The leaf names of a nested row, as the manifest lists them (`cell.policy`). */
export function rowFields(row: object, prefix = ''): string[] {
  return Object.entries(row).flatMap(([key, value]) =>
    value !== null && typeof value === 'object' && !Array.isArray(value) && key === 'cell'
      ? rowFields(value, `${key}.`)
      : [`${prefix}${key}`],
  );
}

/** One short line with no control characters: a thrown message may quote arbitrary text. */
export function sanitizeReason(reason: string): string {
  const printable = Array.from(reason, (char) => {
    const code = char.codePointAt(0)!;
    return code < 0x20 || code === 0x7f ? ' ' : char;
  }).join('');
  return printable.replace(/ +/g, ' ').trim().slice(0, 160);
}

/**
 * Counts, for the focal seat, the decisions at which its exploit rule had an opportunity and the
 * ones that used it. The same definition is applied to both arms, so the control arm's count says
 * how many chances the baseline had (§8 Critic). Wraps the policy without changing its choice.
 */
class FocalRecorder implements Policy {
  readonly opportunities: Record<string, number> = {};
  readonly uses: Record<string, number> = {};

  constructor(
    private readonly inner: Policy,
    private readonly exploitId: string,
  ) {}

  get personality() {
    return this.inner.personality;
  }

  get wantsFacts() {
    return this.inner.wantsFacts;
  }

  counts() {
    return this.inner.counts?.() ?? {};
  }

  async decide(
    observation: Observation,
    legalActions: LegalActions,
    rng: PolicyRng,
    facts?: SeatFacts,
  ): Promise<PolicyChoice> {
    const picked = await this.inner.decide(observation, legalActions, rng, facts);
    const moment = exploitMoment(this.exploitId, observation, legalActions, facts, picked);
    if (moment) {
      this.opportunities[moment.kind] = (this.opportunities[moment.kind] ?? 0) + 1;
      if (moment.used) this.uses[moment.kind] = (this.uses[moment.kind] ?? 0) + 1;
    }
    return picked;
  }
}

/**
 * Plays one planned game and returns its row, aborted or not. A throw anywhere in the game is an
 * abort with its reason, never a missing row. A finished game is also saved and replayed (§6, §8):
 * a mismatch is a failure with a reason.
 */
export async function playPlan(
  engine: SimEngine,
  plan: GamePlan,
  registry: Readonly<Record<string, SeedlessPolicyFactory>>,
  checkInvariants: InvariantCheck,
  provenance: Provenance,
): Promise<GameRow> {
  let recorder: FocalRecorder | undefined;
  const personalities: string[] = [];
  const metrics = createMetrics();
  const result = await playGame(
    engine,
    {
      seats: plan.cell.seats,
      maxSteps: plan.maxSteps,
      lapTarget: plan.lapTarget,
      ...(plan.social && { social: true }),
    },
    plan.seed,
    // No second parameter: the game and its seed are never passed on to a policy.
    (seat) => {
      const policy = registry[plan.seatPolicies[seat.seatIndex]!]!();
      personalities[seat.seatIndex] = policy.personality?.id ?? 'unassigned';
      if (seat.seatIndex !== plan.focalSeat) return policy;
      recorder = new FocalRecorder(policy, plan.cell.policy);
      return recorder;
    },
    checkInvariants,
    metrics,
  );
  const { hostility, promises } = metrics.summary();
  const reasons: string[] = [];
  if (result.abortReason) reasons.push(`aborted: ${sanitizeReason(result.abortReason)}`);
  if (result.illegalApplied > 0) reasons.push(`illegal applied actions: ${result.illegalApplied}`);
  if (result.violations > 0) reasons.push(`invariant failures: ${result.violations}`);
  let replayPass: boolean | null = null;
  if (result.game && result.outcome.finished) {
    replayPass = replays(result.game);
    if (!replayPass) reasons.push('replay does not reproduce the saved state hash');
  }
  const winners = result.outcome.finished ? result.outcome.winnerSeats : [];
  return {
    gameId: plan.gameId,
    cell: plan.cell,
    block: plan.block,
    arm: plan.arm,
    seed: plan.seed,
    seatClasses: result.seats.map((seat) => seat.classId),
    seatPolicies: [...plan.seatPolicies],
    seatPersonalities: personalities,
    focalSeat: plan.focalSeat,
    focalClass: plan.focalClass,
    backgroundPersonality: plan.backgroundPersonality,
    socialWindow: plan.social,
    lapTarget: plan.lapTarget,
    maxSteps: plan.maxSteps,
    finished: result.outcome.finished,
    abortReason: result.abortReason === null ? null : sanitizeReason(result.abortReason),
    turns: result.turns,
    steps: result.game?.records.length ?? 0,
    winners,
    focalWinCredit: winners.includes(plan.focalSeat) ? 1 / winners.length : 0,
    finalCoins: result.finalCoins,
    illegalAppliedActionCount: result.illegalApplied,
    invariantFailures: result.violations,
    replayPass,
    failureReasons: reasons,
    focalOpportunities: { ...recorder?.opportunities },
    focalUses: { ...recorder?.uses },
    hostility,
    promises,
    ...provenance,
  };
}

/** Saves the finished game as the CLI's `--save` does, reloads it and replays it (§6.8). */
function replays(game: PlayedGame): boolean {
  try {
    const log = createGameLog(game.initialState);
    log.actions = game.records;
    return verifyReplay(deserialize(serialize({ state: game.state, log }))).pass;
  } catch {
    return false;
  }
}

/** A row as the paired analysis takes it (A61-3); the focal seat's arm policy is the label. */
export function toPairedRecord(row: GameRow): PairedGameRecord {
  return {
    blockId: `${row.cell.policy}/${row.cell.seats}p/b${row.block}`,
    arm: row.arm,
    policy: row.seatPolicies[row.focalSeat]!,
    seedSet: row.seed >= EVAL_SEED_FLOOR ? 'eval' : 'tune',
    seed: row.seed,
    seats: row.cell.seats,
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

export type PlanFilter = {
  policy?: string;
  seats?: number;
  /** Inclusive block range within each cell. */
  blocks?: readonly [number, number];
  arms?: readonly Arm[];
};

/** The games a filter selects, in cell, block, arm order: control first, as in the manifest. */
export function planGames(
  manifest: Manifest,
  filter: PlanFilter = {},
  seedBase?: number,
): GamePlan[] {
  return manifest.cells
    .filter(
      (entry) =>
        (filter.policy === undefined || entry.policy === filter.policy) &&
        (filter.seats === undefined || entry.seats === filter.seats),
    )
    .flatMap((entry) =>
      (schedule(manifest, entry.seats) ?? [])
        .filter(
          (row) =>
            filter.blocks === undefined ||
            (row.block >= filter.blocks[0] && row.block <= filter.blocks[1]),
        )
        .flatMap((row) =>
          ARMS.filter((arm) => filter.arms === undefined || filter.arms.includes(arm)).map((arm) =>
            planGame(manifest, entry, row.block, arm, seedBase),
          ),
        ),
    );
}

/** The command that replays one game of the design alone, for a failing seed's report. */
export function reproducePlan(plan: GamePlan, seedBase?: number): string {
  return [
    'npm run experiment --',
    `--policy ${plan.cell.policy} --seats ${plan.cell.seats}`,
    `--blocks ${plan.block}-${plan.block} --arms ${plan.arm}`,
    seedBase === undefined ? '--held-out' : `--seed-base ${seedBase}`,
    '--out <rows.jsonl>',
  ].join(' ');
}
