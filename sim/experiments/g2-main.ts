import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { CONTENT_VERSION, ENGINE_VERSION } from '../../engine/index.ts';
import type { CliIo } from '../main.ts';
import type { InvariantCheck, SimEngine } from '../runner.ts';
import {
  analyzeG2,
  formatG2Report,
  envBackend,
  G2_TUNE_FIRST,
  G2_TUNE_LAST,
  estimateThb,
  parseG2Plan,
  parseG2Rows,
  planG2Games,
  planSha256,
  playG2Game,
  powerTable,
  validateG2Plan,
  type DuelBackend,
  type G2GamePlan,
  type G2PlanFilter,
  type G2Provenance,
  type G2Row,
} from './g2.ts';

export const DEFAULT_G2_PLAN = fileURLToPath(new URL('./g2-plan.json', import.meta.url));
const C5_PLAN = fileURLToPath(new URL('./c5-plan.json', import.meta.url));

/** The rows file of a run unless `--out` says otherwise; `logs/` is git-ignored. */
export const DEFAULT_G2_ROWS = 'logs/g2-hard-vs-normal.rows.jsonl';

/**
 * `npm run experiment:g2 -- (--seed-base <n> | --held-out) [--seeds k] [--shard i/k] [--out rows.jsonl]
 * [--max-thb n] [--game id]` plays the G2 duel and appends one row per game; a rerun with the same
 * `--out` skips the games already written. `--analyze` reads the rows (`--rows a,b` for shards) and
 * prints the §8 Difficulty tables and the verdict. `--validate` checks the plan and prints its power
 * table. `--held-out` opens the plan's evaluation seeds, so it is refused unless the run is live (a
 * key in the environment and Jev on): the fake client never touches them (spec §8, plan seed ledger).
 */
export async function runG2Cli(
  args: string[],
  engine: SimEngine,
  checkInvariants: InvariantCheck,
  io: CliIo = console,
  provenance: (planText: string) => G2Provenance = gitProvenance,
  backend: DuelBackend = envBackend,
): Promise<number> {
  let values: ReturnType<typeof parse>;
  try {
    values = parse(args);
  } catch (error) {
    return usage(io, error instanceof Error ? error.message : String(error));
  }
  const planText = readFileSync(values.plan ?? DEFAULT_G2_PLAN, 'utf8');
  const plan = parseG2Plan(JSON.parse(planText));
  const c5 = JSON.parse(readFileSync(C5_PLAN, 'utf8')) as {
    seedLedger: { id: string; first: number; last: number }[];
  };
  const problems = validateG2Plan(plan, engine.classIds, c5.seedLedger);
  for (const problem of problems) io.error(`experiment:g2: plan: ${problem}`);
  if (problems.length > 0) return 1;
  if (values.validate) {
    io.log(`plan ok: ${plan.seeds.count} seeds, ${planG2Games(plan).length} games`);
    for (const row of powerTable(plan)) {
      io.log(
        `gap ${row.gap}: ${row.blocks} blocks, ${row.seeds} seeds, ${row.games} games, power at the plan's n ${row.powerAtRecommended.toFixed(2)}`,
      );
    }
    return 0;
  }
  if (values['held-out'] === (values['seed-base'] !== undefined)) {
    return usage(io, 'pass exactly one of --seed-base <n> and --held-out');
  }
  const seedBase = values['seed-base'] === undefined ? undefined : Number(values['seed-base']);
  const seeds = values.seeds === undefined ? undefined : Number(values.seeds);
  let shard: G2PlanFilter['shard'];
  try {
    shard = values.shard === undefined ? undefined : parseShard(values.shard);
  } catch (error) {
    return usage(io, error instanceof Error ? error.message : String(error));
  }
  const filter: G2PlanFilter = {
    ...(seedBase !== undefined && { seedBase }),
    ...(seeds !== undefined && { seeds }),
  };
  let all: G2GamePlan[];
  try {
    all = planG2Games(plan, filter);
  } catch (error) {
    return usage(io, error instanceof Error ? error.message : String(error));
  }
  if (seedBase !== undefined) {
    const seedsUsed = all.map((game) => game.seed);
    if (Math.min(...seedsUsed) < G2_TUNE_FIRST || Math.max(...seedsUsed) > G2_TUNE_LAST) {
      return usage(io, `--seed-base keeps every seed within ${G2_TUNE_FIRST} to ${G2_TUNE_LAST}`);
    }
  }
  const out = values.out ?? DEFAULT_G2_ROWS;

  if (values.analyze) {
    const files = (values.rows ?? out).split(',').filter(Boolean);
    const rows: G2Row[] = [];
    for (const file of files) {
      if (!existsSync(file)) return usage(io, `no rows file ${file}`);
      const parsed = parseG2Rows(readFileSync(file, 'utf8'));
      if (parsed.skipped > 0)
        io.error(`experiment:g2: ${file}: ${parsed.skipped} unreadable line(s) skipped`);
      rows.push(...parsed.rows);
    }
    const planned = new Set(all.map((game) => game.gameId));
    const stray = rows.filter((row) => !planned.has(row.gameId));
    if (stray.length > 0) {
      return usage(
        io,
        `${stray.length} row(s) are not games of this plan and seed range, such as ${stray[0]!.gameId}`,
      );
    }
    // n is declared when a run starts. A run stopped half way is not read as a smaller plan: the
    // seeds count of the analysis must be the one every row was played under (spec §8, plan seeds).
    const declared = seeds ?? plan.seeds.count;
    const other = rows.find((row) => row.plannedSeeds !== declared);
    if (other) {
      return usage(
        io,
        `${other.gameId} was played in a run of ${other.plannedSeeds ?? 'an unrecorded number of'} seeds; this analysis is for ${declared}. A verdict is only given for the n declared when the run started; pass --seeds ${other.plannedSeeds ?? '<that n>'} or leave it out for the whole plan.`,
      );
    }
    const shas = new Set(rows.map((row) => row.planSha256));
    if (shas.size > 1 || (rows.length > 0 && !shas.has(planSha256(planText)))) {
      return usage(io, 'the rows were played under another version of the plan');
    }
    const report = analyzeG2(rows, plan, {
      plannedBlocks: all.length / 2,
      ...(values.resamples !== undefined && { resamples: Number(values.resamples) }),
    });
    if (values.json) {
      mkdirSync(dirname(values.json), { recursive: true });
      writeFileSync(values.json, `${JSON.stringify(report, null, 2)}\n`);
    }
    for (const line of formatG2Report(report)) io.log(line);
    return 0;
  }

  const mode = backend.mode();
  if (values['held-out'] && mode !== 'live') {
    return usage(
      io,
      `--held-out opens the G2 evaluation seeds and needs a live run (the Jev key set in the environment, JEV_ENABLED not false); this process is ${mode}. Use --seed-base <n> for a smoke run.`,
    );
  }
  const planned = all.filter(
    (game) =>
      (shard === undefined || game.blockIndex % shard.count === shard.index) &&
      (values.game === undefined || game.gameId === values.game),
  );
  if (planned.length === 0) return usage(io, 'the filters select no game');

  const sha = planSha256(planText);
  let done = new Map<string, G2Row>();
  if (existsSync(out)) {
    const text = readFileSync(out, 'utf8');
    const parsed = parseG2Rows(text);
    for (const row of parsed.rows) {
      if (row.planSha256 !== sha)
        return usage(io, `${out} holds rows of another version of the plan`);
      if (row.plannedSeeds !== (seeds ?? plan.seeds.count)) {
        return usage(
          io,
          `${out} holds rows of a run of ${row.plannedSeeds} seeds; this run is ${seeds ?? plan.seeds.count}. Use another --out.`,
        );
      }
      if (row.mode !== mode) {
        return usage(
          io,
          `${out} holds ${row.mode} rows; this process is ${mode}. Use another --out.`,
        );
      }
    }
    done = new Map(parsed.rows.map((row) => [row.gameId, row]));
    if (parsed.skipped > 0)
      io.error(
        `experiment:g2: ${parsed.skipped} unreadable line(s) in ${out}; the games are played again`,
      );
    // An interrupted write can leave a last line without its newline.
    if (text.length > 0 && !text.endsWith('\n')) appendFileSync(out, '\n');
  } else {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, '');
  }
  const todo = planned.filter((game) => !done.has(game.gameId));
  io.log(
    `experiment:g2: mode ${mode}; ${planned.length} games in scope, ${planned.length - todo.length} already in ${out}, ${todo.length} to play`,
  );
  const source = provenance(planText);
  const maxThb = values['max-thb'] === undefined ? undefined : Number(values['max-thb']);
  const spent = () =>
    [...done.values()].reduce(
      (sum, row) => sum + (row.usage.thb ?? estimateThb(plan, row.usage.requests)),
      0,
    );
  let failing = 0;
  let played = 0;
  for (const game of todo) {
    if (maxThb !== undefined && spent() >= maxThb) {
      io.error(
        `experiment:g2: stopped at THB ${spent().toFixed(4)} (--max-thb ${maxThb}); rerun to resume`,
      );
      return 3;
    }
    if (mode === 'live' && backend.budgetExceeded()) {
      io.error(
        'experiment:g2: the spend guard reports the budget reached (spec §9); stopped. Rerun to resume.',
      );
      return 3;
    }
    const row = await playG2Game(engine, game, checkInvariants, source, backend);
    appendFileSync(out, `${JSON.stringify(row)}\n`);
    done.set(row.gameId, row);
    played++;
    io.log(
      `experiment:g2: [${played}/${todo.length}] ${row.gameId} ${row.finished ? `winners ${row.winners.join(',')}` : 'aborted'} requests ${row.usage.requests}`,
    );
    if (row.failureReasons.length > 0) {
      failing++;
      io.error(
        `experiment:g2: game ${row.gameId} seed ${row.seed} failed (${row.failureReasons.join('; ')}); the row is kept, a rerun does not replay it`,
      );
    }
  }
  io.log(`experiment:g2: ${played} games played, ${failing} failing, rows in ${out}`);
  return failing > 0 ? 1 : 0;
}

function parse(args: string[]) {
  return parseArgs({
    args,
    strict: true,
    allowPositionals: false,
    options: {
      plan: { type: 'string' },
      out: { type: 'string' },
      'seed-base': { type: 'string' },
      'held-out': { type: 'boolean', default: false },
      seeds: { type: 'string' },
      shard: { type: 'string' },
      game: { type: 'string' },
      'max-thb': { type: 'string' },
      analyze: { type: 'boolean', default: false },
      rows: { type: 'string' },
      json: { type: 'string' },
      resamples: { type: 'string' },
      validate: { type: 'boolean', default: false },
    },
  }).values;
}

function parseShard(raw: string): { index: number; count: number } {
  const match = /^(\d+)\/(\d+)$/.exec(raw);
  if (!match || Number(match[1]) >= Number(match[2])) {
    throw new RangeError(
      `--shard must be index/count with index below count, such as 0/3; got ${raw}`,
    );
  }
  return { index: Number(match[1]), count: Number(match[2]) };
}

function usage(io: CliIo, message: string): number {
  io.error(`experiment:g2: ${message}`);
  return 2;
}

function gitProvenance(planText: string): G2Provenance {
  return {
    mainSha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    engineVersion: ENGINE_VERSION,
    contentVersion: CONTENT_VERSION,
    planSha256: planSha256(planText),
  };
}
