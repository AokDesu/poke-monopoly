import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { legalActions, observe, type GameState } from '../engine/index.ts';
import { promiseTable } from '../eval/jev/scenario-kit.ts';
import type { DecisionRequest } from '../engine/contract/decision.ts';
import { createPolicyRng } from '../sim/policy.ts';
import { policyAnswer } from './decider.ts';
import { PERSONALITIES } from './fallback/index.ts';
import {
  PINNED_JEV_MODEL,
  type JevAnswer,
  type JevClient,
  type JevRequest,
  type JevResult,
} from './jev/client.ts';
import { createFakeJevClient } from './jev/fake.ts';
import { JevPolicy } from './jev-policy.ts';
import { Orchestrator, type DecideRequest, type Difficulty } from './orchestrator.ts';

// Spec §4.8, §5.3, §5.6: the promise response through the orchestrator (S09). Fake clients only.

// An exported JEV_ENABLED=false (the §9 kill switch) must not turn these fake-transport tests into fallback runs: pin the switch on; tests of the switch stub it off themselves (#64).
beforeEach(() => vi.stubEnv('JEV_ENABLED', 'true'));
afterEach(() => vi.unstubAllEnvs());

const ACCEPT = 'respond:accept';
const REJECT = 'respond:reject';

/** A successful answer for the one promise Choice: `accept`'s share, the rest to `reject`. */
const answerWith = (accept: number, confidence?: number, choice?: string): JevResult => {
  const probabilities = { accept, reject: Math.round((1 - accept) * 1000) / 1000 };
  const peak = Math.max(accept, 1 - accept);
  const answers: Record<string, JevAnswer> = {
    promise_response: {
      type: 'choice',
      choice: choice ?? (accept >= 0.5 ? 'accept' : 'reject'),
      confidence: confidence ?? 2 * peak - 1,
      probabilities,
    },
  };
  return {
    ok: true,
    answers,
    requestId: 'req_fake_promise',
    model: PINNED_JEV_MODEL,
    latencyMs: 5,
    usage: { inputTokens: 100, outputTokens: 0 },
  };
};

const request = (
  state: GameState,
  personality = PERSONALITIES.greedy,
  overrides: Partial<DecideRequest> = {},
): DecideRequest => ({
  turnKey: 'promise-turn',
  observation: observe(state, 0),
  legalActions: legalActions(state, 0),
  facts: {},
  difficulty: 'normal',
  personality,
  decisionPoint: 'promise_response',
  rng: createPolicyRng('promise'),
  ...overrides,
});

const table = (trust = 0, direction: 'offer' | 'ask' = 'offer') =>
  promiseTable({ seed: 5, direction, trust });

const decideWith = (client: JevClient, ...args: Parameters<typeof request>) =>
  new Orchestrator({ client }).decide(request(...args));

describe('Normal: the highest-probability option, above the floor', () => {
  test("Jev's own answer is applied and logged against the engine action IDs", async () => {
    const client = createFakeJevClient(() => answerWith(0.1));
    const decision = await decideWith(client, table(2));
    expect(decision).toMatchObject({ choice: REJECT, source: 'jev', fallbackReason: null });
    expect(decision.requests).toBe(1);
    expect(decision.events).toEqual([
      expect.objectContaining({
        questionId: 'promise_response',
        choice: REJECT,
        probabilities: { [ACCEPT]: 0.1, [REJECT]: 0.9 },
        sampled: null,
        fallbackReason: null,
      }),
    ]);
    // One request, one question, and it is the promise question.
    expect(client.requests).toHaveLength(1);
    expect(Object.keys(client.requests[0]!.questions)).toEqual(['promise_response']);
  });

  test('either answer is applied even when it goes against trust: breaking trust is a choice', async () => {
    expect(
      (
        await decideWith(
          createFakeJevClient(() => answerWith(0.95)),
          table(-3),
        )
      ).choice,
    ).toBe(ACCEPT);
    expect(
      (
        await decideWith(
          createFakeJevClient(() => answerWith(0.05)),
          table(3),
        )
      ).choice,
    ).toBe(REJECT);
  });

  test('the same question is asked for a promise made to the AI and one the AI is asked to make', async () => {
    for (const direction of ['offer', 'ask'] as const) {
      const client = createFakeJevClient(() => answerWith(0.9));
      const decision = await decideWith(client, table(1, direction));
      expect(decision.choice).toBe(ACCEPT);
      const { state } = client.requests[0]!;
      expect((state as { promise_offer: { you_are: string } }).promise_offer.you_are).toBe(
        direction === 'offer' ? 'recipient' : 'promiser',
      );
    }
  });
});

describe('Easy: sampled from the probabilities, seeded and logged', () => {
  test('the draw is logged and the same seed gives the same choice', async () => {
    const sampled = async (seed: string) => {
      const decision = await new Orchestrator({
        client: createFakeJevClient(() => answerWith(0.7)),
      }).decide(
        request(table(0), PERSONALITIES.greedy, { difficulty: 'easy', rng: createPolicyRng(seed) }),
      );
      return decision;
    };
    const first = await sampled('easy-1');
    const again = await sampled('easy-1');
    expect(first.events[0]!.sampled).toBeTypeOf('number');
    expect(first.choice).toBe(again.choice);
    expect(first.events[0]!.sampled).toBe(again.events[0]!.sampled);
    expect(first).toMatchObject({ source: 'jev', fallbackReason: null });
    expect(first.events[0]!.probabilities).toEqual({ [ACCEPT]: 0.7, [REJECT]: 0.3 });
  });

  test('over many draws both options are chosen in about the shares Jev gave', async () => {
    const counts: Record<string, number> = { [ACCEPT]: 0, [REJECT]: 0 };
    const total = 400;
    for (let draw = 0; draw < total; draw++) {
      const difficulty: Difficulty = 'easy';
      const decision = await new Orchestrator({
        client: createFakeJevClient(() => answerWith(0.7)),
      }).decide(
        request(table(0), PERSONALITIES.greedy, { difficulty, rng: createPolicyRng(draw) }),
      );
      counts[decision.choice as string]!++;
    }
    expect(counts[ACCEPT]! / total).toBeGreaterThan(0.6);
    expect(counts[ACCEPT]! / total).toBeLessThan(0.8);
  });
});

describe('below the confidence floor the fallback scores the top two', () => {
  test('a toss-up leaves the choice to loyalty and trust, which differ by trust', async () => {
    // Jev leans slightly towards the opposite of what the fallback prefers each time.
    const lowTrust = await decideWith(
      createFakeJevClient(() => answerWith(0.55, 0.1)),
      table(-2),
    );
    expect(lowTrust).toMatchObject({
      choice: REJECT,
      source: 'fallback',
      fallbackReason: 'low_confidence',
    });
    const highTrust = await decideWith(
      createFakeJevClient(() => answerWith(0.45, 0.1)),
      table(2),
    );
    expect(highTrust).toMatchObject({
      choice: ACCEPT,
      source: 'fallback',
      fallbackReason: 'low_confidence',
    });
    // The event still records what Jev said, and why the fallback chose.
    expect(highTrust.events[0]).toMatchObject({
      probabilities: { [ACCEPT]: 0.45, [REJECT]: 0.55 },
      confidence: 0.1,
      fallbackReason: 'low_confidence',
    });
  });

  test('exactly at the floor Jev is applied', async () => {
    const decision = await decideWith(
      createFakeJevClient(() => answerWith(0.8, 0.6)),
      table(-3),
    );
    expect(decision).toMatchObject({ choice: ACCEPT, source: 'jev', fallbackReason: null });
  });
});

describe('Jev off, late or unusable: the fallback answers with its reason', () => {
  test('JEV_ENABLED=false sends no request and the fallback chooses by trust', async () => {
    vi.stubEnv('JEV_ENABLED', 'false');
    const ask = vi.fn();
    const client: JevClient = { ask };
    const low = await decideWith(client, table(-2));
    const high = await decideWith(client, table(2));
    expect(ask).not.toHaveBeenCalled();
    expect(low).toMatchObject({
      choice: REJECT,
      source: 'fallback',
      fallbackReason: 'disabled',
      requests: 0,
    });
    expect(high).toMatchObject({ choice: ACCEPT, source: 'fallback', fallbackReason: 'disabled' });
    expect(low.events[0]!.questionId).toBe('promise_response');
  });

  test('a failed request falls back at once, whatever the failure', async () => {
    const failing = (fallbackReason: 'timeout' | 'rate_limited' | 'server_error') =>
      createFakeJevClient(() => ({ ok: false, fallbackReason }));
    for (const reason of ['timeout', 'rate_limited', 'server_error'] as const) {
      const decision = await decideWith(failing(reason), table(2));
      expect(decision).toMatchObject({
        choice: ACCEPT,
        source: 'fallback',
        fallbackReason: reason,
      });
    }
  });

  test('an answer after the decision deadline is never applied', async () => {
    const slow: JevClient = {
      ask: (_request, { decisionSignal }) =>
        new Promise<JevResult>((resolve) =>
          setTimeout(() => resolve(answerWith(0.05)), decisionSignal.aborted ? 0 : 60),
        ),
    };
    const decision = await new Orchestrator({ client: slow, decisionMs: 10 }).decide(
      request(table(2)),
    );
    expect(decision).toMatchObject({
      choice: ACCEPT,
      source: 'fallback',
      fallbackReason: 'timeout',
    });
  });

  test('a choice that was not offered, or a missing answer, is an invalid output', async () => {
    const invalid = await decideWith(
      createFakeJevClient(() => answerWith(0.9, 0.9, 'counter')),
      table(2),
    );
    expect(invalid).toMatchObject({ source: 'fallback', fallbackReason: 'invalid_choice' });
    const wrong = await decideWith(
      createFakeJevClient((): JevResult => ({
        ok: true,
        answers: { promise_response: { type: 'noul', noul: 0.9 } },
        requestId: 'req_fake_promise',
        model: PINNED_JEV_MODEL,
        latencyMs: 5,
        usage: { inputTokens: 100, outputTokens: 0 },
      })),
      table(2),
    );
    expect(wrong).toMatchObject({ source: 'fallback', fallbackReason: 'schema_mismatch' });
  });

  test('the revision moving while Jev thinks discards the answer', async () => {
    const decision = await new Orchestrator({
      client: createFakeJevClient(() => answerWith(0.05)),
    }).decide(request(table(2), PERSONALITIES.greedy, { currentRevision: () => -1 }));
    expect(decision).toMatchObject({ source: 'fallback', fallbackReason: 'revision_mismatch' });
  });

  test('the per-turn request limit sends the question to the fallback', async () => {
    const orchestrator = new Orchestrator({
      client: createFakeJevClient(() => answerWith(0.9)),
      config: {
        requestsPerTurn: 0,
        inputTokensPerGame: 1_000_000,
        confidenceFloor: {
          strategy: { few: 0.6, fewMax: 4, many: 0.5, manyFrom: 12 },
          encounter: { few: 0.6, fewMax: 4, many: 0.5, manyFrom: 12 },
          deal: { few: 0.6, fewMax: 4, many: 0.5, manyFrom: 12 },
          promise_response: { few: 0.6, fewMax: 4, many: 0.5, manyFrom: 12 },
        },
      },
    });
    expect(await orchestrator.decide(request(table(-2)))).toMatchObject({
      choice: REJECT,
      source: 'fallback',
      fallbackReason: 'request_limit',
    });
  });
});

describe('routing', () => {
  test('a promise point with no promise question pending is applied without asking Jev', async () => {
    const state = table(2);
    const idle: DecideRequest = request(state, PERSONALITIES.greedy, {
      // The asker's own observation holds no question for it to answer.
      observation: observe(state, 1),
    });
    const ask = vi.fn();
    const decision = await new Orchestrator({ client: { ask } }).decide(idle);
    expect(ask).not.toHaveBeenCalled();
    expect(decision).toMatchObject({ source: 'auto', requests: 0 });
  });

  test('every answer, from every path, is one of the engine’s listed actions', async () => {
    const paths: JevResult[] = [answerWith(0.9), answerWith(0.1), answerWith(0.55, 0.1)];
    for (const id of Object.keys(PERSONALITIES) as (keyof typeof PERSONALITIES)[]) {
      for (const trust of [-3, 0, 3]) {
        for (const result of paths) {
          const state = table(trust);
          const decision = await decideWith(
            createFakeJevClient(() => result),
            state,
            PERSONALITIES[id],
          );
          expect(legalActions(state, 0).enabled.map((action) => action.id)).toContain(
            decision.choice,
          );
        }
      }
    }
  });
});

describe('the sim policy asks Jev about a pending offer (spec §4.8, §5.3, §8)', () => {
  test('a responder seat reaches the promise question, so a sim run measures the Jev path', async () => {
    const client = createFakeJevClient(() => answerWith(0.9));
    const policy = new JevPolicy(new Orchestrator({ client }), PERSONALITIES.greedy);
    const state = table(2);
    const choice = await policy.decide(
      observe(state, 0),
      legalActions(state, 0),
      createPolicyRng('sim'),
    );
    expect(choice).toBe(ACCEPT);
    expect(client.requests).toHaveLength(1);
    expect(Object.keys(client.requests[0]!.questions)).toEqual(['promise_response']);
    expect(policy.decisions[0]).toMatchObject({ source: 'jev', fallbackReason: null });
  });
});

describe('what Jev is sent (spec §5.4)', () => {
  test('the request has no hidden information and no number to compare', async () => {
    const client = createFakeJevClient(() => answerWith(0.9));
    const state = promiseTable({
      seed: 6,
      direction: 'offer',
      trust: -2,
      history: ['broken'],
      chats: [{ topic: 'truce' }],
      bystander: true,
    });
    state.players[1]!.items.push({
      instanceId: 'bought:1:0',
      itemId: 'pickpocket',
      name: 'Pickpocket',
      visibility: 'secret',
    });
    await decideWith(client, state);
    const sent: JevRequest = client.requests[0]!;
    const text = JSON.stringify(sent);
    expect(text).not.toMatch(/bought:1:0|keptGain|actionSeq|acceptedActionSeq|"trust"|"value"/);
    expect(text).toContain('"trust_in_them":"low"');
    expect(text).toContain('P2 broke no_attack on turn 3');
    expect(text).toContain('Can we call a truce?');
  });
});

describe('the server decider with Jev unavailable', () => {
  test('the backup policy answers a promise by personality and trust, as a fallback with its reason', () => {
    const answerFor = (trust: number, personalityId: string) => {
      const state = table(trust);
      const observation = observe(state, 0);
      const wire: DecisionRequest = {
        gameId: 'game-1',
        seatIndex: 0,
        decisionPoint: 'promise_response',
        stateRevision: observation.public.stateRevision,
        observation,
        enabledActions: legalActions(state, 0).enabled,
        facts: {},
        difficulty: 'normal',
        personalityId,
        turnKey: 't',
      };
      return policyAnswer(wire, 'disabled');
    };
    expect(answerFor(-2, 'greedy')).toEqual({
      choice: REJECT,
      source: 'fallback',
      fallbackReason: 'disabled',
    });
    expect(answerFor(2, 'greedy')).toEqual({
      choice: ACCEPT,
      source: 'fallback',
      fallbackReason: 'disabled',
    });
  });
});
