import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname } from 'node:path';
import { createGameLog, loadGame, serialize, stateHash } from '../engine/index.ts';
import { parseReplayArgs, parseSimArgs } from './args.ts';
import { POLICIES } from './policy.ts';
import { formatSummary } from './report.ts';
import {
  failed,
  noDealCommitted,
  runSim,
  type InvariantCheck,
  type PlayedGame,
  type SimEngine,
  type SimOptions,
} from './runner.ts';

export type CliIo = { log(line: string): void; error(line: string): void };

/** The `npm run sim` body: parses `args`, runs the games and returns the exit code. */
export async function runCli(
  args: string[],
  engine: SimEngine,
  checkInvariants: InvariantCheck,
  io: CliIo = console,
): Promise<number> {
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
  const { summary, failures } = await runSim(engine, options, POLICIES, checkInvariants, save);
  for (const failure of failures) {
    io.error(
      `sim: game seed ${failure.seed} failed (${failure.reasons.join('; ')}); reproduce: ${failure.reproduce}`,
    );
  }
  io.log(JSON.stringify(summary));
  for (const line of formatSummary(summary)) io.log(line);
  // Hard gate (spec §1, §8): an applied illegal action, an invariant failure or an aborted game
  // fails the run, and so CI.
  const noDeals = noDealCommitted(options, summary);
  if (noDeals) io.error('sim: --require-deals: no Deal Card committed in this run');
  return failed(summary) || saveErrors > 0 || noDeals ? 1 : 0;
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
  try {
    const game = loadGame(readFileSync(file, 'utf8'));
    io.log(`PASS ${file}: replayed state hash ${stateHash(game.state)} matches the save`);
    return 0;
  } catch (error) {
    io.log(`FAIL ${file}: ${message(error)}`);
    return 1;
  }
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
