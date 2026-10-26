# sim/

Simulation CLI: plays full games through the engine with bots. No network. Output goes to `sim/out/` (git-ignored).

```bash
npm run sim -- --games <n> --seed <n> [--seats 2|3|4] [--max-steps 5000] [--lap-target 2] [--policy random|fallback|jev] [--seed-set tune|eval] [--save <file>]
npm run sim -- --replay <save.json>
```

- Game `g` of a run with seed `s` uses seed `s + g`; classes rotate across seats by seed, so every class takes every seat equally often and one game re-runs alone.
- `--lap-target <n>` overrides the Quick 2 Laps default, e.g. `--lap-target 3` for the not-yet-open Standard preset.
- `--policy` picks a policy registered in `policy.ts`: `random`; `fallback`, which plays every seat with the Greedy fallback policy from `ai/fallback/` (spec §5.2, §5.5); or `jev`, which makes every Greedy seat's decision on Normal through the Jev decision orchestrator (`ai/jev-policy.ts`, spec §5.6). Offline, in tests and in CI, `jev` uses a seeded fake Jev client that returns random, invalid, late and failing answers; it calls the real service only when a person runs it with the key in their environment, and `JEV_ENABLED=false` puts every decision on the fallback. The summary then adds `policyCounts` and `jev` (`invalidOutputRate` and `fallbackRate` by cause), reported apart from `illegalAppliedActionCount`.
- `--seed-set tune|eval` (default `tune`) keeps tuning seeds below 1,000,000 and evaluation seeds from 1,000,000; a run whose game seeds leave its set exits 2. See [docs/sim.md](../docs/sim.md).
- `--save <file>` writes each finished game as a save file (`serialize` from the engine: state and action log as siblings, spec §6.7). With `--games 1` the file is written as named; with more games each goes to `<file>-seed-<seed>.json`. Aborted games are not saved; a failed write fails the run.
- `--replay <save.json>` takes no other flag. It replays the saved log with its recorded dice (`verifyReplay`) and prints `PASS` when the replayed `stateHash` equals the saved state's, or `FAIL` with the reason (tampered state or log, malformed file, other engine/content/RNG version) and exits 1. It never calls Jev or the network (spec §6.8).
- Prints one JSON summary line on stdout, then a short readable table; the metrics (final coins, ties, catching by Ball, DC and Lap, Shop purchases, sales per Lap, class-in-seat counts) are described in [docs/sim.md](../docs/sim.md). Each failing game prints its reproduce command (`--games 1 --seed <seed> ...`) on stderr.
- Exits non-zero when `illegalAppliedActionCount` or `invariantFailures` is above zero or a game aborted (at `--max-steps`, or because the engine, policy or invariant check threw; the other games still run).
- `runner.ts` drives the `SimEngine` seam and calls an invariant check (`checkInvariants(before, action, result)`) after every action. `cli.ts` passes the engine's checker (issue #14), so every run checks every §8 invariant; `main.ts` holds the testable CLI body, `metrics.ts` collects the summary metrics from accepted steps and `report.ts` formats the table. Tests use a fake engine.

`engine.ts` binds the real engine: it builds each game with `createGame` from `content/*.json`, rotates the six core classes (not the stretch ones) and decides results with `winner`. Its `facts` gives the deciding seat the engine numbers its observation lacks (catch odds and succeeding faces from `oddsForAllBalls`, and each sellable Pokémon's payout within one batch selling them all), passed to `Policy.decide` as `PolicyFacts` only when the policy sets `wantsFacts`. `decide` may return a promise (the runner awaits it) of an enabled action's ID, or `{ sellUids }` to sell several Pokémon in one atomic Sell Phase (§4.7); the runner counts that batch as enabled when each Pokémon in it has its own enabled sale.

Property tests (spec §8 Tests layer, issue #26): `legal-games.ts` holds a fast-check arbitrary for a game plan (2 to 4 seats, any mix and order of core classes, a seed, a Lap target and a tape of decisions) and `playGame`, which plays the plan through the engine pipeline (`advanceAutomatically`, `legalActions`, `applyAction`) into a `createGameLog` command log and asserts it only ever submits an enabled legal action. With a fixed seed, `legal-games.property.test.ts` checks 200 games for no invariant violation, no state change from stale or foreign commands and a finish within the step limit, and `replay.property.test.ts` checks that replaying each of 200 command logs gives the live final state. A failure prints the fast-check seed, the shrunk plan and the accepted actions up to the failure.

`sim/content.ts` is the Node loader for `content/*.json`: `loadContent()` reads the files and validates them with `parseContent`. The engine itself never reads files.

Spec: §6.7, §6.8 (save, replay), §7, §8 (Simulation), §9 (sim limits), Appendix A (Ball price check).
