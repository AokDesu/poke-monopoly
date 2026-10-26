import { z } from 'zod';

/**
 * Slots a line may name; the engine fills each with a real name or number (spec §5.7). Lines never
 * hold a number of their own.
 */
export const SLOTS = ['target', 'turn', 'pokemon', 'coins'] as const;
export type Slot = (typeof SLOTS)[number];

const SLOT = /\{(\w+)\}/g;
const isSlot = (name: string): name is Slot => (SLOTS as readonly string[]).includes(name);
const kebab = (what: string) =>
  z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, `${what} must be a kebab-case id`);

const lineSchema = z.strictObject({
  id: kebab('id'),
  /** A `content/personalities/<id>.json` id. */
  personality: kebab('personality'),
  /** Trust bucket; v0 ships `neutral` only. */
  trust: kebab('trust'),
  /** English (spec §3); `{slot}`s are filled by `fillSlots`. */
  text: z
    .string()
    .min(1)
    .refine((text) => !/[{}]/.test(text.replace(SLOT, '')), {
      message: 'text has an unfilled or malformed brace',
    })
    .refine((text) => !/\p{Script=Thai}/u.test(text), {
      message: 'text must be English, without Thai script',
    })
    .refine((text) => !/\p{N}/u.test(text.replace(SLOT, '')), {
      message: 'text must use slots instead of number literals',
    })
    .refine((text) => [...text.matchAll(SLOT)].every(([, name]) => isSlot(name!)), {
      message: `text may only use the slots ${SLOTS.map((s) => `{${s}}`).join(', ')}`,
    }),
});

export const linesSchema = z
  .array(lineSchema)
  .min(1)
  .refine(
    (lines) => new Set(lines.map((l) => l.id)).size === lines.length,
    'line ids must be unique',
  );

export type Line = z.infer<typeof lineSchema>;

/** Pure: validates `content/lines/en/<situation>.json` and throws one readable `Error` on failure. */
export function parseLines(situation: string, json: unknown): Line[] {
  const result = linesSchema.safeParse(json);
  if (!result.success) {
    throw new Error(`Invalid lines "${situation}":\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}

/** Spec §5.7: replaces each `{slot}` in a line-bank template; throws on an unknown or unfilled slot. */
export function fillSlots(
  template: string,
  values: Partial<Record<Slot, string | number>>,
): string {
  const bare = template.replace(SLOT, '');
  if (/[{}]/.test(bare)) throw new Error(`Line has a malformed slot: ${template}`);
  return template.replace(SLOT, (_, name: string) => {
    if (!isSlot(name)) throw new Error(`Line has an unknown slot "${name}": ${template}`);
    const value = values[name];
    if (value === undefined) throw new Error(`No value for slot "${name}": ${template}`);
    return String(value);
  });
}
