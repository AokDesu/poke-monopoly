import { describe, expect, test } from 'vitest';
import { legalActions, observe } from '../../engine/index.ts';
import { pickpocketReaction, pvpChallenge, pvpDefenderWindow } from '../../eval/jev/battle-kit.ts';
import { BATTLE_SCENARIOS } from '../../eval/jev/battle-scenarios.ts';
import { createPolicyRng, type PolicyFacts } from '../../sim/policy.ts';
import { FallbackPolicy, PERSONALITIES, scoreOptions } from './index.ts';

// Spec §4.4, §5.3, §5.5: the fallback policy for the PvP response, Ability window and reward
// (issue #56, C3). Scores come from the personality files' risk, aggression and liquidity.

const PERSONALITY_IDS = ['greedy', 'aggressive', 'cautious', 'opportunist'] as const;

/** What the policy picks for a seat-0 table, over many seeds, so a coin flip would show. */
const picks = (state: Parameters<typeof observe>[0], id: string, facts: PolicyFacts = {}) => {
  const policy = new FallbackPolicy(PERSONALITIES[id as keyof typeof PERSONALITIES]);
  const chosen = new Set<string>();
  for (let seed = 0; seed < 25; seed++) {
    chosen.add(
      String(
        policy.decide(
          observe(state, 0),
          legalActions(state, 0),
          createPolicyRng(`b${seed}`),
          facts,
        ),
      ),
    );
  }
  return [...chosen];
};

const edge = (win: number, loss: number): PolicyFacts => ({
  battle: { win, tie: 1 - win - loss, loss },
});

describe('PvP response', () => {
  const state = pvpChallenge({ seed: 3, humanClass: 'researcher' });

  test('never a coin flip: each personality decides the same way on every seed', () => {
    for (const id of PERSONALITY_IDS) {
      expect(picks(state, id, edge(0.42, 0.42)), id).toHaveLength(1);
    }
  });

  test('the more aggressive and risk-taking the personality, the worse the odds it accepts at', () => {
    // At an even fight Aggressive and Opportunist fight and Greedy and Cautious do not.
    const even = Object.fromEntries(
      PERSONALITY_IDS.map((id) => [id, picks(state, id, edge(0.4, 0.4))]),
    );
    expect(even).toEqual({
      greedy: ['decline-pvp'],
      aggressive: ['accept-pvp'],
      cautious: ['decline-pvp'],
      opportunist: ['accept-pvp'],
    });
    // Behind, only Aggressive still fights; well ahead, all four do.
    const behind = Object.fromEntries(
      PERSONALITY_IDS.map((id) => [id, picks(state, id, edge(0.28, 0.58))]),
    );
    expect(behind).toEqual({
      greedy: ['decline-pvp'],
      aggressive: ['accept-pvp'],
      cautious: ['decline-pvp'],
      opportunist: ['decline-pvp'],
    });
    for (const id of PERSONALITY_IDS)
      expect(picks(state, id, edge(0.8, 0.1)), id).toEqual(['accept-pvp']);
    for (const id of PERSONALITY_IDS)
      expect(picks(state, id, edge(0.05, 0.9)), id).toEqual(['decline-pvp']);
  });

  test('accepting scores higher as the odds improve, and declining always scores 0', () => {
    const observation = observe(state, 0);
    const enabled = legalActions(state, 0).enabled;
    for (const id of PERSONALITY_IDS) {
      const personality = PERSONALITIES[id];
      const accept = (win: number, loss: number) =>
        scoreOptions(observation, enabled, personality, edge(win, loss)).get('accept-pvp')!;
      const decline = scoreOptions(observation, enabled, personality, edge(0.3, 0.5)).get(
        'decline-pvp',
      );
      expect(decline).toBe(0);
      expect(accept(0.2, 0.7)).toBeLessThan(accept(0.4, 0.4));
      expect(accept(0.4, 0.4)).toBeLessThan(accept(0.7, 0.2));
    }
  });

  test('without engine chances the personality alone decides, never a coin flip', () => {
    expect(picks(state, 'aggressive')).toEqual(['accept-pvp']);
    expect(picks(state, 'cautious')).toEqual(['decline-pvp']);
  });
});

describe('Ability window', () => {
  const window = pvpDefenderWindow({ seed: 3, humanClass: 'rival' });
  const ability = 'ability:starter:0';
  // The engine's own preview for this window: the odds now and after Blaze, which moves the win
  // and the loss chance each by `gain` (so the win-minus-lose edge by twice it).
  const facts = (gain: number): PolicyFacts => ({
    battle: { win: 0.28, tie: 0.14, loss: 0.58 },
    battleChoices: { [ability]: { win: 0.28 + gain, tie: 0.14, loss: 0.58 - gain } },
  });

  test('an Ability that raises the chance is used by the more aggressive personalities', () => {
    const result = Object.fromEntries(
      PERSONALITY_IDS.map((id) => [id, picks(window, id, facts(0.15))]),
    );
    expect(result).toEqual({
      greedy: ['pass-window'],
      aggressive: [ability],
      cautious: ['pass-window'],
      opportunist: [ability],
    });
  });

  test('a gain too small to be worth the Ability is passed on by everyone', () => {
    for (const id of PERSONALITY_IDS)
      expect(picks(window, id, facts(0.005)), id).toEqual(['pass-window']);
  });

  test('a large gain is used by everyone', () => {
    for (const id of PERSONALITY_IDS) expect(picks(window, id, facts(0.25)), id).toEqual([ability]);
  });

  test('a Pickpocket reaction is always blocked, which the auto policy never did', () => {
    const state = pickpocketReaction({ seed: 4 });
    for (const id of PERSONALITY_IDS) expect(picks(state, id), id).toEqual(['ability:caught:0:1']);
  });
});

describe('reward', () => {
  const [gym] = BATTLE_SCENARIOS.filter((scenario) => scenario.id === 'greedy-reward-gym-won');
  const pvp = BATTLE_SCENARIOS.find((scenario) => scenario.id === 'greedy-reward-pvp-won')!;

  test('coins are worth liquidity and an evolution aggression', () => {
    for (const scenario of [gym!, pvp]) {
      const state = scenario.build().state;
      const observation = observe(state, 0);
      const enabled = legalActions(state, 0).enabled;
      for (const id of PERSONALITY_IDS) {
        const { liquidity, aggression } = PERSONALITIES[id].weights;
        const scores = scoreOptions(observation, enabled, PERSONALITIES[id]);
        expect(scores.get('reward:coins')).toBe(liquidity);
        for (const action of enabled) {
          if (action.kind === 'choose_reward' && action.payload.kind === 'evolve') {
            expect(scores.get(action.id)).toBe(aggression);
          }
        }
      }
    }
  });

  test('Aggressive evolves and the other three take coins, on both tables', () => {
    for (const scenario of [gym!, pvp]) {
      const state = scenario.build().state;
      expect(picks(state, 'greedy').every((choice) => choice === 'reward:coins')).toBe(true);
      expect(picks(state, 'cautious')).toEqual(['reward:coins']);
      expect(picks(state, 'opportunist')).toEqual(['reward:coins']);
      expect(
        picks(state, 'aggressive').every((choice) => choice.startsWith('reward:evolve:')),
      ).toBe(true);
    }
  });
});
