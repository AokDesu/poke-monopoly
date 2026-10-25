import type { SeatFeedEntry } from '../game/store.ts';
import { content } from '../game/content.ts';
import { t, type MessageKey } from '../i18n/en.ts';
import { phaseLabel } from './labels.ts';

export interface TurnMessage {
  key: MessageKey;
  text: string;
}

/** Presentation only: accepted, seat-filtered records are the authority for every announcement. */
export function turnMessages({ before, record }: SeatFeedEntry): TurnMessage[] {
  const messages: TurnMessage[] = [];
  if (record.auto && record.action.actorId !== 'engine') {
    messages.push({
      key: 'turn.automatic',
      text: t('turn.automatic', {
        phase: phaseLabel(before.phase.kind),
      }),
    });
  }
  if (
    before.phase.kind === 'encounter' &&
    ['release', 'dice_result'].includes(record.action.kind)
  ) {
    const key =
      record.action.kind === 'release'
        ? 'encounter.released'
        : record.events.some((event) => event.kind === 'uid_created' && event.entity === 'pokemon')
          ? 'encounter.caught'
          : 'encounter.escaped';
    const { speciesId } = before.phase.pokemon;
    const pokemon = content.species.find((species) => species.id === speciesId)!.name;
    messages.push({ key, text: t(key, { pokemon }) });
  }
  return messages;
}
