import { checkInvariants } from '../../engine/index.ts';
import { realEngine } from '../engine.ts';
import { runG2Cli } from './g2-main.ts';

// Every action is checked against the spec §8 invariants, as in `npm run sim`.
process.exitCode = await runG2Cli(process.argv.slice(2), realEngine, checkInvariants);
