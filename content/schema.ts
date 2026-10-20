import { z } from 'zod';
import { contentSchema, type Content } from '../engine/contract/schema.ts';
import { CONTENT_VERSION } from './index.ts';

// Rows extend the engine's own row schemas (engine/contract/schema.ts), so the engine fields and
// their constraints stay identical to `Content`; this file adds only what the engine does not read.
const id = z.string().min(1);
const count = z.int().nonnegative();
const rarities = ['common', 'uncommon', 'rare'] as const;

function uniqueIds(label: string) {
  return (rows: { id: string }[], ctx: z.RefinementCtx) => {
    const seen = new Set<string>();
    rows.forEach((row, index) => {
      if (seen.has(row.id)) {
        ctx.addIssue({
          code: 'custom',
          path: [index, 'id'],
          message: `duplicate ${label} id "${row.id}"`,
        });
      }
      seen.add(row.id);
    });
  };
}

// Spec §4.1 and Appendix A: Start 1, Wild 11, Event 5, Shop 4, Gym 3 (spaces 6/12/18), Start at 0.
const BOARD_KINDS = { start: 1, wild: 11, event: 5, shop: 4, gym: 3 };
const FIXED_SQUARES = { 0: 'start', 6: 'gym', 12: 'gym', 18: 'gym' } as const;

const boardSchema = contentSchema.shape.board.superRefine((squares, ctx) => {
  squares.forEach((square, index) => {
    if (square.position !== index) {
      ctx.addIssue({
        code: 'custom',
        path: [index, 'position'],
        message: `square ${index} has position ${square.position}; list squares in order from 0`,
      });
    }
  });
  for (const [kind, expected] of Object.entries(BOARD_KINDS)) {
    const found = squares.filter((square) => square.kind === kind).length;
    if (found !== expected) {
      ctx.addIssue({
        code: 'custom',
        message: `board needs ${expected} ${kind} squares, found ${found}`,
      });
    }
  }
  for (const [position, kind] of Object.entries(FIXED_SQUARES)) {
    if (squares[Number(position)]?.kind !== kind) {
      ctx.addIssue({
        code: 'custom',
        path: [Number(position), 'kind'],
        message: `square ${position} must be ${kind}`,
      });
    }
  }
});

// Appendix A timing legend: S, C, B, A, R.
const abilityTiming = z.enum([
  'OWN_STRATEGY',
  'CHALLENGE_DECLARE',
  'BEFORE_OWN_ROLL',
  'AFTER_OWN_ROLL',
  'REACTION',
]);
const speciesSchema = z
  .array(
    contentSchema.shape.species.element.extend({
      // Spec §4.5: the encounter pool is every species except the 3 starters and Porygon.
      inEncounterPool: z.boolean(),
      ability: z.strictObject({ name: id, text: id, timing: abilityTiming }),
    }),
  )
  .superRefine(uniqueIds('species'));

const classesSchema = z
  .array(
    contentSchema.shape.classes.element.extend({
      passiveText: id,
      stretch: z.boolean().default(false),
    }),
  )
  .superRefine(uniqueIds('class'));

const [ballRow, utilityRow] = contentSchema.shape.items.element.options;
const itemsSchema = z
  .array(
    z.discriminatedUnion('kind', [
      ballRow.extend({ bonus: count }),
      utilityRow.extend({ effect: id }),
    ]),
  )
  .superRefine(uniqueIds('item'))
  .superRefine((items, ctx) => {
    const seen = new Set<string>();
    items.forEach((item, index) => {
      if (item.kind !== 'ball') return;
      if (seen.has(item.ballType)) {
        ctx.addIssue({
          code: 'custom',
          path: [index, 'ballType'],
          message: `ball type "${item.ballType}" is listed twice`,
        });
      }
      seen.add(item.ballType);
    });
  });

// A line starts at a base species. A stage with several forms is the player's choice (Eevee).
const stageSchema = z
  .strictObject({ forms: z.array(id).min(1), choice: z.literal('player').optional() })
  .refine((stage) => stage.forms.length > 1 === (stage.choice === 'player'), {
    message: `a stage with several forms needs choice: "player", and a single form must not have it`,
  });
const evolutionsSchema = z.strictObject({
  // Evolved forms that have no species definition (spec §4.5 fallback rule).
  forms: z.array(z.strictObject({ id, name: id })).superRefine(uniqueIds('form')),
  lines: z.array(z.strictObject({ speciesId: id, stages: z.array(stageSchema).min(1) })),
});

const eventsSchema = z.array(z.strictObject({ id, text: id })).superRefine(uniqueIds('event'));

const configSchema = z.strictObject({
  startingKit: z.strictObject({
    coins: count,
    starters: count,
    pokeBalls: count,
    classItems: count,
  }),
  startIncome: count,
  lapTargets: z.strictObject({ quick: z.int().positive(), standard: z.int().positive() }),
  rarityWeights: z.strictObject({ common: count, uncommon: count, rare: count }),
});

const contentFilesSchema = z
  .strictObject({
    board: boardSchema,
    classes: classesSchema,
    species: speciesSchema,
    evolutions: evolutionsSchema,
    items: itemsSchema,
    events: eventsSchema,
    config: configSchema,
  })
  .superRefine((content, ctx) => {
    const problem = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: 'custom', path, message });
    const speciesIds = new Set(content.species.map((species) => species.id));
    const itemIds = new Set(content.items.map((item) => item.id));
    const formIds = new Set(content.evolutions.forms.map((form) => form.id));

    content.classes.forEach((entry, index) => {
      entry.starterSpeciesIds.forEach((speciesId, at) => {
        if (!speciesIds.has(speciesId)) {
          problem(['classes', index, 'starterSpeciesIds', at], `unknown species "${speciesId}"`);
        }
      });
      if (!itemIds.has(entry.classItemId)) {
        problem(['classes', index, 'classItemId'], `unknown item "${entry.classItemId}"`);
      }
    });

    content.evolutions.forms.forEach((form, index) => {
      if (speciesIds.has(form.id)) {
        problem(
          ['evolutions', 'forms', index, 'id'],
          `"${form.id}" is already a species; remove it from forms`,
        );
      }
    });
    const bases = new Set<string>();
    content.evolutions.lines.forEach((line, index) => {
      if (!speciesIds.has(line.speciesId)) {
        problem(['evolutions', 'lines', index, 'speciesId'], `unknown species "${line.speciesId}"`);
      }
      if (bases.has(line.speciesId)) {
        problem(['evolutions', 'lines', index, 'speciesId'], `second line for "${line.speciesId}"`);
      }
      bases.add(line.speciesId);
      line.stages.forEach((stage, at) =>
        stage.forms.forEach((form, slot) => {
          if (!speciesIds.has(form) && !formIds.has(form)) {
            problem(
              ['evolutions', 'lines', index, 'stages', at, 'forms', slot],
              `unknown species "${form}": use a species id or declare it in evolutions.forms`,
            );
          }
        }),
      );
    });

    // Spec §4.5: weights apply per rarity, uniform inside it, so every weighted rarity needs a species.
    for (const rarity of rarities) {
      const pooled = content.species.some((s) => s.inEncounterPool && s.rarity === rarity);
      if (content.config.rarityWeights[rarity] > 0 && !pooled) {
        problem(
          ['config', 'rarityWeights', rarity],
          `no ${rarity} species is in the encounter pool`,
        );
      }
    }
  });

export type ParsedContent = z.output<typeof contentFilesSchema> & { contentVersion: string };

/** The seven JSON files as authored: what `parseContent` accepts. */
export type ContentFiles = z.input<typeof contentFilesSchema>;

/**
 * Validates the seven `content/*.json` files (keyed by file name without `.json`). Pure: no IO.
 * Throws one Error listing every problem with its path, e.g. `→ at species[3].dc`.
 */
export function parseContent(json: unknown): ParsedContent {
  const result = contentFilesSchema.safeParse(json);
  if (!result.success) {
    throw new Error(`Invalid game content:\n${z.prettifyError(result.error)}`);
  }
  return { ...result.data, contentVersion: CONTENT_VERSION };
}

const engineFields = (schema: { shape: object }, row: object) =>
  Object.fromEntries(Object.entries(row).filter(([key]) => key in schema.shape));

/** The exact `Content` the engine's strict `contentSchema` accepts: extra authoring fields dropped. */
export function toEngineContent(content: ParsedContent): Content {
  return contentSchema.parse({
    board: content.board,
    species: content.species.map((row) => engineFields(contentSchema.shape.species.element, row)),
    classes: content.classes.map((row) => engineFields(contentSchema.shape.classes.element, row)),
    items: content.items.map((row) =>
      engineFields(row.kind === 'ball' ? ballRow : utilityRow, row),
    ),
  });
}
