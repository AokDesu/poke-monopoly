import { describe, expect, test } from 'vitest';
import {
  legalActions,
  observe,
  oddsForAllBalls,
  pendingDecision,
  type GameState,
} from '../engine/index.ts';
import { decisionStates } from '../engine/rollout-testing.ts';
import { createPolicyRng } from '../sim/policy.ts';
import { hardOutcomes } from './hard.ts';
import { PERSONALITIES } from './fallback/index.ts';
import type { JevAnswer, JevRequest, JevResult } from './jev/client.ts';
import { createFakeJevClient } from './jev/fake.ts';
import {
  Orchestrator,
  type DecideRequest,
  type Difficulty,
  type OrchestratorDecision,
} from './orchestrator.ts';
import { outcomeSentence } from './questions/index.ts';
import { isStrategyQuestionAction } from './questions/strategy.ts';

const greedy = PERSONALITIES.greedy;

/** Real, randomly played decision states, searched until one of each kind Jev is asked about. */
function findState(match: (state: GameState) => boolean): GameState {
  for (let seed = 1; seed < 60; seed++) {
    const found = decisionStates(seed, { seats: 2 + (seed % 3), every: 1, limit: 400 }).find(match);
    if (found) return found;
  }
  throw new Error('No matching real decision state');
}

const seatOf = (state: GameState) => pendingDecision(state)!.seatIndex;

const strategyState = findState((state) => {
  if (state.phase.kind !== 'strategy' || state.pendingResponse) return false;
  const enabled = legalActions(state, seatOf(state)).enabled;
  return enabled.filter(isStrategyQuestionAction).length >= 2 && enabled.length >= 2;
});
const encounterState = findState(
  (state) =>
    state.phase.kind === 'encounter' &&
    !state.phase.catchRoll &&
    legalActions(state, seatOf(state)).enabled.filter((action) => action.kind === 'catch').length >=
      1,
);

function requestFor(
  state: GameState,
  difficulty: Difficulty,
  extra: Partial<DecideRequest> = {},
): DecideRequest {
  const seat = seatOf(state);
  const encounter = state.phase.kind === 'encounter';
  return {
    turnKey: 't1',
    observation: observe(state, seat),
    legalActions: legalActions(state, seat),
    facts: encounter
      ? {
          encounter: {
            odds: oddsForAllBalls(state, seat).map(({ ballType, successFaces }) => ({
              ballType,
              successFaces,
            })),
          },
        }
      : {},
    difficulty,
    personality: greedy,
    rng: createPolicyRng('hard-test'),
    ...extra,
  };
}

/** Jev answers with equal shares; the fake keeps every request it was sent. */
function jevFake(delayMs = 0) {
  return createFakeJevClient(async (request: JevRequest): Promise<JevResult> => {
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    const answers: Record<string, JevAnswer> = {};
    for (const [name, question] of Object.entries(request.questions)) {
      if (question.type !== 'choice') throw new Error('Only Choice questions here');
      const labels = Object.keys(question.criteria);
      const shares = Object.fromEntries(
        labels.map((label, i) => [label, i === 0 ? 0.7 : 0.3 / (labels.length - 1)]),
      );
      answers[name] = {
        type: 'choice',
        choice: labels[0]!,
        confidence: 0.9,
        probabilities: shares,
      };
    }
    return {
      ok: true,
      answers,
      requestId: 'req_fake',
      model: 'jev-fake',
      latencyMs: 1,
      usage: { inputTokens: 10, outputTokens: 0 },
    } as JevResult;
  });
}

async function ask(
  state: GameState,
  difficulty: Difficulty,
  options: ConstructorParameters<typeof Orchestrator>[0] extends infer O ? Partial<O> : never = {},
): Promise<{ requests: JevRequest[]; decision: OrchestratorDecision }> {
  const client = jevFake();
  const orchestrator = new Orchestrator({ client, gameId: 'g1', ...options });
  const decision = await orchestrator.decide(requestFor(state, difficulty));
  return { requests: client.requests, decision };
}

const criteriaOf = (request: JevRequest) =>
  Object.values(request.questions).flatMap((question) =>
    question.type === 'choice' ? Object.values(question.criteria) : [],
  );

describe.each([
  ['strategy', strategyState],
  ['encounter', encounterState],
])('Hard on a %s decision (spec §5.6)', (_name, state) => {
  test('adds engine rollout buckets to every offered option, and none for Easy or Normal', async () => {
    const hard = await ask(state, 'hard');
    expect(hard.requests).toHaveLength(1);
    const criteria = criteriaOf(hard.requests[0]!);
    expect(criteria.length).toBeGreaterThan(1);
    for (const text of criteria) expect(text).toContain('Simulated over the next round');
    for (const difficulty of ['easy', 'normal'] as const) {
      const other = await ask(state, difficulty);
      for (const text of criteriaOf(other.requests[0]!)) expect(text).not.toContain('Simulated');
    }
  });

  test('without rollouts Hard asks exactly what Normal asks', async () => {
    const hard = await ask(state, 'hard', { outcomes: () => undefined });
    const normal = await ask(state, 'normal');
    expect(hard.requests).toEqual(normal.requests);
  });

  test('takes the highest-probability option, as Normal does, and stays a Jev decision', async () => {
    const hard = await ask(state, 'hard');
    const normal = await ask(state, 'normal');
    expect(hard.decision.choice).toBe(normal.decision.choice);
    expect(hard.decision.source).toBe('jev');
  });

  test('is deterministic under the request seed', async () => {
    const a = await ask(state, 'hard');
    const b = await ask(state, 'hard');
    expect(a.requests).toEqual(b.requests);
  });

  test("never sends the real seed, deck order or opponents' Balls: same observation, same question (leak test)", async () => {
    const other = structuredClone(state);
    other.config.seed = 'another-secret-seed';
    other.rng = { state: '4242', cursor: 9 };
    other.eventDeck.drawPile = [...other.eventDeck.drawPile].reverse();
    for (const player of other.players) {
      if (player.seatIndex === seatOf(state)) continue;
      player.balls = { poke: 0, great: 5, ultra: 5 };
    }
    expect(observe(other, seatOf(other))).toEqual(observe(state, seatOf(state)));
    const real = await ask(state, 'hard');
    const changed = await ask(other, 'hard');
    expect(changed.requests).toEqual(real.requests);
  });
});

describe('outcomes are words, never numbers (spec §5.4)', () => {
  test.each([
    ['falls', 'low'],
    ['flat', 'medium'],
    ['rises', 'high'],
    ['rises a lot', 'high'],
  ] as const)('the sentence for %s / %s has no digit', (expected_coins, lead_chance) => {
    expect(outcomeSentence({ expected_coins, lead_chance })).not.toMatch(/\d/);
  });
});

describe('the rollout time and the Jev deadline (spec §5.6)', () => {
  /** Rollouts that take `ms` of wall-clock time, then give the real buckets. */
  const slowRollouts =
    (ms: number): NonNullable<ConstructorParameters<typeof Orchestrator>[0]['outcomes']> =>
    (request) => {
      const until = performance.now() + ms;
      while (performance.now() < until);
      return hardOutcomes(request);
    };

  async function decide(options: Partial<ConstructorParameters<typeof Orchestrator>[0]>) {
    const orchestrator = new Orchestrator({
      client: jevFake(30),
      gameId: 'g1',
      decisionMs: 400,
      ...options,
    });
    return orchestrator.decide(requestFor(strategyState, 'hard'));
  }

  test('with no rollout limit set, rollout time is not taken off the Jev deadline', async () => {
    const decision = await decide({ outcomes: slowRollouts(500) });
    expect(decision.source).toBe('jev');
  });

  test('with a rollout limit set, rollout time is taken off the Jev deadline', async () => {
    const decision = await decide({ outcomes: slowRollouts(500), rolloutMs: 100 });
    expect(decision.source).toBe('fallback');
  });
});

describe('hardOutcomes', () => {
  test("rolls out the asked options only, under the seat's own observation", () => {
    const seat = seatOf(strategyState);
    const legal = legalActions(strategyState, seat);
    const first = legal.enabled[0]!.id;
    const outcomes = hardOutcomes({
      observation: observe(strategyState, seat),
      legalActions: legal,
      options: [first],
      personality: greedy,
      seed: 5,
    });
    expect(Object.keys(outcomes ?? {})).toEqual([first]);
  });

  test('a deadline that has already passed gives no buckets, so the decision plays as Normal', () => {
    const seat = seatOf(strategyState);
    expect(
      hardOutcomes({
        observation: observe(strategyState, seat),
        legalActions: legalActions(strategyState, seat),
        personality: greedy,
        seed: 5,
        deadlineMs: 0,
      }),
    ).toBeUndefined();
  });
});
