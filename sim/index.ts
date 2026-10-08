import { ENGINE_VERSION } from '../engine/index.ts';

export function runSim(games: number, seed: number) {
  // Stub until the real runner lands: no games are played, so nothing illegal is applied.
  return {
    stub: 'replaced by issue #13 (policy interface, random bot and the sim runner)',
    engineVersion: ENGINE_VERSION,
    games,
    seed,
    illegalAppliedActionCount: 0,
  };
}
