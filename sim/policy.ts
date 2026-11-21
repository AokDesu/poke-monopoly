import { FallbackPolicy, PERSONALITIES } from '../ai/fallback/index.ts';
import { createHardJevPolicy, createJevPolicy } from '../ai/jev-policy.ts';
import { ECONOMY_POLICIES } from './exploits/economy.ts';
import {
  AlwaysPvpPolicy,
  ForceWeakTargetPolicy,
  ImmediateAbilityPolicy,
} from './exploits/combat.ts';

export { decisionRates, type DecisionRates } from '../ai/jev-policy.ts';
import {
  createRng,
  int,
  type BallType,
  type ExploitFacts,
  type LegalActions,
  type Observation,
} from '../engine/index.ts';

/** Seeded choice source for a policy; separate from the engine's private game RNG. */
export type PolicyRng = { int(n: number): number };

/**
 * Engine-computed numbers for the deciding seat that its observation does not carry (§5.2).
 * The caller asks the engine for them, so a policy never needs the game state.
 */
export type PolicyFacts = {
  /** Catch probability for each held Ball type in the current Encounter (`oddsForAllBalls`). */
  catchChance?: Readonly<Partial<Record<BallType, number>>>;
  /** Succeeding d6 faces for each held Ball type in the current Encounter (`oddsForAllBalls`). */
  catchSuccessFaces?: Readonly<Partial<Record<BallType, number>>>;
  /** Coins each own sellable Pokémon would fetch in one batch selling all of them (§4.7). */
  saleValue?: Readonly<Record<string, number>>;
  /** Lost Battle points for each own Pokémon if removed, from `saleFacts` (§5.6). */
  keepValue?: Readonly<Record<string, number>>;
};

/** What `SimEngine.facts` returns: the numbers above plus the exploit facts the combat policies read. */
export type SeatFacts = PolicyFacts & Partial<ExploitFacts>;

/**
 * An enabled action's ID, or the Pokémon to sell in one atomic Sell Phase batch (§4.7). The
 * engine lists one-Pokémon sales and validates a batch as a whole, so a batch has no listed ID.
 */
export type PolicyChoice = string | { sellUids: readonly string[] };

/** Spec §8: a policy only chooses; the engine stays the sole rules authority (§9). */
export interface Policy {
  /** Reporting metadata; policies without a personality are labelled `unassigned`. */
  readonly personality?: { readonly id: string };
  /** Set when `decide` reads `facts`; the runner skips asking the engine for them otherwise. */
  readonly wantsFacts?: boolean;
  /** May wait, for example on a Jev request (§5.6); the runner awaits every decision. */
  decide(
    observation: Observation,
    legalActions: LegalActions,
    rng: PolicyRng,
    facts?: PolicyFacts,
  ): PolicyChoice | Promise<PolicyChoice>;
  /** Counts the runner adds up over every seat and game, such as Jev fallbacks by cause. */
  counts?(): Readonly<Record<string, number>>;
}

/** One game of a run; every seat's policy in that game gets the same object. */
export type PolicyGame = Readonly<{ seed: number }>;

/** Creates one seat's policy; a policy may share per-game state through `game`. */
export type PolicyFactory = (game: PolicyGame) => Policy;

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

/** A factory that reads nothing about the game, so the policy it builds cannot hold the seed. */
export type SeedlessPolicyFactory = () => Policy;

/**
 * The policies an experiment seat may play (§8 Critic): the baseline `random`, the four fallback
 * personalities and the seven exploits. No factory takes the game, so no policy is ever handed
 * the game seed; the only seeded input is its own `PolicyRng`. Each exploit takes the seeded
 * `random` choice wherever its rule is silent, so the rule is the one difference from `random`.
 */
export const EXPERIMENT_POLICIES: Readonly<Record<string, SeedlessPolicyFactory>> = {
  random: () => new RandomPolicy(),
  fallback: () => new FallbackPolicy(PERSONALITIES.greedy),
  'fallback-aggressive': () => new FallbackPolicy(PERSONALITIES.aggressive),
  'fallback-cautious': () => new FallbackPolicy(PERSONALITIES.cautious),
  'fallback-opportunist': () => new FallbackPolicy(PERSONALITIES.opportunist),
  'always-pvp': () => new AlwaysPvpPolicy(new RandomPolicy()),
  'force-weak-target': () => new ForceWeakTargetPolicy(new RandomPolicy()),
  'immediate-ability': () => new ImmediateAbilityPolicy(new RandomPolicy()),
  ...ECONOMY_POLICIES,
};

/** The seven §8 Critic exploit policies, in the order of the experiment plan. */
export const EXPLOIT_POLICY_IDS = [
  'always-pvp',
  'force-weak-target',
  'sell-all',
  'keep-to-evolve',
  'immediate-ability',
  'ultra-only',
  'never-negotiate',
] as const;

/**
 * `--policy <name>`; `fallback` plays every seat as Greedy and `fallback-<personality>` as that personality (spec §5.2, §5.5), the seven exploit
 * policies (`EXPLOIT_POLICY_IDS`) play every seat as that exploit (§8 Critic), and `jev` decides
 * every seat's turns through the Jev decision orchestrator (§5.6).
 */
export const POLICIES: Readonly<Record<string, PolicyFactory>> = {
  ...EXPERIMENT_POLICIES,
  jev: createJevPolicy,
  'jev-hard': createHardJevPolicy,
};
