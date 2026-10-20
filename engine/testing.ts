import type { GameState } from './contract/schema.ts';

/** Test-only displacement: not a command, log record or production push/pull effect. */
export function forceMove(state: GameState, seat: number, delta: number): GameState {
  const next = structuredClone(state);
  const player = next.players.find((entry) => entry.seatIndex === seat);
  if (!player) throw new RangeError('Unknown seat index');
  if (!Number.isSafeInteger(delta) || !Number.isSafeInteger(player.routeProgress + delta)) {
    throw new RangeError('Displacement must produce safe whole-square progress');
  }
  player.routeProgress += delta;
  return next;
}
