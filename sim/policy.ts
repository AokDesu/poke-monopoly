import { FallbackPolicy, PERSONALITIES } from '../ai/fallback/index.ts';
import {
  createRng,
  int,
  type BallType,
  type LegalActions,
  type Observation,
} from '../engine/index.ts';

/** Seeded choice source for a policy; separate from the engine's private game RNG. */
export type PolicyRng = { int(n: number): number };

/**
 * Engine-computed numbers for the deciding seat that its observation does not carry (§5.2). The
 * caller asks the engine for them, so a policy never needs the game state.
 */
export type PolicyFacts = {
  /** Catch probability for each held Ball type in the current Encounter (`oddsForAllBalls`). */
  catchChance?: Readonly<Partial<Record<BallType, number>>>;
  /** Coins each own sellable Pokémon would fetch in one batch selling all of them (§4.7). */
  saleValue?: Readonly<Record<string, number>>;
};

/**
 * An enabled action's ID, or the Pokémon to sell in one atomic Sell Phase batch (§4.7). The
 * engine lists one-Pokémon sales and validates a batch as a whole, so a batch has no listed ID.
 */
export type PolicyChoice = string | { sellUids: readonly string[] };

/** Spec §8: a policy only chooses; the engine stays the sole rules authority (§9). */
export interface Policy {
  /** Set when `decide` reads `facts`; the runner skips asking the engine for them otherwise. */
  readonly wantsFacts?: boolean;
  decide(
    observation: Observation,
    legalActions: LegalActions,
    rng: PolicyRng,
    facts?: PolicyFacts,
  ): PolicyChoice;
}

export function createPolicyRng(seed: number | string): PolicyRng {
  let rng = createRng(seed);
  return {
    int(n) {
      const draw = int(rng, n, 'policy');
      rng = draw.rng;
      return draw.value;
    },
  };
}

/** Uniform over enabled choices; disabled choices are never picked. */
export class RandomPolicy implements Policy {
  decide(_observation: Observation, legalActions: LegalActions, rng: PolicyRng): string {
    const { enabled } = legalActions;
    if (enabled.length === 0) throw new RangeError('No enabled legal action to choose from');
    return enabled[rng.int(enabled.length)]!.id;
  }
}

/** `--policy <name>`; `fallback` plays every seat as Greedy (spec §5.2, §5.5). A later issue adds `jev`. */
export const POLICIES: Readonly<Record<string, () => Policy>> = {
  random: () => new RandomPolicy(),
  fallback: () => new FallbackPolicy(PERSONALITIES.greedy),
};
