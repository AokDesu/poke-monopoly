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

/**
 * Core classes in content order; stretch classes stay out until after G2 (spec §1). A class is
 * playable once the engine implements its passive, which content records by naming it in
 * `passive` (skills/content-authoring), so a newly implemented class appears without UI changes.
 */
export const classOptions: readonly ClassOption[] = content.classes
  .filter((entry) => !entry.stretch)
  .map((entry) => ({
    id: entry.id,
    starterSpeciesIds: entry.starterSpeciesIds,
    classItemId: entry.classItemId,
    playable: entry.passive !== undefined,
  }));
