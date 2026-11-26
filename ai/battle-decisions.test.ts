import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { observe } from '../engine/index.ts';
import { BATTLE_SCENARIOS } from '../eval/jev/battle-scenarios.ts';
import { decideRequest } from '../eval/jev/scenarios.ts';
import { createPolicyRng } from '../sim/policy.ts';
import { PERSONALITIES } from './fallback/index.ts';
import { PINNED_JEV_MODEL, type JevAnswer, type JevRequest, type JevResult } from './jev/client.ts';
import { createFakeJevClient } from './jev/fake.ts';
import { Orchestrator, type DecideRequest } from './orchestrator.ts';

// Spec §4.4, §5.3, §5.6: the PvP response, the Ability window and the reward through the
// orchestrator (issue #56, C3). Fake clients only.

beforeEach(() => vi.stubEnv('JEV_ENABLED', 'true'));
afterEach(() => vi.unstubAllEnvs());

const scenario = (id: string) => BATTLE_SCENARIOS.find((entry) => entry.id === id)!;
const requestFor = (id: string, overrides: Partial<DecideRequest> = {}): DecideRequest => ({
  ...decideRequest(scenario(id)).request,
  ...overrides,
});

/** A Choice answer for the question named `name`: `top` takes `peak` of the mass, the rest share it. */
const answer = (request: JevRequest, name: string, top: string, peak: number): JevResult => {
  const labels = Object.keys(request.questions[name]!.criteria!);
  const rest = labels.filter((label) => label !== top);
  const probabilities = Object.fromEntries([
    [top, peak],
    ...rest.map((label) => [label, (1 - peak) / rest.length]),
  ]);
  const n = labels.length;
  const answers: Record<string, JevAnswer> = {
    [name]: {
      type: 'choice',
      choice: top,
      confidence: (n * peak - 1) / (n - 1),
      probabilities,
    },
  };
  return {
    ok: true,
    answers,
    requestId: 'req_fake_battle',
    model: PINNED_JEV_MODEL,
    latencyMs: 5,
    usage: { inputTokens: 100, outputTokens: 0 },
  };
};

const POINTS = [
  { id: 'greedy-pvp-response-even', name: 'pvp_response', label: 'decline', action: 'decline-pvp' },
  {
    id: 'greedy-window-defender-underdog',
    name: 'ability_window',
    label: 'use_blaze_charmander',
    action: 'ability:starter:0',
  },
  {
    id: 'greedy-window-pickpocket-block',
    name: 'ability_window',
    label: 'none',
    action: 'pass-window',
  },
  { id: 'greedy-reward-gym-won', name: 'reward', label: 'coins', action: 'reward:coins' },
] as const;

describe.each(POINTS)('$name ($id)', ({ id, name, label, action }) => {
  test("Jev's own answer is applied, logged against the engine action IDs and asks one question", async () => {
    const client = createFakeJevClient((request) => answer(request, name, label, 0.9));
    const decision = await new Orchestrator({ client }).decide(requestFor(id));
    expect(decision).toMatchObject({ choice: action, source: 'jev', fallbackReason: null });
    expect(decision.requests).toBe(1);
    expect(decision.events).toEqual([
      expect.objectContaining({ questionId: name, choice: action, sampled: null }),
    ]);
    expect(client.requests).toHaveLength(1);
    expect(Object.keys(client.requests[0]!.questions)).toEqual([name]);
    expect(decision.detail?.questionId).toBe(name);
  });

  test('below the confidence floor the fallback policy chooses, and says why', async () => {
    const client = createFakeJevClient((request) => answer(request, name, label, 0.55));
    const decision = await new Orchestrator({ client }).decide(requestFor(id));
    expect(decision).toMatchObject({ source: 'fallback', fallbackReason: 'low_confidence' });
    const labels = Object.keys(client.requests[0]!.questions[name]!.criteria!);
    expect(labels.length).toBeGreaterThan(1);
    expect(decision.events[0]).toMatchObject({
      questionId: name,
      fallbackReason: 'low_confidence',
    });
  });

  test('a label that was not offered falls back as invalid_choice', async () => {
    const client = createFakeJevClient((request) => {
      const result = answer(request, name, label, 0.9);
      if (!result.ok) throw new Error('unreachable');
      result.answers[name] = { ...result.answers[name]!, choice: 'surrender' } as JevAnswer;
      return result;
    });
    const decision = await new Orchestrator({ client }).decide(requestFor(id));
    expect(decision).toMatchObject({ source: 'fallback', fallbackReason: 'invalid_choice' });
    expect(decision.choice).toBeTypeOf('string');
  });

  test('a late answer, a failure and the kill switch each fall back with their reason', async () => {
    const late = createFakeJevClient(
      () =>
        new Promise<JevResult>((resolve) =>
          setTimeout(() => resolve({ ok: false, fallbackReason: 'timeout' }), 80),
        ),
    );
    expect(
      await new Orchestrator({ client: late, decisionMs: 10 }).decide(requestFor(id)),
    ).toMatchObject({ source: 'fallback', fallbackReason: 'timeout' });
    const failing = createFakeJevClient(() => ({ ok: false, fallbackReason: 'server_error' }));
    expect(await new Orchestrator({ client: failing }).decide(requestFor(id))).toMatchObject({
      source: 'fallback',
      fallbackReason: 'server_error',
    });
    vi.stubEnv('JEV_ENABLED', 'false');
    const off = createFakeJevClient((request) => answer(request, name, label, 0.9));
    expect(await new Orchestrator({ client: off }).decide(requestFor(id))).toMatchObject({
      source: 'fallback',
      fallbackReason: 'disabled',
    });
    expect(off.requests).toHaveLength(0);
  });

  test('Hard plays it as Normal: no rollouts, and the same one question', async () => {
    const outcomes = vi.fn();
    const client = createFakeJevClient((request) => answer(request, name, label, 0.9));
    const decision = await new Orchestrator({ client, outcomes }).decide(
      requestFor(id, { difficulty: 'hard' }),
    );
    expect(outcomes).not.toHaveBeenCalled();
    expect(decision).toMatchObject({ choice: action, source: 'jev' });
  });

  test('Easy samples from the probabilities and logs the draw', async () => {
    const client = createFakeJevClient((request) => answer(request, name, label, 0.9));
    const decision = await new Orchestrator({ client }).decide(
      requestFor(id, { difficulty: 'easy', rng: createPolicyRng('easy-battle') }),
    );
    expect(decision.source).toBe('jev');
    expect(decision.events[0]!.sampled).toBeTypeOf('number');
  });

  test('a seat that is not owed this decision is applied without asking Jev', async () => {
    const request = requestFor(id);
    const state = scenario(id).build().state;
    const idle = { ...request, observation: observe(state, 1) };
    const client = createFakeJevClient((asked) => answer(asked, name, label, 0.9));
    const decision = await new Orchestrator({ client }).decide(idle);
    expect(decision).toMatchObject({ source: 'auto', fallbackReason: null });
    expect(client.requests).toHaveLength(0);
  });
});

describe('the engine facts a question needs', () => {
  test.each(['greedy-pvp-response-even', 'greedy-window-defender-underdog'])(
    '%s without the battle chances falls back as missing_facts and asks nothing',
    async (id) => {
      const client = createFakeJevClient(() => ({ ok: false, fallbackReason: 'network' }));
      const request = requestFor(id);
      const { battle: _battle, ...facts } = request.facts;
      void _battle;
      const decision = await new Orchestrator({ client }).decide({
        ...request,
        facts: { ...facts, policy: undefined },
      });
      expect(decision).toMatchObject({ source: 'fallback', fallbackReason: 'missing_facts' });
      expect(client.requests).toHaveLength(0);
    },
  );

  test('a Pickpocket reaction and a reward need no battle chances', async () => {
    for (const [id, name, label] of [
      ['greedy-window-pickpocket-block', 'ability_window', 'use_block_snorlax'],
      ['greedy-reward-gym-won', 'reward', 'coins'],
    ] as const) {
      const request = requestFor(id);
      expect(request.facts.battle).toBeUndefined();
      const client = createFakeJevClient((asked) => answer(asked, name, label, 0.9));
      expect(await new Orchestrator({ client }).decide(request)).toMatchObject({ source: 'jev' });
    }
  });
});

describe('the PvP response keeps what the AI sees', () => {
  test('the per-turn request limit sends the question to the fallback', async () => {
    const client = createFakeJevClient((request) => answer(request, 'pvp_response', 'accept', 0.9));
    const orchestrator = new Orchestrator({
      client,
      config: {
        requestsPerTurn: 0,
        inputTokensPerGame: 1_000_000,
        confidenceFloor: {
          strategy: { few: 0.6, fewMax: 4, many: 0.5, manyFrom: 12 },
          encounter: { few: 0.6, fewMax: 4, many: 0.5, manyFrom: 12 },
          promise_response: { few: 0.6, fewMax: 4, many: 0.5, manyFrom: 12 },
          pvp_response: { few: 0.6, fewMax: 4, many: 0.5, manyFrom: 12 },
          ability_window: { few: 0.6, fewMax: 4, many: 0.5, manyFrom: 12 },
          reward: { few: 0.6, fewMax: 4, many: 0.5, manyFrom: 12 },
        },
      },
    });
    expect(await orchestrator.decide(requestFor('aggressive-pvp-response-even'))).toMatchObject({
      choice: 'accept-pvp',
      source: 'fallback',
      fallbackReason: 'request_limit',
    });
  });

  test('every personality gets a different question text and the same wording otherwise', async () => {
    const texts = new Set<string>();
    for (const personality of Object.values(PERSONALITIES)) {
      const client = createFakeJevClient((request) =>
        answer(request, 'pvp_response', 'accept', 0.9),
      );
      await new Orchestrator({ client }).decide(
        requestFor('greedy-pvp-response-even', { personality }),
      );
      texts.add((client.requests[0]!.state as { you: { personality: string } }).you.personality);
    }
    expect(texts.size).toBe(4);
  });
});
