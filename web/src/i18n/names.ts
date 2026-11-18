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

/** Why a class is not open: its own reason when the catalog has one, else the general one. */
export function classClosedReason(id: string): string {
  const key = `class.closed.${id}`;
  return Object.hasOwn(en, key) ? t(key as MessageKey) : t('class.comingLater');
}

/** An AI personality's label from the catalog; an id the catalog no longer has stays as it is. */
export function personalityName(id: string): string {
  const key = `personality.${id}`;
  return Object.hasOwn(en, key) ? t(key as MessageKey) : id;
}

/** An AI difficulty's label from the catalog; an id the catalog no longer has stays as it is. */
export function difficultyName(id: string): string {
  const key = `difficulty.${id}`;
  return Object.hasOwn(en, key) ? t(key as MessageKey) : id;
}
