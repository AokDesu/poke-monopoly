import { PERSONALITIES } from '../../ai/fallback/index.ts';
import type { GameState } from '../../engine/index.ts';
import {
  dealTable,
  DEAL_AI_SEAT,
  owned,
  proposeDeal,
  type DealOffer,
  type DealTable,
} from './deal-kit.ts';
import type { EvalScenario } from './scenario-kit.ts';

/**
 * Issue #164 D3, spec §4.8, §5.3, §5.5, §8: Deal Card decisions. Seat 1 is the AI answering; seat 0 is the human
 * who proposed. Every scenario reaches its pending question through the engine's own `propose_deal`, so the facts
 * Jev sees are the engine's buckets (§5.4) and nothing hidden reaches it.
 *
 * Acceptable sets are judgements from `content/personalities/<id>.json`, and each `reason` cites the weights it
 * rests on (a test checks the cited values against the files). They are not the fallback policy's output: the
 * policy is a cross-check, and the two may differ where a set lists more than one fitting answer.
 */

type PersonalityId = 'greedy' | 'aggressive' | 'cautious' | 'opportunist';
const PERSONALITY_IDS: readonly PersonalityId[] = [
  'greedy',
  'aggressive',
  'cautious',
  'opportunist',
];

const ACCEPT = 'respond-deal:accept';
const REJECT = 'respond-deal:reject';
/** A counter is listed by amount; the scenario names it by the amount the code will pick (one step in the AI's favour). */
const counter = (coins: number) => `counter-deal:coins-${coins}`;

interface Verdict {
  /** Acceptable action IDs; the counter's amount is the one step the code picks. */
  acceptable: readonly string[];
  /** Cites the weights in the personality file that justify `acceptable` (spec §5.5). */
  reason: string;
}

export type DealKind = 'fair' | 'lopsided' | 'counter' | 'low-trust' | 'reject';

interface Group {
  /** Scenario IDs are `<personality>-<group>`. */
  group: string;
  kind: DealKind;
  description: string;
  table: DealTable;
  offer: DealOffer;
  /** Verdicts per personality; a function when the counter's ID depends on the state. */
  verdicts: Record<PersonalityId, Verdict>;
}

const EEVEE_SALE: Pick<DealTable, 'humanTeam' | 'coins' | 'seed'> = {
  seed: 41,
  coins: [10, 20],
  humanTeam: [owned(0, 1, 'eevee')],
};

/** Within budget: the AI pays `coins` for a Repel worth less to it, a concession of "few". */
const REPEL_OVERPAY: Pick<DealTable, 'humanItems' | 'coins' | 'seed'> = {
  seed: 42,
  coins: [10, 20],
  humanItems: ['repel'],
};

/** Every personality takes the lopsided deal: an agreement control, so echoing the personality text earns nothing. */
const controlVerdict = (id: PersonalityId): Verdict => ({
  acceptable: [ACCEPT],
  reason: `${weights(id)}; a rare Pokémon for a few coins is a large gain and costs no budget, so every personality takes it and a counter would only risk a good deal (an agreement control).`,
});

const GROUPS: readonly Group[] = [
  {
    group: 'deal-fair-eevee-sale',
    kind: 'fair',
    description:
      'The human sells an Eevee for about what it is worth; the AI loses no value. Trust is neutral.',
    table: EEVEE_SALE,
    offer: { sells: { pokemon: 'caught:0:1' }, coins: 7 },
    verdicts: {
      greedy: {
        acceptable: [counter(6), REJECT],
        reason:
          'liquidity 0.9 values cash now over a team member and the deal spends its coins, so it haggles for a lower price or declines; a fair price still pays out coins it would rather keep.',
      },
      aggressive: {
        acceptable: [ACCEPT, counter(6)],
        reason:
          'risk 0.8 takes a fair deal without fear and liquidity 0.3 does not hoard the coins it pays out; loyalty 0.4 leaves room to haggle once.',
      },
      cautious: {
        acceptable: [ACCEPT],
        reason:
          'risk 0.2 and a fair price with no value lost make this a safe deal, and loyalty 0.8 keeps goodwill with a trading partner, so it takes the deal as offered.',
      },
      opportunist: {
        acceptable: [ACCEPT, counter(6)],
        reason:
          'liquidity 0.7 and risk 0.6 take whatever pays, and the Eevee pays for its price; loyalty 0.2 means it may also squeeze the price once.',
      },
    },
  },
  {
    group: 'deal-lopsided-snorlax-sale',
    kind: 'lopsided',
    description:
      'The human sells a Snorlax for almost nothing: the AI gets far more value than it pays.',
    table: { seed: 43, coins: [10, 20], humanTeam: [owned(0, 1, 'snorlax')] },
    offer: { sells: { pokemon: 'caught:0:1' }, coins: 2 },
    verdicts: {
      greedy: controlVerdict('greedy'),
      aggressive: controlVerdict('aggressive'),
      cautious: controlVerdict('cautious'),
      opportunist: controlVerdict('opportunist'),
    },
  },
  {
    group: 'deal-counter-repel-overpay',
    kind: 'counter',
    description:
      'The human sells a Repel for a little more than it is worth to the AI: a small concession, within budget.',
    table: REPEL_OVERPAY,
    offer: { sells: { item: 'item:0:0' }, coins: 5 },
    verdicts: {
      greedy: {
        acceptable: [counter(4), REJECT],
        reason:
          'liquidity 0.9 hates paying over the value, so it asks for a lower price or declines; it never accepts a loss of value for an item.',
      },
      aggressive: {
        acceptable: [ACCEPT, counter(4)],
        reason:
          'risk 0.8 accepts a small loss for an item that could be used on the leader, and aggression 0.9 wants the weapon; it may still push the price down once.',
      },
      cautious: {
        acceptable: [counter(4), REJECT],
        reason:
          'risk 0.2 does not take a loss of value for an item it may not use, and loyalty 0.8 prefers a counter to an outright refusal; either fits.',
      },
      opportunist: {
        acceptable: [counter(4), REJECT],
        reason:
          'liquidity 0.7 takes only what pays, and this one costs it more than it gets; with loyalty 0.2 it is willing to haggle or walk away.',
      },
    },
  },
  {
    group: 'deal-low-trust-eevee-sale',
    kind: 'low-trust',
    description:
      'The same fair Eevee sale as the neutral one, from a player the AI distrusts (it broke a promise).',
    table: { ...EEVEE_SALE, trust: -2 },
    offer: { sells: { pokemon: 'caught:0:1' }, coins: 7 },
    verdicts: {
      greedy: {
        acceptable: [counter(6), REJECT],
        reason:
          'liquidity 0.9 already prefers to keep its coins, and loyalty 0.5 adds distrust of a player who broke a promise; counter or refuse.',
      },
      aggressive: {
        acceptable: [counter(6), REJECT],
        reason:
          'loyalty 0.4 gives distrust some weight and risk 0.8 does not outweigh it for a deal with nothing to gain; it may counter or refuse.',
      },
      cautious: {
        acceptable: [REJECT],
        reason:
          'loyalty 0.8 holds a broken promise against the player and risk 0.2 will not trade with someone it distrusts, so it refuses (the neutral-trust twin is accepted).',
      },
      opportunist: {
        acceptable: [ACCEPT, counter(6)],
        reason:
          'loyalty 0.2 means trust barely matters to it, and liquidity 0.7 and risk 0.6 still take a fair deal, so it answers as it does at neutral trust.',
      },
    },
  },
  {
    group: 'deal-reject-repel-overpay-low-trust',
    kind: 'reject',
    description:
      'A small concession for a Repel (within budget) from a player the AI distrusts a great deal.',
    table: { ...REPEL_OVERPAY, trust: -3 },
    offer: { sells: { item: 'item:0:0' }, coins: 5 },
    verdicts: {
      greedy: {
        acceptable: [REJECT],
        reason:
          'liquidity 0.9 refuses to pay over the value, and loyalty 0.5 gives no reason to favour a distrusted player, so it refuses.',
      },
      aggressive: {
        acceptable: [counter(4), REJECT],
        reason:
          'risk 0.8 might still bargain, but loyalty 0.4 and a very low trust make a distrusted player a poor partner; counter or refuse.',
      },
      cautious: {
        acceptable: [REJECT],
        reason:
          'risk 0.2 avoids a loss of value and loyalty 0.8 does not deal with someone who broke its trust, so it refuses.',
      },
      opportunist: {
        acceptable: [counter(4), REJECT],
        reason:
          "liquidity 0.7 sees a payment above the item's value and loyalty 0.2 neither forgives nor holds a grudge, so it bargains or refuses.",
      },
    },
  },
];

/** The weights a personality's reason cites, as the personality file writes them. */
function weights(id: PersonalityId): string {
  const { risk, aggression, liquidity, loyalty } = PERSONALITIES[id].weights;
  return `risk ${risk.toFixed(1)}, aggression ${aggression.toFixed(1)}, liquidity ${liquidity.toFixed(1)} and loyalty ${loyalty.toFixed(1)}`;
}

const build = (group: Group) => (): { state: GameState } => ({
  state: proposeDeal(dealTable(group.table), group.offer),
});

const description = (group: Group, id: PersonalityId) =>
  `${PERSONALITIES[id].name}: ${group.description}`;

/**
 * The Deal Card scenarios Jev answers, one request each: 5 table states for each of the four personalities. A new
 * one starts as a marked synthetic placeholder until a person records it; all 20 are recorded now (README).
 */
export const DEAL_SCENARIOS: readonly EvalScenario[] = PERSONALITY_IDS.flatMap((id) =>
  GROUPS.map((group): EvalScenario => {
    const verdict = group.verdicts[id];
    const personality = PERSONALITIES[id];
    return {
      id: `${id}-${group.group}`,
      description: description(group, id),
      personality,
      seat: DEAL_AI_SEAT,
      build: build(group),
      acceptable: verdict.acceptable,
      reason: `${personality.name}: ${verdict.reason}`,
    };
  }),
);

/** The kind of deal each Jev scenario covers, for the coverage test. */
export const DEAL_KIND: ReadonlyMap<string, DealKind> = new Map(
  PERSONALITY_IDS.flatMap((id) =>
    GROUPS.map((group) => [`${id}-${group.group}`, group.kind] as const),
  ),
);

interface OverBudgetGroup {
  group: string;
  description: string;
  table: DealTable;
  offer: DealOffer;
}

const OVER_BUDGET_GROUPS: readonly OverBudgetGroup[] = [
  {
    group: 'deal-over-budget-pidgey-overpay',
    description:
      'The human sells a Pidgey for far more than it is worth: the concession is over the per-deal budget.',
    table: { seed: 44, coins: [10, 20], humanTeam: [owned(0, 1, 'pidgey')] },
    offer: { sells: { pokemon: 'caught:0:1' }, coins: 9 },
  },
  {
    group: 'deal-over-budget-game-spent',
    description:
      'A small concession for a Repel, but the game budget is mostly spent, so it no longer fits what is left.',
    table: { ...REPEL_OVERPAY, spent: 2 },
    offer: { sells: { item: 'item:0:0' }, coins: 5 },
  },
  {
    group: 'deal-over-budget-snorlax-underpriced',
    description:
      "The human buys the AI's Snorlax for almost nothing: a cheaper-for-the-AI counter is listed, but the concession is over budget.",
    table: { seed: 45, coins: [20, 10], aiTeam: [owned(1, 1, 'snorlax')] },
    offer: { buys: { pokemon: 'caught:1:1' }, coins: 2 },
  },
];

/**
 * Over budget, code rejects without calling Jev (§5.3), so there is nothing to record: these replay through the
 * orchestrator with a client that fails if it is asked. Every personality gives the same answer.
 */
export const OVER_BUDGET_SCENARIOS: readonly EvalScenario[] = PERSONALITY_IDS.flatMap((id) =>
  OVER_BUDGET_GROUPS.map((group): EvalScenario => ({
    id: `${id}-${group.group}`,
    description: `${PERSONALITIES[id].name}: ${group.description}`,
    personality: PERSONALITIES[id],
    seat: DEAL_AI_SEAT,
    build: () => ({ state: proposeDeal(dealTable(group.table), group.offer) }),
    acceptable: [REJECT],
    reason: `${PERSONALITIES[id].name}: the engine lists no accept over the concession budget, so code rejects and Jev is not asked, whatever the personality.`,
  })),
);
