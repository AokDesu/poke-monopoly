import board from '../../content/board.json' with { type: 'json' };
import classes from '../../content/classes.json' with { type: 'json' };
import config from '../../content/config.json' with { type: 'json' };
import events from '../../content/events.json' with { type: 'json' };
import evolutions from '../../content/evolutions.json' with { type: 'json' };
import items from '../../content/items.json' with { type: 'json' };
import species from '../../content/species.json' with { type: 'json' };
import { parseContent } from '../../content/schema.ts';

/** English names and effect texts for question wording; content holds the text, not ai/ (spec §5.2). */
export const CONTENT = parseContent({
  board,
  classes,
  config,
  events,
  evolutions,
  items,
  species,
});

export function itemText(itemId: string, fallbackName: string) {
  const item = CONTENT.items.find((entry) => entry.id === itemId);
  return {
    name: item?.name ?? fallbackName,
    effect: item?.kind === 'utility' ? item.effect : undefined,
  };
}

export function speciesText(speciesId: string) {
  const entry = CONTENT.species.find((candidate) => candidate.id === speciesId);
  if (!entry) throw new RangeError(`Unknown species "${speciesId}"`);
  return { name: entry.name, rarity: entry.rarity };
}
