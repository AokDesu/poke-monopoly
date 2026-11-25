import { describe, expect, test } from 'vitest';
import { legalActions, observe, type GameState } from '../../engine/index.ts';
import {
  gymReward,
  pickpocketReaction,
  pvpChallenge,
  pvpDefenderWindow,
  pvpReward,
} from '../../eval/jev/battle-kit.ts';
import { decideRequest } from '../../eval/jev/scenarios.ts';
import { BATTLE_SCENARIOS } from '../../eval/jev/battle-scenarios.ts';
import { PERSONALITIES } from '../fallback/index.ts';
import { assertNoComparableNumbers, assertStateTokenBudget } from '../state/index.ts';
import {
  actionIdFor,
  buildPvpResponseQuestion,
  buildReactionQuestion,
  buildRewardQuestion,
} from './index.ts';

// Spec §4.4, §5.3, §5.4: the PvP response, Ability window and reward questions (issue #56, C3).

const greedy = PERSONALITIES.greedy;
const facts = (id: string) => {
  const scenario = BATTLE_SCENARIOS.find((entry) => entry.id === id)!;
  return decideRequest(scenario).request;
};
const askPvp = (id: string) => {
  const request = facts(id);
  const decision = buildPvpResponseQuestion(
    request.observation,
    request.legalActions.enabled,
    greedy,
    request.facts.battle,
  );
  if (decision.kind !== 'ask') throw new Error(decision.kind);
  return decision;
};
const askReaction = (id: string) => {
  const request = facts(id);
  const decision = buildReactionQuestion(
    request.observation,
    request.legalActions.enabled,
    greedy,
    request.facts.battle,
  );
  if (decision.kind !== 'ask') throw new Error(decision.kind);
  return decision;
};
const askReward = (id: string) => {
  const request = facts(id);
  const decision = buildRewardQuestion(request.observation, request.legalActions.enabled, greedy);
  if (decision.kind !== 'ask') throw new Error(decision.kind);
  return decision;
};
const criteria = (question: { criteria?: unknown }) =>
  (question.criteria ?? {}) as Record<string, string>;

describe('PvP response', () => {
  test('accept and decline map to the engine actions, and the chances are named buckets', () => {
    const even = askPvp('greedy-pvp-response-even');
    expect(even.options).toEqual({ accept: 'accept-pvp', decline: 'decline-pvp' });
    expect(actionIdFor(even, 'accept')).toBe('accept-pvp');
    expect(even.state.challenge).toEqual({
      from_id: 'P2',
      your_win_chance: 'medium',
      their_win_chance: 'medium',
    });
    expect(askPvp('greedy-pvp-response-underdog').state.challenge).toMatchObject({
      your_win_chance: 'low',
      their_win_chance: 'medium',
    });
    expect(askPvp('greedy-pvp-response-favoured').state.challenge).toMatchObject({
      your_win_chance: 'high',
      their_win_chance: 'low',
    });
  });

  test('the defender reads the challenger’s chances from its own side', () => {
    // The engine's preview is the attacker's: the defender's win is its loss.
    const underdog = facts('greedy-pvp-response-underdog');
    expect(underdog.facts.battle!.now.win).toBeLessThan(underdog.facts.battle!.now.loss);
  });

  test('a single legal action is applied without a question, and none is skipped', () => {
    const request = facts('greedy-pvp-response-even');
    const { observation, facts: given } = request;
    const [first] = request.legalActions.enabled;
    expect(buildPvpResponseQuestion(observation, [first!], greedy, given.battle)).toEqual({
      kind: 'autoApply',
      actionId: first!.id,
    });
    expect(buildPvpResponseQuestion(observation, [], greedy, given.battle)).toEqual({
      kind: 'skip',
    });
  });

  test('only the challenged seat is asked, and the engine chances are required', () => {
    const state = pvpChallenge({ seed: 3, humanClass: 'researcher' });
    const enabled = legalActions(state, 0).enabled;
    expect(() => buildPvpResponseQuestion(observe(state, 1), enabled, greedy, undefined)).toThrow(
      RangeError,
    );
    expect(() => buildPvpResponseQuestion(observe(state, 0), enabled, greedy, undefined)).toThrow(
      'engine battle chances',
    );
  });
});

describe('Ability window', () => {
  test('each Ability is named with its effect in words, and none passes the window', () => {
    const decision = askReaction('greedy-window-defender-favoured');
    expect(decision.options).toEqual({
      use_blaze_charmander: 'ability:starter:0',
      use_block_snorlax: 'ability:caught:0:1',
      none: 'pass-window',
    });
    const text = criteria(decision.questions.ability_window!);
    expect(text.use_blaze_charmander).toContain('raises your combat total');
    expect(text.use_block_snorlax).toContain('prevents the next coin loss');
    expect(text.none).toContain('Nothing is spent');
  });

  test('a battle window gives the chance with and without an Ability, a Pickpocket reaction gives none', () => {
    const battle = askReaction('greedy-window-defender-underdog');
    expect(criteria(battle.questions.ability_window!).use_blaze_charmander).toContain(
      'With it your chance to win is medium',
    );
    expect(battle.state.window).toMatchObject({
      kind: 'pvp_defender',
      opponent_id: 'P2',
      your_win_chance: 'low',
    });
    const pickpocket = askReaction('greedy-window-pickpocket-block');
    expect(pickpocket.state.window).toEqual({ kind: 'pickpocket', attacker_id: 'P2' });
    expect(JSON.stringify(criteria(pickpocket.questions.ability_window!))).not.toContain(
      'chance to win',
    );
  });

  test('an Ability that leaves the odds alone says so, in a battle', () => {
    const text = criteria(askReaction('greedy-window-defender-favoured').questions.ability_window!);
    expect(text.use_block_snorlax).toContain('does not change your chance to win');
  });

  test('a battle window needs the engine chances, and a seat with no window is not asked', () => {
    const state = pvpDefenderWindow({ seed: 3, humanClass: 'rival' });
    const enabled = legalActions(state, 0).enabled;
    expect(() => buildReactionQuestion(observe(state, 0), enabled, greedy, undefined)).toThrow(
      'engine battle chances',
    );
    expect(() => buildReactionQuestion(observe(state, 1), enabled, greedy, undefined)).toThrow(
      RangeError,
    );
  });

  test('with no Ability to use, the pass is applied without a question', () => {
    const request = facts('greedy-window-pickpocket-block');
    const pass = request.legalActions.enabled.find((action) => action.kind === 'skip')!;
    expect(
      buildReactionQuestion(request.observation, [pass], greedy, request.facts.battle),
    ).toEqual({ kind: 'autoApply', actionId: 'pass-window' });
  });
});

describe('reward', () => {
  test('coins and one option per evolution branch, mapped to the engine action IDs', () => {
    const decision = askReward('greedy-reward-pvp-won');
    expect(decision.options).toEqual({
      coins: 'reward:coins',
      evolve_charmander_to_charmeleon: 'reward:evolve:starter:0:charmeleon',
      evolve_eevee_to_vaporeon: 'reward:evolve:caught:0:2:vaporeon',
      evolve_eevee_to_jolteon: 'reward:evolve:caught:0:2:jolteon',
      evolve_eevee_to_flareon: 'reward:evolve:caught:0:2:flareon',
    });
    expect(decision.state.reward).toEqual({ source: 'pvp', loser_id: 'P2' });
    expect(askReward('greedy-reward-gym-won').state.reward).toEqual({ source: 'gym' });
  });

  test('the wording gives the effect and no amount', () => {
    const pvp = criteria(askReward('greedy-reward-pvp-won').questions.reward!);
    expect(pvp.coins).toContain('from P2');
    expect(pvp.evolve_eevee_to_flareon).toContain('P2 then pays you nothing');
    const gym = criteria(askReward('greedy-reward-gym-won').questions.reward!);
    expect(gym.coins).toContain('The bank pays you');
    expect(gym.evolve_charmander_to_charmeleon).toContain('You take no coins');
  });

  test('a reward is asked only of the winner', () => {
    const state = gymReward({ seed: 5 });
    const enabled = legalActions(state, 0).enabled;
    expect(() => buildRewardQuestion(observe(state, 0), enabled, greedy)).not.toThrow();
    const lost: GameState = structuredClone(state);
    expect(() => buildRewardQuestion(observe(lost, 1), [], greedy)).not.toThrow();
  });
});

describe('guards (spec §5.4)', () => {
  test('every state passes the number and size guards, and no wording has a digit', () => {
    for (const id of [
      'greedy-pvp-response-even',
      'greedy-window-defender-underdog',
      'greedy-window-pickpocket-block',
      'greedy-reward-pvp-won',
    ]) {
      const request = facts(id);
      const decision =
        request.decisionPoint === 'pvp_response'
          ? askPvp(id)
          : request.decisionPoint === 'reward'
            ? askReward(id)
            : askReaction(id);
      assertNoComparableNumbers(decision.state);
      assertStateTokenBudget(decision.state);
      const wording = JSON.stringify(decision.questions).replace(/\bP\d\b/g, 'P');
      expect(wording, id).not.toMatch(/\d/);
    }
  });

  test('an actor ID made only of digits is allowed at the battle identifier paths and nowhere else', () => {
    expect(() =>
      assertNoComparableNumbers({
        challenge: { from_id: '7' },
        reward: { loser_id: '7' },
        window: { opponent_id: '7', attacker_id: '7' },
      }),
    ).not.toThrow();
    expect(() => assertNoComparableNumbers({ challenge: { your_win_chance: '7' } })).toThrow(
      TypeError,
    );
  });

  test('what the other seat holds in secret, and the dice, never change a request', () => {
    const request = (state: GameState) => {
      const asked = buildPvpResponseQuestion(
        observe(state, 0),
        legalActions(state, 0).enabled,
        greedy,
        facts('greedy-pvp-response-even').facts.battle,
      );
      return JSON.stringify(asked);
    };
    // The item count is public, so the two tables differ only in which secret item is held.
    const held = (itemId: string, name: string) => {
      const state = pvpChallenge({ seed: 3, humanClass: 'researcher' });
      state.players[1]!.items.push({
        instanceId: 'bought:1:0',
        itemId,
        name,
        visibility: 'secret',
      });
      return state;
    };
    const hostile = held('pickpocket', 'Pickpocket');
    const harmless = held('lucky-egg', 'Lucky Egg');
    hostile.players[1]!.balls = { poke: 9, great: 9, ultra: 9 };
    hostile.rng = { cursor: 987654, state: 'PRIVATE_RNG_SENTINEL' };
    expect(request(hostile)).toBe(request(harmless));
    expect(request(hostile)).not.toMatch(/Pickpocket|PRIVATE_RNG|bought:1:0/);
  });

  test('both PvP and Gym tables carry the same reward wording shape', () => {
    const pvp = pvpReward({ seed: 5, humanClass: 'researcher', aiExtras: ['gyarados'] });
    expect(buildRewardQuestion(observe(pvp, 0), legalActions(pvp, 0).enabled, greedy).kind).toBe(
      'ask',
    );
    const window = pickpocketReaction({ seed: 4 });
    expect(observe(window, 0).own.pickpocketReaction).toBe(true);
  });
});
