import type { GameState } from '../../engine/index.ts';
import { PERSONALITIES } from '../../ai/fallback/index.ts';
import {
  caught,
  encounter,
  sell,
  starter,
  strategy,
  withFinalTableRound,
  type Acceptable,
  type ContrastKind,
  type EvalScenario,
} from './scenario-kit.ts';

/**
 * Issue #233, spec §5.5, §8: decision scenarios for the Aggressive, Cautious and Opportunist
 * personalities, 15 each. Most share the exact table state of a Greedy scenario (its "twin"), so a
 * pair differs only in the personality text of the request: spec §8 "paired scenarios swap
 * personality while holding everything else constant". The Greedy scenarios are not repeated: the
 * original 20 already exceed 15.
 *
 * Every request comes from the real question builders over engine facts, so no hidden information
 * and no number reaches Jev. Acceptable sets are judgements from the personality files:
 * `content/personalities/<id>.json` gives each weight, and the `reason` of every scenario cites
 * the weights it rests on (a test checks the cited values against the files). The fallback
 * policy's own score is a cross-check, not the source: it cannot choose a Battle Ticket, and the
 * PvP groups document that gap.
 */

type PersonalityId = 'aggressive' | 'cautious' | 'opportunist';
const PERSONALITY_IDS: readonly PersonalityId[] = ['aggressive', 'cautious', 'opportunist'];

interface Verdict {
  acceptable: Acceptable | ((state: GameState) => Acceptable);
  /** Cites the weights in the personality file that justify `acceptable` (spec §5.5). */
  reason: string;
}

interface Group {
  /** Scenario IDs are `<personality>-<group>`. */
  group: string;
  kind: ContrastKind;
  description: string;
  /** The Greedy scenario whose table state this group reuses; absent for a new state. */
  twin?: string;
  build: () => GameState;
  verdicts: Record<PersonalityId, Verdict>;
}

const hostile = (seat: number, item = 0) => `use-item:bought:0:${item}:seat-${seat}`;
const SKIP = 'skip';
const catchWith = (ball: 'poke' | 'great' | 'ultra') => `catch:${ball}`;

const GROUPS: readonly Group[] = [
  // ---- Hostile item against skip (Strategy) ----
  {
    group: 'strategy-pickpocket-rich-rival',
    kind: 'hostile-item',
    description: 'Holds Pickpocket; the only opponent is far ahead in coins.',
    twin: 'strategy-pickpocket-rich-rival',
    build: () => strategy({ seed: 1, coins: [6, 30], items: ['pickpocket'] }),
    verdicts: {
      aggressive: {
        acceptable: [hostile(1)],
        reason:
          'aggression 0.9 hunts the leader and the only rival is far ahead; loyalty 0.4 puts little weight on the goodwill a hostile item costs, so Pickpocket on the leader is right and skipping wastes the lead to hunt.',
      },
      cautious: {
        acceptable: [hostile(1), SKIP],
        reason:
          'loyalty 0.8 makes a hostile item costly and aggression 0.2 and risk 0.2 mean holding steady is fine, yet Pickpocket needs no battle and the rival is far ahead, so either use or skip is defensible.',
      },
      opportunist: {
        acceptable: [hostile(1)],
        reason:
          'liquidity 0.7 takes the coins on offer now and loyalty 0.2 leaves no goodwill to protect, so Pickpocket on the far richer rival pays right now.',
      },
    },
  },
  {
    group: 'strategy-pickpocket-richer-target',
    kind: 'hostile-item',
    description:
      'Holds Pickpocket at a 3-seat table: one opponent is rich, the other nearly broke.',
    twin: 'strategy-pickpocket-richer-target',
    build: () =>
      strategy({
        classIds: ['main-character', 'rival', 'nurse-joy'],
        seed: 2,
        coins: [10, 28, 2],
        items: ['pickpocket'],
      }),
    verdicts: {
      aggressive: {
        acceptable: [hostile(1)],
        reason:
          'aggression 0.9 targets the leader, the rich rival, never the nearly broke one; loyalty 0.4 does not hold it back.',
      },
      cautious: {
        acceptable: [hostile(1), SKIP],
        reason:
          'loyalty 0.8 and aggression 0.2 favour holding, but if it uses the item at all it takes from the rich rival, because the broke one has nothing to take; either that or skip.',
      },
      opportunist: {
        acceptable: [hostile(1)],
        reason:
          'liquidity 0.7 and loyalty 0.2: it takes from the rich rival, where the coins are, and never wastes the item on the nearly broke one.',
      },
    },
  },
  {
    group: 'strategy-repel-leader-near-start',
    kind: 'hostile-item',
    description: 'Holds Repel; the coin leader is a few squares from Start income and selling.',
    twin: 'strategy-repel-leader-near-start',
    build: () => strategy({ seed: 4, coins: [8, 24], progress: [30, 44], items: ['repel'] }),
    verdicts: {
      aggressive: {
        acceptable: [hostile(1)],
        reason:
          'aggression 0.9 strikes first at the leader, and Repel stops it reaching Start income; loyalty 0.4 and risk 0.8 put nothing in the way.',
      },
      cautious: {
        acceptable: [SKIP],
        reason:
          'loyalty 0.8 and aggression 0.2: Repel is a hostile item that earns nothing now, and a steady player keeps the goodwill rather than slow the leader.',
      },
      opportunist: {
        acceptable: [hostile(1), SKIP],
        reason:
          'aggression 0.5 is a middling pull and Repel pays no coins now (liquidity 0.7 wants cash), but loyalty 0.2 leaves no brake, so slowing the leader or holding are both reasonable.',
      },
    },
  },
  {
    group: 'strategy-mixed-items-two-rivals',
    kind: 'hostile-item',
    description: 'Holds Pickpocket, Repel and Lucky Egg at a 3-seat table with one rich opponent.',
    twin: 'strategy-mixed-items-two-rivals',
    build: () =>
      strategy({
        classIds: ['main-character', 'rival', 'researcher'],
        seed: 6,
        coins: [9, 26, 7],
        items: ['pickpocket', 'repel', 'lucky-egg'],
      }),
    verdicts: {
      aggressive: {
        acceptable: [hostile(1, 1)],
        reason:
          'aggression 0.9 prefers to slow the leader with Repel over taking its coins (liquidity 0.3 values cash little), and the one rich rival is that leader.',
      },
      cautious: {
        acceptable: [SKIP, 'use-item:bought:0:2'],
        reason:
          'loyalty 0.8 rules out both hostile items and aggression 0.2 gives no push to use them; only the Lucky Egg, used on itself (risk 0.2, a weak pull), or skipping fits a cautious player.',
      },
      opportunist: {
        acceptable: [hostile(1, 0)],
        reason:
          'liquidity 0.7 and loyalty 0.2: Pickpocket on the rich rival pays coins right now, which beats Repel (no coins) and the Lucky Egg (an unknown payoff).',
      },
    },
  },
  // ---- PvP against not (Strategy: the Battle Ticket forces the target to accept PvP) ----
  {
    group: 'strategy-battle-ticket-leader',
    kind: 'pvp',
    description: 'Holds a Battle Ticket (forces PvP); the only opponent is far ahead in coins.',
    build: () =>
      strategy({ seed: 9, coins: [8, 26], progress: [30, 40], items: ['battle-ticket'] }),
    verdicts: {
      aggressive: {
        acceptable: [hostile(1)],
        reason:
          'aggression 0.9 and risk 0.8: strikes first at the leader and takes a battle whose outcome is unknown for the bigger win; loyalty 0.4 does not stop it.',
      },
      cautious: {
        acceptable: [SKIP],
        reason:
          'aggression 0.2 and risk 0.2: avoids fights and gambles, and a forced PvP is an unknown-outcome fight; loyalty 0.8 also protects goodwill.',
      },
      opportunist: {
        acceptable: [hostile(1), SKIP],
        reason:
          'risk 0.6 and aggression 0.5 are middling, loyalty 0.2 leaves no brake, but a forced battle pays only if it is won (liquidity 0.7 wants coins now), so use or skip both fit.',
      },
    },
  },
  {
    group: 'strategy-battle-ticket-ahead',
    kind: 'pvp',
    description: 'Holds a Battle Ticket; far ahead in coins, the only opponent has few.',
    build: () =>
      strategy({ seed: 10, coins: [30, 6], progress: [40, 30], items: ['battle-ticket'] }),
    verdicts: {
      aggressive: {
        acceptable: [hostile(1), SKIP],
        reason:
          'aggression 0.9 and risk 0.8 like to strike first, but the target is not the leader (a hunter has nothing to catch up on), so forcing the fight or holding are both fine.',
      },
      cautious: {
        acceptable: [SKIP],
        reason:
          'aggression 0.2 and risk 0.2 plus a lead to protect: a forced PvP can only put the lead at risk, so it holds the Ticket.',
      },
      opportunist: {
        acceptable: [SKIP],
        reason:
          'liquidity 0.7 wants coins now and the opponent has few, so a forced battle pays little; with risk 0.6 and aggression 0.5 only middling it holds.',
      },
    },
  },
  // ---- Ball choice (Encounter) ----
  {
    group: 'encounter-magikarp-only-ultra',
    kind: 'ball-choice',
    description: 'A common Magikarp; the only Ball held is one Ultra Ball.',
    twin: 'encounter-magikarp-only-ultra',
    build: () => encounter('magikarp', { poke: 0, great: 0, ultra: 1 }),
    verdicts: {
      aggressive: {
        acceptable: [catchWith('ultra')],
        reason:
          'liquidity 0.3 barely counts the Ball price and risk 0.8 takes the throw, and the catch is near certain, so it throws the Ultra Ball rather than let the Pokémon go.',
      },
      cautious: {
        acceptable: [catchWith('ultra'), 'release'],
        reason:
          'risk 0.2 likes a near certain catch, but liquidity 0.5 weighs an Ultra Ball (the dearest Ball) against a common Pokémon, so the throw and the release are both defensible.',
      },
      opportunist: {
        acceptable: ['release', catchWith('ultra')],
        reason:
          'liquidity 0.7 weighs the dearest Ball against the small sale of a common Pokémon, so releasing is as good as throwing; risk 0.6 does not tip it either way.',
      },
    },
  },
  {
    group: 'encounter-rare-snorlax-ultra',
    kind: 'ball-choice',
    description: 'A rare Snorlax; holds a few Poké Balls and one Ultra Ball.',
    twin: 'encounter-rare-snorlax-ultra',
    build: () => encounter('snorlax', { poke: 3, great: 0, ultra: 1 }),
    verdicts: {
      aggressive: {
        acceptable: [catchWith('ultra')],
        reason:
          'risk 0.8 and liquidity 0.3: the rare Pokémon is the big win and the Ball price barely counts, so the best catch chance, the Ultra Ball, is right.',
      },
      cautious: {
        acceptable: [catchWith('ultra')],
        reason:
          'risk 0.2 wants the likeliest catch and a rare Pokémon sells for far more than the Ball costs even at liquidity 0.5, so the Ultra Ball.',
      },
      opportunist: {
        acceptable: [catchWith('ultra')],
        reason:
          'liquidity 0.7 still pays for the Ultra Ball because a rare Pokémon sells for far more than the Ball costs; risk 0.6 does not change that.',
      },
    },
  },
  {
    group: 'encounter-weedle-poke-or-great',
    kind: 'ball-choice',
    description:
      'A common Weedle, with a class that gets no catch bonus; holds two Poké Balls and two Great Balls.',
    build: () =>
      encounter(
        'weedle',
        { poke: 2, great: 2, ultra: 0 },
        { classIds: ['rival', 'main-character'] },
      ),
    verdicts: {
      aggressive: {
        acceptable: [catchWith('great')],
        reason:
          'liquidity 0.3 barely counts one extra coin and risk 0.8 wants the throw to land, so the Great Ball.',
      },
      cautious: {
        acceptable: [catchWith('great')],
        reason:
          'risk 0.2 does not want a miss when one more coin makes the catch certain, and liquidity 0.5 allows the small extra cost, so the Great Ball.',
      },
      opportunist: {
        acceptable: [catchWith('poke'), catchWith('great')],
        reason:
          'liquidity 0.7 says one extra coin is hard to earn back on a common Pokémon, so the cheaper Poké Ball is fine, but risk 0.6 also allows the Great Ball.',
      },
    },
  },
  {
    group: 'encounter-pidgey-poke-or-great',
    kind: 'ball-choice',
    description: 'A common Pidgey; holds one Poké Ball and a few Great Balls.',
    twin: 'encounter-pidgey-poke-or-great',
    build: () => encounter('pidgey', { poke: 1, great: 2, ultra: 0 }),
    verdicts: {
      aggressive: {
        acceptable: [catchWith('poke'), catchWith('great')],
        reason:
          'the catch is already near certain with either Ball, so liquidity 0.3 and risk 0.8 make the Ball choice a coin flip for it.',
      },
      cautious: {
        acceptable: [catchWith('poke'), catchWith('great')],
        reason:
          'the catch is already near certain with either Ball, so risk 0.2 gains nothing from the dearer one and liquidity 0.5 keeps the cheaper Ball, but a Great Ball is not wrong.',
      },
      opportunist: {
        acceptable: [catchWith('poke'), catchWith('great')],
        reason:
          'the catch is already near certain with either Ball, so liquidity 0.7 prefers the cheaper Poké Ball, and the Great Ball is not wrong at risk 0.6.',
      },
    },
  },
  // ---- Sell against keep (Sell Phase) ----
  {
    group: 'sell-last-phase-final-round',
    kind: 'sell-keep',
    description: 'Final Table Round: the last Sell Phase, with a caught Pidgey and Psyduck.',
    twin: 'sell-last-phase-final-round',
    build: () => withFinalTableRound(sell([caught(1, 'pidgey'), caught(2, 'psyduck')])),
    verdicts: {
      aggressive: {
        acceptable: (state) => ({
          [starter(state)]: ['true'],
          'caught:0:1': ['true'],
          'caught:0:2': ['true'],
        }),
        reason:
          'this is the last Sell Phase, so a kept Pokémon is sold later for less with no class bonus; whatever aggression 0.9 or liquidity 0.3 says, nothing is gained by keeping, so it sells all.',
      },
      cautious: {
        acceptable: (state) => ({
          [starter(state)]: ['true'],
          'caught:0:1': ['true'],
          'caught:0:2': ['true'],
        }),
        reason:
          'this is the last Sell Phase, so keeping only lowers the sale price; even loyalty 0.8 and risk 0.2, which favour a steady team, give no reason to hold, so it sells all.',
      },
      opportunist: {
        acceptable: (state) => ({
          [starter(state)]: ['true'],
          'caught:0:1': ['true'],
          'caught:0:2': ['true'],
        }),
        reason:
          'this is the last Sell Phase, so liquidity 0.7 takes the full price now instead of the lower automatic sale, and it sells all.',
      },
    },
  },
  {
    group: 'sell-snorlax-high-sale-low-keep',
    kind: 'sell-keep',
    description:
      'Lap 2 of 2: a caught Snorlax sells high now and is worth a medium amount to keep.',
    twin: 'sell-snorlax-high-sale-low-keep',
    build: () => sell([caught(1, 'snorlax')]),
    verdicts: {
      aggressive: {
        acceptable: (state) => ({ [starter(state)]: ['false'], 'caught:0:1': ['false'] }),
        reason:
          'aggression 0.9 keeps its best fighters to hunt with, and liquidity 0.3 does not need the coins, so it keeps the Snorlax; its sale threshold is the highest of the four (liquidity 0.3).',
      },
      cautious: {
        acceptable: (state) => ({
          [starter(state)]: ['false'],
          'caught:0:1': ['true', 'false'],
        }),
        reason:
          'liquidity 0.5 sits near its own sale threshold, and the Snorlax sells high but also protects a lead in battle (risk 0.2 and loyalty 0.8 favour a steady team), so selling and keeping are both defensible.',
      },
      opportunist: {
        acceptable: (state) => ({ [starter(state)]: ['false'], 'caught:0:1': ['true'] }),
        reason:
          'liquidity 0.7 takes a high sale now, and nothing in aggression 0.5 asks it to hold a team for later, so it sells the Snorlax.',
      },
    },
  },
  {
    group: 'sell-gyarados-early-lap',
    kind: 'sell-keep',
    description: 'A caught Gyarados sells high now; its keep value is high (3 Battle points).',
    twin: 'sell-gyarados-early-lap',
    build: () => sell([caught(1, 'gyarados')], { progress: [24, 10] }),
    verdicts: {
      aggressive: {
        acceptable: (state) => ({ [starter(state)]: ['false'], 'caught:0:1': ['false'] }),
        reason:
          'aggression 0.9 and risk 0.8 keep the strongest battler, a large loss of Battle points, and liquidity 0.3 does not chase the sale.',
      },
      cautious: {
        acceptable: (state) => ({ [starter(state)]: ['false'], 'caught:0:1': ['false'] }),
        reason:
          'risk 0.2 and loyalty 0.8 favour a steady strong team, and a high keep value means a large loss of Battle points, so liquidity 0.5 does not outweigh keeping it.',
      },
      opportunist: {
        acceptable: (state) => ({
          [starter(state)]: ['false'],
          'caught:0:1': ['true', 'false'],
        }),
        reason:
          'liquidity 0.7 likes the high sale now, but the keep value is high (a large loss of Battle points) and risk 0.6 values a strong team, so selling and keeping are both defensible.',
      },
    },
  },
  {
    group: 'sell-tired-eevee',
    kind: 'sell-keep',
    description: 'A tired caught Eevee sells for less now; keeping it lets it recover.',
    twin: 'sell-tired-eevee',
    build: () => sell([caught(1, 'eevee', { tired: true })]),
    verdicts: {
      aggressive: {
        acceptable: (state) => ({ [starter(state)]: ['false'], 'caught:0:1': ['false'] }),
        reason:
          'liquidity 0.3 does not need a reduced sale now and aggression 0.9 wants the Pokémon recovered and fighting, so it keeps the Eevee.',
      },
      cautious: {
        acceptable: (state) => ({ [starter(state)]: ['false'], 'caught:0:1': ['false'] }),
        reason:
          'a steady player (risk 0.2, loyalty 0.8) does not sell at a reduced price when waiting recovers it, and liquidity 0.5 gives no urgency, so it keeps the Eevee.',
      },
      opportunist: {
        acceptable: (state) => ({
          [starter(state)]: ['false'],
          'caught:0:1': ['true', 'false'],
        }),
        reason:
          'liquidity 0.7 takes cash now, but the tired price is lower than it will be after recovery and risk 0.6 can wait, so selling and keeping are both defensible.',
      },
    },
  },
  {
    group: 'sell-magikarp-low-sale-high-keep',
    kind: 'sell-keep',
    description: 'A caught Magikarp sells low now and adds nothing to the best Battle stat.',
    twin: 'sell-magikarp-low-sale-high-keep',
    build: () => sell([caught(1, 'magikarp')]),
    verdicts: {
      aggressive: {
        acceptable: (state) => ({ [starter(state)]: ['false'], 'caught:0:1': ['false'] }),
        reason:
          'liquidity 0.3 does not chase a low sale, and aggression 0.9 keeps every Pokémon that can grow; it keeps the Magikarp.',
      },
      cautious: {
        acceptable: (state) => ({ [starter(state)]: ['false'], 'caught:0:1': ['false'] }),
        reason:
          'the sale is low and liquidity 0.5 gives no urgency, while a steady player (risk 0.2) keeps a Pokémon that costs nothing to hold, so it keeps the Magikarp.',
      },
      opportunist: {
        acceptable: (state) => ({
          [starter(state)]: ['false'],
          'caught:0:1': ['true', 'false'],
        }),
        reason:
          'liquidity 0.7 takes any cash now, but the sale is low, so a Pokémon that adds nothing to the team may be sold or kept; risk 0.6 does not break the tie.',
      },
    },
  },
];

const description = (group: Group, id: PersonalityId) =>
  `${PERSONALITIES[id]!.name}: ${group.description}`;

/**
 * 15 scenarios for each of Aggressive, Cautious and Opportunist, built from the Greedy
 * scenarios' own table states where a group names a twin.
 */
export function personalityScenarios(greedyScenarios: readonly EvalScenario[]): EvalScenario[] {
  return PERSONALITY_IDS.flatMap((id) =>
    GROUPS.map((group): EvalScenario => {
      const twin = group.twin
        ? greedyScenarios.find((scenario) => scenario.id === group.twin)
        : undefined;
      if (group.twin && !twin) throw new RangeError(`${group.group}: no Greedy twin ${group.twin}`);
      const build = twin ? twin.build : () => ({ state: group.build() });
      const verdict = group.verdicts[id];
      const personality = PERSONALITIES[id]!;
      return {
        id: `${id}-${group.group}`,
        description: description(group, id),
        personality,
        build,
        acceptable:
          typeof verdict.acceptable === 'function'
            ? verdict.acceptable(build().state)
            : verdict.acceptable,
        reason: `${personality.name}: ${verdict.reason}`,
        contrast: {
          kind: group.kind,
          group: group.group,
          ...(twin && { greedyTwin: twin.id }),
        },
      };
    }),
  );
}
