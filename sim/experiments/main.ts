import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { CONTENT_VERSION, ENGINE_VERSION } from '../../engine/index.ts';
import type { CliIo } from '../main.ts';
import { EXPERIMENT_POLICIES } from '../policy.ts';
import { EVAL_SEED_FLOOR, type InvariantCheck, type SimEngine } from '../runner.ts';
import {
  ARMS,
  manifestSha256,
  parseManifest,
  planGames,
  playPlan,
  reproducePlan,
  validateManifest,
  type Arm,
  type PlanFilter,
  type Provenance,
} from './run.ts';

export const DEFAULT_MANIFEST = fileURLToPath(new URL('./c5-plan.json', import.meta.url));
/** The plan's tuning range (seed ledger `tune`): smoke runs outside the 1,008 stay in it. */
const TUNE_FIRST = 100_000;
const TUNE_LAST = 199_999;

/**
 * `npm run experiment -- [--manifest file] [--policy id] [--seats 2|3|4] [--blocks a-b]
 * [--arms control,treatment] (--seed-base <n> | --held-out) --out <rows.jsonl>` plays the selected
 * games of the C5 plan and writes one sanitized row per game, aborts included (spec §8, §10 C5).
 * `--validate` only checks that the manifest can run. `--seed-base` moves the plan into the tuning
 * range for a smoke run; `--held-out` plays the manifest's own evaluation seeds and so opens that
 * range in the plan's seed ledger: it is required, never implied.
 */
export async function runExperimentCli(
  args: string[],
  engine: SimEngine,
  checkInvariants: InvariantCheck,
  io: CliIo = console,
  provenance: (manifestText: string) => Provenance = gitProvenance,
): Promise<number> {
  let values: ReturnType<typeof parse>;
  try {
    values = parse(args);
  } catch (error) {
    io.error(`experiment: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
  const text = readFileSync(values.manifest ?? DEFAULT_MANIFEST, 'utf8');
  const manifest = parseManifest(JSON.parse(text));
  const problems = validateManifest(manifest, EXPERIMENT_POLICIES, engine.classIds);
  for (const problem of problems) io.error(`experiment: manifest: ${problem}`);
  if (problems.length > 0) return 1;
  if (values.validate) {
    io.log(`manifest ok: ${manifest.cells.length} cells`);
    return 0;
  }
  if (!values.out) return usage(io, '--out <rows.jsonl> is required');
  if (values['held-out'] === (values['seed-base'] !== undefined)) {
    return usage(io, 'pass exactly one of --seed-base <n> and --held-out');
  }
  const seedBase = values['seed-base'] === undefined ? undefined : Number(values['seed-base']);
  const filter: PlanFilter = {
    ...(values.policy && { policy: values.policy }),
    ...(values.seats && { seats: Number(values.seats) }),
    ...(values.blocks && { blocks: blocks(values.blocks) }),
    ...(values.arms && { arms: arms(values.arms) }),
  };
  const plans = planGames(manifest, filter, seedBase);
  if (plans.length === 0) return usage(io, 'the filters select no game');
  const seeds = plans.map((plan) => plan.seed);
  if (
    seedBase !== undefined &&
    (Math.min(...seeds) < TUNE_FIRST || Math.max(...seeds) > TUNE_LAST)
  ) {
    return usage(io, `--seed-base keeps every seed within ${TUNE_FIRST} to ${TUNE_LAST}`);
  }
  if (seedBase === undefined && Math.min(...seeds) < EVAL_SEED_FLOOR) {
    return usage(io, 'a manifest range below the evaluation floor needs --seed-base');
  }
  const source = provenance(text);
  mkdirSync(dirname(values.out), { recursive: true });
  writeFileSync(values.out, '');
  let failing = 0;
  for (const plan of plans) {
    const row = await playPlan(engine, plan, EXPERIMENT_POLICIES, checkInvariants, source);
    appendFileSync(values.out, `${JSON.stringify(row)}\n`);
    if (row.failureReasons.length > 0) {
      failing++;
      io.error(
        `experiment: game ${row.gameId} seed ${row.seed} failed (${row.failureReasons.join('; ')}); reproduce: ${reproducePlan(plan, seedBase)}`,
      );
    }
  }
  io.log(`experiment: ${plans.length} games, ${failing} failing, rows in ${values.out}`);
  return failing > 0 ? 1 : 0;
}

function parse(args: string[]) {
  return parseArgs({
    args,
    strict: true,
    allowPositionals: false,
    options: {
      manifest: { type: 'string' },
      policy: { type: 'string' },
      seats: { type: 'string' },
      blocks: { type: 'string' },
      arms: { type: 'string' },
      out: { type: 'string' },
      'seed-base': { type: 'string' },
      'held-out': { type: 'boolean', default: false },
      validate: { type: 'boolean', default: false },
    },
  }).values;
}

function usage(io: CliIo, message: string): number {
  io.error(`experiment: ${message}`);
  return 2;
}

function blocks(raw: string): [number, number] {
  const match = /^(\d+)-(\d+)$/.exec(raw);
  if (!match || Number(match[1]) > Number(match[2])) {
    throw new RangeError(`--blocks must be first-last, such as 0-23; got ${raw}`);
  }
  return [Number(match[1]), Number(match[2])];
}

function arms(raw: string): Arm[] {
  const list = raw.split(',');
  if (!list.every((arm): arm is Arm => (ARMS as readonly string[]).includes(arm))) {
    throw new RangeError(`--arms must be a list of ${ARMS.join(', ')}; got ${raw}`);
  }
  return list;
}

function gitProvenance(manifestText: string): Provenance {
  return {
    mainSha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    engineVersion: ENGINE_VERSION,
    contentVersion: CONTENT_VERSION,
    manifestSha256: manifestSha256(manifestText),
  };
}
