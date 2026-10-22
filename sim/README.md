# sim/

Simulation CLI: plays full games through the engine with bots. No network. Output goes to `sim/out/` (git-ignored).

```bash
npm run sim -- --games <n> --seed <n> [--seats 2|3|4] [--max-steps 5000] [--lap-target 2] [--policy random|fallback]
```

- Game `g` of a run with seed `s` uses seed `s + g`; classes rotate across seats by seed, so every class takes every seat equally often and one game re-runs alone.
- `--lap-target <n>` overrides the Quick 2 Laps default, e.g. `--lap-target 3` for the not-yet-open Standard preset.
- `--policy` picks a policy registered in `policy.ts`: `random`, or `fallback`, which plays every seat with the Greedy fallback policy from `ai/fallback/` (spec §5.2, §5.5).
- Prints one JSON summary line on stdout. Each failing game prints its reproduce command (`--games 1 --seed <seed> ...`) on stderr.
- Exits non-zero when `illegalAppliedActionCount` or `invariantFailures` is above zero or a game aborted (at `--max-steps`, or because the engine, policy or invariant check threw; the other games still run).
- `runner.ts` drives the `SimEngine` seam and calls an invariant check (`checkInvariants(before, action, result)`) after every action. `cli.ts` passes the engine's checker (issue #14), so every run checks every §8 invariant; `main.ts` holds the testable CLI body. Tests use a fake engine.

`engine.ts` binds the real engine: it builds each game with `createGame` from `content/*.json`, rotates the six core classes (not the stretch ones) and decides results with `winner`. Its `facts` gives the deciding seat the engine numbers its observation lacks (catch odds from `oddsForAllBalls`, and each sellable Pokémon's payout within one batch selling them all), passed to `Policy.decide` as `PolicyFacts` only when the policy sets `wantsFacts`. `decide` returns an enabled action's ID, or `{ sellUids }` to sell several Pokémon in one atomic Sell Phase (§4.7); the runner counts that batch as enabled when each Pokémon in it has its own enabled sale.

Property tests (spec §8 Tests layer, issue #26): `legal-games.ts` holds a fast-check arbitrary for a game plan (2 to 4 seats, any mix and order of core classes, a seed, a Lap target and a tape of decisions) and `playGame`, which plays the plan through the engine pipeline (`advanceAutomatically`, `legalActions`, `applyAction`) into a `createGameLog` command log and asserts it only ever submits an enabled legal action. With a fixed seed, `legal-games.property.test.ts` checks 200 games for no invariant violation, no state change from stale or foreign commands and a finish within the step limit, and `replay.property.test.ts` checks that replaying each of 200 command logs gives the live final state. A failure prints the fast-check seed, the shrunk plan and the accepted actions up to the failure.

`sim/content.ts` is the Node loader for `content/*.json`: `loadContent()` reads the files and validates them with `parseContent`. The engine itself never reads files.

Spec: §7, §8 (Simulation), §9 (sim limits).
