import type { SeatFeedEntry } from '../game/store.ts';
import { content } from '../game/content.ts';
import { t, type MessageKey } from '../i18n/en.ts';
import { phaseLabel, seatLabel } from './labels.ts';

export interface TurnMessage {
  key: MessageKey;
  text: string;
}

/**
 * Presentation only: accepted, seat-filtered records are the authority for every announcement.
 * `viewerSeat` is the human seat reading the feed, or `undefined` for a watcher, who sees every
 * seat as an AI rival.
 */
export function turnMessages(
  { before, record }: SeatFeedEntry,
  viewerSeat: number | undefined,
): TurnMessage[] {
  const messages: TurnMessage[] = [];
  const action = record.action;
  const phase = before.phase;
  if (before.activeSeatIndex !== viewerSeat && action.actorId !== 'engine') {
    const name = seatLabel(before.activeSeatIndex, viewerSeat);
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
  // An engine-authored movement die (issue #123): the record only knows the roll, so
  // the strip announces it while the board spotlight already points at the destination
  // square. Never claims a distance: the engine may slow steps.
  if (
    action.kind === 'dice_result' &&
    before.activeSeatIndex !== viewerSeat &&
    before.phase.kind === 'move'
  ) {
    let roll: number | undefined;
    for (const event of record.events) {
      if (event.kind === 'random_result' && typeof event.result === 'number') {
        roll = event.result;
        break;
      }
    }
    if (roll !== undefined) {
      messages.push({
        key: 'ai.action.move',
        text: t('ai.action.move', {
          name: seatLabel(before.activeSeatIndex, viewerSeat),
          result: roll,
        }),
      });
    }
  }
  // Gym entry: leaving without a challenge costs nothing (§4.4). With no battle-ready Pokémon the
  // engine applies the skip itself (§3.1, Appendix C.3 D5 step 1).
  const gymSkip = phase.kind === 'gym' && phase.battle.step === 'entry' && action.kind === 'skip';
  if (gymSkip) {
    const name = seatLabel(before.activeSeatIndex, viewerSeat);
    const key = record.auto ? 'battle.gymAutoSkipped' : 'battle.gymSkipped';
    messages.push({ key, text: t(key, { name }) });
  }
  if (record.auto && record.action.actorId !== 'engine' && !gymSkip) {
    messages.push({
      key: 'turn.automatic',
      text: t('turn.automatic', {
        phase: phaseLabel(before.phase.kind),
      }),
    });
  }
  // An encounter is announced once its outcome is final: the record that leaves the Encounter. A
  // catch die held open for Porygon's reroll (Appendix C.6) leaves it later, by a reroll or a keep.
  if (
    before.phase.kind === 'encounter' &&
    ['release', 'dice_result', 'skip'].includes(record.action.kind) &&
    record.events.some((event) => event.kind === 'phase_changed' && event.from === 'encounter')
  ) {
    const outcome =
      record.action.kind === 'release'
        ? 'released'
        : record.events.some((event) => event.kind === 'uid_created' && event.entity === 'pokemon')
          ? 'caught'
          : 'escaped';
    const key =
      before.activeSeatIndex === viewerSeat
        ? (`encounter.${outcome}` as const)
        : (`ai.result.${outcome}` as const);
    const { speciesId } = before.phase.pokemon;
    const pokemon = content.species.find((species) => species.id === speciesId)!.name;
    messages.push({
      key,
      text: t(key, { pokemon, name: seatLabel(before.activeSeatIndex, viewerSeat) }),
    });
  }
  return messages;
}
