# sim/

Simulation CLI: plays full games through the engine with bots. No network. Output goes to `sim/out/` (git-ignored).

```bash
npm run sim -- --games <n> --seed <n> [--seats 2|3|4] [--max-steps 5000] [--lap-target 2] [--policy random] [--save <file>]
npm run sim -- --replay <save.json>
```

- Game `g` of a run with seed `s` uses seed `s + g`; classes rotate across seats by seed, so every class takes every seat equally often and one game re-runs alone.
- `--lap-target <n>` overrides the Quick 2 Laps default, e.g. `--lap-target 3` for the not-yet-open Standard preset.
- `--policy` picks a policy registered in `policy.ts` (`random` for now).
- `--save <file>` writes each finished game as a save file (`serialize` from the engine: state and action log as siblings, spec §6.7). With `--games 1` the file is written as named; with more games each goes to `<file>-seed-<seed>.json`. Aborted games are not saved; a failed write fails the run.
- `--replay <save.json>` takes no other flag. It replays the saved log with its recorded dice (`verifyReplay`) and prints `PASS` when the replayed `stateHash` equals the saved state's, or `FAIL` with the reason (tampered state or log, malformed file, other engine/content/RNG version) and exits 1. It never calls Jev or the network (spec §6.8).
- Prints one JSON summary line on stdout. Each failing game prints its reproduce command (`--games 1 --seed <seed> ...`) on stderr.
- Exits non-zero when `illegalAppliedActionCount` or `invariantFailures` is above zero or a game aborted (at `--max-steps`, or because the engine, policy or invariant check threw; the other games still run).
- `runner.ts` drives the `SimEngine` seam and calls an invariant check (`checkInvariants(before, action, result)`) after every action. `cli.ts` passes the engine's checker (issue #14), so every run checks every §8 invariant; `main.ts` holds the testable CLI body. Tests use a fake engine.

`engine.ts` binds the real engine: it builds each game with `createGame` from `content/*.json`, rotates the six core classes (not the stretch ones) and decides results with `winner`.

`sim/content.ts` is the Node loader for `content/*.json`: `loadContent()` reads the files and validates them with `parseContent`. The engine itself never reads files.

Spec: §6.7, §6.8 (save, replay), §7, §8 (Simulation), §9 (sim limits).
