import type { Personality } from '../../content/personality-schema.ts';
import type { LegalAction, LegalActions, Observation } from '../../engine/index.ts';
import type { Policy, PolicyChoice, PolicyFacts, PolicyRng } from '../../sim/policy.ts';
import type { FallbackReason } from '../jev/client.ts';

/**
 * Personality heuristics, not gameplay rules: every game number the policy compares (odds, sale
 * values, prices, coins) comes from the engine through the observation or `PolicyFacts` (§5.2).
 */
export const FALLBACK_TUNING = Object.freeze({
  /** Strategy: what keeping an item is worth, scaled by 1 − aggression (1 − risk for Lucky Egg). */
  holdItem: 0.5,
  /** Strategy: squares ahead whose Wild share values a Lucky Egg. */
  lookahead: 6,
  /** Encounter: catch chance given up per Ball tier above Poké, at full liquidity. */
  ballTierCost: 0.15,
  /** Encounter: at zero risk, a best catch chance below this releases the Pokémon. */
  releaseBelow: 0.3,
  /** Encounter: the chance assumed for a Ball when the caller supplied no odds. */
  unknownChance: 0.5,
  /** Sell Phase: share of sale desire held back by a ready Ability or an Original Starter. */
  keepFeature: 0.25,
  /** Shop: appetite for a Ball with none held, with at most `fewMax` held, and otherwise. */
  ballNeed: Object.freeze({ none: 1, few: 0.5, plenty: 0.1, fewMax: 2 }),
});

const BALL_TIERS = ['poke', 'great', 'ultra'] as const;
/** Items whose Strategy effect exists in the engine; others are never bought or used. */
const ITEM_APPEAL: Readonly<Record<string, keyof Personality['weights']>> = {
  'lucky-egg': 'risk',
  pickpocket: 'liquidity',
  repel: 'aggression',
};

type Context = { observation: Observation; personality: Personality; facts: PolicyFacts };

/**
 * Personality-weighted utility of each option (spec §5.2): higher is better, and in Strategy,
 * Encounter release, Sell and Shop the "do nothing" option scores 0 or its own fixed bar.
 */
export function scoreOptions(
  observation: Observation,
  options: readonly LegalAction[],
  personality: Personality,
  facts: PolicyFacts = {},
): Map<string, number> {
  const context = { observation, personality, facts };
  const score = SCORERS[observation.public.phase.kind] ?? (() => 0);
  return new Map(options.map((option) => [option.id, score(option, context)]));
}

const SCORERS: Partial<
  Record<Observation['public']['phase']['kind'], (option: LegalAction, context: Context) => number>
> = { strategy: strategyScore, encounter: encounterScore, sell: sellScore, shop: shopScore };

function you(observation: Observation) {
  return observation.public.players.find(
    (player) => player.seatIndex === observation.own.seatIndex,
  )!;
}

/** Target coins as a share of the richest opponent's, so the leader is the preferred target. */
function coinShare(observation: Observation, targetSeatIndex: number | undefined): number {
  const opponents = observation.public.players.filter(
    (player) => player.seatIndex !== observation.own.seatIndex,
  );
  const richest = Math.max(0, ...opponents.map((player) => player.coins));
  const target = opponents.find((player) => player.seatIndex === targetSeatIndex);
  return target && richest > 0 ? target.coins / richest : 0;
}

/** Share of the next few squares that are Wild: how likely a Lucky Egg meets an Encounter. */
function wildAhead(observation: Observation): number {
  const { board } = observation.public;
  const { position } = you(observation);
  const { lookahead } = FALLBACK_TUNING;
  let wild = 0;
  for (let step = 1; step <= lookahead; step++) {
    if (board[(position + step) % board.length]?.kind === 'wild') wild++;
  }
  return wild / lookahead;
}

function strategyScore(option: LegalAction, { observation, personality }: Context): number {
  if (option.kind !== 'use_item') return 0;
  const { risk, aggression, liquidity } = personality.weights;
  const { holdItem } = FALLBACK_TUNING;
  const { itemInstanceId, targetSeatIndex } = option.payload;
  const item = observation.own.items.find((entry) => entry.instanceId === itemInstanceId);
  switch (item?.itemId) {
    case 'lucky-egg':
      return wildAhead(observation) - holdItem * (1 - risk);
    case 'pickpocket':
      return liquidity * coinShare(observation, targetSeatIndex) - holdItem * (1 - aggression);
    case 'repel':
      return aggression * coinShare(observation, targetSeatIndex) - holdItem * (1 - aggression);
    default:
      return -1;
  }
}

function encounterScore(option: LegalAction, { personality, facts }: Context): number {
  const { risk, liquidity } = personality.weights;
  if (option.kind === 'release') return FALLBACK_TUNING.releaseBelow * (1 - risk);
  if (option.kind !== 'catch') return -1;
  const { ballType } = option.payload;
  const chance = facts.catchChance?.[ballType] ?? FALLBACK_TUNING.unknownChance;
  return chance - FALLBACK_TUNING.ballTierCost * liquidity * BALL_TIERS.indexOf(ballType);
}

/**
 * Sale desire in [0, 1]: sale value as a share of the team's best, less what a ready Ability or
 * an Original Starter holds back. Without engine sale values nothing is worth selling.
 */
export function saleDesire(observation: Observation, instanceId: string, facts: PolicyFacts) {
  const team = you(observation).team;
  const pokemon = team.find((entry) => entry.instanceId === instanceId);
  const values = facts.saleValue ?? {};
  const best = Math.max(0, ...team.map((entry) => values[entry.instanceId] ?? 0));
  if (!pokemon || best === 0) return 0;
  const kept =
    FALLBACK_TUNING.keepFeature *
    (Number(pokemon.abilityReady) + Number(pokemon.origin === 'original_starter'));
  return ((values[instanceId] ?? 0) / best) * (1 - kept);
}

/**
 * Spec §5.3: sell the Pokémon whose desire is at or above the personality's threshold. A batch
 * scores the sum over its members of desire, less 1 below the threshold, so keeping the team
 * scores 0 and the best batch is exactly the qualifying ones, sold together (§4.7).
 */
function sellScore(option: LegalAction, context: Context): number {
  if (option.kind === 'finish_sell') return 0;
  if (option.kind !== 'sell') return -1;
  return batchScore(option.payload.pokemonInstanceIds, context);
}

function batchScore(ids: readonly string[], { observation, personality, facts }: Context) {
  let score = 0;
  for (const id of ids) {
    const desire = saleDesire(observation, id, facts);
    score += desire >= personality.sellThreshold ? desire : desire - 1;
  }
  return score;
}

/** The Pokémon worth selling this Sell Phase, in team order: every one at the threshold. */
function sellBatch(enabled: readonly LegalAction[], context: Context): string[] {
  const sellable = enabled.flatMap((option) =>
    option.kind === 'sell' ? option.payload.pokemonInstanceIds : [],
  );
  return sellable.filter((id) => batchScore([id], context) > 0);
}

function shopScore(option: LegalAction, { observation, personality }: Context): number {
  if (option.kind !== 'buy') return 0;
  const { phase } = observation.public;
  const offer =
    phase.kind === 'shop'
      ? phase.offers.find((entry) => entry.id === option.payload.offerId)
      : null;
  if (!offer) return -1;
  const { weights } = personality;
  const coins = you(observation).coins;
  const spend = (weights.liquidity * offer.price) / Math.max(coins, 1);
  if (offer.kind === 'ball') {
    const { none, few, plenty, fewMax } = FALLBACK_TUNING.ballNeed;
    const { poke, great, ultra } = observation.own.balls;
    const held = poke + great + ultra;
    return (held === 0 ? none : held <= fewMax ? few : plenty) - spend;
  }
  const appeal = ITEM_APPEAL[offer.itemId];
  return appeal ? FALLBACK_TUNING.holdItem * weights[appeal] - spend : -1;
}

/** Best-scoring option; exact ties are broken by the seeded policy RNG. */
function pick(scores: Map<string, number>, rng: PolicyRng): string {
  const best = Math.max(...scores.values());
  const ties = [...scores].filter(([, score]) => score === best).map(([id]) => id);
  return ties.length === 1 ? ties[0]! : ties[rng.int(ties.length)]!;
}

/**
 * Spec §5.2 fallback policy: personality-weighted utility over the enabled actions. Its input is
 * the seat's `Observation` plus engine facts, never the game state, the RNG or hidden information.
 */
export class FallbackPolicy implements Policy {
  readonly wantsFacts = true;

  constructor(readonly personality: Personality) {}

  decide(
    observation: Observation,
    legalActions: LegalActions,
    rng: PolicyRng,
    facts: PolicyFacts = {},
  ): PolicyChoice {
    const { enabled } = legalActions;
    if (enabled.length === 0) throw new RangeError('No enabled legal action to choose from');
    if (enabled.length === 1) return enabled[0]!.id;
    if (observation.public.phase.kind === 'sell') {
      // A batch of two or more has no listed ID; the engine sells it in one atomic step (§4.7).
      const batch = sellBatch(enabled, { observation, personality: this.personality, facts });
      if (batch.length > 1) return { sellUids: batch };
    }
    return pick(scoreOptions(observation, enabled, this.personality, facts), rng);
  }
}

/** Jev's Choice answer with option IDs already mapped back to engine action IDs. */
export type JevChoice = {
  choice: string;
  probabilities: Readonly<Record<string, number>>;
  confidence: number;
};

export type FallbackDecision = {
  /** An enabled action's ID, or the Pokémon the full policy would sell together. */
  choice: PolicyChoice;
  /** `null` when Jev's own choice was applied. */
  fallbackReason: FallbackReason | 'low_confidence' | null;
};

/**
 * Spec §5.6 (Normal): apply Jev's choice at or above the confidence floor; below it the fallback
 * policy chooses between Jev's top two by personality weight. An unusable answer, or a choice
 * that is not an enabled action, falls back to the full policy at once.
 */
export function decideWithFallback(input: {
  personality: Personality;
  observation: Observation;
  legalActions: LegalActions;
  rng: PolicyRng;
  facts?: PolicyFacts;
  jev: JevChoice | { fallbackReason: FallbackReason };
  confidenceFloor: number;
}): FallbackDecision {
  const { personality, observation, legalActions, rng, facts = {}, jev } = input;
  const policy = () =>
    new FallbackPolicy(personality).decide(observation, legalActions, rng, facts);
  if ('fallbackReason' in jev) return { choice: policy(), fallbackReason: jev.fallbackReason };
  const { enabled } = legalActions;
  if (!enabled.some((option) => option.id === jev.choice)) {
    return { choice: policy(), fallbackReason: 'schema_mismatch' };
  }
  if (jev.confidence >= input.confidenceFloor) {
    return { choice: jev.choice, fallbackReason: null };
  }
  // Highest probability first; equal probabilities keep the engine's order (a stable sort).
  const topTwo = [...enabled]
    .sort((a, b) => (jev.probabilities[b.id] ?? 0) - (jev.probabilities[a.id] ?? 0))
    .slice(0, 2);
  const scores = scoreOptions(observation, topTwo, personality, facts);
  const [first, second] = topTwo;
  const choice = second && scores.get(second.id)! > scores.get(first!.id)! ? second.id : first!.id;
  return { choice, fallbackReason: 'low_confidence' };
}
