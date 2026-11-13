import { effectiveForm, nextEvolutionForms } from '../../../engine/index.ts';
import board from '../../../content/board.json';
import classes from '../../../content/classes.json';
import config from '../../../content/config.json';
import events from '../../../content/events.json';
import evolutions from '../../../content/evolutions.json';
import items from '../../../content/items.json';
import { parseContent, toEngineContent } from '../../../content/schema.ts';
import species from '../../../content/species.json';
import type { ClassOption } from './setup.ts';

/** The browser's copy of `content/*.json`, validated once at load (see `sim/content.ts` for Node). */
export const content = parseContent({ board, classes, config, events, evolutions, items, species });

/** The strict `Content` the engine's `createGame` takes. */
export const engineContent = toEngineContent(content);

/** Engine-owned current stats, inherited Abilities and authored evolution choices (§4.5). */
export const currentForm = (formId: string) => effectiveForm(engineContent, formId);
export const nextForms = (formId: string) =>
  nextEvolutionForms(engineContent, formId).map(currentForm);

/**
 * Core classes in content order; stretch classes stay out until after G2 (spec §1).
 * Keep the browser roster at Main Character/Researcher during engine-only issue #55 S01.
 * A later UI slice must remove this guard when the new classes have browser support.
 */
export const classOptions: readonly ClassOption[] = content.classes
  .filter((entry) => !entry.stretch)
  .map((entry) => ({
    id: entry.id,
    starterSpeciesIds: entry.starterSpeciesIds,
    classItemId: entry.classItemId,
    playable:
      entry.passive !== undefined && (entry.id === 'main-character' || entry.id === 'researcher'),
  }));

/** Pokémon types the content tags use; any other species shows as normal. */
const TYPES = ['grass', 'fire', 'water', 'bug', 'normal'] as const;
export type PokemonType = (typeof TYPES)[number];

/** Current form's type from engine-resolved tags; untyped forms show as normal. */
export function speciesType(speciesId: string): PokemonType {
  const tags = currentForm(speciesId).tags;
  return TYPES.find((type) => tags.includes(type)) ?? 'normal';
}
