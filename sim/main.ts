import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname } from 'node:path';
import { createGameLog, deserialize, serialize, verifyReplay } from '../engine/index.ts';
import { parseReplayArgs, parseSimArgs } from './args.ts';
import { POLICIES } from './policy.ts';
import { formatSummary } from './report.ts';
import {
  failed,
  runSim,
  type InvariantCheck,
  type PlayedGame,
  type SimEngine,
  type SimOptions,
} from './runner.ts';

export type CliIo = { log(line: string): void; error(line: string): void };

/** The `npm run sim` body: parses `args`, runs the games and returns the exit code. */
export function runCli(
  args: string[],
  engine: SimEngine,
  checkInvariants: InvariantCheck,
  io: CliIo = console,
): number {
  if (args.some((arg) => arg === '--replay' || arg.startsWith('--replay='))) {
    return runReplay(args, io);
  }
  let options: SimOptions;
  try {
    options = parseSimArgs(args);
  } catch (error) {
    io.error(`sim: ${message(error)}`);
    return 2;
  }

  let saveErrors = 0;
  const save = (game: PlayedGame) => {
    if (!options.save || !game.outcome.finished) return;
    const file = options.games === 1 ? options.save : seedFile(options.save, game.seed);
    try {
      writeSave(file, game);
    } catch (error) {
      saveErrors++;
      io.error(`sim: could not save game seed ${game.seed} to ${file}: ${message(error)}`);
    }
  };
  const { summary, failures } = runSim(engine, options, POLICIES, checkInvariants, save);
  for (const failure of failures) {
    io.error(
      `sim: game seed ${failure.seed} failed (${failure.reasons.join('; ')}); reproduce: ${failure.reproduce}`,
    );
  }
  io.log(JSON.stringify(summary));
  for (const line of formatSummary(summary)) io.log(line);
  // Hard gate (spec §1, §8): an applied illegal action, an invariant failure or an aborted game
  // fails the run, and so CI.
  return failed(summary) || saveErrors > 0 ? 1 : 0;
}

/**
 * `--replay <save.json>` (spec §6.8, §8): re-executes the saved log with its recorded random
 * results and prints PASS when the replayed state hash equals the saved one, FAIL otherwise.
 * Never calls Jev or the network.
 */
function runReplay(args: string[], io: CliIo): number {
  let file: string;
  try {
    file = parseReplayArgs(args);
  } catch (error) {
    io.error(`sim: ${message(error)}`);
    return 2;
  }
  let check: ReturnType<typeof verifyReplay>;
  try {
    check = verifyReplay(deserialize(readFileSync(file, 'utf8')));
  } catch (error) {
    check = { pass: false, reason: message(error) };
  }
  if (check.pass) {
    io.log(`PASS ${file}: replayed state hash ${check.stateHash} matches the save`);
    return 0;
  }
  io.log(`FAIL ${file}: ${check.reason}`);
  return 1;
}

function writeSave(file: string, game: PlayedGame): void {
  const log = createGameLog(game.initialState);
  log.actions = game.records;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, serialize({ state: game.state, log }));
}

/** `out/run.json` → `out/run-seed-7.json`, so a multi-game run keeps every game. */
function seedFile(file: string, seed: number): string {
  const ext = extname(file);
  return `${file.slice(0, file.length - ext.length)}-seed-${seed}${ext}`;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
