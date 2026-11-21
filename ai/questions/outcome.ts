import type { ExpectedCoins, LeadChance, OptionOutcome } from '../../engine/index.ts';

/** Hard's per-option rollout buckets, keyed by engine action ID (spec §5.6). */
export type OptionOutcomes = Readonly<Record<string, OptionOutcome>>;

const COINS: Readonly<Record<ExpectedCoins, string>> = {
  falls: 'fall',
  flat: 'stay about the same',
  rises: 'rise',
  'rises a lot': 'rise a lot',
};

/**
 * Spec §5.6 Hard: the engine's expected-outcome buckets for one option, as words. They come from
 * simulated rounds over worlds the seat could be in, so the sentence says they are estimates and
 * never carries a number (§5.4).
 */
export function outcomeSentence({ expected_coins, lead_chance }: OptionOutcome): string {
  return (
    ` Simulated over the next round, with what you cannot see filled in at random: your coins ` +
    `${COINS[expected_coins]}, and your chance to lead the table in coins is ${lead_chance}.`
  );
}

export type { ExpectedCoins, LeadChance };
