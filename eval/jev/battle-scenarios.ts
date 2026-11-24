import type { GameState } from '../../engine/index.ts';
import { PERSONALITIES } from '../../ai/fallback/index.ts';
import {
  gymReward,
  pickpocketReaction,
  pvpChallenge,
  pvpDefenderWindow,
  pvpReward,
  type BattleTable,
} from './battle-kit.ts';
import type { EvalScenario } from './scenario-kit.ts';

/**
 * Spec §4.4, §5.3, §5.5, §8 (issue #56, C3): decision scenarios for the three battle decisions the
 * AI answers: the PvP challenge (`pvp_response`), the open Ability window (`ability_window`, a battle
 * window or a Pickpocket reaction) and the winner's reward (`reward`). Seat 0, the AI, is the Main
 * Character; the human at seat 1 challenges it, uses Pickpocket on it or loses to it. Each table is
 * shared by all four personalities, so a pair differs only in the personality text of the request.
 *
 * Every request comes from the real question builder over the engine's own observation and battle
 * preview. The acceptable sets are judgements from `content/personalities/<id>.json`: the `reason`
 * of each cites the weights it rests on and a test checks the cited values against the files. The
 * fallback policy's answer is a cross-check, not the source. These fixtures start as synthetic
 * placeholders; the captain records them live.
 */

type PersonalityId = keyof typeof PERSONALITIES;
const IDS: readonly PersonalityId[] = ['greedy', 'aggressive', 'cautious', 'opportunist'];

interface Verdict {
  acceptable: readonly string[];
  reason: string;
}

interface Group {
  /** Scenario IDs are `<personality>-<group>`. */
  group: string;
  description: string;
  table: () => GameState;
  verdicts: Record<PersonalityId, Verdict>;
}

const ACCEPT = 'accept-pvp';
const DECLINE = 'decline-pvp';
const PASS = 'pass-window';
const COINS = 'reward:coins';

/** Built once per table: the reward tables search the engine's seeds for the AI's win. */
const memo = (build: () => GameState): (() => GameState) => {
  let state: GameState | undefined;
  return () => (state ??= build());
};

const even: BattleTable = { seed: 3, humanClass: 'researcher' };
const underdog: BattleTable = { seed: 3, humanClass: 'rival' };
const favoured: BattleTable = { seed: 3, humanClass: 'researcher', aiExtras: ['gyarados'] };

const GROUPS: readonly Group[] = [
  {
    group: 'pvp-response-even',
    description:
      'A Researcher challenges the AI to PvP; both Starters are even, so the odds are even.',
    table: () => pvpChallenge(even),
    verdicts: {
      greedy: {
        acceptable: [DECLINE],
        reason:
          'Greedy: risk 0.3 and aggression 0.3: it keeps its coins out of a battle that is a coin flip, so it declines.',
      },
      aggressive: {
        acceptable: [ACCEPT],
        reason:
          'Aggressive: risk 0.8 and aggression 0.9: it takes an even fight for the bigger win, so it accepts.',
      },
      cautious: {
        acceptable: [DECLINE],
        reason:
          'Cautious: risk 0.2 and aggression 0.2: declining costs nothing and an even fight can lose coins, so it declines.',
      },
      opportunist: {
        acceptable: [ACCEPT, DECLINE],
        reason:
          'Opportunist: risk 0.6 and aggression 0.5: it fights when the odds are at least level, and these are level, so either answer fits.',
      },
    },
  },
  {
    group: 'pvp-response-underdog',
    description:
      'A Rival (a combat bonus in PvP) challenges the AI; the AI is the underdog with its lone Starter.',
    table: () => pvpChallenge(underdog),
    verdicts: {
      greedy: {
        acceptable: [DECLINE],
        reason:
          'Greedy: risk 0.3 and aggression 0.3: it will not stake coins on a fight it is likely to lose, so it declines.',
      },
      aggressive: {
        acceptable: [ACCEPT, DECLINE],
        reason:
          'Aggressive: risk 0.8 and aggression 0.9: it fights even as the underdog, though a worse chance makes declining defensible, so either answer fits.',
      },
      cautious: {
        acceptable: [DECLINE],
        reason:
          'Cautious: risk 0.2 and aggression 0.2: a likely loss costs coins and declining costs none, so it declines.',
      },
      opportunist: {
        acceptable: [DECLINE],
        reason:
          'Opportunist: risk 0.6 and aggression 0.5: it fights only when the odds are at least level, and they are against it, so it declines.',
      },
    },
  },
  {
    group: 'pvp-response-favoured',
    description:
      'A Researcher challenges the AI, which holds a Gyarados beside its Starter and is the clear favourite.',
    table: () => pvpChallenge(favoured),
    verdicts: {
      greedy: {
        acceptable: [ACCEPT],
        reason:
          'Greedy: risk 0.3 and aggression 0.3: a likely win takes coins from the challenger, and the odds are clearly its way, so it accepts.',
      },
      aggressive: {
        acceptable: [ACCEPT],
        reason:
          'Aggressive: risk 0.8 and aggression 0.9: a clear favourite and a fight it wants, so it accepts.',
      },
      cautious: {
        acceptable: [ACCEPT],
        reason:
          'Cautious: risk 0.2 and aggression 0.2: it avoids fights it may lose, and this one it is very likely to win, so it accepts.',
      },
      opportunist: {
        acceptable: [ACCEPT],
        reason:
          'Opportunist: risk 0.6 and aggression 0.5: a lopsided chance in its favour is the fight it waits for, so it accepts.',
      },
    },
  },
  {
    group: 'window-defender-underdog',
    description:
      'The AI accepted a Rival challenge as the underdog; in its defender window its Starter can use Blaze, which levels the odds.',
    table: () => pvpDefenderWindow(underdog),
    verdicts: {
      greedy: {
        acceptable: [PASS, 'ability:starter:0'],
        reason:
          'Greedy: aggression 0.3 and liquidity 0.9: Blaze helps a fight it would rather avoid, yet it likes to keep an Ability in hand, so either answer fits.',
      },
      aggressive: {
        acceptable: ['ability:starter:0'],
        reason:
          'Aggressive: aggression 0.9 and risk 0.8: it spends an Ability to win a fight it is losing, so it uses Blaze.',
      },
      cautious: {
        acceptable: [PASS, 'ability:starter:0'],
        reason:
          'Cautious: aggression 0.2 and risk 0.2: it holds Abilities back, but a battle it is losing is the moment to use one, so either answer fits.',
      },
      opportunist: {
        acceptable: ['ability:starter:0'],
        reason:
          'Opportunist: aggression 0.5 and risk 0.6: a free boost that levels a battle it is already in is worth spending, so it uses Blaze.',
      },
    },
  },
  {
    group: 'window-defender-favoured',
    description:
      'The AI accepted a Rival challenge with a Snorlax beside its Starter and is the favourite; Blaze would help a little and Block guards against a coin loss.',
    table: () => pvpDefenderWindow({ ...underdog, aiExtras: ['snorlax'] }),
    verdicts: {
      greedy: {
        acceptable: [PASS, 'ability:starter:0'],
        reason:
          'Greedy: aggression 0.3 and liquidity 0.9: it is already ahead, so keeping Blaze in hand or spending it both make sense.',
      },
      aggressive: {
        acceptable: ['ability:starter:0'],
        reason:
          'Aggressive: aggression 0.9 and risk 0.8: it presses a lead and spends Blaze to make the win likelier.',
      },
      cautious: {
        acceptable: [PASS, 'ability:starter:0'],
        reason:
          'Cautious: aggression 0.2 and risk 0.2: already the favourite, it keeps its Abilities for later, though using one is no mistake.',
      },
      opportunist: {
        acceptable: [PASS, 'ability:starter:0'],
        reason:
          'Opportunist: aggression 0.5 and risk 0.6: the gain from Blaze is small against the favourite lead, so it may keep it or spend it.',
      },
    },
  },
  {
    group: 'window-pickpocket-block',
    description:
      'The human used Pickpocket on the AI, whose Snorlax can react with Block to prevent the coin loss.',
    table: () => pickpocketReaction({ seed: 4 }),
    verdicts: {
      greedy: {
        acceptable: ['ability:caught:0:1'],
        reason:
          'Greedy: liquidity 0.9: coins are what it values most and Block saves them, so it uses Block.',
      },
      aggressive: {
        acceptable: ['ability:caught:0:1'],
        reason:
          'Aggressive: aggression 0.9 and liquidity 0.3: a rival is robbing it and Block costs it nothing else, so it blocks.',
      },
      cautious: {
        acceptable: ['ability:caught:0:1'],
        reason:
          'Cautious: liquidity 0.5 and aggression 0.2: it guards what it holds, and Block does exactly that, so it blocks.',
      },
      opportunist: {
        acceptable: ['ability:caught:0:1'],
        reason:
          'Opportunist: liquidity 0.7: a coin loss it can prevent is a loss it prevents, so it blocks.',
      },
    },
  },
  {
    group: 'reward-pvp-won',
    description:
      'The AI won a PvP battle and chooses: take the loser’s coins, or evolve its Charmander or its Eevee.',
    table: memo(() => pvpReward({ ...favoured, aiExtras: ['gyarados', 'eevee'] })),
    verdicts: {
      greedy: {
        acceptable: [COINS],
        reason:
          'Greedy: liquidity 0.9 and aggression 0.3: coins now are what it plays for, so it takes the coins.',
      },
      aggressive: {
        acceptable: [
          'reward:evolve:starter:0:charmeleon',
          'reward:evolve:caught:0:2:vaporeon',
          'reward:evolve:caught:0:2:jolteon',
          'reward:evolve:caught:0:2:flareon',
        ],
        reason:
          'Aggressive: aggression 0.9 and liquidity 0.3: a stronger fighter wins more battles than a few coins, so it evolves a Pokémon.',
      },
      cautious: {
        acceptable: [COINS],
        reason:
          'Cautious: liquidity 0.5 and aggression 0.2: coins in hand are safe and a stronger team is not what it wants, so it takes the coins.',
      },
      opportunist: {
        acceptable: [COINS],
        reason:
          'Opportunist: liquidity 0.7 and aggression 0.5: cash it can use at once beats a slow gain, so it takes the coins.',
      },
    },
  },
  {
    group: 'reward-gym-won',
    description:
      'The AI beat a Gym and chooses: take coins from the bank, or evolve its Charmander.',
    table: memo(() => gymReward({ seed: 5 })),
    verdicts: {
      greedy: {
        acceptable: [COINS],
        reason:
          'Greedy: liquidity 0.9 and aggression 0.3: the bank pays coins and coins are its aim, so it takes them.',
      },
      aggressive: {
        acceptable: ['reward:evolve:starter:0:charmeleon'],
        reason:
          'Aggressive: aggression 0.9 and liquidity 0.3: a stronger Charmander makes the next Gym and fight easier, so it evolves.',
      },
      cautious: {
        acceptable: [COINS],
        reason:
          'Cautious: liquidity 0.5 and aggression 0.2: it takes the safe coins over a stronger fighter it will not use, so it takes the coins.',
      },
      opportunist: {
        acceptable: [COINS, 'reward:evolve:starter:0:charmeleon'],
        reason:
          'Opportunist: liquidity 0.7 and aggression 0.5: cash now and a stronger Starter both pay, so either answer fits.',
      },
    },
  },
];

/** Spec §8: 32 battle decision scenarios, eight tables by four personalities. */
export const BATTLE_SCENARIOS: readonly EvalScenario[] = GROUPS.flatMap((group) =>
  IDS.map((id): EvalScenario => ({
    id: `${id}-${group.group}`,
    description: group.description,
    personality: PERSONALITIES[id],
    build: () => ({ state: group.table() }),
    acceptable: group.verdicts[id].acceptable,
    reason: group.verdicts[id].reason,
  })),
);
