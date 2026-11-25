import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { FallbackPolicy } from '../../ai/fallback/index.ts';
import { legalActions, observe } from '../../engine/index.ts';
import { createPolicyRng } from '../../sim/policy.ts';
import { BATTLE_SCENARIOS } from './battle-scenarios.ts';
import { decideRequest, SCENARIOS } from './scenarios.ts';
import { scenarioRequest } from './replay.ts';
import type { EvalScenario } from './scenario-kit.ts';

// Spec §4.4, §5.3, §8 (issue #56, C3): battle decision scenarios, four personalities by eight tables.

const IDS = ['greedy', 'aggressive', 'cautious', 'opportunist'];
const byGroup = () => {
  const groups = new Map<string, EvalScenario[]>();
  for (const scenario of BATTLE_SCENARIOS) {
    const key = scenario.id.replace(/^[a-z]+-/, '');
    groups.set(key, [...(groups.get(key) ?? []), scenario]);
  }
  return groups;
};

test('32 scenarios: every personality answers each of the three battle decision points', () => {
  expect(BATTLE_SCENARIOS).toHaveLength(32);
  expect(new Set(BATTLE_SCENARIOS.map((scenario) => scenario.id)).size).toBe(32);
  expect(BATTLE_SCENARIOS.every((scenario) => SCENARIOS.includes(scenario))).toBe(true);
  for (const id of IDS) {
    const points = BATTLE_SCENARIOS.filter((scenario) => scenario.personality.id === id).map(
      (scenario) => decideRequest(scenario).request.decisionPoint,
    );
    expect(
      points.filter((point) => point === 'pvp_response'),
      id,
    ).toHaveLength(3);
    expect(
      points.filter((point) => point === 'ability_window'),
      id,
    ).toHaveLength(3);
    expect(
      points.filter((point) => point === 'reward'),
      id,
    ).toHaveLength(2);
  }
});

test('within a table the requests differ only in the personality', async () => {
  const groups = byGroup();
  expect(groups.size).toBe(8);
  for (const [group, members] of groups) {
    expect(members.map((member) => member.personality.id).sort(), group).toEqual([...IDS].sort());
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

test('no request carries a digit in its wording or a number in its state (spec §5.4)', async () => {
  for (const scenario of BATTLE_SCENARIOS) {
    const { questions, state } = await scenarioRequest(scenario);
    // Seat names such as P2 are opaque IDs, not numbers.
    const bare = (text: string) => text.replace(/\bP\d\b/g, 'P');
    for (const question of Object.values(questions)) {
      if (question.type !== 'choice') throw new Error('expected a Choice');
      expect(bare(String(question.instructions ?? '')), scenario.id).not.toMatch(/\d/);
      for (const text of Object.values(question.criteria))
        expect(bare(String(text)), scenario.id).not.toMatch(/\d/);
    }
    // The state guard passed when it was built; the only numbers left are seat IDs and booleans.
    expect(JSON.stringify(state), scenario.id).not.toMatch(
      /"(?:win|tie|loss|percent|probability)"/,
    );
  }
});

test("every reason cites the personality's weights, and each cited value matches its file", async () => {
  for (const scenario of BATTLE_SCENARIOS) {
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
    expect(cited.length, `${scenario.id} cites no weight`).toBeGreaterThan(0);
    for (const [, weight, value] of cited) {
      expect(Number(value), `${scenario.id} ${weight}`).toBe(file.weights[weight!]);
    }
  }
});

test('the personalities disagree on six tables and agree on two controls', () => {
  const sets = (members: EvalScenario[]) =>
    new Set(
      members.map((member) => JSON.stringify([...(member.acceptable as readonly string[])].sort())),
    );
  const groups = new Map([...byGroup()].map(([group, members]) => [group, sets(members).size]));
  const agree = [...groups].filter(([, size]) => size === 1).map(([group]) => group);
  expect(agree.sort()).toEqual(['pvp-response-favoured', 'window-pickpocket-block']);
  expect([...groups.values()].filter((size) => size > 1)).toHaveLength(6);
  // Each decision point has at least one table where the acceptable sets differ.
  for (const group of ['pvp-response-even', 'window-defender-underdog', 'reward-gym-won']) {
    expect(groups.get(group), group).toBeGreaterThan(1);
  }
});

test("the fallback policy's own answer is an acceptable one for every scenario", () => {
  for (const scenario of BATTLE_SCENARIOS) {
    const { request } = decideRequest(scenario);
    const choice = new FallbackPolicy(scenario.personality).decide(
      request.observation,
      request.legalActions,
      createPolicyRng(scenario.id),
      request.facts.policy,
    );
    expect(scenario.acceptable, scenario.id).toContain(choice);
  }
});

test('decideRequest names the decision point and gives the AI only that point’s actions', () => {
  const kinds: Record<string, string[]> = {
    pvp_response: ['respond_pvp'],
    ability_window: ['activate_ability', 'skip'],
    reward: ['choose_reward'],
  };
  for (const scenario of BATTLE_SCENARIOS) {
    const { request } = decideRequest(scenario);
    const allowed = kinds[request.decisionPoint!]!;
    expect(
      request.legalActions.enabled.every((action) => allowed.includes(action.kind)),
      scenario.id,
    ).toBe(true);
    // The engine's chances reach a challenge or a battle window; a reward and a Pickpocket have none.
    const needsBattle =
      request.decisionPoint === 'pvp_response' ||
      (request.decisionPoint === 'ability_window' && !request.observation.own.pickpocketReaction);
    expect(request.facts.battle !== undefined, scenario.id).toBe(needsBattle);
  }
});

test('no hidden information: what the other seat holds in secret never reaches the request', async () => {
  for (const scenario of BATTLE_SCENARIOS) {
    const hidden = {
      ...scenario,
      build: () => {
        const { state } = scenario.build();
        const copy = structuredClone(state);
        for (const player of copy.players.filter((entry) => entry.seatIndex === 1)) {
          player.items = [
            { instanceId: 'hidden', itemId: 'potion', name: 'SECRET_ITEM', visibility: 'secret' },
          ];
          player.balls = { poke: 9, great: 9, ultra: 9 };
        }
        return { state: copy };
      },
    };
    const text = JSON.stringify(await scenarioRequest(hidden));
    expect(text, scenario.id).not.toContain('SECRET_ITEM');
    expect(text, scenario.id).not.toMatch(/rng|cursor|drawPile|actionSeq/);
    // The engine's observation is all the question may read.
    expect(observe(scenario.build().state, 0).own.seatIndex).toBe(0);
    expect(legalActions(scenario.build().state, 0).enabled.length).toBeGreaterThan(1);
  }
});
