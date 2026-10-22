# sim/

Simulation CLI: plays full games through the engine with bots. No network. Output goes to `sim/out/` (git-ignored).

```bash
npm run sim -- --games <n> --seed <n> [--seats 2|3|4] [--max-steps 5000] [--lap-target 2] [--policy random] [--seed-set tune|eval]
```

- Game `g` of a run with seed `s` uses seed `s + g`; classes rotate across seats by seed, so every class takes every seat equally often and one game re-runs alone.
- `--lap-target <n>` overrides the Quick 2 Laps default, e.g. `--lap-target 3` for the not-yet-open Standard preset.
- `--policy` picks a policy registered in `policy.ts` (`random` for now).
- `--seed-set tune|eval` (default `tune`) keeps tuning seeds below 1,000,000 and evaluation seeds from 1,000,000; a run whose game seeds leave its set exits 2. See [docs/sim.md](../docs/sim.md).
- Prints one JSON summary line on stdout, then a short readable table; the metrics (final coins, ties, catching by Ball, DC and Lap, Shop purchases, sales per Lap, class-in-seat counts) are described in [docs/sim.md](../docs/sim.md). Each failing game prints its reproduce command (`--games 1 --seed <seed> ...`) on stderr.
- Exits non-zero when `illegalAppliedActionCount` or `invariantFailures` is above zero or a game aborted (at `--max-steps`, or because the engine, policy or invariant check threw; the other games still run).
- `runner.ts` drives the `SimEngine` seam and calls an invariant check (`checkInvariants(before, action, result)`) after every action. `cli.ts` passes the engine's checker (issue #14), so every run checks every §8 invariant; `main.ts` holds the testable CLI body, `metrics.ts` collects the summary metrics from accepted steps and `report.ts` formats the table. Tests use a fake engine.

`engine.ts` binds the real engine: it builds each game with `createGame` from `content/*.json`, rotates the six core classes (not the stretch ones) and decides results with `winner`.

`sim/content.ts` is the Node loader for `content/*.json`: `loadContent()` reads the files and validates them with `parseContent`. The engine itself never reads files.

Spec: §7, §8 (Simulation), §9 (sim limits), Appendix A (Ball price check).
