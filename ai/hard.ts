import type { Personality } from '../content/personality-schema.ts';
import { toEngineContent } from '../content/schema.ts';
import {
  rolloutOptions,
  type LegalActions,
  type Observation,
  type RolloutPolicy,
} from '../engine/index.ts';
import { FallbackPolicy, PERSONALITIES } from './fallback/index.ts';
import { CONTENT } from './questions/content.ts';
import type { OptionOutcomes } from './questions/index.ts';

const content = toEngineContent(CONTENT);

/**
 * How long a Hard decision may spend on rollouts on the server before it uses the sampled worlds it
 * has (spec §5.6: 1,500 ms per decision, Jev's request included). Rollouts that finish sooner use
 * every sample; only this deadline, never the game, decides how many were drawn.
 */
export const HARD_ROLLOUT_MS = 400;

/**
 * The seats of a rollout play the fallback policy (spec §5.2, §5.5): the deciding seat as its own
 * personality, every other seat as Greedy, since an opponent's personality is not observable.
 */
export function rolloutPolicy(ownSeat: number, personality: Personality): RolloutPolicy {
  const own = new FallbackPolicy(personality);
  const others = new FallbackPolicy(PERSONALITIES.greedy);
  return (seatIndex, observation, legalActions, rng, facts) =>
    (seatIndex === ownSeat ? own : others).decide(
      observation,
      { enabled: legalActions.enabled, disabled: [] },
      rng,
      facts,
    );
}

export type HardRequest = {
  observation: Observation;
  legalActions: LegalActions;
  /** The enabled option IDs the question offers; every enabled option when absent. */
  options?: readonly string[];
  personality: Personality;
  /** From the request's seeded choice source; never the game's seed. */
  seed: number;
  /** Stops sampling this many ms from now; every sample is drawn when absent (the offline sim). */
  deadlineMs?: number;
};

/**
 * Spec §5.6 Hard: the engine's expected-outcome buckets for each option, from Monte Carlo rollouts
 * over worlds sampled from this seat's observation alone. `undefined` when the engine cannot roll
 * out (see `rolloutOptions`), and the decision then plays as Normal.
 */
export function hardOutcomes(request: HardRequest): OptionOutcomes | undefined {
  const { observation, legalActions, options, personality, seed, deadlineMs } = request;
  const stopAt = deadlineMs === undefined ? undefined : performance.now() + deadlineMs;
  return rolloutOptions({
    observation,
    legalActions,
    ...(options && { options }),
    content,
    policy: rolloutPolicy(observation.own.seatIndex, personality),
    seed,
    ...(stopAt !== undefined && { shouldStop: () => performance.now() >= stopAt }),
  })?.outcomes;
}
