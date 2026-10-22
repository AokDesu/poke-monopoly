import { noul, type Questions } from '@typesafe-ai/sdk';
import { bucketCount } from '../../engine/index.ts';
import type { Observation } from '../../engine/index.ts';
import type { JevAnswer } from '../jev/client.ts';
import { speciesText } from './content.ts';
import { personalState } from './decision.ts';
import type { Personality } from './shortlist.ts';

/**
 * The engine's numbers for one sellable Pokémon in this Sell Phase (spec §4.7). The engine
 * computes every number; the builder only turns them into buckets (§5.2, §5.4).
 */
export interface SaleFact {
  instanceId: string;
  /** Coins from selling it now: its sale basis, after the tired adjustment, before any class bonus. */
  salePrice: number;
  /** Class bonus coins it gets when it is the only Pokémon sold in this phase; 0 when none. */
  classBonusAlone: number;
  /** Class bonus coins it still gets when every offered Pokémon is sold together. */
  classBonusTogether: number;
  /** What keeping it is worth in coins, as the engine projects it (§5.6 keep value). */
  keepValue: number;
}

export interface SellFacts {
  pokemon: readonly SaleFact[];
}

/** Coin buckets for sale and keep values: low up to 5, medium 6–12, high 13 or more. Presentation only. */
export const SELL_VALUE_BUCKETS = Object.freeze({ lowMax: 5, mediumMax: 12 });

// Spec §5.3: at most 12 Pokémon per request, and at most 3 Jev requests per AI turn.
export const SELL_REQUEST_LIMIT = 12;
export const REQUESTS_PER_TURN = 3;

export type SellValue = 'low' | 'medium' | 'high';

export function bucketSellValue(coins: number): SellValue {
  if (!Number.isSafeInteger(coins) || coins < 0) {
    throw new RangeError('Coins must be a nonnegative whole number');
  }
  if (coins <= SELL_VALUE_BUCKETS.lowMax) return 'low';
  if (coins <= SELL_VALUE_BUCKETS.mediumMax) return 'medium';
  return 'high';
}

const BONUS_ONLY_ALONE = 'only if you do not also sell a Pokémon that takes it instead';

/** `yes` when it keeps the once-per-phase bonus even if every offered Pokémon is sold. */
function classBonusWords(fact: SaleFact): 'yes' | 'no' | typeof BONUS_ONLY_ALONE {
  if (fact.classBonusTogether > 0) return 'yes';
  return fact.classBonusAlone > 0 ? BONUS_ONLY_ALONE : 'no';
}

/** The Noul for `you.team[index]`; its facts are `sell_phase.offers[label]` (spec §5.3, §5.4). */
export function sellInstructions(index: number, pokemon: string, label: string): string {
  return (
    `Sell Phase at Start: should \`you.team[${index}]\` (${pokemon}) be sold now? Its facts are ` +
    `in \`sell_phase.offers.${label}\`. \`sale_value_now\` (coins from selling it now) and ` +
    '`keep_value` (what keeping it is worth) are separate values, each low, medium or high. ' +
    '`class_bonus` says whether your class adds bonus coins to this sale; a once-per-Lap bonus ' +
    'goes to only one Pokémon per Sell Phase.'
  );
}

export const SELL_CRITERIA = Object.freeze({
  true:
    'Sell it now: you get its sale value now, plus the class bonus if `class_bonus` says so, ' +
    'and you no longer have the Pokémon. If you sell every Pokémon you have, you get a Rescue ' +
    'Starter, which sells for nothing.',
  false:
    'Keep it: you keep the Pokémon and can sell it at a later Sell Phase. When ' +
    '`sell_phase.last_sell_phase` is true there is none: a Pokémon kept to the end of the game ' +
    'is sold automatically for less, with no class bonus.',
});

export type SellOffer = {
  pokemon: string;
  sale_value_now: SellValue;
  keep_value: SellValue;
  class_bonus: ReturnType<typeof classBonusWords>;
};

export type SellState = ReturnType<
  typeof personalState<{
    sell_phase: {
      laps_remaining: ReturnType<typeof bucketCount>;
      last_sell_phase: boolean;
      offers: Record<string, SellOffer>;
    };
  }>
>;

/** One Jev request of the Sell Phase; `options` maps each question name to its Pokémon's ID. */
export interface SellRequest {
  state: SellState;
  questions: Questions;
  options: Readonly<Record<string, string>>;
}

export interface SellQuestions {
  requests: SellRequest[];
  /** Offered Pokémon over the request budget, in team order, for the fallback sale rule. */
  fallbackIds: string[];
}

/**
 * Spec §5.3 Sell Phase: one Noul per offered Pokémon, "Should `you.team[i]` be sold now?",
 * named `sell_team_<i>` after its team position. Up to 12 Pokémon share one request; a larger
 * team is split into requests of 12 while `requestsLeft` allows, and the rest go to the
 * fallback. Rescue Starters are never offered: they sell for nothing (§4.7).
 */
export function buildSellQuestions(
  observation: Observation,
  facts: SellFacts,
  personality: Personality,
  requestsLeft = REQUESTS_PER_TURN,
): SellQuestions {
  const { phase, players, finalTableRound, lapTarget } = observation.public;
  if (phase.kind !== 'sell') throw new RangeError('Observation is not in a Sell Phase');
  const you = players.find((player) => player.seatIndex === observation.own.seatIndex);
  if (!you) throw new RangeError('Observation has no player for its own seat');
  for (const fact of facts.pokemon) {
    if (!you.team.some((pokemon) => pokemon.instanceId === fact.instanceId)) {
      throw new RangeError(`Sale fact for ${fact.instanceId}, which is not in your team`);
    }
  }
  const offered = you.team.flatMap((pokemon, index) => {
    const fact = facts.pokemon.find((entry) => entry.instanceId === pokemon.instanceId);
    if (!fact || pokemon.origin === 'rescue_starter') return [];
    const offer: SellOffer = {
      pokemon: speciesText(pokemon.speciesId).name,
      sale_value_now: bucketSellValue(fact.salePrice),
      keep_value: bucketSellValue(fact.keepValue),
      class_bonus: classBonusWords(fact),
    };
    return [{ label: `sell_team_${index}`, index, instanceId: pokemon.instanceId, offer }];
  });
  // Once the Final Table Round is announced, this is the seat's last turn, so its last Sell Phase.
  const lastSellPhase = finalTableRound !== null;
  const lapsRemaining = bucketCount(lastSellPhase ? 0 : Math.max(0, lapTarget - you.creditedLap));
  const requests: SellRequest[] = [];
  let next = 0;
  while (next < offered.length && requests.length < requestsLeft) {
    const batch = offered.slice(next, next + SELL_REQUEST_LIMIT);
    next += batch.length;
    const questions: Questions = {};
    const options: Record<string, string> = {};
    const offers: Record<string, SellOffer> = {};
    for (const { label, index, instanceId, offer } of batch) {
      questions[label] = noul(sellInstructions(index, offer.pokemon, label), { ...SELL_CRITERIA });
      options[label] = instanceId;
      offers[label] = offer;
    }
    requests.push({
      state: personalState(observation, personality, {
        sell_phase: { laps_remaining: lapsRemaining, last_sell_phase: lastSellPhase, offers },
      }),
      questions,
      options,
    });
  }
  return { requests, fallbackIds: offered.slice(next).map(({ instanceId }) => instanceId) };
}

/**
 * Jev's answers to one Sell request keyed by Pokémon instance ID. Answers to questions the
 * request did not ask are dropped.
 */
export function sellAnswers(
  request: Pick<SellRequest, 'options'>,
  answers: Readonly<Record<string, JevAnswer>>,
): Record<string, JevAnswer> {
  const byPokemon: Record<string, JevAnswer> = {};
  for (const [label, instanceId] of Object.entries(request.options)) {
    const answer = Object.hasOwn(answers, label) ? answers[label] : undefined;
    if (answer) byPokemon[instanceId] = answer;
  }
  return byPokemon;
}

/**
 * Spec §5.3: sell every Pokémon whose Noul is at or above the personality's sell threshold.
 * A Noul has no confidence, so no confidence floor applies; any other answer type sells nothing.
 */
export function decideSales(
  answers: Readonly<Record<string, JevAnswer>>,
  personality: { sellThreshold: number },
): string[] {
  return Object.entries(answers).flatMap(([instanceId, answer]) =>
    answer.type === 'noul' && answer.noul >= personality.sellThreshold ? [instanceId] : [],
  );
}
