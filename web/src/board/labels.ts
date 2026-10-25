import type { Observation } from '../../../engine/index.ts';
import { en, t, type MessageKey } from '../i18n/en.ts';

export function seatLabel(seatIndex: number, ownSeatIndex: number): string {
  return seatIndex === ownSeatIndex ? t('seat.you') : t('board.rivalLabel', { seat: seatIndex });
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
export const playerLabel = (observation: Observation, actorId: string) => {
  const player = observation.public.players.find((entry) => entry.actorId === actorId);
  return player ? seatLabel(player.seatIndex, observation.own.seatIndex) : t('board.event.player');
};
