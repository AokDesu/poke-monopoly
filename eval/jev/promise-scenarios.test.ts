import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { FallbackPolicy } from '../../ai/fallback/index.ts';
import { legalActions, observe } from '../../engine/index.ts';
import { createPolicyRng } from '../../sim/policy.ts';
import { decideRequest, SCENARIOS } from './scenarios.ts';
import { scenarioRequest } from './replay.ts';
import { PROMISE_SCENARIOS } from './promise-scenarios.ts';
import type { EvalScenario } from './scenario-kit.ts';

// Spec §5.3, §8 (S11, promise half): promise response scenarios, four personalities by four tables.

const IDS = ['greedy', 'aggressive', 'cautious', 'opportunist'];
const stateOf = async (scenario: EvalScenario) =>
  (await scenarioRequest(scenario)).state as {
    you: { personality: string };
    promise_offer: { you_are: string; trust_in_them: string; memory: string[] };
    recent_chat?: { from: string; said: string }[];
  };
const byGroup = () => {
  const groups = new Map<string, EvalScenario[]>();
  for (const scenario of PROMISE_SCENARIOS) {
    const key = scenario.id.replace(/^[a-z]+-/, '');
    groups.set(key, [...(groups.get(key) ?? []), scenario]);
  }
  return groups;
};

test('16 scenarios: each personality has the AI as promiser and as recipient, at high and low trust', async () => {
  expect(PROMISE_SCENARIOS).toHaveLength(16);
  expect(new Set(PROMISE_SCENARIOS.map((scenario) => scenario.id)).size).toBe(16);
  expect(PROMISE_SCENARIOS.every((scenario) => SCENARIOS.includes(scenario))).toBe(true);
  for (const id of IDS) {
    const mine = PROMISE_SCENARIOS.filter((scenario) => scenario.personality.id === id);
    const cells = await Promise.all(
      mine.map(async (scenario) => {
        const { promise_offer: offer } = await stateOf(scenario);
        return `${offer.you_are}/${offer.trust_in_them}`;
      }),
    );
    expect(cells.sort(), id).toEqual([
      'promiser/high',
      'promiser/low',
      'recipient/high',
      'recipient/low',
    ]);
  }
});

test('each scenario names its trust bucket and carries the memory and the human’s message', async () => {
  for (const scenario of PROMISE_SCENARIOS) {
    const state = await stateOf(scenario);
    const high = scenario.id.includes('-high-trust');
    expect(state.promise_offer.trust_in_them, scenario.id).toBe(high ? 'high' : 'low');
    expect(state.promise_offer.memory, scenario.id).toEqual(
      high
        ? ['P2 kept no_attack, made on turn 2', 'P2 kept no_attack, made on turn 5']
        : ['P2 broke no_attack on turn 3'],
    );
    expect(state.recent_chat, scenario.id).toEqual([
      { from: 'P2', said: '"Can we call a truce?"' },
    ]);
  }
});

test('within a table the requests differ only in the personality', async () => {
  const groups = byGroup();
  expect(groups.size).toBe(4);
  for (const [group, members] of groups) {
    expect(members.map((member) => member.personality.id).sort(), group).toEqual([...IDS].sort());
    const tables = members.map((member) => JSON.stringify(observe(member.build().state, 0)));
    expect(new Set(tables).size, group).toBe(1);
    const requests = await Promise.all(members.map((member) => scenarioRequest(member)));
    const strip = (request: Awaited<ReturnType<typeof scenarioRequest>>) => {
      const copy = structuredClone(request.state) as { you: { personality?: string } };
      delete copy.you.personality;
      return JSON.stringify({ state: copy, questions: request.questions });
    };
    expect(new Set(requests.map(strip)).size, group).toBe(1);
    expect(new Set(requests.map((request) => JSON.stringify(request))).size, group).toBe(4);
  }
});

test("every reason cites the personality's weights, and each cited value matches its file", async () => {
  for (const scenario of PROMISE_SCENARIOS) {
    const file = JSON.parse(
      await readFile(
        join(import.meta.dirname, '../../content/personalities', `${scenario.personality.id}.json`),
        'utf8',
      ),
    ) as { weights: Record<string, number> };
    expect(scenario.reason!.startsWith(`${scenario.personality.name}: `), scenario.id).toBe(true);
    const cited = [
      ...scenario.reason!.matchAll(/\b(risk|aggression|liquidity|loyalty) (\d\.\d)\b/g),
    ];
    expect(
      cited.some(([, weight]) => weight === 'loyalty'),
      `${scenario.id} cites no loyalty`,
    ).toBe(true);
    for (const [, weight, value] of cited) {
      expect(Number(value), `${scenario.id} ${weight}`).toBe(file.weights[weight!]);
    }
  }
});

test('the personalities disagree somewhere, and agree on a control', () => {
  const sets = (members: EvalScenario[]) =>
    members.map((member) => JSON.stringify(member.acceptable));
  const groups = [...byGroup().values()];
  expect(groups.some((members) => new Set(sets(members)).size > 1)).toBe(true);
  expect(groups.some((members) => new Set(sets(members)).size === 1)).toBe(true);
  // High trust accepts and low trust rejects for Greedy, the personality of the old acceptance.
  const greedy = (suffix: string) =>
    PROMISE_SCENARIOS.find((scenario) => scenario.id === `greedy-promise-${suffix}`)!;
  for (const role of ['recipient', 'promiser']) {
    expect(greedy(`${role}-high-trust`).acceptable).toEqual(['respond:accept']);
    expect(greedy(`${role}-low-trust`).acceptable).toEqual(['respond:reject']);
  }
});

test("the fallback policy's own answer is an acceptable one for every scenario", () => {
  for (const scenario of PROMISE_SCENARIOS) {
    const { state } = scenario.build();
    const choice = new FallbackPolicy(scenario.personality).decide(
      observe(state, 0),
      legalActions(state, 0),
      createPolicyRng(scenario.id),
    );
    expect(scenario.acceptable, scenario.id).toContain(choice);
  }
});

test('no hidden information: what other seats hold in secret never reaches the request', async () => {
  for (const scenario of PROMISE_SCENARIOS) {
    const hidden = {
      ...scenario,
      build: () => {
        const { state } = scenario.build();
        for (const player of state.players.filter((entry) => entry.seatIndex === 1)) {
          // Swap the one public-count item for a secret one of another kind.
          player.items = [
            {
              instanceId: 'hidden',
              itemId: 'potion',
              name: 'SECRET_ITEM',
              visibility: 'secret',
            },
          ];
        }
        return { state };
      },
    };
    const text = JSON.stringify(await scenarioRequest(hidden));
    expect(text, scenario.id).not.toContain('SECRET_ITEM');
    expect(text, scenario.id).not.toMatch(/keptGain|actionSeq|"value"/);
  }
});

test('decideRequest names the responder point and gives the AI only respond actions', () => {
  for (const scenario of PROMISE_SCENARIOS) {
    const { request } = decideRequest(scenario);
    expect(request.decisionPoint).toBe('promise_response');
    expect(request.legalActions.enabled.map((action) => action.id)).toEqual([
      'respond:accept',
      'respond:reject',
    ]);
  }
});
