import {
  effectiveForm,
  itemEffectStatus,
  nextEvolutionForms,
  type ItemEffectStatus,
} from '../../../engine/index.ts';
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

/** How much of an item's effect the engine applies; undefined for an unknown item id. */
export function itemStatus(itemId: string): ItemEffectStatus | undefined {
  const item = engineContent.items.find((entry) => entry.id === itemId);
  return item && itemEffectStatus(item);
}

/** Content item id of the Ball for one pouch slot. */
export function ballItemId(ballType: 'poke' | 'great' | 'ultra'): string {
  return content.items.find((item) => item.kind === 'ball' && item.ballType === ballType)!.id;
}

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

/**
 * Pokémon types the content tags use (every tag in `content/species.json` except the `cute`
 * modifier); a form with no type tag shows as normal.
 */
export const POKEMON_TYPES = [
  'grass',
  'fire',
  'water',
  'electric',
  'bug',
  'flying',
  'fighting',
  'dragon',
  'normal',
] as const;
export type PokemonType = (typeof POKEMON_TYPES)[number];

const isPokemonType = (tag: string): tag is PokemonType =>
  (POKEMON_TYPES as readonly string[]).includes(tag);

/** Current form's type: its first type tag from the engine-resolved tags, else normal. */
export function speciesType(speciesId: string): PokemonType {
  return currentForm(speciesId).tags.find(isPokemonType) ?? 'normal';
}
