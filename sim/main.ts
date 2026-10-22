import { parseSimArgs } from './args.ts';
import { POLICIES } from './policy.ts';
import { formatSummary } from './report.ts';
import { failed, runSim, type InvariantCheck, type SimEngine, type SimOptions } from './runner.ts';

export type CliIo = { log(line: string): void; error(line: string): void };

/** The `npm run sim` body: parses `args`, runs the games and returns the exit code. */
export function runCli(
  args: string[],
  engine: SimEngine,
  checkInvariants: InvariantCheck,
  io: CliIo = console,
): number {
  let options: SimOptions;
  try {
    options = parseSimArgs(args);
  } catch (error) {
    io.error(`sim: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }

  const { summary, failures } = runSim(engine, options, POLICIES, checkInvariants);
  for (const failure of failures) {
    io.error(
      `sim: game seed ${failure.seed} failed (${failure.reasons.join('; ')}); reproduce: ${failure.reproduce}`,
    );
  }
  io.log(JSON.stringify(summary));
  for (const line of formatSummary(summary)) io.log(line);
  // Hard gate (spec §1, §8): an applied illegal action, an invariant failure or an aborted game
  // fails the run, and so CI.
  return failed(summary) ? 1 : 0;
}
