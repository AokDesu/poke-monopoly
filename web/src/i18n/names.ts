import { t, th, type MessageKey } from './th.ts';

/**
 * Thai names for content IDs (classes, species, items). Content stays English (`content/`), so
 * the catalog holds one key per ID; `names.test.ts` checks every ID setup can show has one.
 */
function lookup(prefix: string, id: string): string | undefined {
  const key = `${prefix}.${id}`;
  return Object.hasOwn(th, key) ? t(key as MessageKey) : undefined;
}

export const className = (id: string) => lookup('class.name', id);
export const classPassive = (id: string) => lookup('class.passive', id);
export const speciesName = (id: string) => lookup('species', id);
export const itemName = (id: string) => lookup('item', id);
