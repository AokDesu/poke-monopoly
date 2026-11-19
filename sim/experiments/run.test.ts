import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';
import { checkInvariants } from '../../engine/index.ts';
import { analyzePaired } from '../analysis/paired.ts';
import { realEngine } from '../engine.ts';
import {
  EXPERIMENT_POLICIES,
  EXPLOIT_POLICY_IDS,
  POLICIES,
  type Policy,
  type PolicyGame,
  type SeedlessPolicyFactory,
} from '../policy.ts';
import { seatPolicies, seatSetup, type InvariantCheck } from '../runner.ts';
import { DEFAULT_MANIFEST, runExperimentCli } from './main.ts';
import {
  backgroundPolicy,
  manifestSha256,
  parseManifest,
  planGame,
  planGames,
  playPlan,
  reproducePlan,
  rowFields,
  sanitizeReason,
  toPairedRecord,
  validateManifest,
  type GamePlan,
  type GameRow,
  type Provenance,
} from './run.ts';

const manifestText = readFileSync(DEFAULT_MANIFEST, 'utf8');
const manifest = parseManifest(JSON.parse(manifestText));
const provenance: Provenance = {
  mainSha: 'test-sha',
  engineVersion: 'test-engine',
  contentVersion: 'test-content',
  manifestSha256: manifestSha256(manifestText),
};
const noViolations: InvariantCheck = () => [];
/** A tuning-range base (a multiple of the class count) for runs below the evaluation floor. */
const SMOKE_BASE = 100_200;
const SLOW = 120_000;
const dir = mkdtempSync(join(tmpdir(), 'poke-experiment-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function cellOf(policy: string, seats: number) {
  const found = manifest.cells.find((c) => c.policy === policy && c.seats === seats);
  if (!found) throw new Error(`no cell ${policy}/${seats}`);
  return found;
}

function plan(policy: string, seats: number, block: number, arm: 'control' | 'treatment') {
  return planGame(manifest, cellOf(policy, seats), block, arm, SMOKE_BASE);
}

describe('the manifest on this engine', () => {
  test('is runnable: every policy registered, counts and class rotation match the sim', () => {
    expect(validateManifest(manifest, EXPERIMENT_POLICIES, realEngine.classIds)).toEqual([]);
    expect(manifest.cells).toHaveLength(21);
    expect(manifest.cells.reduce((n, c) => n + c.games, 0)).toBe(1008);
  });

  test('reports an unregistered policy, a wrong class and a shared seed', () => {
    const without = Object.fromEntries(
      Object.entries(EXPERIMENT_POLICIES).filter(([id]) => id !== 'sell-all'),
    );
    expect(validateManifest(manifest, without, realEngine.classIds)).toContain(
      'policy sell-all is not registered',
    );
    const wrongClass = structuredClone(manifest);
    wrongClass.schedule.seats2[0]!.focalClass = 'researcher';
    const problems = validateManifest(wrongClass, EXPERIMENT_POLICIES, realEngine.classIds);
    // The 2-seat schedule is shared by the seven 2-seat cells, so each reports it.
    expect(problems).toHaveLength(7);
    expect(problems.every((problem) => problem.includes('focal class researcher'))).toBe(true);
    const overlap = structuredClone(manifest);
    overlap.cells[1]!.seedFirst = overlap.cells[0]!.seedFirst;
    overlap.cells[1]!.seedLast = overlap.cells[0]!.seedLast;
    expect(
      validateManifest(overlap, EXPERIMENT_POLICIES, realEngine.classIds).some((p) =>
        p.includes('is in two cells'),
      ),
    ).toBe(true);
  });

  test('the manifest game-row table is a subset of the fields a row writes', async () => {
    const row = await playPlan(
      realEngine,
      { ...plan('always-pvp', 2, 0, 'treatment'), maxSteps: 20 },
      EXPERIMENT_POLICIES,
      noViolations,
      provenance,
    );
    const written = new Set(rowFields(row));
    expect(manifest.tables.gameRow.filter((name) => !written.has(name))).toEqual([]);
  });
});

describe('arms differ only in the policy assignment', () => {
  test('every block of every cell: one focal seat differs, nothing else', () => {
    for (const entry of manifest.cells) {
      for (const row of planGames(manifest, { policy: entry.policy, seats: entry.seats }).filter(
        (p) => p.arm === 'control',
      )) {
        const control = row;
        const treatment = planGame(manifest, entry, control.block, 'treatment');
        const shared = (p: GamePlan) => ({ ...p, arm: '', gameId: '', seatPolicies: [] });
        const controlSeats = control.seatPolicies;
        const treatmentSeats = treatment.seatPolicies;
        expect(shared(treatment)).toEqual(shared(control));
        const differing = controlSeats.flatMap((id, seat) =>
          id === treatmentSeats[seat] ? [] : [seat],
        );
        expect(differing).toEqual([control.focalSeat]);
        expect(controlSeats[control.focalSeat]).toBe(manifest.baseline.policy);
        expect(treatmentSeats[control.focalSeat]).toBe(entry.policy);
        // Every other seat is the block's background personality, in both arms.
        const background = backgroundPolicy(control.backgroundPersonality as never);
        controlSeats.forEach((id, seat) => {
          if (seat === control.focalSeat) return;
          const human = entry.social && seat === 0;
          expect(id).toBe(human ? manifest.baseline.policy : background);
        });
      }
    }
  });

  test('the whole design is 1,008 distinct physical games, control before treatment', () => {
    const plans = planGames(manifest);
    expect(plans).toHaveLength(1008);
    expect(new Set(plans.map((p) => p.gameId)).size).toBe(1008);
    expect(plans.slice(0, 2).map((p) => p.arm)).toEqual(['control', 'treatment']);
    expect(plans[0]!.blockId).toBe(plans[1]!.blockId);
    expect(plans[0]!.seed).toBe(plans[1]!.seed);
  });

  test('the Social window seats the human at 0 on the baseline unless it is the focal seat', () => {
    const social = planGames(manifest, { policy: 'never-negotiate' });
    expect(social.every((p) => p.social)).toBe(true);
    for (const p of social) {
      expect(p.seatPolicies[0]).toBe(p.focalSeat === 0 ? p.seatPolicies[0] : 'random');
    }
    expect(social.some((p) => p.focalSeat === 0 && p.arm === 'treatment')).toBe(true);
    expect(planGames(manifest, { policy: 'sell-all' }).every((p) => !p.social)).toBe(true);
  });

  test('a smoke seed base moves every range and must keep the class rotation', () => {
    const smoke = planGames(manifest, {}, SMOKE_BASE);
    expect(Math.min(...smoke.map((p) => p.seed))).toBe(SMOKE_BASE);
    // The cell's class rotation survives the move: each block still seats its scheduled class.
    for (const p of smoke) {
      const seatClass = seatSetup(realEngine.classIds, p.cell.seats, p.seed)[p.focalSeat]!.classId;
      expect(seatClass).toBe(p.focalClass);
    }
    expect(() => planGame(manifest, cellOf('sell-all', 2), 0, 'control', SMOKE_BASE + 1)).toThrow(
      /multiple of 6/,
    );
  });

  test(
    'a real block: both arms share seed, classes and background, and differ at the focal seat',
    async () => {
      const control = await playPlan(
        realEngine,
        plan('always-pvp', 2, 0, 'control'),
        EXPERIMENT_POLICIES,
        checkInvariants,
        provenance,
      );
      const treatment = await playPlan(
        realEngine,
        plan('always-pvp', 2, 0, 'treatment'),
        EXPERIMENT_POLICIES,
        checkInvariants,
        provenance,
      );
      expect(treatment.seed).toBe(control.seed);
      expect(treatment.seatClasses).toEqual(control.seatClasses);
      expect(treatment.focalSeat).toBe(control.focalSeat);
      expect(treatment.backgroundPersonality).toBe(control.backgroundPersonality);
      const focal = control.focalSeat;
      expect(control.seatPolicies[focal]).toBe('random');
      expect(treatment.seatPolicies[focal]).toBe('always-pvp');
      expect(treatment.seatPolicies.filter((_, i) => i !== focal)).toEqual(
        control.seatPolicies.filter((_, i) => i !== focal),
      );
      // The control seat's chances are counted with the treatment's definition (vacuity rule).
      for (const row of [control, treatment]) {
        expect(row.failureReasons).toEqual([]);
        expect(row.finished).toBe(true);
        expect(row.replayPass).toBe(true);
      }
      // The pair feeds the paired analysis as one complete block.
      const report = analyzePaired([toPairedRecord(control), toPairedRecord(treatment)], {
        resamples: 20,
      });
      expect(report.counts.completePairs).toBe(1);
    },
    SLOW,
  );
});

describe('all seven policy selectors are reachable', () => {
  test('each id is registered and builds its own policy class from a no-argument factory', () => {
    const classes = EXPLOIT_POLICY_IDS.map((id) => {
      expect(Object.hasOwn(EXPERIMENT_POLICIES, id)).toBe(true);
      expect(Object.hasOwn(POLICIES, id)).toBe(true);
      expect(EXPERIMENT_POLICIES[id]!.length).toBe(0);
      return EXPERIMENT_POLICIES[id]!().constructor.name;
    });
    expect(EXPLOIT_POLICY_IDS).toHaveLength(7);
    expect(new Set(classes).size).toBe(7);
    expect(manifest.policies.map((p) => p.id).sort()).toEqual([...EXPLOIT_POLICY_IDS].sort());
  });

  test('the manifest selects each of the seven as the focal treatment seat', () => {
    for (const id of EXPLOIT_POLICY_IDS) {
      const treatments = planGames(manifest, { policy: id, arms: ['treatment'] });
      expect(treatments).toHaveLength(72);
      expect(
        treatments.every((p) => p.seatPolicies[p.focalSeat] === id && p.cell.policy === id),
      ).toBe(true);
    }
  });

  test(
    'each plays a real treatment game and leaves a row',
    async () => {
      for (const id of EXPLOIT_POLICY_IDS) {
        const row = await playPlan(
          realEngine,
          plan(id, 2, 0, 'treatment'),
          EXPERIMENT_POLICIES,
          checkInvariants,
          provenance,
        );
        expect(row.seatPolicies[row.focalSeat]).toBe(id);
        expect(row.finished, `${id}: ${row.abortReason}`).toBe(true);
        expect(row.failureReasons, id).toEqual([]);
      }
    },
    SLOW,
  );
});

describe('policies never receive the seed or private state', () => {
  const poisoned: PolicyGame = {
    get seed(): number {
      throw new Error('a policy factory read the game seed');
    },
  };

  test('no registered experiment policy factory reads the game it is handed', () => {
    for (const [id, factory] of Object.entries(EXPERIMENT_POLICIES)) {
      expect(() => (factory as (game: PolicyGame) => Policy)(poisoned), id).not.toThrow();
    }
    for (const id of EXPLOIT_POLICY_IDS) {
      const pick = seatPolicies({ policy: id, seats: 2 }, POLICIES);
      expect(() => pick({ seatIndex: 0, actorId: 'a', classId: 'c' }, poisoned), id).not.toThrow();
    }
  });

  test('the experiment runner calls every factory with no argument', async () => {
    const calls: number[] = [];
    const spy = Object.fromEntries(
      Object.entries(EXPERIMENT_POLICIES).map(([id, factory]) => [
        id,
        ((...args: unknown[]) => {
          calls.push(args.length);
          return (factory as () => Policy)();
        }) as SeedlessPolicyFactory,
      ]),
    );
    await playPlan(
      realEngine,
      { ...plan('always-pvp', 3, 0, 'treatment'), maxSteps: 5 },
      spy,
      noViolations,
      provenance,
    );
    expect(calls).toHaveLength(3);
    expect(calls.every((n) => n === 0)).toBe(true);
  });

  test(
    'nothing handed to decide carries a seed or an RNG state',
    async () => {
      const seen: string[] = [];
      const registry = {
        ...EXPERIMENT_POLICIES,
        'always-pvp': (): Policy => ({
          wantsFacts: true,
          decide(observation, legal, rng, facts) {
            seen.push(JSON.stringify({ observation, legal, facts }));
            // The RNG offers only `int`; there is no seed to read from it.
            expect(Object.keys(rng)).toEqual(['int']);
            return legal.enabled[0]!.id;
          },
        }),
      };
      const row = await playPlan(
        realEngine,
        { ...plan('always-pvp', 2, 0, 'treatment'), maxSteps: 150 },
        registry,
        noViolations,
        provenance,
      );
      expect(seen.length).toBeGreaterThan(10);
      const text = seen.join('\n');
      expect(text).not.toMatch(/"(seed|rng|rngState|rngCursor)"\s*:/i);
      expect(text).not.toContain(String(row.seed) + ',"');
    },
    SLOW,
  );
});

describe('one sanitized row per game, aborts included', () => {
  test(
    'a step-limited game is an aborted row with its reason and no replay',
    async () => {
      const row = await playPlan(
        realEngine,
        { ...plan('sell-all', 2, 0, 'treatment'), maxSteps: 30 },
        EXPERIMENT_POLICIES,
        noViolations,
        provenance,
      );
      expect(row.finished).toBe(false);
      expect(row.abortReason).toBe('max steps 30');
      expect(row.replayPass).toBeNull();
      expect(row.winners).toEqual([]);
      expect(row.focalWinCredit).toBe(0);
      expect(row.failureReasons).toEqual(['aborted: max steps 30']);
      expect(toPairedRecord(row).status).toBe('aborted');
    },
    SLOW,
  );

  test(
    'a policy that throws is an abort row, never a missing row',
    async () => {
      const registry = {
        ...EXPERIMENT_POLICIES,
        'sell-all': (): Policy => ({
          decide() {
            throw new Error('boom\nwith\u0007 control characters');
          },
        }),
      };
      const row = await playPlan(
        realEngine,
        plan('sell-all', 2, 0, 'treatment'),
        registry,
        noViolations,
        provenance,
      );
      expect(row.finished).toBe(false);
      expect(row.abortReason).toBe('error: boom with control characters');
      expect(row.failureReasons).toEqual(['aborted: error: boom with control characters']);
    },
    SLOW,
  );

  test('a factory that throws before the game starts is also a row', async () => {
    const registry = {
      ...EXPERIMENT_POLICIES,
      'sell-all': (): Policy => {
        throw new Error('no such policy');
      },
    };
    const row = await playPlan(
      realEngine,
      plan('sell-all', 2, 0, 'treatment'),
      registry,
      noViolations,
      provenance,
    );
    expect(row.abortReason).toBe('error: no such policy');
    expect(row.steps).toBe(0);
  });

  test(
    'invariant failures and illegal applied actions are failing reasons',
    async () => {
      const violating: InvariantCheck = () => [{ code: 'x', message: 'bad' } as never];
      const row = await playPlan(
        realEngine,
        { ...plan('always-pvp', 2, 0, 'control'), maxSteps: 40 },
        EXPERIMENT_POLICIES,
        violating,
        provenance,
      );
      expect(row.invariantFailures).toBeGreaterThan(0);
      expect(row.failureReasons).toContain(`invariant failures: ${row.invariantFailures}`);
    },
    SLOW,
  );

  test(
    'a row holds counts and identifiers only',
    async () => {
      const row = await playPlan(
        realEngine,
        { ...plan('never-negotiate', 2, 0, 'control'), maxSteps: 200 },
        EXPERIMENT_POLICIES,
        noViolations,
        provenance,
      );
      const keys = new Set<string>();
      const walk = (value: unknown): void => {
        if (value && typeof value === 'object') {
          for (const [key, inner] of Object.entries(value)) {
            keys.add(key);
            walk(inner);
          }
        }
      };
      walk(row);
      for (const forbidden of ['hand', 'deck', 'rng', 'state', 'observation', 'apiKey', 'key']) {
        expect([...keys].filter((k) => k.toLowerCase() === forbidden)).toEqual([]);
      }
      expect(row).toMatchObject({ mainSha: 'test-sha', manifestSha256: provenance.manifestSha256 });
      expect(JSON.stringify(row)).not.toMatch(/ANTHROPIC|TYPESAFE/);
    },
    SLOW,
  );

  test('sanitizeReason is one short line', () => {
    expect(sanitizeReason('a\r\nb\u0000c  d')).toBe('a b c d');
    expect(sanitizeReason('x'.repeat(500))).toHaveLength(160);
  });
});

describe('the exploit moments are counted the same way in both arms', () => {
  test(
    'never-negotiate in the Social window has real offer opportunities in both arms',
    async () => {
      const rows: GameRow[] = [];
      for (const arm of ['control', 'treatment'] as const) {
        rows.push(
          await playPlan(
            realEngine,
            plan('never-negotiate', 2, 0, arm),
            EXPERIMENT_POLICIES,
            checkInvariants,
            provenance,
          ),
        );
      }
      const [control, treatment] = rows as [GameRow, GameRow];
      // Block 0 seats the human at 0, which is the focal seat: it can chat and offer promises.
      expect(control.focalSeat).toBe(0);
      expect(control.focalOpportunities.offer).toBeGreaterThan(0);
      expect(treatment.focalOpportunities.offer).toBeGreaterThan(0);
      // Never-negotiate takes every one; the baseline does not.
      expect(treatment.focalUses.offer).toBe(treatment.focalOpportunities.offer);
      expect(control.focalUses.offer ?? 0).toBeLessThan(control.focalOpportunities.offer!);
      expect(treatment.socialWindow).toBe(true);
    },
    SLOW,
  );
});

describe('the experiment CLI', () => {
  const run = async (args: string[], check: InvariantCheck = noViolations) => {
    const out: string[] = [];
    const err: string[] = [];
    const code = await runExperimentCli(
      args,
      realEngine,
      check,
      { log: (line) => out.push(line), error: (line) => err.push(line) },
      () => provenance,
    );
    return { code, out, err };
  };

  test('--validate runs no game', async () => {
    expect(await run(['--validate'])).toMatchObject({ code: 0, out: ['manifest ok: 21 cells'] });
  });

  test('refuses to run without choosing a range, and refuses the held-out range by default', async () => {
    const file = join(dir, 'none.jsonl');
    for (const args of [
      ['--policy', 'sell-all', '--out', file],
      ['--policy', 'sell-all', '--seed-base', '100200', '--held-out', '--out', file],
    ]) {
      const result = await run(args);
      expect(result.code).toBe(2);
      expect(result.err.join('\n')).toContain('exactly one of --seed-base');
    }
    expect((await run(['--seed-base', '100200'])).code).toBe(2);
    expect((await run(['--bogus'])).code).toBe(2);
    const outside = await run(['--seed-base', '1000002', '--out', file]);
    expect(outside.err.join('\n')).toContain('--seed-base keeps every seed within');
    // A copy of the plan moved below the evaluation floor: `--held-out` must refuse it before any
    // game. (Never pass `--held-out` with the real manifest in a test: that plays the held-out set.)
    const shifted = structuredClone(manifest);
    for (const entry of shifted.cells) {
      entry.seedFirst -= 1_000_002;
      entry.seedLast -= 1_000_002;
    }
    const shiftedFile = join(dir, 'shifted.json');
    writeFileSync(shiftedFile, JSON.stringify(shifted));
    expect(
      await run(['--manifest', shiftedFile, '--held-out', '--policy', 'sell-all', '--out', file]),
    ).toMatchObject({
      code: 2,
      err: ['experiment: a manifest range below the evaluation floor needs --seed-base'],
    });
    expect(existsSync(file)).toBe(false);
  });

  test(
    'writes one row per selected game and exits 0',
    async () => {
      const file = join(dir, 'rows.jsonl');
      const { code, out } = await run(
        [
          ...['--seed-base', String(SMOKE_BASE), '--policy', 'keep-to-evolve', '--seats', '2'],
          ...['--blocks', '0-0', '--out', file],
        ],
        checkInvariants,
      );
      expect(code).toBe(0);
      expect(out).toEqual([expect.stringContaining('2 games, 0 failing')]);
      const rows = readFileSync(file, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as GameRow);
      expect(rows.map((r) => r.arm)).toEqual(['control', 'treatment']);
      expect(rows.every((r) => r.mainSha === 'test-sha')).toBe(true);
    },
    SLOW,
  );

  test(
    'keeps the failing seed, its reasons and a reproduce command, and exits 1',
    async () => {
      const file = join(dir, 'failing.jsonl');
      const violating: InvariantCheck = () => [{ code: 'x', message: 'bad' } as never];
      const { code, err } = await run(
        [
          ...['--seed-base', String(SMOKE_BASE), '--policy', 'always-pvp', '--seats', '2'],
          ...['--blocks', '0-0', '--arms', 'treatment', '--out', file],
        ],
        violating,
      );
      expect(code).toBe(1);
      const [row] = readFileSync(file, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as GameRow);
      expect(row!.failureReasons.length).toBeGreaterThan(0);
      expect(err.join('\n')).toContain(`seed ${row!.seed} failed`);
      expect(err.join('\n')).toContain(
        reproducePlan(plan('always-pvp', 2, 0, 'treatment'), SMOKE_BASE),
      );
    },
    SLOW,
  );
});
