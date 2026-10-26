import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ESLint } from 'eslint';
import { afterAll, describe, expect, test, vi } from 'vitest';
import { CONTENT_VERSION } from '../content/index.ts';
import {
  actionSchema,
  checkInvariants,
  fixtureSchema,
  GAME_PRESETS,
  observe,
  type Action,
  type ApplyActionResult,
  type GameState,
  type LegalActions,
} from '../engine/index.ts';
import fixture from '../engine/fixtures/start-of-game-2p.json';
import { parseSimArgs } from './args.ts';
import { loadContent } from './content.ts';
import { runCli } from './main.ts';
import {
  createPolicyRng,
  POLICIES,
  RandomPolicy,
  type Policy,
  type PolicyFactory,
} from './policy.ts';
import { realEngine } from './engine.ts';
import {
  failed,
  runSim,
  seatSetup,
  type GameSetup,
  type InvariantCheck,
  type SimEngine,
  type SimOptions,
} from './runner.ts';

const CLASSES = ['alpha', 'beta', 'gamma', 'delta'];
const base = fixtureSchema.parse(fixture).state;

/**
 * Tiny fake engine implementing the contract: each turn the active seat may take a coin, skip,
 * or (disabled, too expensive) take five coins; the roll then passes the turn. The game ends
 * after `lapTarget` turns per seat; the most coins win.
 */
function fakeEngine(
  options: { acceptIllegal?: boolean; neverFinish?: boolean; crashSeed?: number } = {},
): SimEngine {
  const legalActions = (state: GameState, seatIndex: number): LegalActions => {
    if (seatIndex !== state.activeSeatIndex || state.phase.kind === 'finished') {
      return { enabled: [], disabled: [] };
    }
    if (state.phase.kind === 'move') {
      return { enabled: [{ id: 'roll', kind: 'roll', payload: {} }], disabled: [] };
    }
    return {
      enabled: [
        { id: 'buy:coin', kind: 'buy', payload: { offerId: 'coin' } },
        { id: 'skip', kind: 'skip', payload: {} },
      ],
      disabled: [
        {
          id: 'buy:gold',
          kind: 'buy',
          payload: { offerId: 'gold' },
          reasonCode: 'NOT_ENOUGH_COINS',
          reasonText: 'Not enough coins',
        },
      ],
    };
  };
  const applyAction = (state: GameState, input: unknown): ApplyActionResult => {
    const parsed = actionSchema.safeParse(input);
    if (!parsed.success) return { rejected: true, reason: 'malformed_action', state };
    const action = parsed.data;
    if (action.stateRevisionBefore !== state.stateRevision) {
      return { rejected: true, reason: 'stale_revision', state };
    }
    if (action.actionSeq !== state.stateRevision + 1) {
      return { rejected: true, reason: 'invalid_sequence', state };
    }
    const legal = legalActions(state, state.activeSeatIndex).enabled.some(
      (choice) =>
        choice.kind === action.kind &&
        JSON.stringify(choice.payload) === JSON.stringify(action.payload),
    );
    if (!legal && !options.acceptIllegal)
      return { rejected: true, reason: 'illegal_action', state };
    const next = structuredClone(state);
    next.stateRevision = action.actionSeq;
    const player = next.players[next.activeSeatIndex]!;
    if (action.kind === 'buy') player.coins += action.payload.offerId === 'gold' ? 5 : 1;
    if (action.kind === 'roll') {
      next.activeSeatIndex = (next.activeSeatIndex + 1) % next.players.length;
      const done = next.globalTurnNo >= next.config.lapTarget * next.players.length;
      if (done && !options.neverFinish) {
        next.phase = { kind: 'finished' };
      } else {
        next.globalTurnNo++;
        next.players[next.activeSeatIndex]!.ownTurnNo++;
        next.phase = { kind: 'strategy' };
      }
    } else {
      next.phase = { kind: 'move' };
    }
    return { accepted: true, state: next, events: [], record: { action, events: [] } };
  };
  return {
    classIds: CLASSES,
    createGame({ seed, seats, lapTarget }: GameSetup) {
      return {
        ...structuredClone(base),
        config: {
          ...base.config,
          seed,
          lapTarget,
          seats: seats.map((seat) => ({ ...seat, controller: 'ai' as const })),
        },
        players: seats.map((seat) => ({
          ...structuredClone(base.players[0]!),
          ...seat,
          coins: 0,
          ownTurnNo: seat.seatIndex === 0 ? 1 : 0,
        })),
        activeSeatIndex: 0,
        globalTurnNo: 1,
        stateRevision: 0,
        phase: { kind: 'strategy' },
      };
    },
    observe(state, seatIndex) {
      if (state.config.seed === options.crashSeed && state.globalTurnNo === 3) {
        throw new RangeError('Unknown seat index');
      }
      return observe(state, seatIndex);
    },
    legalActions,
    applyAction,
    advanceAutomatically(state) {
      const choices = legalActions(state, state.activeSeatIndex).enabled;
      if (choices.length !== 1) return { state, records: [], events: [] };
      const result = applyAction(state, {
        actorId: state.config.seats[state.activeSeatIndex]!.actorId,
        actionSeq: state.stateRevision + 1,
        stateRevisionBefore: state.stateRevision,
        kind: choices[0]!.kind,
        payload: choices[0]!.payload,
      });
      if ('rejected' in result) return { state, records: [], events: [] };
      return { state: result.state, records: [{ ...result.record, auto: true }], events: [] };
    },
    outcome(state) {
      if (state.phase.kind !== 'finished') return { finished: false };
      const top = Math.max(...state.players.map((player) => player.coins));
      return {
        finished: true,
        winnerSeats: state.players
          .filter((player) => player.coins === top)
          .map((player) => player.seatIndex),
      };
    },
  };
}

const options = (overrides: Partial<SimOptions> = {}): SimOptions => ({
  games: 20,
  seed: 1,
  seats: 2,
  maxSteps: 5000,
  lapTarget: 2,
  policy: 'random',
  seedSet: 'tune',
  ...overrides,
});

/** Each seat picks the disabled "buy:gold" once per game, then plays randomly. */
const illegalOnce = (): Policy => {
  let injected = false;
  const random = new RandomPolicy();
  return {
    decide(observation, legal, rng) {
      if (!injected && legal.disabled.some((choice) => choice.id === 'buy:gold')) {
        injected = true;
        return 'buy:gold';
      }
      return random.decide(observation, legal, rng);
    },
  };
};

describe('RandomPolicy (§8)', () => {
  const legal: LegalActions = fakeEngine().legalActions(
    fakeEngine().createGame({ seed: 1, seats: seatSetup(CLASSES, 2, 1), lapTarget: 2 }),
    0,
  );
  const observation = observe(base, 0);

  test('picks only enabled choices, and every enabled choice is reachable', async () => {
    const rng = createPolicyRng(7);
    const picks = new Set(
      Array.from({ length: 50 }, () => new RandomPolicy().decide(observation, legal, rng)),
    );
    expect([...picks].sort()).toEqual(['buy:coin', 'skip']);
  });

  test('is deterministic for a seed', async () => {
    const run = (seed: number) => {
      const rng = createPolicyRng(seed);
      return Array.from({ length: 20 }, () => new RandomPolicy().decide(observation, legal, rng));
    };
    expect(run(3)).toEqual(run(3));
    expect(run(3)).not.toEqual(run(4));
  });

  test('refuses to choose when nothing is enabled', async () => {
    expect(() =>
      new RandomPolicy().decide(
        observation,
        { enabled: [], disabled: legal.disabled },
        createPolicyRng(1),
      ),
    ).toThrow(RangeError);
  });
});

describe('runSim with a fake engine (§7, §8, §9)', () => {
  test('plays complete games through the contract and summarises them', async () => {
    const { summary, failures } = await runSim(fakeEngine(), options());
    expect(failures).toEqual([]);
    expect(failed(summary)).toBe(false);
    expect(summary).toMatchObject({
      games: 20,
      seats: 2,
      averageTurns: 4,
      aborted: 0,
      illegalAppliedActionCount: 0,
      invariantFailures: 0,
    });
    expect(summary.ties).toBeGreaterThan(0);
    expect(summary.winners.bySeat.reduce((sum, n) => sum + n, 0)).toBe(20);
    expect(Object.values(summary.winners.byClass).reduce((sum, n) => sum + n, 0)).toBe(20);
  });

  test('k co-winners score 1/k each (§8 Scoring), rounded to 2 decimals', async () => {
    const { summary } = await runSim(
      fakeEngine(),
      options({ games: 6, seats: 3, policy: 'skip' }),
      {
        skip: () => ({ decide: () => 'skip' }),
      },
    );
    expect(summary.ties).toBe(6);
    expect(summary.winners.bySeat).toEqual([2, 2, 2]);
    expect(summary.winners.byClass).toEqual({ alpha: 1.33, beta: 1.33, gamma: 1.67, delta: 1.67 });
  });

  test('reports average final coins and the tie rate (§8 Scoring)', async () => {
    // Fake games last 2 turns per seat; buying a coin each turn ends on 2 coins, skipping on 0.
    const { summary: both } = await runSim(fakeEngine(), options({ games: 4, policy: 'coin' }), {
      coin: () => ({
        decide: (_o, legal) => (legal.enabled[0]!.id === 'roll' ? 'roll' : 'buy:coin'),
      }),
    });
    expect(both).toMatchObject({ averageFinalCoins: 2, ties: 4, tieRate: 1 });
    let seat = 0;
    const { summary: lopsided } = await runSim(
      fakeEngine(),
      options({ games: 4, policy: 'lopsided' }),
      {
        lopsided: () => {
          const buys = seat++ % 2 === 0;
          return {
            decide: (_o, legal) =>
              legal.enabled[0]!.id === 'roll' ? 'roll' : buys ? 'buy:coin' : 'skip',
          };
        },
      },
    );
    expect(lopsided).toMatchObject({ averageFinalCoins: 1, ties: 0, tieRate: 0 });
  });

  test('the same options give identical output', async () => {
    expect(JSON.stringify(await runSim(fakeEngine(), options()))).toBe(
      JSON.stringify(await runSim(fakeEngine(), options())),
    );
  });

  test('an illegal action is rejected by the engine and never counted as applied', async () => {
    const rejections: string[] = [];
    const check: InvariantCheck = (_before, _action, result) => {
      if ('rejected' in result) rejections.push(result.reason);
      return [];
    };
    const { summary, failures } = await runSim(
      fakeEngine(),
      options({ policy: 'illegal' }),
      { illegal: illegalOnce },
      check,
    );
    expect(rejections).toEqual(Array.from({ length: 40 }, () => 'illegal_action'));
    expect(summary.illegalAppliedActionCount).toBe(0);
    expect(failures).toEqual([]);
    expect(failed(summary)).toBe(false);
  });

  test('an illegal action the engine wrongly applies is counted and fails the run', async () => {
    const { summary, failures } = await runSim(
      fakeEngine({ acceptIllegal: true }),
      options({ games: 3, seed: 10, policy: 'illegal' }),
      { illegal: illegalOnce },
    );
    expect(summary.illegalAppliedActionCount).toBe(6);
    expect(failed(summary)).toBe(true);
    expect(failures.map((failure) => failure.seed)).toEqual([10, 11, 12]);
    expect(failures[0]).toEqual({
      seed: 10,
      reasons: ['illegal applied actions: 2'],
      reproduce:
        'npm run sim -- --games 1 --seed 10 --seats 2 --max-steps 5000 --lap-target 2 --policy illegal',
    });
  });

  test('a failing evaluation game reproduces inside the evaluation seed set', async () => {
    const { failures } = await runSim(
      fakeEngine({ neverFinish: true }),
      options({ games: 1, seed: 1000000, maxSteps: 50, seedSet: 'eval' }),
    );
    expect(failures.map((failure) => failure.reproduce)).toEqual([
      'npm run sim -- --games 1 --seed 1000000 --seats 2 --max-steps 50 --lap-target 2 --policy random --seed-set eval',
    ]);
  });

  test('--max-steps stops a stuck game and reports it as aborted', async () => {
    const run = await runSim(
      fakeEngine({ neverFinish: true }),
      options({ games: 2, maxSteps: 50 }),
    );
    expect(run.summary).toMatchObject({ aborted: 2, averageTurns: 0, ties: 0 });
    expect(run.summary.winners.bySeat).toEqual([0, 0]);
    expect(failed(run.summary)).toBe(true);
    expect(run.failures).toEqual([
      {
        seed: 1,
        reasons: ['aborted: max steps 50'],
        reproduce:
          'npm run sim -- --games 1 --seed 1 --seats 2 --max-steps 50 --lap-target 2 --policy random',
      },
      {
        seed: 2,
        reasons: ['aborted: max steps 50'],
        reproduce:
          'npm run sim -- --games 1 --seed 2 --seats 2 --max-steps 50 --lap-target 2 --policy random',
      },
    ]);
  });

  test('a game that throws is aborted with its reproduce command and the rest still play', async () => {
    const violation: InvariantCheck = (before, action) =>
      action.kind === 'roll' && before.globalTurnNo === 1 ? ['first roll'] : [];
    const { summary, failures } = await runSim(
      fakeEngine({ crashSeed: 3 }),
      options({ games: 4 }),
      POLICIES,
      violation,
    );
    expect(summary).toMatchObject({ games: 4, aborted: 1, invariantFailures: 4 });
    expect(summary.winners.bySeat.reduce((sum, n) => sum + n, 0)).toBe(3);
    expect(failed(summary)).toBe(true);
    expect(failures.find((failure) => failure.seed === 3)).toEqual({
      seed: 3,
      reasons: ['aborted: error: Unknown seat index', 'invariant failures: 1'],
      reproduce:
        'npm run sim -- --games 1 --seed 3 --seats 2 --max-steps 5000 --lap-target 2 --policy random',
    });
  });

  test('a failing game re-runs alone with the printed seed', async () => {
    const engine = fakeEngine({ acceptIllegal: true });
    const full = await runSim(engine, options({ games: 5, seed: 30, policy: 'illegal' }), {
      illegal: illegalOnce,
    });
    const alone = await runSim(engine, options({ games: 1, seed: 33, policy: 'illegal' }), {
      illegal: illegalOnce,
    });
    expect(alone.failures).toEqual([full.failures[3]]);
  });

  test('every invariant violation the hook returns counts as a failure', async () => {
    const calls: Action['kind'][] = [];
    const check: InvariantCheck = (before, action, result) => {
      calls.push(action.kind);
      expect(before.stateRevision).toBe(action.stateRevisionBefore);
      expect('accepted' in result && result.state.stateRevision).toBe(action.actionSeq);
      return action.kind === 'roll' && before.globalTurnNo === 1 ? ['first roll'] : [];
    };
    const { summary, failures } = await runSim(
      fakeEngine(),
      options({ games: 2 }),
      POLICIES,
      check,
    );
    expect(summary.invariantFailures).toBe(2);
    expect(failed(summary)).toBe(true);
    expect(failures.map((failure) => failure.reasons)).toEqual([
      ['invariant failures: 1'],
      ['invariant failures: 1'],
    ]);
    // Policy choices and automatic steps (the single-choice roll) are both checked.
    expect(calls.filter((kind) => kind === 'roll')).toHaveLength(8);
    expect(calls.filter((kind) => kind !== 'roll')).toHaveLength(8);
  });

  test('engine facts reach only a policy that asks for them', async () => {
    const asked: number[] = [];
    const engine: SimEngine = {
      ...fakeEngine(),
      facts: (_state, seatIndex) => (asked.push(seatIndex), { saleValue: { mon: 1 } }),
    };
    const seen: unknown[] = [];
    const recorder = (wantsFacts: boolean) => (): Policy => {
      const random = new RandomPolicy();
      return {
        wantsFacts,
        decide(observation, legal, rng, facts) {
          seen.push(facts);
          return random.decide(observation, legal, rng);
        },
      };
    };
    await runSim(engine, options({ games: 1, policy: 'plain' }), { plain: recorder(false) });
    expect(asked).toEqual([]);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((facts) => facts === undefined)).toBe(true);
    seen.length = 0;
    await runSim(engine, options({ games: 1, policy: 'eager' }), { eager: recorder(true) });
    expect(asked).toHaveLength(seen.length);
    expect(seen.every((facts) => JSON.stringify(facts) === '{"saleValue":{"mon":1}}')).toBe(true);
  });

  test.each([2, 3, 4])('plays %i seats', async (seats) => {
    const { summary } = await runSim(fakeEngine(), options({ seats }));
    expect(summary).toMatchObject({ seats, aborted: 0, averageTurns: 2 * seats });
    expect(summary.winners.bySeat).toHaveLength(seats);
  });
});

describe('runCli (§7, §8)', () => {
  const run = async (args: string[], check: InvariantCheck) => {
    const out: string[] = [];
    const err: string[] = [];
    const code = await runCli(args, fakeEngine(), check, {
      log: (line) => out.push(line),
      error: (line) => err.push(line),
    });
    return { code, out, err };
  };

  test('an invariant violation fails the run with its reproduce command', async () => {
    const firstRoll: InvariantCheck = (before, action) =>
      action.kind === 'roll' && before.globalTurnNo === 1 ? ['first roll'] : [];
    const { code, out, err } = await run(['--games', '2', '--seed', '7'], firstRoll);
    expect(code).toBe(1);
    expect(JSON.parse(out[0]!)).toMatchObject({ games: 2, invariantFailures: 2 });
    expect(err).toEqual([
      expect.stringContaining(
        'game seed 7 failed (invariant failures: 1); reproduce: npm run sim -- --games 1 --seed 7',
      ),
      expect.stringContaining(
        'game seed 8 failed (invariant failures: 1); reproduce: npm run sim -- --games 1 --seed 8',
      ),
    ]);
  });

  test('prints the summary as one JSON line, then a short readable table', async () => {
    const { code, out } = await run(['--games', '4', '--seed', '7'], () => []);
    expect(code).toBe(0);
    expect(Object.keys(JSON.parse(out[0]!))).toEqual(
      expect.arrayContaining([
        'averageTurns',
        'averageFinalCoins',
        'tieRate',
        'catching',
        'shop',
        'salesByLap',
        'classInSeat',
      ]),
    );
    expect(JSON.parse(out[0]!).shop).toEqual({ purchases: { coin: expect.any(Number) } });
    const table = out.slice(1).join('\n');
    expect(table).toMatch(/^ {2}Shop +coin \d+$/m);
    expect(table).toMatch(/^Sim: 4 games, 2 seats, seed set tune$/m);
    expect(table).toMatch(/^ {2}Turns per game +4$/m);
    expect(table).toMatch(/^ {2}Tie rate +[\d.]+ \(\d+ ties?\)$/m);
    expect(table).toMatch(/^ {2}Class in seat +alpha \d+\/\d+/m);
    expect(out.length).toBeLessThan(30);
  });

  test('a clean run exits 0', async () => {
    const { code, err } = await run(['--games', '2', '--seed', '7'], () => []);
    expect(code).toBe(0);
    expect(err).toEqual([]);
  });

  test('--seed-set eval refuses a tuning seed with a clear message, and runs from 1,000,000', async () => {
    const wrong = await run(['--seed-set', 'eval', '--seed', '5', '--games', '2'], () => []);
    expect(wrong.code).not.toBe(0);
    expect(wrong.out).toEqual([]);
    expect(wrong.err).toEqual([
      'sim: --seed-set eval takes only seeds from 1000000; this run uses seeds 5 to 6',
    ]);
    const right = await run(['--seed-set', 'eval', '--seed', '1000000', '--games', '2'], () => []);
    expect(right.code).toBe(0);
    expect(JSON.parse(right.out[0]!)).toMatchObject({ games: 2, seedSet: 'eval' });
  });

  test('bad arguments exit 2', async () => {
    const { code, err } = await run(['--seats', '5'], () => []);
    expect(code).toBe(2);
    expect(err).toEqual(['sim: --seats must be 2, 3 or 4']);
  });
});

describe('save and replay (§6.7, §6.8, §8)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'poke-sim-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const run = async (args: string[]) => {
    const out: string[] = [];
    const err: string[] = [];
    const code = await runCli(args, realEngine, checkInvariants, {
      log: (line) => out.push(line),
      error: (line) => err.push(line),
    });
    return { code, out, err };
  };

  test('--save writes a finished game that --replay passes, and a tampered copy fails', async () => {
    const file = join(dir, 'nested', 'g1.json');
    const saved = await run(['--games', '1', '--seed', '1', '--save', file]);
    expect(saved).toMatchObject({ code: 0, err: [] });
    const save = JSON.parse(readFileSync(file, 'utf8'));
    expect(save.state.phase).toEqual({ kind: 'finished' });

    // Replay never calls Jev or the network (§6.8).
    vi.stubGlobal('fetch', () => {
      throw new Error('network call during replay');
    });
    try {
      const good = await run(['--replay', file]);
      expect(good.code).toBe(0);
      expect(good.out).toEqual([expect.stringMatching(/^PASS /)]);

      save.state.players[0].coins += 1;
      const tampered = join(dir, 'tampered.json');
      writeFileSync(tampered, JSON.stringify(save));
      const bad = await run(['--replay', tampered]);
      expect(bad.code).toBe(1);
      expect(bad.out).toEqual([expect.stringMatching(/^FAIL /)]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  test('--save with several games writes one file per game seed', async () => {
    const file = join(dir, 'run.json');
    expect((await run(['--games', '2', '--seed', '5', '--save', file])).code).toBe(0);
    for (const seed of [5, 6]) {
      expect((await run(['--replay', join(dir, `run-seed-${seed}.json`)])).out).toEqual([
        expect.stringMatching(/^PASS /),
      ]);
    }
  });

  // The replay path (sim/ and engine/) never reaches Jev (§6.8): lint rejects any import of ai/.
  test.each([
    ['sim/replay-jev.ts', "import * as jev from '../ai/app.ts';"],
    ['sim/replay-jev.ts', "import * as jev from '@typesafe-ai/sdk';"],
    ['engine/replay-jev.ts', "import * as jev from '../ai/app.ts';"],
    ['sim/replay-jev.ts', "import * as jev from '../ai/jev-policy.ts';"],
    ['sim/policy.ts', "import * as jev from '../ai/orchestrator.ts';"],
  ])('lint rejects %s importing the AI layer', async (filePath, code) => {
    const eslint = new ESLint({ cwd: join(import.meta.dirname, '..') });
    const [result] = await eslint.lintText(`${code}\nexport { jev };\n`, { filePath });
    expect(result!.messages.map((entry) => entry.ruleId)).toContain('no-restricted-imports');
  });

  test('lint lets only the policy registry import the `--policy jev` policy', async () => {
    const eslint = new ESLint({ cwd: join(import.meta.dirname, '..') });
    const code = "import * as jev from '../ai/jev-policy.ts';\nexport { jev };\n";
    const [result] = await eslint.lintText(code, { filePath: 'sim/policy.ts' });
    expect(result!.messages.map((entry) => entry.ruleId)).not.toContain('no-restricted-imports');
  });

  test('--replay of an unreadable save fails with a reason', async () => {
    const file = join(dir, 'garbage.json');
    writeFileSync(file, '{"saveVersion":"save-v0"}');
    const result = await run(['--replay', file]);
    expect(result.code).toBe(1);
    expect(result.out).toEqual([expect.stringMatching(/^FAIL .*save-v0/)]);
  });
});

describe('the real engine', () => {
  test('plays complete games from the real content with no failures (§8)', async () => {
    const { summary, failures } = await runSim(
      realEngine,
      options({ games: 6, seats: 3 }),
      POLICIES,
      checkInvariants,
    );
    expect(failures).toEqual([]);
    expect(summary).toMatchObject({ games: 6, seats: 3, aborted: 0 });
    expect(summary.averageTurns).toBeGreaterThan(0);
    expect(summary.winners.bySeat.reduce((sum, n) => sum + n, 0)).toBeCloseTo(6);
  });

  test('rotates only the core classes; stretch classes wait until after G2 (§1)', async () => {
    const stretch = loadContent()
      .classes.filter((entry) => entry.stretch)
      .map((entry) => entry.id);
    expect(stretch.length).toBeGreaterThan(0);
    expect(realEngine.classIds).toHaveLength(6);
    expect(realEngine.classIds.some((classId) => stretch.includes(classId))).toBe(false);
  });

  test('main-character plays every Starter in every seat with 2 seats', async () => {
    const starters = loadContent().classes.find(
      (entry) => entry.id === 'main-character',
    )!.starterSpeciesIds;
    const played = new Map<number, Set<string>>();
    for (let seed = 1; seed <= realEngine.classIds.length * starters.length; seed++) {
      const seats = seatSetup(realEngine.classIds, 2, seed);
      const state = realEngine.createGame({ seed, seats, lapTarget: 2 });
      for (const seat of state.config.seats) {
        if (seat.classId !== 'main-character') continue;
        played.set(
          seat.seatIndex,
          (played.get(seat.seatIndex) ?? new Set()).add(seat.starterSpeciesId!),
        );
      }
    }
    expect([...played.keys()].sort()).toEqual([0, 1]);
    for (const seen of played.values()) expect(seen).toEqual(new Set(starters));
  });
});

/** Takes the first enabled choice whose ID is listed, in list order, else the first enabled. */
const prefer =
  (...ids: string[]) =>
  (): Policy => ({
    decide(_observation, legal) {
      for (const id of ids) {
        if (legal.enabled.some((choice) => choice.id === id)) return id;
      }
      return legal.enabled[0]!.id;
    },
  });

describe('summary metrics from the real engine (§8, Appendix A)', () => {
  const real = async (policy: string, policies: Record<string, PolicyFactory>) =>
    (await runSim(realEngine, options({ games: 4, seed: 11, policy }), policies)).summary;

  test('a player who always releases makes no catch attempt', async () => {
    const summary = await real('release', { release: prefer('release', 'skip') });
    const { encounters, attempts, catches, releases } = summary.catching;
    expect(encounters).toBeGreaterThan(0);
    expect({ attempts, catches, releases }).toEqual({
      attempts: 0,
      catches: 0,
      releases: encounters,
    });
  });

  test('catch attempts per encounter split by Ball type, DC and Lap', async () => {
    const { catching } = await real('random', POLICIES);
    expect(catching.attempts + catching.releases).toBe(catching.encounters);
    expect(catching.catches).toBeGreaterThan(0);
    const rows = catching.byBallDcLap;
    expect(rows.reduce((sum, row) => sum + row.attempts, 0)).toBe(catching.attempts);
    expect(rows.reduce((sum, row) => sum + row.catches, 0)).toBe(catching.catches);
    const encountersByDcLap = new Map<string, number>();
    for (const row of rows) {
      expect(['poke', 'great', 'ultra']).toContain(row.ballType);
      expect([2, 3, 4, 5]).toContain(row.dc);
      expect([0, 1, 2]).toContain(row.lap);
      expect(row.catches).toBeLessThanOrEqual(row.attempts);
      expect(row.attempts).toBeLessThanOrEqual(row.encounters);
      expect(row.attemptsPerEncounter).toBeCloseTo(row.attempts / row.encounters, 2);
      encountersByDcLap.set(`${row.dc}@${row.lap}`, row.encounters);
    }
    // Every DC and Lap with an encounter lists all three Balls, so a Ball never tried shows 0.
    expect(rows).toHaveLength(encountersByDcLap.size * 3);
    expect([...encountersByDcLap.values()].reduce((sum, n) => sum + n, 0)).toBe(
      catching.encounters,
    );
  });

  test('Shop purchases are counted by offer', async () => {
    const { shop } = await real('buy-poke', {
      'buy-poke': prefer('buy:offer-poke', 'release', 'finish-sell', 'skip'),
    });
    expect(shop).toEqual({ purchases: { 'offer-poke': expect.any(Number) } });
    expect(shop.purchases['offer-poke']).toBeGreaterThan(0);
  });

  test('sales are counted per Lap, and only after a paid Start crossing (§4.7)', async () => {
    const sellOne = (): Policy => ({
      decide(_observation, legal) {
        const sale = legal.enabled.find((choice) => choice.id.startsWith('sell:'));
        return (
          sale ??
          legal.enabled.find((choice) => choice.id === 'release') ??
          legal.enabled[0]!
        ).id;
      },
    });
    const { salesByLap } = await real('sell-one', { 'sell-one': sellOne });
    expect(Object.keys(salesByLap).length).toBeGreaterThan(0);
    for (const [lap, sales] of Object.entries(salesByLap)) {
      expect([1, 2]).toContain(Number(lap));
      expect(sales).toEqual({ sold: expect.any(Number), coins: expect.any(Number) });
      expect(sales.sold).toBeGreaterThan(0);
    }
    // A Rescue Starter sells for 0, so only the run as a whole must have paid coins.
    expect(Object.values(salesByLap).reduce((sum, sales) => sum + sales.coins, 0)).toBeGreaterThan(
      0,
    );
  });

  test('a player who throws only Poké Balls has attempts only in the Poké Ball rows', async () => {
    const { byBallDcLap } = (await real('poke', { poke: prefer('catch:poke', 'release', 'skip') }))
      .catching;
    const tried = byBallDcLap.filter((row) => row.attempts > 0);
    expect(tried.length).toBeGreaterThan(0);
    expect(new Set(tried.map((row) => row.ballType))).toEqual(new Set(['poke']));
  });
});

describe('seat balance (§8 variation)', () => {
  test.each([2, 3, 4])(
    'with %i seats every class sits in every seat equally often',
    async (seats) => {
      const counts = new Map<string, number>();
      for (let seed = 5; seed < 5 + CLASSES.length * 3; seed++) {
        const setup = seatSetup(CLASSES, seats, seed);
        expect(new Set(setup.map((seat) => seat.classId)).size).toBe(seats);
        for (const seat of setup) {
          const key = `${seat.classId}@${seat.seatIndex}`;
          counts.set(key, (counts.get(key) ?? 0) + 1);
        }
      }
      expect(counts.size).toBe(CLASSES.length * seats);
      expect(new Set(counts.values())).toEqual(new Set([3]));
    },
  );

  test.each([2, 3, 4])(
    'over 200 games with %i seats the summary counts each core class in each seat within 1',
    async (seats) => {
      const engine = { ...fakeEngine(), classIds: realEngine.classIds };
      const { summary } = await runSim(engine, options({ games: 200, seats, lapTarget: 1 }));
      expect(Object.keys(summary.classInSeat).sort()).toEqual([...realEngine.classIds].sort());
      const counts = Object.values(summary.classInSeat).flat();
      expect(counts).toHaveLength(realEngine.classIds.length * seats);
      expect(counts.reduce((sum, n) => sum + n, 0)).toBe(200 * seats);
      expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
    },
  );

  test('too few classes are refused', async () => {
    expect(() => seatSetup(['alpha'], 2, 1)).toThrow(RangeError);
  });
});

describe('parseSimArgs', () => {
  test('applies the defaults', async () => {
    expect(parseSimArgs([])).toEqual({
      games: 100,
      seed: 1,
      seats: 2,
      maxSteps: 5000,
      lapTarget: GAME_PRESETS.quick.lapTarget,
      policy: 'random',
      seedSet: 'tune',
    });
  });

  test('reads every flag', async () => {
    expect(
      parseSimArgs(
        '--games 1 --seed 1000004 --seats 4 --max-steps 9 --lap-target 3 --policy random --seed-set eval'.split(
          ' ',
        ),
      ),
    ).toEqual({
      games: 1,
      seed: 1000004,
      seats: 4,
      maxSteps: 9,
      lapTarget: 3,
      policy: 'random',
      seedSet: 'eval',
    });
  });

  test('a tuning run may not reach into the evaluation seeds (§8 Variation)', async () => {
    expect(parseSimArgs(['--games', '10', '--seed', '999990']).seed).toBe(999990);
    expect(() => parseSimArgs(['--games', '11', '--seed', '999990'])).toThrow(
      '--seed-set tune takes only seeds below 1000000; this run uses seeds 999990 to 1000000',
    );
  });

  test.each([
    '--seats=1',
    '--seats=5',
    '--games=0',
    '--games=1.5',
    '--seed=x',
    '--seed=-1',
    '--max-steps=0',
    '--lap-target=',
    '--lap-target=0',
    '--lap-target=-1',
    '--lap-target=2.5',
    '--policy=unknown',
    '--seed-set=test',
  ])('rejects %s', async (arg) => {
    expect(() => parseSimArgs([arg])).toThrow(RangeError);
  });
});

test('loadContent reads and validates the real content/*.json from disk', async () => {
  const content = loadContent();
  expect(content.species).toHaveLength(19);
  expect(content.contentVersion).toBe(CONTENT_VERSION);
});
