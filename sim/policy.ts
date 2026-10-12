import { createRng, int, type LegalActions, type Observation } from '../engine/index.ts';

/** Seeded choice source for a policy; separate from the engine's private game RNG. */
export type PolicyRng = { int(n: number): number };

/** Spec §8: a policy only chooses; the engine stays the sole rules authority (§9). */
export interface Policy {
  decide(observation: Observation, legalActions: LegalActions, rng: PolicyRng): string;
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

/** `--policy <name>`; later issues register `fallback` and `jev`. */
export const POLICIES: Readonly<Record<string, () => Policy>> = {
  random: () => new RandomPolicy(),
};
