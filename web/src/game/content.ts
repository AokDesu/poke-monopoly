import {
  ABILITY_EFFECTS,
  abilityCosts,
  effectiveForm,
  itemEffectStatus,
  nextEvolutionForms,
  positionOf,
  type AbilityEffectId,
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

/**
 * What the engine says activating an Ability effect costs and risks beyond its prose: whether it
 * is hostile (§4.5) and whether it also spends the tactical action (Appendix C, D10).
 */
export function abilityFacts(effect: AbilityEffectId) {
  return { hostile: ABILITY_EFFECTS[effect].hostile, ...abilityCosts(effect) };
}

/** The visible square of a signed route progress (§6.5). */
export const squareOf = positionOf;

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
 * Core classes in content order; stretch classes stay out until after G2 (spec §1). A class is
 * open when its whole kit works in the browser. Rival's once-per-Lap forced PvP is a Strategy
 * choice the board has no control for until the PvP screens land (issue #135), so offering the
 * class would misrepresent its passive. Remove it from this list with that change.
 */
const NEEDS_PVP_CONTROLS: readonly string[] = ['rival'];

export const classOptions: readonly ClassOption[] = content.classes
  .filter((entry) => !entry.stretch)
  .map((entry) => ({
    id: entry.id,
    starterSpeciesIds: entry.starterSpeciesIds,
    classItemId: entry.classItemId,
    playable: entry.passive !== undefined && !NEEDS_PVP_CONTROLS.includes(entry.id),
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
