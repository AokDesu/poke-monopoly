import { parseArgs } from 'node:util';
import { runSim } from './index.ts';

const { values } = parseArgs({
  options: {
    games: { type: 'string', default: '100' },
    seed: { type: 'string', default: '1' },
    'lap-target': { type: 'string' },
  },
});
const lapTarget = values['lap-target'];
const summary = runSim(
  Number(values.games),
  Number(values.seed),
  lapTarget === undefined ? undefined : Number(lapTarget),
);
console.log(JSON.stringify(summary));
// Hard gate (spec §1): any illegal applied action fails the run, and so CI.
if (summary.illegalAppliedActionCount > 0) process.exitCode = 1;
