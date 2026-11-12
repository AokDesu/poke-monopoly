import { content, currentForm } from '../game/content.ts';
import { en, t, type MessageKey } from './en.ts';

/** Names come from the content tables, which are in English (spec §3). */
export const className = (id: string) =>
  content.classes.find((entry) => entry.id === id)?.name ?? id;
export const speciesName = (id: string) => currentForm(id).name;
export const itemName = (id: string) => content.items.find((entry) => entry.id === id)?.name ?? id;

/**
 * A playable class's passive, without its numbers (they live in the engine). Content's
 * `passiveText` keeps the Appendix A amounts, so the catalog words it instead.
 */
export function classPassive(id: string): string | undefined {
  const key = `class.passive.${id}`;
  return Object.hasOwn(en, key) ? t(key as MessageKey) : undefined;
}
