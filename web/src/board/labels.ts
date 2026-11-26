import type { Observation, SpectatorObservation } from '../../../engine/index.ts';
import { personName } from '../game/people.ts';
import { en, t, type MessageKey } from '../i18n/en.ts';

/** What a screen reads: a seat's observation, or the watcher's public-only view. */
export type ViewedObservation = Observation | SpectatorObservation;

/** The reader's own seat; a watcher holds none. */
export const ownSeatOf = (observation: ViewedObservation): number | undefined =>
  'own' in observation ? observation.own.seatIndex : undefined;

/**
 * "You" for the reader's own seat, a person's name for another person at a shared table (spec §3),
 * and "AI rival · seat N" for an AI.
 */
export function seatLabel(seatIndex: number, ownSeatIndex: number | undefined): string {
  if (seatIndex === ownSeatIndex) return t('seat.you');
  return personName(seatIndex) ?? t('board.rivalLabel', { seat: seatIndex });
}

function catalogLabel(
  prefix: 'board.phase' | 'board.tag' | 'board.event.reason',
  value: string,
): string {
  const key = `${prefix}.${value}`;
  return t(Object.hasOwn(en, key) ? (key as MessageKey) : `${prefix}.other`);
}

export const phaseLabel = (phase: string) => catalogLabel('board.phase', phase);
export const tagLabel = (tag: string) => catalogLabel('board.tag', tag);
export const reasonLabel = (reason: string) => catalogLabel('board.event.reason', reason);
export const playerLabel = (observation: ViewedObservation, actorId: string) => {
  const player = observation.public.players.find((entry) => entry.actorId === actorId);
  return player ? seatLabel(player.seatIndex, ownSeatOf(observation)) : t('board.event.player');
};

/** "your" or "AI rival · seat 1’s": whose own turn a promise runs to. */
export const possessive = (seatIndex: number, ownSeatIndex: number | undefined): string =>
  seatIndex === ownSeatIndex
    ? t('promise.possessive.you')
    : t('promise.possessive.rival', { rival: seatLabel(seatIndex, ownSeatIndex) });
