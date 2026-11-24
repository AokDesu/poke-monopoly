import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { realEngine } from '../engine.ts';
import { seatSetup, type InvariantCheck } from '../runner.ts';
import {
  analyzeG2,
  blockIdOf,
  decideVerdict,
  estimateThb,
  normalCdf,
  seedClusteredScore,
  offlineBackend,
  parseG2Plan,
  parseG2Rows,
  percentile,
  planG2Games,
  planSha256,
  playG2Game,
  powerAt,
  powerTable,
  requiredBlocks,
  validateG2Plan,
  type DifficultyStats,
  type DuelBackend,
  type G2Mode,
  type G2Plan,
  type G2Provenance,
  type G2Row,
} from './g2.ts';
import { DEFAULT_G2_PLAN, runG2Cli as runG2CliWith } from './g2-main.ts';

const planText = readFileSync(DEFAULT_G2_PLAN, 'utf8');
const plan = parseG2Plan(JSON.parse(planText));
const c5 = JSON.parse(readFileSync(new URL('./c5-plan.json', import.meta.url), 'utf8')) as {
  seedLedger: { id: string; first: number; last: number }[];
};
const provenance: G2Provenance = {
  mainSha: 'test-sha',
  engineVersion: 'test-engine',
  contentVersion: 'test-content',
  planSha256: planSha256(planText),
};
const noViolations: InvariantCheck = () => [];
/** A tuning-range base (a multiple of the class count) for runs below the evaluation floor. */
const SMOKE_BASE = 100_200;
/** Named time budget for a test that plays whole games through the real engine (4 games per seed). */
const SLOW = 120_000;
const dir = mkdtempSync(join(tmpdir(), 'poke-g2-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

// Every game here runs on `offlineBackend`: the seeded fake client, whatever key the machine holds.
// The Jev key's name may not appear in sim/ (lint, spec §7), so it is not stubbed here: no call can
// reach `envBackend` (see `runG2Cli` below), and `ai/jev-duel.test.ts` checks, with a key set, that
// the offline backend's mode is never live.
beforeEach(() => vi.stubEnv('JEV_ENABLED', ''));
afterEach(() => vi.unstubAllEnvs());

/**
 * The one way this file calls the runner: the backend is a required argument, so no test can fall
 * through to `envBackend`, which is live on a machine with the key in its shell.
 */
function runG2Cli(
  args: string[],
  io: ReturnType<typeof makeIo>,
  backend: DuelBackend = offlineBackend,
): Promise<number> {
  return runG2CliWith(args, realEngine, noViolations, io, () => provenance, backend);
}

/** A backend that must never play a game: a `create` that throws fails the test that reaches it. */
const neverPlays = (mode: G2Mode): DuelBackend => ({
  mode: () => mode,
  create: () => {
    throw new Error(
      `a ${mode} game was started; the guard under test should have stopped it first`,
    );
  },
  budgetExceeded: () => false,
});

function makeIo() {
  const lines: string[] = [];
  const errors: string[] = [];
  return { lines, errors, log: (l: string) => lines.push(l), error: (l: string) => errors.push(l) };
}

describe('the plan', () => {
  test('is runnable on this engine and its seeds are disjoint from the C5 ledger', () => {
    expect(validateG2Plan(plan, realEngine.classIds, c5.seedLedger)).toEqual([]);
    expect(plan.seeds.first).toBeGreaterThanOrEqual(1_000_000);
  });

  test('reports an overlap with another range and a seed count off the class rotation', () => {
    const problems = validateG2Plan(plan, realEngine.classIds, [
      { id: 'other', first: plan.seeds.first + 10, last: plan.seeds.first + 20 },
    ]);
    expect(problems.some((p) => p.includes('overlap other'))).toBe(true);
    const odd = { ...plan, seeds: { ...plan.seeds, count: 197 } } as G2Plan;
    expect(validateG2Plan(odd, realEngine.classIds).some((p) => p.includes('multiple of 6'))).toBe(
      true,
    );
  });

  test('names the registered policies Hard, Normal and Normal', () => {
    expect(plan.policies).toMatchObject({
      treatment: 'jev-hard',
      control: 'jev',
      background: 'jev',
      personality: 'greedy',
    });
  });

  test('the recommended seed count is the power estimate at the smallest useful gap, in whole rotations', () => {
    const [row] = powerTable(plan).filter((r) => r.gap === plan.power.minimumUsefulGap);
    expect(row!.seeds).toBe(plan.power.recommendedSeeds);
    expect(plan.power.recommendedSeeds).toBe(plan.seeds.count);
    expect(row!.powerAtRecommended).toBeGreaterThanOrEqual(plan.power.power);
  });

  test('writes the cost basis from the spend config, not a made-up number', () => {
    expect(estimateThb(plan, 1000)).toBeCloseTo((1000 * 3242.23 * 0.042 * 33) / 1_000_000, 9);
  });
});

describe('power', () => {
  test('known values: blocks for a 0.10 gap at SD 0.7071, and the CDF', () => {
    expect(requiredBlocks(0.1, 0.7071)).toBe(393);
    expect(requiredBlocks(0.2, 0.7071)).toBe(99);
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
    expect(normalCdf(1.959964)).toBeCloseTo(0.975, 4);
    expect(powerAt(393, 0.1, 0.7071)).toBeCloseTo(0.8, 2);
  });

  test('nearest-rank percentile, as the usage report takes it', () => {
    expect(percentile([], 0.5)).toBeNull();
    expect(percentile([5, 1, 3], 0.5)).toBe(3);
    const hundred = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(hundred, 0.95)).toBe(95);
  });
});

describe('the design: rotation and pairing', () => {
  const games = planG2Games(plan);

  test('every seed is played with Hard in every seat, both arms per block, control first', () => {
    expect(games).toHaveLength(plan.seeds.count * plan.game.seats * 2);
    for (let offset = 0; offset < plan.seeds.count; offset += 37) {
      const seed = plan.seeds.first + offset;
      const focals = games
        .filter((g) => g.seed === seed && g.arm === 'treatment')
        .map((g) => g.focalSeat);
      expect(focals).toEqual([0, 1]);
    }
    for (let i = 0; i < games.length; i += 2) {
      expect(games[i]!.arm).toBe('control');
      expect(games[i + 1]!.arm).toBe('treatment');
      expect(games[i]!.blockId).toBe(games[i + 1]!.blockId);
    }
  });

  test("the arms differ in the focal seat's policy and nothing else", () => {
    for (const g of games.filter((x) => x.arm === 'treatment')) {
      const control = games.find((x) => x.blockId === g.blockId && x.arm === 'control')!;
      expect(control.seatPolicies.every((id) => id === 'jev')).toBe(true);
      expect(g.seatPolicies.filter((id) => id === 'jev-hard')).toHaveLength(1);
      expect(g.seatPolicies[g.focalSeat]).toBe('jev-hard');
      expect({ ...g, arm: '', gameId: '', seatPolicies: [] }).toEqual({
        ...control,
        arm: '',
        gameId: '',
        seatPolicies: [],
      });
    }
  });

  test('over the seeds every class takes every seat equally often', () => {
    const count = { 0: {} as Record<string, number>, 1: {} as Record<string, number> };
    for (let offset = 0; offset < plan.seeds.count; offset++) {
      const setup = seatSetup(realEngine.classIds, 2, plan.seeds.first + offset);
      for (const seat of setup) {
        const bySeat = count[seat.seatIndex as 0 | 1];
        bySeat[seat.classId] = (bySeat[seat.classId] ?? 0) + 1;
      }
    }
    for (const seat of [0, 1] as const) {
      expect(Object.values(count[seat])).toEqual(Array(6).fill(plan.seeds.count / 6));
    }
  });

  test('a prefix, a shard and a seed base select what they say; a bad base or shard is refused', () => {
    expect(planG2Games(plan, { seeds: 6 })).toHaveLength(24);
    const shards = [0, 1, 2].map((index) =>
      planG2Games(plan, { seeds: 12, shard: { index, count: 3 } }).map((g) => g.gameId),
    );
    expect(shards.flat().sort()).toEqual(
      planG2Games(plan, { seeds: 12 })
        .map((g) => g.gameId)
        .sort(),
    );
    expect(new Set(shards.flat()).size).toBe(48);
    expect(planG2Games(plan, { seedBase: SMOKE_BASE, seeds: 1 })[0]!.seed).toBe(SMOKE_BASE);
    expect(() => planG2Games(plan, { seedBase: 100_001 })).toThrow('multiple of 6');
    expect(() => planG2Games(plan, { seeds: plan.seeds.count + 1 })).toThrow('--seeds');
    expect(() => planG2Games(plan, { shard: { index: 3, count: 3 } })).toThrow('shard');
  });

  test('the block id names seats, seed and focal seat', () => {
    expect(blockIdOf(2, 1300002, 1)).toBe('g2/2p/s1300002/f1');
  });
});

describe('a game on the seeded fake client', () => {
  test(
    'finishes legally with no illegal action, an invariant failure or a replay mismatch, and carries its latency, counts and mode',
    async () => {
      const [control, treatment] = planG2Games(plan, { seedBase: SMOKE_BASE, seeds: 1 });
      for (const game of [control!, treatment!]) {
        const row = await playG2Game(realEngine, game, noViolations, provenance, offlineBackend);
        expect(row).toMatchObject({
          mode: 'fake',
          rolloutMs: null,
          finished: true,
          illegalAppliedActionCount: 0,
          invariantFailures: 0,
          replayPass: true,
          failureReasons: [],
        });
        expect(row.seatPersonalities).toEqual(['greedy', 'greedy']);
        expect(row.seatStats.map((s) => s.difficulty).sort()).toEqual(
          game.arm === 'treatment' ? ['hard', 'normal'] : ['normal', 'normal'],
        );
        expect(row.seatStats.some((s) => s.decisionMs.length > 0)).toBe(true);
        expect(row.usage).toMatchObject({ source: 'decision-counts', thb: null });
        // A row holds counts and timings, never a game's state or a key.
        expect(JSON.stringify(row)).not.toMatch(/apiKey|TYPESAFE|sk-/);
      }
    },
    SLOW,
  );

  test(
    'finishes with Jev off: every decision falls back and the mode says so',
    async () => {
      vi.stubEnv('JEV_ENABLED', 'false');
      expect(offlineBackend.mode()).toBe('disabled');
      const [, treatment] = planG2Games(plan, { seedBase: SMOKE_BASE, seeds: 1 });
      const row = await playG2Game(
        realEngine,
        treatment!,
        noViolations,
        provenance,
        offlineBackend,
      );
      expect(row).toMatchObject({ mode: 'disabled', finished: true, illegalAppliedActionCount: 0 });
      expect(row.usage.requests).toBe(0);
      const hard = row.seatStats.find((s) => s.difficulty === 'hard')!;
      expect(hard.counts['fallback:disabled']).toBe(hard.counts.decisions);
    },
    SLOW,
  );
});

/** A synthetic finished row, for analysis and verdict tests that need no game. */
function row(block: number, arm: 'control' | 'treatment', overrides: Partial<G2Row> = {}): G2Row {
  const seed = plan.seeds.first + Math.floor(block / 2);
  const focalSeat = block % 2;
  return {
    gameId: `${blockIdOf(2, seed, focalSeat)}/${arm}`,
    blockId: blockIdOf(2, seed, focalSeat),
    arm,
    seed,
    seats: 2,
    focalSeat,
    seatClasses: ['rival', 'researcher'],
    seatPolicies: [0, 1].map((s) => (s === focalSeat && arm === 'treatment' ? 'jev-hard' : 'jev')),
    seatPersonalities: ['greedy', 'greedy'],
    mode: 'live',
    rolloutMs: 400,
    finished: true,
    abortReason: null,
    turns: 20,
    steps: 100,
    winners: [focalSeat],
    finalCoins: [30, 20],
    illegalAppliedActionCount: 0,
    invariantFailures: 0,
    replayPass: true,
    failureReasons: [],
    seatStats: [0, 1].map((seat) => ({
      seat,
      difficulty:
        seat === focalSeat && arm === 'treatment' ? ('hard' as const) : ('normal' as const),
      counts: { decisions: 10, requests: 10, invalid_outputs: 0 },
      decisionMs: [100, 200, 300],
      turnMs: [150, 250],
    })),
    usage: {
      source: 'usage-log',
      requests: 20,
      inputTokens: 64_000,
      estimatedRequests: 0,
      thb: 0.09,
    },
    plannedSeeds: plan.seeds.count,
    ...provenance,
    ...overrides,
  };
}

/** `blocks` complete live blocks where Hard wins `hardWins` of them and Normal wins the rest of its own. */
function rows(blocks: number, hardWins: number, normalWins = 0): G2Row[] {
  const out: G2Row[] = [];
  for (let b = 0; b < blocks; b++) {
    const focal = b % 2;
    out.push(
      row(b, 'control', { winners: b < normalWins ? [focal] : [1 - focal] }),
      row(b, 'treatment', { winners: b < hardWins ? [focal] : [1 - focal] }),
    );
  }
  return out;
}

describe('analysis and the pre-registered verdict', () => {
  const fast = { resamples: 400 };

  test('keeps three levels when Hard clearly wins, inside the latency budget, on a full live run', () => {
    const report = analyzeG2(rows(120, 100, 40), plan, { plannedBlocks: 120, ...fast });
    expect(report.duel!.hard.wins).toBe(100);
    expect(report.duel!.normal.wins).toBe(40);
    expect(report.duel!.scoreDifference.mean).toBeCloseTo(0.5, 6);
    expect(report.duel!.scoreDifference.lo).toBeGreaterThan(0);
    expect(report.verdict.status).toBe('keep-3-levels');
  });

  test('ships two levels, saying evidence failed, when Hard is no better', () => {
    const report = analyzeG2(rows(120, 60, 60), plan, { plannedBlocks: 120, ...fast });
    expect(report.verdict.status).toBe('ship-2-levels');
    expect(report.verdict.statement).toContain('not shown to beat Normal');
    expect(report.verdict.reasons.some((r) => r.startsWith('evidence-interval'))).toBe(true);
  });

  test('ships two levels, saying latency failed, when Hard wins but is too slow or times out more', () => {
    const slow = rows(120, 100, 40).map((r) =>
      r.seatStats.some((s) => s.difficulty === 'hard')
        ? {
            ...r,
            seatStats: r.seatStats.map((s) =>
              s.difficulty === 'hard'
                ? {
                    ...s,
                    decisionMs: [400, 1700],
                    turnMs: [600, 2500],
                    counts: { ...s.counts, 'fallback:timeout': 4 },
                  }
                : s,
            ),
          }
        : r,
    );
    const report = analyzeG2(slow, plan, { plannedBlocks: 120, ...fast });
    expect(report.verdict.status).toBe('ship-2-levels');
    expect(report.verdict.statement).toContain('latency budget');
    const failed = report.verdict.checks.filter((c) => !c.pass).map((c) => c.id);
    expect(failed).toEqual(['latency-decision-p95', 'latency-turn-p95', 'latency-timeouts']);
  });

  test('gives no verdict for fake rows, however good the result looks', () => {
    const fake = rows(120, 120, 0).map((r) => ({ ...r, mode: 'fake' as const }));
    const report = analyzeG2(fake, plan, { plannedBlocks: 120, ...fast });
    expect(report.evidence).toBe('not-evidence: fake-client');
    expect(report.verdict.status).toBe('no-verdict');
  });

  test('gives no verdict for a partial run, an illegal applied action, a replay mismatch or a spent budget', () => {
    expect(analyzeG2(rows(100, 90, 40), plan, { plannedBlocks: 120, ...fast }).verdict.status).toBe(
      'no-verdict',
    );
    const bad = (patch: Partial<G2Row>) => {
      const all = rows(120, 100, 40);
      all[0] = { ...all[0]!, ...patch };
      return analyzeG2(all, plan, { plannedBlocks: 120, ...fast }).verdict;
    };
    expect(bad({ illegalAppliedActionCount: 1 }).status).toBe('no-verdict');
    expect(bad({ replayPass: false }).status).toBe('no-verdict');
    const spent = bad({
      seatStats: [
        {
          seat: 0,
          difficulty: 'normal',
          counts: { 'fallback:budget_exceeded': 2 },
          decisionMs: [],
          turnMs: [],
        },
      ],
    });
    expect(spent.reasons.join()).toContain('spend');
  });

  test('too many aborted pairs is no verdict; one within the 2% allowance is scored around', () => {
    const all = rows(120, 100, 40);
    const abort = (i: number) => {
      all[i] = {
        ...all[i]!,
        finished: false,
        winners: [],
        finalCoins: [0, 0],
        abortReason: 'max steps 5000',
      };
    };
    abort(1);
    expect(analyzeG2(all, plan, { plannedBlocks: 120, ...fast }).verdict.status).toBe(
      'keep-3-levels',
    );
    for (const i of [3, 5, 7]) abort(i);
    expect(analyzeG2(all, plan, { plannedBlocks: 120, ...fast }).verdict.status).toBe('no-verdict');
  });

  test('decideVerdict is the rule of the plan: thresholds are read from it', () => {
    const stats = (p95: number, timeout: number): DifficultyStats => ({
      seatGames: 1,
      rates: {
        decisions: 10,
        requests: 10,
        invalidOutputRate: 0,
        fallbackRate: { total: 0, byCause: {} },
      },
      timeoutRate: timeout,
      decisionMs: { n: 1, p50: 1, p95, max: p95 },
      turnMs: { n: 1, p50: 1, p95, max: p95 },
    });
    const duel = (lo: number, mean: number) =>
      ({
        n: 100,
        hard: { wins: 0, ties: 0, losses: 0, score: 0 },
        normal: { wins: 0, ties: 0, losses: 0, score: 0 },
        scoreDifference: { mean, lo, hi: mean + 0.1 },
        winDifference: { mean, lo, hi: mean + 0.1 },
        effectSize: 1,
        bySeedCluster: null,
        byFocalSeat: {},
      }) as const;
    const input = (lo: number, mean: number, p95: number) => ({
      evidence: 'live' as const,
      plannedBlocks: 100,
      counts: { abortedPairs: 0 } as never,
      duel: duel(lo, mean),
      stats: { hard: stats(p95, 0), normal: stats(50, 0) },
      integrity: {
        illegalAppliedActionCount: 0,
        invariantFailures: 0,
        replayFailures: 0,
        budgetExceededFallbacks: 0,
        abortedPairs: 0,
        missingBlocks: 0,
      },
    });
    expect(decideVerdict(plan, input(0.01, 0.1, 1500)).status).toBe('keep-3-levels');
    // The interval excludes zero but the point estimate is under the 0.05 floor.
    expect(decideVerdict(plan, input(0.01, 0.04, 1500)).status).toBe('ship-2-levels');
    // The point estimate is large but the interval includes zero.
    expect(decideVerdict(plan, input(0, 0.2, 1500)).status).toBe('ship-2-levels');
    // One millisecond over the decision deadline.
    expect(decideVerdict(plan, input(0.01, 0.1, 1501)).status).toBe('ship-2-levels');
  });
});

describe('Jev must have answered (pre-registered integrity, B2)', () => {
  const fast = { resamples: 400 };
  const withCounts = (counts: Record<string, number>, which?: 'hard' | 'normal') =>
    rows(120, 100, 40).map((r) => ({
      ...r,
      seatStats: r.seatStats.map((s) =>
        which === undefined || s.difficulty === which ? { ...s, counts } : s,
      ),
    }));
  const verdictOf = (all: G2Row[]) => analyzeG2(all, plan, { plannedBlocks: 120, ...fast }).verdict;

  test('the plan states the floor, the ceiling and the causes', () => {
    expect(plan.rule.integrity.minJevAnsweredShare).toBe(0.3);
    expect(plan.rule.integrity.maxInfrastructureFallbackShare).toBe(0.05);
    expect(plan.rule.integrity.infrastructureCauses).toEqual(
      expect.arrayContaining(['timeout', 'network', 'auth']),
    );
  });

  test('live rows that are all fallback:timeout give no verdict, however the arms compare', () => {
    // An outage: every decision of both difficulties times out, so the arms look identical.
    const outage = withCounts({ decisions: 10, requests: 10, 'fallback:timeout': 10 });
    const report = analyzeG2(outage, plan, { plannedBlocks: 120, ...fast });
    expect(report.evidence).toBe('live');
    expect(report.verdict.status).toBe('no-verdict');
    const failed = report.verdict.checks.filter((c) => !c.pass).map((c) => c.id);
    expect(failed).toEqual(['jev-answered', 'infrastructure-fallbacks']);
    expect(report.verdict.statement).not.toContain('Ship two levels');
    const answered = report.verdict.checks.find((c) => c.id === 'jev-answered')!.detail;
    expect(answered).toContain('hard 0.000');
    expect(answered).toContain('normal 0.000');
  });

  test('every other infrastructure cause is caught as well, with the numbers in the detail', () => {
    for (const cause of ['network', 'auth', 'rate_limited', 'server_error']) {
      const verdict = verdictOf(
        withCounts({ decisions: 10, requests: 10, [`fallback:${cause}`]: 10 }),
      );
      expect(verdict.status, cause).toBe('no-verdict');
      const infra = verdict.checks.find((c) => c.id === 'infrastructure-fallbacks')!;
      expect(infra.pass).toBe(false);
      expect(infra.detail).toContain(`${cause} 1.000`);
    }
  });

  test('a service that answers badly is not an outage: Jev-side fallbacks do not trip the infrastructure check', () => {
    const lowConfidence = withCounts({ decisions: 10, requests: 10, 'fallback:low_confidence': 5 });
    const verdict = verdictOf(lowConfidence);
    expect(verdict.checks.find((c) => c.id === 'jev-answered')!.pass).toBe(true);
    expect(verdict.checks.find((c) => c.id === 'infrastructure-fallbacks')!.pass).toBe(true);
  });

  test('the floor is exact: answered 0.30 passes, below it gives no verdict', () => {
    const at = withCounts({ decisions: 10, requests: 10, 'fallback:low_confidence': 7 });
    expect(verdictOf(at).checks.find((c) => c.id === 'jev-answered')!.pass).toBe(true);
    const below = withCounts({ decisions: 10, requests: 10, 'fallback:low_confidence': 8 });
    const verdict = verdictOf(below);
    expect(verdict.status).toBe('no-verdict');
    expect(verdict.reasons.join()).toContain('jev-answered');
  });

  test("Hard's own timeouts are the latency rule's, not an outage: Normal answering keeps the verdict", () => {
    // Hard times out on half its decisions (rollouts eat the deadline); Normal is healthy.
    const slowHard = withCounts({ decisions: 10, requests: 10, 'fallback:timeout': 5 }, 'hard');
    const verdict = verdictOf(slowHard);
    expect(verdict.status).toBe('ship-2-levels');
    expect(verdict.checks.find((c) => c.id === 'infrastructure-fallbacks')!.pass).toBe(true);
    expect(verdict.checks.find((c) => c.id === 'latency-timeouts')!.pass).toBe(false);
  });

  test('a run with no decision at all that reached Jev has no answered share to trust', () => {
    const none = withCounts({ decisions: 0, requests: 0 });
    expect(verdictOf(none).status).toBe('no-verdict');
  });
});

describe('a live smoke run on tuning seeds', () => {
  test('is not evidence and gives no verdict, but still shows the answered share', () => {
    const smoke = rows(40, 30, 10).map((r) => {
      const seed = r.seed - plan.seeds.first + 100_200;
      const blockId = blockIdOf(2, seed, r.focalSeat);
      return { ...r, seed, blockId, gameId: `${blockId}/${r.arm}` };
    });
    const report = analyzeG2(smoke, plan, { plannedBlocks: 40, resamples: 100 });
    expect(report.evidence).toBe('not-evidence: tuning seeds');
    expect(report.verdict.status).toBe('no-verdict');
    expect(report.verdict.checks.find((c) => c.id === 'jev-answered')!.detail).toContain(
      'hard 1.000',
    );
  });
});

describe('the seed-clustered sensitivity', () => {
  test('averages a seed’s two blocks and resamples whole seeds, and says nothing for a single seed', () => {
    const all = rows(40, 30, 10);
    const result = seedClusteredScore(all, { confidence: 0.95, analysisSeed: 1, resamples: 400 })!;
    expect(result.seeds).toBe(20);
    const report = analyzeG2(all, plan, { plannedBlocks: 40, resamples: 400 });
    expect(result.mean).toBeCloseTo(report.duel!.scoreDifference.mean, 9);
    expect(result.lo).toBeLessThan(result.mean);
    expect(result.hi).toBeGreaterThan(result.mean);
    expect(report.duel!.bySeedCluster).not.toBeNull();
    expect(
      seedClusteredScore(rows(2, 1), { confidence: 0.95, analysisSeed: 1, resamples: 100 }),
    ).toBeNull();
  });
});

describe('the runner: resume, held-out guard and analysis', () => {
  const smoke = ['--seed-base', String(SMOKE_BASE), '--seeds', '1'];

  test(
    'plays the plan, skips what is written on a rerun, survives a torn last line, and analyses it as not evidence',
    async () => {
      const out = join(dir, 'resume.rows.jsonl');
      const first = makeIo();
      expect(await runG2Cli([...smoke, '--out', out], first)).toBe(0);
      expect(first.lines.some((l) => l.includes('4 to play'))).toBe(true);
      const written = parseG2Rows(readFileSync(out, 'utf8'));
      expect(written.rows.map((r) => r.gameId)).toEqual(
        planG2Games(plan, { seedBase: SMOKE_BASE, seeds: 1 }).map((g) => g.gameId),
      );
      expect(written.rows.every((r) => r.plannedSeeds === 1)).toBe(true);
      // Rotation: Hard sat in seat 0 in one block and seat 1 in the other, with Normal opposite.
      expect(
        written.rows.filter((r) => r.arm === 'treatment').map((r) => r.seatPolicies.join('+')),
      ).toEqual(['jev-hard+jev', 'jev+jev-hard']);

      // An interrupted write: the last game's row is cut mid-line.
      const lines = readFileSync(out, 'utf8').trimEnd().split('\n');
      writeFileSync(out, `${lines.slice(0, 3).join('\n')}\n${lines[3]!.slice(0, 40)}`);
      const resumed = makeIo();
      expect(await runG2Cli([...smoke, '--out', out], resumed)).toBe(0);
      expect(resumed.lines[0]).toContain('3 already in');
      expect(resumed.lines[0]).toContain('1 to play');
      const after = parseG2Rows(readFileSync(out, 'utf8'));
      expect(after.rows).toHaveLength(4);
      expect(new Set(after.rows.map((r) => r.gameId)).size).toBe(4);

      const rerun = makeIo();
      expect(await runG2Cli([...smoke, '--out', out], rerun)).toBe(0);
      expect(rerun.lines[0]).toContain('0 to play');

      const report = makeIo();
      const json = join(dir, 'report.json');
      expect(
        await runG2Cli(
          [...smoke, '--out', out, '--analyze', '--resamples', '200', '--json', json],
          report,
        ),
      ).toBe(0);
      const text = report.lines.join('\n');
      expect(text).toContain('not-evidence: fake-client');
      expect(text).toContain('Verdict: no-verdict');
      expect(JSON.parse(readFileSync(json, 'utf8')).verdict.status).toBe('no-verdict');
    },
    SLOW,
  );

  test('refuses --held-out unless the run is live, and writes nothing', async () => {
    const out = join(dir, 'held-out.rows.jsonl');
    // Fake (no key) and disabled (kill switch): the guard must stop both before a game is created.
    for (const mode of ['fake', 'disabled'] as const) {
      const run = makeIo();
      expect(
        await runG2Cli(['--held-out', '--seeds', '1', '--out', out], run, neverPlays(mode)),
      ).toBe(2);
      expect(run.errors.join(), mode).toContain('needs a live run');
      expect(existsSync(out), mode).toBe(false);
    }
    // The offline backend is the default of the helper and is never live, whatever the shell holds.
    const offline = makeIo();
    expect(await runG2Cli(['--held-out', '--seeds', '1', '--out', out], offline)).toBe(2);
    expect(existsSync(out)).toBe(false);
  });

  test('refuses a seed base outside the tuning range, two seed choices and a mixed-mode rows file', async () => {
    const out = join(dir, 'guards.rows.jsonl');
    const a = makeIo();
    expect(await runG2Cli(['--seed-base', '1000002', '--out', out], a)).toBe(2);
    const b = makeIo();
    expect(await runG2Cli(['--out', out], b)).toBe(2);
    const c = makeIo();
    expect(await runG2Cli(['--seed-base', '100002', '--held-out', '--out', out], c)).toBe(2);
    writeFileSync(out, `${JSON.stringify(row(0, 'control', { mode: 'live', plannedSeeds: 1 }))}\n`);
    const d = makeIo();
    expect(await runG2Cli([...smoke, '--out', out], d)).toBe(2);
    expect(d.errors.join()).toContain('live rows');
  });

  test("--validate prints the power table; --analyze refuses rows that are not this plan's games", async () => {
    const v = makeIo();
    expect(await runG2Cli(['--validate'], v)).toBe(0);
    expect(v.lines.join('\n')).toContain('gap 0.1: 393 blocks, 198 seeds, 792 games');
    const out = join(dir, 'stray.rows.jsonl');
    writeFileSync(out, `${JSON.stringify(row(0, 'control'))}\n`);
    const a = makeIo();
    expect(await runG2Cli([...smoke, '--out', out, '--analyze'], a)).toBe(2);
    expect(a.errors.join()).toContain('not games of this plan');
  });

  test('--analyze --seeds k refuses a run that was not declared with k seeds, so a half-played run gets no verdict', async () => {
    const out = join(dir, 'half.rows.jsonl');
    // Two seeds declared (--seeds 2), one of them played: its rows say plannedSeeds 2.
    const half = planG2Games(plan, { seedBase: SMOKE_BASE, seeds: 2 }).slice(0, 4);
    writeFileSync(
      out,
      half
        .map((g) =>
          JSON.stringify(
            row(0, g.arm, {
              gameId: g.gameId,
              blockId: g.blockId,
              seed: g.seed,
              focalSeat: g.focalSeat,
              mode: 'fake',
              plannedSeeds: 2,
            }),
          ),
        )
        .join('\n') + '\n',
    );
    // Reading it as a finished one-seed run would complete every block; it is refused instead.
    const prefix = makeIo();
    expect(
      await runG2Cli(
        ['--seed-base', String(SMOKE_BASE), '--seeds', '1', '--out', out, '--analyze'],
        prefix,
      ),
    ).toBe(2);
    expect(prefix.errors.join()).toContain('declared when the run started');
    expect(prefix.lines).toEqual([]);
    // Without --seeds the analysis is for the whole plan: also not the declared 2.
    const whole = makeIo();
    expect(
      await runG2Cli(['--seed-base', String(SMOKE_BASE), '--out', out, '--analyze'], whole),
    ).toBe(2);
    // The declared n is accepted, and the missing blocks then give no verdict.
    const declared = makeIo();
    expect(
      await runG2Cli(
        ['--seed-base', String(SMOKE_BASE), '--seeds', '2', '--out', out, '--analyze'],
        declared,
      ),
    ).toBe(0);
    expect(declared.lines.join('\n')).toContain('Verdict: no-verdict');
  });

  test('a rows file started for another n is not continued', async () => {
    const out = join(dir, 'other-n.rows.jsonl');
    writeFileSync(out, `${JSON.stringify(row(0, 'control', { mode: 'fake', plannedSeeds: 3 }))}\n`);
    const run = makeIo();
    expect(await runG2Cli([...smoke, '--out', out], run)).toBe(2);
    expect(run.errors.join()).toContain('run of 3 seeds');
  });

  test('--max-thb stops before the next game and exits 3, leaving the rows to resume', async () => {
    const out = join(dir, 'cap.rows.jsonl');
    writeFileSync(
      out,
      `${JSON.stringify(row(0, 'control', { gameId: 'g2/2p/s100200/f0/control', blockId: 'g2/2p/s100200/f0', seed: 100200, mode: 'fake', plannedSeeds: 1, usage: { source: 'decision-counts', requests: 100, inputTokens: null, estimatedRequests: 0, thb: null } }))}\n`,
    );
    const run = makeIo();
    expect(await runG2Cli([...smoke, '--out', out, '--max-thb', '0.0001'], run)).toBe(3);
    expect(run.errors.join()).toContain('--max-thb');
  });
});
