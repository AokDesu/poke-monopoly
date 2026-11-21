import type { Personality } from '../../content/personality-schema.ts';
import type { LegalAction, LegalActions, Observation } from '../../engine/index.ts';
import { bucketKeepValue } from '../../engine/index.ts';
import type { Policy, PolicyChoice, PolicyFacts, PolicyRng } from '../../sim/policy.ts';
import { chatScoreShift } from '../chat.ts';
import { pendingPromise } from '../promises.ts';
import type { FallbackReason } from '../jev/client.ts';
import { pendingDeal } from '../questions/deal.ts';
import { lastSellChoice } from '../last-sell.ts';

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
  /** Deal response: score of rejecting, the bar an accept or a counter has to beat. */
  dealRejectBar: -0.05,
  /** Deal response: a counter's base score, less `dealCounterLoyalty` × loyalty; a loyal personality haggles less. */
  dealCounterBase: 0.3,
  dealCounterLoyalty: 0.6,
  /** Deal response: each bucket step of value edge is worth 1; the rest are fractions of it. */
  dealCounterEdge: 0.2,
  /** Deal response: cost of each concession bucket step, less for a risk-taker (× (1 − risk)). */
  dealConcessionCost: 0.3,
  /**
   * Deal response: trust (low or high) shifts an accept or a counter by this × loyalty; liquidity above the middle of
   * its range shifts an accept toward coins in and away from coins out, by this × 2 × (liquidity − 0.5).
   */
  dealTrustStep: 0.5,
  dealLiquidityStep: 0.25,
  /** Promise response: willingness (loyalty plus trust) at or above this accepts. */
  promiseBar: 0.5,
  /** Promise response: willingness gained (lost) per point of trust above (below) neutral. */
  promiseTrustStep: 0.2,
  /** Promise response: willingness lost per promise the asker broke to this seat. */
  promiseGrudge: 0.1,
});

const VALUE_RANK = { low: 0, medium: 1, high: 2 } as const;
const COUNT_RANK = { none: 0, one: 1, few: 2, many: 3 } as const;

const BALL_TIERS = ['poke', 'great', 'ultra'] as const;

type Context = { observation: Observation; personality: Personality; facts: PolicyFacts };

/**
 * Personality-weighted utility of each option (spec §5.2): higher is better, and in Strategy,
 * Encounter release and Sell the "do nothing" option scores 0 or its own fixed bar; other phases
 * score every option 0, so the seeded tie-break chooses.
 */
export function scoreOptions(
  observation: Observation,
  options: readonly LegalAction[],
  personality: Personality,
  facts: PolicyFacts = {},
): Map<string, number> {
  if (pendingDeal(observation)) return dealScores(observation, options, personality);
  const context = { observation, personality, facts };
  const phaseScore = SCORERS[observation.public.phase.kind] ?? (() => 0);
  // A responder answers a pending question; the phase on the table is the asker's, not its own.
  const score = (option: LegalAction) =>
    option.kind === 'respond' ? respondScore(option, context) : phaseScore(option, context);
  return new Map(options.map((option) => [option.id, score(option)]));
}

/**
 * Spec §4.8, §5.3 Promise response: the seat's willingness is its loyalty, moved up or down by its
 * trust in the asker (the engine's `own.trust`, `promiseTrustStep` a point) and down again for each
 * promise the asker broke to it (the memory evidence). Accept scores the willingness over the bar,
 * and at the bar itself (a tie goes to accepting); reject scores 0. Promises never change
 * legality, so both options are always scored. Other responder questions score 0 here.
 */
function respondScore(option: LegalAction, { observation, personality }: Context): number {
  if (option.kind !== 'respond') return 0;
  const question = pendingPromise(observation);
  if (!question || option.payload.answer === 'reject') return 0;
  const { promiseBar, promiseTrustStep, promiseGrudge } = FALLBACK_TUNING;
  const grudges = question.memory.filter(
    (entry) =>
      entry.outcome === 'broken' && entry.promiserSeatIndex === question.initiatorSeatIndex,
  ).length;
  const willingness =
    personality.weights.loyalty + promiseTrustStep * question.trust - promiseGrudge * grudges;
  // Rounded so that float noise never decides a tie at the bar.
  return Math.round((willingness - promiseBar) * 1e6) / 1e6 + 1e-9;
}

const SCORERS: Partial<
  Record<Observation['public']['phase']['kind'], (option: LegalAction, context: Context) => number>
> = { strategy: strategyScore, encounter: encounterScore, sell: sellScore };

/**
 * Spec §5.3, §3 fallback table: the answer to a Deal Card from the engine's own buckets (§5.4), under the same
 * concession budget as Jev. The engine lists `accept` only when the concession fits the budget, so an answer it
 * does not list is never chosen; with no `accept` listed everything but `reject` scores below it, a cheaper
 * counter included (§5.3: over budget, code rejects). Without the buckets nothing is worth accepting.
 */
function dealScores(
  observation: Observation,
  options: readonly LegalAction[],
  personality: Personality,
): Map<string, number> {
  const pending = pendingDeal(observation)!;
  const { facts } = pending;
  const { risk, liquidity, loyalty } = personality.weights;
  const tuning = FALLBACK_TUNING;
  const acceptListed = options.some(
    (option) => option.kind === 'respond_deal' && option.payload.answer === 'accept',
  );
  // The engine's own trust bucket and its named favourable counter (§5.4); the policy compares no price.
  const trust = facts?.proposerTrust ?? 'neutral';
  const edge = facts ? VALUE_RANK[facts.valueReceived] - VALUE_RANK[facts.valueGiven] : -2;
  const coinsIn = pending.terms.give.coins > 0;
  const trustShift =
    tuning.dealTrustStep * loyalty * (trust === 'high' ? 1 : trust === 'low' ? -1 : 0);
  const liquidityShift = tuning.dealLiquidityStep * 2 * (liquidity - 0.5) * (coinsIn ? 1 : -1);
  const cost = facts ? COUNT_RANK[facts.concession] * tuning.dealConcessionCost * (1 - risk) : 0;
  const accept = facts ? edge + trustShift + liquidityShift - cost : -1;
  const counterScore = facts
    ? tuning.dealCounterBase -
      tuning.dealCounterLoyalty * loyalty +
      tuning.dealCounterEdge * edge +
      trustShift
    : -1;
  return new Map(
    options.map((option) => {
      if (option.kind === 'respond_deal') {
        return [option.id, option.payload.answer === 'reject' ? tuning.dealRejectBar : accept];
      }
      return [
        option.id,
        acceptListed && facts?.favourableCounter === option.id ? counterScore : -1,
      ];
    }),
  );
}

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
  // Temporary #55 limitation (S06, S10): AI seats never declare PvP or activate an Ability in
  // Strategy until Stream B integrates them.
  if (option.kind === 'declare_pvp' || option.kind === 'activate_ability') return -1;
  if (option.kind !== 'use_item') return 0;
  const { itemInstanceId, targetSeatIndex } = option.payload;
  const item = observation.own.items.find((entry) => entry.instanceId === itemInstanceId);
  // Spec §5.3: a chat shifts this turn's target and item weights by one bounded bucket.
  const chat = chatScoreShift(observation, { itemId: item?.itemId, targetSeatIndex });
  return chat + baseStrategyScore(item?.itemId, targetSeatIndex, observation, personality);
}

function baseStrategyScore(
  itemId: string | undefined,
  targetSeatIndex: number | undefined,
  observation: Observation,
  personality: Personality,
): number {
  const { risk, aggression, liquidity } = personality.weights;
  const { holdItem } = FALLBACK_TUNING;
  switch (itemId) {
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
 * an Original Starter holds back, then reduced by the engine's separate keep bucket.
 * Without engine sale values nothing is worth selling.
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
  const keep = bucketKeepValue(facts.keepValue?.[instanceId] ?? 0);
  const battleKeep =
    keep === 'high'
      ? 2 * FALLBACK_TUNING.keepFeature
      : keep === 'medium'
        ? FALLBACK_TUNING.keepFeature
        : 0;
  return ((values[instanceId] ?? 0) / best) * (1 - kept) * (1 - battleKeep);
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
      // Spec §5.6: the last Sell Phase sells everything unless a Gym follows, whatever the threshold.
      const everything = lastSellChoice(observation, enabled);
      if (everything !== undefined) return everything;
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
