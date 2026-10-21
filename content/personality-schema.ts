import { z } from 'zod';

// Spec §5.5: one file per personality, decided once; every build and game follows it.
const weight = z.number().min(0).max(1);

export const personalitySchema = z.strictObject({
  name: z.string().min(1),
  /** English, inserted into Jev instructions (spec §5.5, Appendix B). */
  description: z.string().min(1),
  /** Each 0 to 1: the fallback policy, sell threshold and shortlist filter read them. */
  weights: z.strictObject({ risk: weight, aggression: weight, liquidity: weight, loyalty: weight }),
  /** Line-bank style id for choosing lines (spec §5.7). */
  lineStyle: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'lineStyle must be a kebab-case id'),
});

export type PersonalityFile = z.infer<typeof personalitySchema>;
export type Personality = PersonalityFile & { id: string; sellThreshold: number };

/**
 * The Sell Phase cut-off (spec §5.3: sell when `noul ≥ threshold(personality)`), derived from
 * `liquidity` alone so a more liquid personality always sells at least as eagerly. Liquidity 1
 * gives 0.5; liquidity 0 gives 1.1, which nothing reaches, so that personality never sells.
 */
export function sellThreshold(weights: PersonalityFile['weights']): number {
  return Math.round((1.1 - 0.6 * weights.liquidity) * 100) / 100;
}

/** Pure: validates `content/personalities/<id>.json` and throws one readable `Error` on failure. */
export function parsePersonality(id: string, json: unknown): Personality {
  const result = personalitySchema.safeParse(json);
  if (!result.success) {
    throw new Error(`Invalid personality "${id}":\n${z.prettifyError(result.error)}`);
  }
  return { ...result.data, id, sellThreshold: sellThreshold(result.data.weights) };
}
