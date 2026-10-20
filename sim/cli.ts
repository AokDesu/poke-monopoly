import { parseSimArgs } from './args.ts';
import { realEngine } from './engine.ts';
import { failed, runSim, type SimOptions } from './runner.ts';

let options: SimOptions;
try {
  options = parseSimArgs(process.argv.slice(2));
} catch (error) {
  console.error(`sim: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
}

const { summary, failures } = runSim(realEngine, options);
for (const failure of failures) {
  console.error(
    `sim: game seed ${failure.seed} failed (${failure.reasons.join('; ')}); reproduce: ${failure.reproduce}`,
  );
}
console.log(JSON.stringify(summary));
// Hard gate (spec §1, §8): an applied illegal action, an invariant failure or an aborted game
// fails the run, and so CI.
if (failed(summary)) process.exitCode = 1;
