import { ENGINE_VERSION, GAME_PRESETS } from '../engine/index.ts';

export function runSim(
  games: number,
  seed: number,
  lapTarget: number = GAME_PRESETS.quick.lapTarget,
) {
  // The sim may run closed presets such as Standard; only the setup screen honours `enabled`.
  if (!Number.isSafeInteger(lapTarget) || lapTarget < 1) {
    throw new RangeError('Lap target must be a positive whole number');
  }
  // Stub until the real runner lands: no games are played, so nothing illegal is applied.
  return {
    stub: 'replaced by issue #13 (policy interface, random bot and the sim runner)',
    engineVersion: ENGINE_VERSION,
    games,
    seed,
    lapTarget,
    illegalAppliedActionCount: 0,
  };
}
