import type { SeatFeedEntry } from '../game/store.ts';
import { content } from '../game/content.ts';
import { t, type MessageKey } from '../i18n/en.ts';
import { phaseLabel, seatLabel } from './labels.ts';

export interface TurnMessage {
  key: MessageKey;
  text: string;
}

/** Presentation only: accepted, seat-filtered records are the authority for every announcement. */
export function turnMessages({ before, record }: SeatFeedEntry): TurnMessage[] {
  const messages: TurnMessage[] = [];
  const action = record.action;
  const phase = before.phase;
  if (before.activeSeatIndex !== 0 && action.actorId !== 'engine') {
    const name = seatLabel(before.activeSeatIndex, 0);
    const pokemon =
      phase.kind === 'encounter'
        ? (content.species.find((species) => species.id === phase.pokemon.speciesId)?.name ?? '')
        : '';
    const key =
      action.kind === 'sell' && action.payload.pokemonInstanceIds?.length === 0
        ? 'ai.action.keep'
        : `ai.action.${action.kind}`;
    const choices: readonly string[] = [
      'roll',
      'skip',
      'catch',
      'release',
      'buy',
      'skip_shop',
      'use_item',
      'sell',
    ];
    if (choices.includes(action.kind))
      messages.push({
        key: key as MessageKey,
        text: t(key as MessageKey, {
          name,
          pokemon,
          phase: phaseLabel(before.phase.kind),
          ...(action.kind === 'catch' &&
            action.payload.ballType && { ball: t(`board.ball.${action.payload.ballType}`) }),
        }),
      });
  }
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
    const outcome =
      record.action.kind === 'release'
        ? 'released'
        : record.events.some((event) => event.kind === 'uid_created' && event.entity === 'pokemon')
          ? 'caught'
          : 'escaped';
    const key =
      before.activeSeatIndex === 0
        ? (`encounter.${outcome}` as const)
        : (`ai.result.${outcome}` as const);
    const { speciesId } = before.phase.pokemon;
    const pokemon = content.species.find((species) => species.id === speciesId)!.name;
    messages.push({ key, text: t(key, { pokemon, name: seatLabel(before.activeSeatIndex, 0) }) });
  }
  return messages;
}
