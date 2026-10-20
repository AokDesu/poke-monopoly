import { describe, expect, test } from 'vitest';
import { CONTENT_VERSION } from '../content/index.ts';
import {
  actionSchema,
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
import { createPolicyRng, POLICIES, RandomPolicy, type Policy } from './policy.ts';
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

  test('picks only enabled choices, and every enabled choice is reachable', () => {
    const rng = createPolicyRng(7);
    const picks = new Set(
      Array.from({ length: 50 }, () => new RandomPolicy().decide(observation, legal, rng)),
    );
    expect([...picks].sort()).toEqual(['buy:coin', 'skip']);
  });

  test('is deterministic for a seed', () => {
    const run = (seed: number) => {
      const rng = createPolicyRng(seed);
      return Array.from({ length: 20 }, () => new RandomPolicy().decide(observation, legal, rng));
    };
    expect(run(3)).toEqual(run(3));
    expect(run(3)).not.toEqual(run(4));
  });

  test('refuses to choose when nothing is enabled', () => {
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
  test('plays complete games through the contract and summarises them', () => {
    const { summary, failures } = runSim(fakeEngine(), options());
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

  test('k co-winners score 1/k each (§8 Scoring), rounded to 2 decimals', () => {
    const { summary } = runSim(fakeEngine(), options({ games: 6, seats: 3, policy: 'skip' }), {
      skip: () => ({ decide: () => 'skip' }),
    });
    expect(summary.ties).toBe(6);
    expect(summary.winners.bySeat).toEqual([2, 2, 2]);
    expect(summary.winners.byClass).toEqual({ alpha: 1.33, beta: 1.33, gamma: 1.67, delta: 1.67 });
  });

  test('the same options give identical output', () => {
    expect(JSON.stringify(runSim(fakeEngine(), options()))).toBe(
      JSON.stringify(runSim(fakeEngine(), options())),
    );
  });

  test('an illegal action is rejected by the engine and never counted as applied', () => {
    const rejections: string[] = [];
    const check: InvariantCheck = (_before, _action, result) => {
      if ('rejected' in result) rejections.push(result.reason);
      return [];
    };
    const { summary, failures } = runSim(
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

  test('an illegal action the engine wrongly applies is counted and fails the run', () => {
    const { summary, failures } = runSim(
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

  test('--max-steps stops a stuck game and reports it as aborted', () => {
    const run = runSim(fakeEngine({ neverFinish: true }), options({ games: 2, maxSteps: 50 }));
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

  test('a game that throws is aborted with its reproduce command and the rest still play', () => {
    const violation: InvariantCheck = (before, action) =>
      action.kind === 'roll' && before.globalTurnNo === 1 ? ['first roll'] : [];
    const { summary, failures } = runSim(
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

  test('a failing game re-runs alone with the printed seed', () => {
    const engine = fakeEngine({ acceptIllegal: true });
    const full = runSim(engine, options({ games: 5, seed: 30, policy: 'illegal' }), {
      illegal: illegalOnce,
    });
    const alone = runSim(engine, options({ games: 1, seed: 33, policy: 'illegal' }), {
      illegal: illegalOnce,
    });
    expect(alone.failures).toEqual([full.failures[3]]);
  });

  test('every invariant violation the hook returns counts as a failure', () => {
    const calls: Action['kind'][] = [];
    const check: InvariantCheck = (before, action, result) => {
      calls.push(action.kind);
      expect(before.stateRevision).toBe(action.stateRevisionBefore);
      expect('accepted' in result && result.state.stateRevision).toBe(action.actionSeq);
      return action.kind === 'roll' && before.globalTurnNo === 1 ? ['first roll'] : [];
    };
    const { summary, failures } = runSim(fakeEngine(), options({ games: 2 }), POLICIES, check);
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

  test.each([2, 3, 4])('plays %i seats', (seats) => {
    const { summary } = runSim(fakeEngine(), options({ seats }));
    expect(summary).toMatchObject({ seats, aborted: 0, averageTurns: 2 * seats });
    expect(summary.winners.bySeat).toHaveLength(seats);
  });
});

describe('the real engine', () => {
  test('plays complete games from the real content with no failures (§8)', () => {
    const { summary, failures } = runSim(realEngine, options({ games: 6, seats: 3 }));
    expect(failures).toEqual([]);
    expect(summary).toMatchObject({ games: 6, seats: 3, aborted: 0 });
    expect(summary.averageTurns).toBeGreaterThan(0);
    expect(summary.winners.bySeat.reduce((sum, n) => sum + n, 0)).toBeCloseTo(6);
  });

  test('rotates only the core classes; stretch classes wait until after G2 (§1)', () => {
    const stretch = loadContent()
      .classes.filter((entry) => entry.stretch)
      .map((entry) => entry.id);
    expect(stretch.length).toBeGreaterThan(0);
    expect(realEngine.classIds).toHaveLength(6);
    expect(realEngine.classIds.some((classId) => stretch.includes(classId))).toBe(false);
  });

  test('main-character plays every Starter in every seat with 2 seats', () => {
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

describe('seat balance (§8 variation)', () => {
  test.each([2, 3, 4])('with %i seats every class sits in every seat equally often', (seats) => {
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
  });

  test('too few classes are refused', () => {
    expect(() => seatSetup(['alpha'], 2, 1)).toThrow(RangeError);
  });
});

describe('parseSimArgs', () => {
  test('applies the defaults', () => {
    expect(parseSimArgs([])).toEqual({
      games: 100,
      seed: 1,
      seats: 2,
      maxSteps: 5000,
      lapTarget: GAME_PRESETS.quick.lapTarget,
      policy: 'random',
    });
  });

  test('reads every flag', () => {
    expect(
      parseSimArgs(
        '--games 1 --seed 4 --seats 4 --max-steps 9 --lap-target 3 --policy random'.split(' '),
      ),
    ).toEqual({ games: 1, seed: 4, seats: 4, maxSteps: 9, lapTarget: 3, policy: 'random' });
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
    '--policy=jev',
  ])('rejects %s', (arg) => {
    expect(() => parseSimArgs([arg])).toThrow(RangeError);
  });
});

test('loadContent reads and validates the real content/*.json from disk', () => {
  const content = loadContent();
  expect(content.species).toHaveLength(19);
  expect(content.contentVersion).toBe(CONTENT_VERSION);
});
