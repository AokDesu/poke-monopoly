import { parseArgs } from 'node:util';
import { POLICIES } from './policy.ts';
import { checkSeedSet, DEFAULT_OPTIONS, type SimOptions } from './runner.ts';

/**
 * `--games <n> --seed <n> [--seats 2|3|4] [--max-steps n] [--lap-target n] [--policy name]
 * [--seed-set tune|eval] [--save file]`.
 */
export function parseSimArgs(args: string[]): SimOptions {
  const { values } = parseArgs({
    args,
    strict: true,
    allowPositionals: false,
    options: {
      games: { type: 'string', default: '100' },
      seed: { type: 'string', default: '1' },
      seats: { type: 'string', default: String(DEFAULT_OPTIONS.seats) },
      'max-steps': { type: 'string', default: String(DEFAULT_OPTIONS.maxSteps) },
      'lap-target': { type: 'string', default: String(DEFAULT_OPTIONS.lapTarget) },
      policy: { type: 'string', default: DEFAULT_OPTIONS.policy },
      'seed-set': { type: 'string', default: DEFAULT_OPTIONS.seedSet },
      save: { type: 'string' },
    },
  });
  const seats = integer('seats', values.seats, 2);
  if (seats > 4) throw new RangeError('--seats must be 2, 3 or 4');
  if (!Object.hasOwn(POLICIES, values.policy)) {
    throw new RangeError(
      `--policy must be one of: ${Object.keys(POLICIES).join(', ')}; got ${values.policy}`,
    );
  }
  const seedSet = values['seed-set'];
  if (seedSet !== 'tune' && seedSet !== 'eval') {
    throw new RangeError(`--seed-set must be tune or eval; got ${seedSet}`);
  }
  const options: SimOptions = {
    games: integer('games', values.games, 1),
    seed: integer('seed', values.seed, 0),
    seats,
    maxSteps: integer('max-steps', values['max-steps'], 1),
    lapTarget: integer('lap-target', values['lap-target'], 1),
    policy: values.policy,
    seedSet,
    ...(values.save === undefined ? {} : { save: nonEmpty('save', values.save) }),
  };
  checkSeedSet(options);
  return options;
}

function integer(name: string, raw: string, min: number): number {
  const value = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value < min) {
    throw new RangeError(`--${name} must be an integer of at least ${min}; got ${raw}`);
  }
  return value;
}

/** `--replay <save.json>`: the replay mode takes no other flag. */
export function parseReplayArgs(args: string[]): string {
  const { values } = parseArgs({
    args,
    strict: true,
    allowPositionals: false,
    options: { replay: { type: 'string' } },
  });
  return nonEmpty('replay', values.replay ?? '');
}

function nonEmpty(name: string, raw: string): string {
  if (raw === '') throw new RangeError(`--${name} needs a file path`);
  return raw;
}
