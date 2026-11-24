import { describe, expect, test } from 'vitest';
import {
  bucketExpectedCoins,
  bucketLeadChance,
  legalActions,
  observe,
  pendingDecision,
  ROLLOUT_CONFIG,
  rolloutOptions,
  rolloutSteps,
  type GameState,
  type RolloutPolicy,
} from './index.ts';
import { decisionStates, realContent } from './rollout-testing.ts';

const content = realContent();

/** A policy that reads only what the engine hands it: its seat's observation and options. */
const seededPick: RolloutPolicy = (_seat, _observation, legal, rng) =>
  legal.enabled[rng.int(legal.enabled.length)]!.id;

const states = [21, 22, 23].flatMap((seed) =>
  decisionStates(seed, { seats: 2 + (seed % 3), every: 11, limit: 6 }),
);

function request(state: GameState, extra: Partial<Parameters<typeof rolloutOptions>[0]> = {}) {
  const seat = pendingDecision(state)!.seatIndex;
  return {
    observation: observe(state, seat),
    legalActions: legalActions(state, seat),
    content,
    policy: seededPick,
    seed: 'test-seed',
    samples: 4,
    ...extra,
  };
}

/** The same table as `state` for its deciding seat, with every secret it cannot see changed. */
function withOtherSecrets(state: GameState): GameState {
  const other = structuredClone(state);
  const seat = pendingDecision(state)!.seatIndex;
  other.config.seed = 'another-secret-seed';
  other.rng = { state: '987654321', cursor: 3 };
  other.eventDeck.drawPile = [...other.eventDeck.drawPile].reverse();
  for (const player of other.players) {
    if (player.seatIndex === seat) continue;
    player.balls = { poke: 0, great: 4, ultra: 4 };
  }
  return other;
}

describe('bucketExpectedCoins (spec §5.4: numbers become named buckets)', () => {
  const { fallsBelow, flatMax, risesMax } = ROLLOUT_CONFIG.coins;
  test.each([
    [fallsBelow - 1, 'falls'],
    [fallsBelow, 'flat'],
    [flatMax, 'flat'],
    [flatMax + 0.01, 'rises'],
    [risesMax, 'rises'],
    [risesMax + 0.01, 'rises a lot'],
  ])('a mean change of %f is "%s"', (mean, bucket) => {
    expect(bucketExpectedCoins(mean)).toBe(bucket);
  });

  test('rejects a number that is not finite', () => {
    expect(() => bucketExpectedCoins(Number.NaN)).toThrow(RangeError);
  });
});

describe('bucketLeadChance', () => {
  const { lowBelow, highFrom } = ROLLOUT_CONFIG.lead;
  test.each([
    [0, 'low'],
    [lowBelow - 0.01, 'low'],
    [lowBelow, 'medium'],
    [highFrom - 0.01, 'medium'],
    [highFrom, 'high'],
    [1, 'high'],
  ])('a lead share of %f is "%s"', (share, bucket) => {
    expect(bucketLeadChance(share)).toBe(bucket);
  });

  test('rejects a share outside 0 to 1', () => {
    expect(() => bucketLeadChance(1.2)).toThrow(RangeError);
    expect(() => bucketLeadChance(-0.1)).toThrow(RangeError);
  });
});

describe('rolloutOptions (spec §5.6 Hard)', () => {
  test('there are real decisions to roll out', () => {
    expect(states.length).toBeGreaterThan(8);
  });

  test.each(states.map((state, index) => [index, state] as const))(
    'state %i: every enabled option gets expected-outcome buckets over the asked samples',
    (_index, state) => {
      const asked = request(state);
      const result = rolloutOptions(asked)!;
      expect(result.samples).toBe(4);
      expect(Object.keys(result.outcomes)).toEqual(asked.legalActions.enabled.map((a) => a.id));
      for (const outcome of Object.values(result.outcomes)) {
        expect(['falls', 'flat', 'rises', 'rises a lot']).toContain(outcome.expected_coins);
        expect(['low', 'medium', 'high']).toContain(outcome.lead_chance);
      }
    },
  );

  test.each(states.map((state, index) => [index, state] as const))(
    'state %i: the same seed gives the same buckets',
    (_index, state) => {
      expect(rolloutOptions(request(state))).toEqual(rolloutOptions(request(state)));
    },
  );

  test('a different seed samples different worlds', () => {
    const differs = states.some(
      (state) =>
        JSON.stringify(rolloutOptions(request(state, { seed: 'one', samples: 6 }))) !==
        JSON.stringify(rolloutOptions(request(state, { seed: 'two', samples: 6 }))),
    );
    expect(differs).toBe(true);
  });

  test.each(states.map((state, index) => [index, state] as const))(
    "state %i: the real seed, deck order and opponents' Balls never reach a rollout (leak test)",
    (_index, state) => {
      const seat = pendingDecision(state)!.seatIndex;
      const other = withOtherSecrets(state);
      expect(observe(other, seat)).toEqual(observe(state, seat));
      expect(rolloutOptions(request(other))).toEqual(rolloutOptions(request(state)));
    },
  );

  test("a policy is only ever shown its own seat, never another seat's secrets", () => {
    const state = states.find((candidate) => candidate.players.length > 2)!;
    const seen: { seat: number; ownSeat: number; items: number }[] = [];
    const watching: RolloutPolicy = (seat, observation, legal, rng) => {
      seen.push({ seat, ownSeat: observation.own.seatIndex, items: observation.own.items.length });
      return seededPick(seat, observation, legal, rng, {});
    };
    rolloutOptions(request(state, { policy: watching, samples: 2 }));
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((entry) => entry.seat === entry.ownSeat)).toBe(true);
  });

  test("rolls out only the options asked for, still matching the seat's whole option list", () => {
    const state = states.find((candidate) => {
      const seat = pendingDecision(candidate)!.seatIndex;
      return legalActions(candidate, seat).enabled.length >= 3;
    })!;
    const all = request(state).legalActions.enabled.map((entry) => entry.id);
    const result = rolloutOptions(request(state, { options: [all[0]!, all[2]!] }))!;
    expect(Object.keys(result.outcomes)).toEqual([all[0], all[2]]);
  });

  test.each(states.map((state, index) => [index, state] as const))(
    "rolloutSteps pauses after each option and ends with rolloutOptions's result (state %i, #64)",
    (_index, state) => {
      const asked = request(state);
      const steps = rolloutSteps(asked);
      let pauses = 0;
      let step = steps.next();
      while (!step.done) {
        pauses++;
        step = steps.next();
      }
      expect(step.value).toEqual(rolloutOptions(asked));
      if (step.value) expect(pauses).toBe(4 * asked.legalActions.enabled.length);
    },
  );

  test('the asked state and options are not changed', () => {
    const state = states[0]!;
    const asked = request(state);
    const before = structuredClone({ ...asked, policy: undefined });
    rolloutOptions(asked);
    expect({ ...asked, policy: undefined }).toEqual(before);
  });

  test('stops between samples when told to, and gives no buckets below the minimum', () => {
    const state = states[0]!;
    let calls = 0;
    const stopAfterOne = () => ++calls > 1;
    expect(
      rolloutOptions(request(state, { samples: 6, shouldStop: stopAfterOne })),
    ).toBeUndefined();
    calls = 0;
    const result = rolloutOptions(
      request(state, { samples: 8, shouldStop: () => ++calls > ROLLOUT_CONFIG.minSamples }),
    );
    expect(result?.samples).toBe(ROLLOUT_CONFIG.minSamples);
  });

  test("gives nothing when the sampled world cannot offer the seat's own options", () => {
    const state = states[0]!;
    const asked = request(state);
    asked.legalActions = {
      ...asked.legalActions,
      enabled: [
        ...asked.legalActions.enabled,
        { id: 'not-a-real-option', kind: 'skip', payload: {} },
      ],
    };
    expect(rolloutOptions(asked)).toBeUndefined();
  });
});
