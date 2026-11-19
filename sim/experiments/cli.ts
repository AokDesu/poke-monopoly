import { checkInvariants } from '../../engine/index.ts';
import { realEngine } from '../engine.ts';
import { runExperimentCli } from './main.ts';

// Every action is checked against the spec §8 invariants, as in `npm run sim`.
process.exitCode = await runExperimentCli(process.argv.slice(2), realEngine, checkInvariants);
