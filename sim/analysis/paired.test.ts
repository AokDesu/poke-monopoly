import { describe, expect, it } from 'vitest';
import { analyzePaired, type PairedArm, type PairedGameRecord } from './paired.ts';

type Spec = {
  block: string;
  arm: PairedArm;
  winners?: readonly number[];
  coins?: readonly number[];
  seed?: number;
  seats?: number;
  focalSeat?: number;
  status?: 'completed' | 'aborted';
  policy?: string;
  seedSet?: 'tune' | 'eval';
  classes?: readonly string[];
  personalities?: readonly string[];
  invariantFailures?: number;
  abortReason?: string;
};

/** Builds one game record; the defaults describe a 2-seat tune game with focal seat 0. */
function rec(spec: Spec): PairedGameRecord {
  const seats = spec.seats ?? 2;
  const aborted = spec.status === 'aborted';
  return {
    blockId: spec.block,
    arm: spec.arm,
    policy: spec.policy ?? (spec.arm === 'treatment' ? 'always-pvp' : 'baseline'),
    seedSet: spec.seedSet ?? 'tune',
    seed: spec.seed ?? 100,
    seats,
    focalSeat: spec.focalSeat ?? 0,
    classBySeat: spec.classes ?? Array.from({ length: seats }, (_, i) => `class-${i}`),
    personalityBySeat: spec.personalities ?? Array.from({ length: seats }, () => 'unassigned'),
    status: spec.status ?? 'completed',
    winnerSeats: aborted ? [] : (spec.winners ?? [0]),
    finalCoins: spec.coins ?? Array.from({ length: seats }, () => 100),
    diagnostics: {
      steps: 50,
      abortReason: aborted ? (spec.abortReason ?? 'step-limit') : null,
      invariantFailures: spec.invariantFailures ?? 0,
    },
  };
}

/** Two blocks: a sole win against a loss, then a two-way tie against a sole win. */
function twoBlocks(): PairedGameRecord[] {
  return [
    rec({ block: 'b1', seed: 1, arm: 'treatment', winners: [0], coins: [300, 100] }),
    rec({ block: 'b1', seed: 1, arm: 'control', winners: [1], coins: [100, 300] }),
    rec({ block: 'b2', seed: 2, arm: 'treatment', winners: [0, 1], coins: [200, 200] }),
    rec({ block: 'b2', seed: 2, arm: 'control', winners: [0], coins: [250, 150] }),
  ];
}

describe('paired outcome scoring', () => {
  it('scores 1/k co-winner credit and differences per complete block', () => {
    const report = analyzePaired(twoBlocks());
    expect(report.comparisons).toHaveLength(1);
    const { overall } = report.comparisons[0]!.bySeatCount['2']!;

    expect(overall.n).toBe(2);
    expect(overall.arms.treatment).toMatchObject({ wins: 1, ties: 1, losses: 0 });
    expect(overall.arms.control).toMatchObject({ wins: 1, ties: 0, losses: 1 });
    expect(overall.arms.treatment.score).toBeCloseTo(0.75);
    expect(overall.arms.control.score).toBeCloseTo(0.5);

    // score: (1 - 0) and (0.5 - 1); win: (1 - 0) and (0 - 1); tie: (0 - 0) and (1 - 0).
    expect(overall.differences.score.mean).toBeCloseTo(0.25);
    expect(overall.differences.win.mean).toBeCloseTo(0);
    expect(overall.differences.tie.mean).toBeCloseTo(0.5);
    expect(overall.differences.loss.mean).toBeCloseTo(-0.5);
    // the focal seat's coins: (300 - 100) and (200 - 250)
    expect(overall.differences.coins.mean).toBeCloseTo(75);
  });

  it('reports the spec tie rate as the share of completed games with co-winners', () => {
    const { overall } = analyzePaired(twoBlocks()).comparisons[0]!.bySeatCount['2']!;
    expect(overall.arms.treatment.tieRate).toBeCloseTo(0.5);
    expect(overall.arms.control.tieRate).toBe(0);
  });

  it('labels the result as policy-only and names the unit of analysis', () => {
    const report = analyzePaired(twoBlocks());
    expect(report.claim).toBe('policy-only');
    expect(report.limitations.join(' ')).toMatch(/Jev/);
    expect(report.limitations.join(' ')).toMatch(/focal seat/);
    expect(report.comparisons[0]).toMatchObject({
      treatmentPolicy: 'always-pvp',
      controlPolicy: 'baseline',
    });
  });
});

describe('incomplete pairs', () => {
  it('counts games, complete pairs, missing pairs and aborted pairs without scoring them', () => {
    const records = [
      ...twoBlocks(),
      rec({ block: 'b3', seed: 3, arm: 'treatment' }), // control never recorded
      rec({ block: 'b4', seed: 4, arm: 'treatment', status: 'aborted' }),
      rec({ block: 'b4', seed: 4, arm: 'control' }),
      rec({ block: 'b5', seed: 5, arm: 'treatment', status: 'aborted' }), // control missing as well
    ];
    const { counts, comparisons } = analyzePaired(records);

    expect(counts.games).toBe(8);
    expect(counts.blocks).toBe(5);
    expect(counts.completePairs).toBe(2);
    expect(counts.missingPairs).toBe(2);
    expect(counts.missingBlockIds).toEqual(['b3', 'b5']);
    expect(counts.abortedPairs).toBe(1);
    expect(counts.abortedBlockIds).toEqual(['b4']);
    expect(counts.abortReasons).toEqual({ 'step-limit': 2 });
    expect(comparisons[0]!.pooledAcrossSeatCounts.n).toBe(2);
    expect(comparisons[0]!.counts).toMatchObject({ blocks: 3, completePairs: 2, abortedPairs: 1 });
  });
});

describe('checker failures and aborts per arm', () => {
  it('treats a pair with an invariant failure as incomplete: not scored, counted and reported', () => {
    const records = [
      ...twoBlocks(),
      rec({ block: 'bad', seed: 3, arm: 'treatment', invariantFailures: 2 }),
      rec({ block: 'bad', seed: 3, arm: 'control', winners: [1] }),
    ];
    const { counts, comparisons } = analyzePaired(records);
    expect(counts.completePairs).toBe(2);
    expect(counts.invariantPairs).toBe(1);
    expect(counts.invariantBlockIds).toEqual(['bad']);
    expect(counts.invariantFailures).toBe(2);
    expect(comparisons[0]!.counts).toMatchObject({
      blocks: 3,
      completePairs: 2,
      invariantPairs: 1,
    });
    expect(comparisons[0]!.pooledAcrossSeatCounts.n).toBe(2);
  });

  it('reports aborts per arm so complete-case dropping cannot hide policy-caused stops', () => {
    const records = [
      ...twoBlocks(),
      rec({ block: 'a1', seed: 3, arm: 'treatment', status: 'aborted' }),
      rec({ block: 'a1', seed: 3, arm: 'control' }),
      rec({ block: 'a2', seed: 4, arm: 'treatment', status: 'aborted', abortReason: 'stalled' }),
      rec({ block: 'a2', seed: 4, arm: 'control' }),
      rec({ block: 'a3', seed: 5, arm: 'treatment' }),
      rec({ block: 'a3', seed: 5, arm: 'control', status: 'aborted' }),
    ];
    const { counts, comparisons } = analyzePaired(records);
    expect(counts.abortsByArm).toEqual({
      treatment: { 'step-limit': 1, stalled: 1 },
      control: { 'step-limit': 1 },
    });
    expect(comparisons[0]!.counts.abortedByArm).toEqual({ treatment: 2, control: 1 });
  });
});

describe('record validation', () => {
  const treatment = rec({ block: 'b1', seed: 1, arm: 'treatment' });
  const control = rec({ block: 'b1', seed: 1, arm: 'control' });

  it('rejects a duplicate arm in one block', () => {
    expect(() => analyzePaired([treatment, control, treatment])).toThrow(/duplicate/i);
  });

  it('rejects the same game recorded under two block ids', () => {
    const again = rec({ block: 'b2', seed: 1, arm: 'treatment' });
    expect(() => analyzePaired([treatment, control, again])).toThrow(/duplicate game/i);
  });

  it.each([
    ['seed', { seed: 2 }],
    ['seat count', { seats: 3 }],
    ['focal seat', { focalSeat: 1 }],
    ['class assignment', { classes: ['class-1', 'class-0'] }],
    ['personality assignment', { personalities: ['careful', 'unassigned'] }],
  ] as const)('rejects a block whose arms disagree on the %s', (_name, change) => {
    const other = rec({ block: 'b1', seed: 1, arm: 'control', ...change });
    expect(() => analyzePaired([treatment, other])).toThrow(/mismatched block b1/i);
  });

  it('rejects tune and eval records in one analysis', () => {
    const evalTreatment = rec({
      block: 'e1',
      seed: 1_000_005,
      arm: 'treatment',
      seedSet: 'eval',
    });
    const evalControl = rec({ block: 'e1', seed: 1_000_005, arm: 'control', seedSet: 'eval' });
    expect(() => analyzePaired([treatment, control, evalTreatment, evalControl])).toThrow(
      /mixes tune and eval/i,
    );
  });

  it('rejects a seed outside its declared seed set', () => {
    const early = rec({ block: 'e1', seed: 5, arm: 'treatment', seedSet: 'eval' });
    expect(() => analyzePaired([early])).toThrow(/eval seeds start at 1000000/i);
    const late = rec({ block: 't1', seed: 1_000_005, arm: 'treatment', seedSet: 'tune' });
    expect(() => analyzePaired([late])).toThrow(/tune seeds stay below 1000000/i);
  });

  it('rejects an expected seed set that the records do not carry', () => {
    expect(() => analyzePaired([treatment, control], { seedSet: 'eval' })).toThrow(
      /expected eval records/i,
    );
  });

  it.each([
    ['a focal seat outside the table', { focalSeat: 2 }],
    ['a winner outside the table', { winners: [5] }],
    ['a completed game without winners', { winners: [] }],
    ['final coins for the wrong number of seats', { coins: [100] }],
  ] as const)('rejects %s', (_name, change) => {
    expect(() => analyzePaired([rec({ block: 'b1', arm: 'treatment', ...change })])).toThrow(
      RangeError,
    );
  });
});

/** `count` blocks where the treatment gains `gain` coins plus noise and wins the first `winsAbove`. */
function manyBlocks(
  count: number,
  options: { gain: number; winsAbove: number },
): PairedGameRecord[] {
  const records: PairedGameRecord[] = [];
  for (let i = 0; i < count; i++) {
    const treatmentWins = i < options.winsAbove;
    records.push(
      rec({
        block: `m${i}`,
        seed: 500 + i,
        arm: 'treatment',
        winners: treatmentWins ? [0] : [1],
        coins: [200 + options.gain + (i % 7) * 13 + (i % 3), 100],
      }),
      rec({
        block: `m${i}`,
        seed: 500 + i,
        arm: 'control',
        winners: [1],
        coins: [200 + (i % 3), 100],
      }),
    );
  }
  return records;
}

describe('paired uncertainty', () => {
  it('is reproducible for one analysis seed and changes with another', () => {
    const records = manyBlocks(20, { gain: 40, winsAbove: 12 });
    const a = analyzePaired(records, { analysisSeed: 7, resamples: 50 });
    const b = analyzePaired(records, { analysisSeed: 7, resamples: 50 });
    const c = analyzePaired(records, { analysisSeed: 8, resamples: 50 });
    expect(b).toEqual(a);
    expect(a.analysisSeed).toBe(7);
    expect(c.comparisons[0]!.bySeatCount['2']!.overall.differences.coins).not.toEqual(
      a.comparisons[0]!.bySeatCount['2']!.overall.differences.coins,
    );
  });

  it('reports a default analysis seed, resample count and method', () => {
    const report = analyzePaired(manyBlocks(4, { gain: 0, winsAbove: 0 }));
    expect(report.analysisSeed).toBe(610004);
    expect(report.resamples).toBe(10000);
    expect(report.confidence).toBe(0.95);
    expect(report.method).toMatch(/paired block/i);
  });

  it('excludes zero for a consistent positive paired difference', () => {
    const { overall } = analyzePaired(manyBlocks(20, { gain: 40, winsAbove: 20 })).comparisons[0]!
      .bySeatCount['2']!;
    expect(overall.differences.coins.mean).toBeGreaterThan(40);
    expect(overall.differences.coins.lo).toBeGreaterThan(40);
    expect(overall.differences.score.lo).toBeGreaterThan(0);
  });

  it('keeps a zero paired difference inside its interval', () => {
    const records: PairedGameRecord[] = [];
    for (let i = 0; i < 20; i++) {
      // Same outcome in both arms, but outcomes vary between blocks.
      const winners = i % 2 === 0 ? [0] : [1];
      const coins = [150 + (i % 5) * 20, 100];
      records.push(
        rec({ block: `z${i}`, seed: 900 + i, arm: 'treatment', winners, coins }),
        rec({ block: `z${i}`, seed: 900 + i, arm: 'control', winners, coins }),
      );
    }
    const { overall } = analyzePaired(records).comparisons[0]!.bySeatCount['2']!;
    expect(overall.differences.score).toMatchObject({ mean: 0, lo: 0, hi: 0 });
    expect(overall.differences.coins).toMatchObject({ mean: 0, lo: 0, hi: 0 });
    expect(overall.differences.score.lo).toBeLessThanOrEqual(0);
    expect(overall.differences.score.hi).toBeGreaterThanOrEqual(0);
  });

  it('preserves arm correlation: a shared block effect does not widen the interval', () => {
    // Block coins swing by 1,000 between blocks but treatment always adds exactly 10.
    const records: PairedGameRecord[] = [];
    for (let i = 0; i < 12; i++) {
      const base = 100 + i * 1000;
      records.push(
        rec({ block: `c${i}`, seed: 300 + i, arm: 'treatment', coins: [base + 10, 100] }),
        rec({ block: `c${i}`, seed: 300 + i, arm: 'control', winners: [1], coins: [base, 100] }),
      );
    }
    const { coins } = analyzePaired(records).comparisons[0]!.bySeatCount['2']!.overall.differences;
    expect(coins.mean).toBeCloseTo(10);
    expect(coins.lo).toBeCloseTo(10);
    expect(coins.hi).toBeCloseTo(10);
  });

  it('pins the paired standardized effect: block differences 1 and -0.5 give 0.2357', () => {
    const { overall } = analyzePaired(twoBlocks()).comparisons[0]!.bySeatCount['2']!;
    // mean 0.25, sample SD sqrt(((0.75)^2 + (0.75)^2) / 1) = 1.0607
    expect(overall.effectSize.score).toBeCloseTo(0.2357, 4);
    // coins: differences 200 and -50, mean 75, SD 176.78
    expect(overall.effectSize.coins).toBeCloseTo(0.4243, 4);
  });

  it('does not depend on the order of the input rows', () => {
    const records = manyBlocks(20, { gain: 40, winsAbove: 12 });
    const shuffled = [...records].reverse();
    shuffled.push(shuffled.splice(3, 1)[0]!);
    expect(analyzePaired(shuffled)).toEqual(analyzePaired(records));
  });

  it('gives no interval below two complete pairs', () => {
    const { overall } = analyzePaired([
      rec({ block: 'only', seed: 1, arm: 'treatment' }),
      rec({ block: 'only', seed: 1, arm: 'control', winners: [1] }),
    ]).comparisons[0]!.bySeatCount['2']!;
    expect(overall.n).toBe(1);
    expect(overall.differences.score.mean).toBe(1);
    expect(overall.differences.score.lo).toBeNull();
    expect(overall.differences.score.hi).toBeNull();
  });
});

describe('strata and seat rotations', () => {
  function rotated(): PairedGameRecord[] {
    const records: PairedGameRecord[] = [];
    for (const [seats, focalSeat, count] of [
      [2, 0, 3],
      [2, 1, 3],
      [3, 2, 2],
    ] as const) {
      for (let i = 0; i < count; i++) {
        const block = `s${seats}f${focalSeat}-${i}`;
        const seed = seats * 1000 + focalSeat * 100 + i;
        const classes = Array.from({ length: seats }, (_, s) => (s === focalSeat ? 'tank' : 'x'));
        const personalities = Array.from({ length: seats }, (_, s) =>
          s === focalSeat ? 'greedy' : 'careful',
        );
        records.push(
          rec({
            block,
            seed,
            seats,
            focalSeat,
            arm: 'treatment',
            winners: [focalSeat],
            classes,
            personalities,
          }),
          rec({
            block,
            seed,
            seats,
            focalSeat,
            arm: 'control',
            winners: [(focalSeat + 1) % seats],
            classes,
            personalities,
          }),
        );
      }
    }
    return records;
  }

  it('reports n per seat count, never silently pooled across seat counts', () => {
    const { bySeatCount, pooledAcrossSeatCounts } = analyzePaired(rotated()).comparisons[0]!;
    const counts = (group: Record<string, { n: number }>) =>
      Object.fromEntries(Object.entries(group).map(([key, value]) => [key, value.n]));

    expect(Object.keys(bySeatCount)).toEqual(['2', '3']);
    expect(bySeatCount['2']!.overall.n).toBe(6);
    expect(bySeatCount['3']!.overall.n).toBe(2);
    expect(counts(bySeatCount['2']!.strata.focalSeat)).toEqual({ '0': 3, '1': 3 });
    expect(counts(bySeatCount['3']!.strata.focalSeat)).toEqual({ '2': 2 });
    expect(counts(bySeatCount['2']!.strata.focalClass)).toEqual({ tank: 6 });
    expect(pooledAcrossSeatCounts.n).toBe(8);
  });

  it('strata by the background personality, not the focal seat', () => {
    const { bySeatCount } = analyzePaired(rotated()).comparisons[0]!;
    expect(Object.keys(bySeatCount['2']!.strata.backgroundPersonality)).toEqual(['careful']);
    expect(Object.keys(bySeatCount['3']!.strata.backgroundPersonality)).toEqual(['careful']);
    expect(bySeatCount['2']!.strata).not.toHaveProperty('focalPersonality');
  });

  it('treats the blocks, not the seats of a game, as the sample size', () => {
    // 3 seats per game still give one observation per block: the focal seat only.
    const { bySeatCount } = analyzePaired(rotated()).comparisons[0]!;
    const { overall } = bySeatCount['3']!;
    expect(overall.n).toBe(2);
    expect(
      overall.arms.treatment.wins + overall.arms.treatment.ties + overall.arms.treatment.losses,
    ).toBe(2);
  });

  it('gives null bounds when any resampling cell has fewer than 2 blocks', () => {
    const records: PairedGameRecord[] = [];
    for (const [focalSeat, count] of [
      [0, 4],
      [1, 1],
    ] as const) {
      for (let i = 0; i < count; i++) {
        const block = `r${focalSeat}-${i}`;
        const seed = 700 + focalSeat * 10 + i;
        const winners = i % 2 === 0 ? [focalSeat] : [1 - focalSeat];
        records.push(
          rec({ block, seed, focalSeat, arm: 'treatment', winners }),
          rec({ block, seed, focalSeat, arm: 'control', winners: [1 - focalSeat] }),
        );
      }
    }
    const two = analyzePaired(records).comparisons[0]!.bySeatCount['2']!;
    expect(two.overall.n).toBe(5);
    expect(two.overall.differences.score.mean).toBeCloseTo(0.6);
    expect(two.overall.differences.score.lo).toBeNull();
    expect(two.overall.differences.score.hi).toBeNull();
    // the focal-seat-1 stratum has one block; the focal-seat-0 stratum has four.
    expect(two.strata.focalSeat['1']!.differences.score.lo).toBeNull();
    expect(two.strata.focalSeat['0']!.differences.score.lo).not.toBeNull();
  });

  it('separates comparisons by policy pair', () => {
    const records = [
      ...twoBlocks(),
      rec({ block: 'x1', seed: 11, arm: 'treatment', policy: 'never-negotiate' }),
      rec({ block: 'x1', seed: 11, arm: 'control', policy: 'baseline', winners: [1] }),
    ];
    const { comparisons } = analyzePaired(records);
    expect(comparisons.map((c) => [c.treatmentPolicy, c.pooledAcrossSeatCounts.n])).toEqual([
      ['always-pvp', 2],
      ['never-negotiate', 1],
    ]);
  });
});
