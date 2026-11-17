import { z } from 'zod';

const kebab = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'key must be a kebab-case id');
const snake = z.string().regex(/^[a-z]+(_[a-z]+)*$/, 'key must be a snake_case situation');
// Plain English only: letters and basic punctuation. No digit can be written, so nothing here
// states a number (spec §5.4); the speech output screen holds Haiku to the same rule.
const plain = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .regex(/^[A-Za-z][A-Za-z ,.'!?;:-]*$/, 'text must be plain English letters and punctuation');
const byKey = (key: z.ZodString, max: number) => z.record(key, plain(max));

/**
 * The words Haiku writes from (spec §5.7): one fixed world card, a hint per class and a topic per
 * line-bank situation. Team-written; no digits, no real-world or official character names.
 */
export const voiceSchema = z.strictObject({
  world: plain(600),
  /** Keyed by a `content/classes.json` id. */
  classHints: byKey(kebab, 160),
  /** Keyed by a line-bank situation (`ai/lines.ts`), except `fallback_notice`. */
  topics: byKey(snake, 160),
});

export type Voice = z.infer<typeof voiceSchema>;

/** Pure: validates `content/voice/en.json` and throws one readable `Error` on failure. */
export function parseVoice(json: unknown): Voice {
  const result = voiceSchema.safeParse(json);
  if (!result.success) throw new Error(`Invalid voice file:\n${z.prettifyError(result.error)}`);
  return result.data;
}
