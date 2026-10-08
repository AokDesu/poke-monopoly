import { parseArgs } from 'node:util';
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

if (import.meta.main) {
  const { values } = parseArgs({
    options: { games: { type: 'string', default: '100' }, seed: { type: 'string', default: '1' } },
  });
  const summary = runSim(Number(values.games), Number(values.seed));
  console.log(JSON.stringify(summary));
  // Hard gate (spec §1): any illegal applied action fails the run, and so CI.
  if (summary.illegalAppliedActionCount > 0) process.exitCode = 1;
}
