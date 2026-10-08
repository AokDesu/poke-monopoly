import { parseArgs } from 'node:util';
import { runSim } from './index.ts';

const { values } = parseArgs({
  options: { games: { type: 'string', default: '100' }, seed: { type: 'string', default: '1' } },
});
const summary = runSim(Number(values.games), Number(values.seed));
console.log(JSON.stringify(summary));
// Hard gate (spec §1): any illegal applied action fails the run, and so CI.
if (summary.illegalAppliedActionCount > 0) process.exitCode = 1;
