import { content, currentForm } from '../game/content.ts';
import { en, t, type MessageKey } from './en.ts';

/** Names come from the content tables, which are in English (spec §3). */
export const className = (id: string) =>
  content.classes.find((entry) => entry.id === id)?.name ?? id;
export const speciesName = (id: string) => currentForm(id).name;
/**
 * A team member by Pokémon name, never by its internal id. Two of one species stay apart by their
 * place among that species in team order ("Caterpie #2"); a member the team no longer lists is
 * still named in plain words.
 */
export function memberName(
  team: readonly { instanceId: string; speciesId: string }[],
  instanceId: string,
): string {
  const member = team.find((entry) => entry.instanceId === instanceId);
  if (!member) return t('team.memberUnknown');
  const same = team.filter((entry) => entry.speciesId === member.speciesId);
  const pokemon = speciesName(member.speciesId);
  return same.length > 1
    ? t('team.memberNumbered', { pokemon, number: same.indexOf(member) + 1 })
    : pokemon;
}
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
