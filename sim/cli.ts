import { checkInvariants } from '../engine/index.ts';
import { realEngine } from './engine.ts';
import { runCli } from './main.ts';

// Every action is checked against the spec §8 invariants (issue #14).
process.exitCode = await runCli(process.argv.slice(2), realEngine, checkInvariants);
