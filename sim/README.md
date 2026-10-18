# sim/

Simulation CLI: plays full games through the engine with bots. No network. Output goes to `sim/out/` (git-ignored).

Run with `npm run sim -- --games 100 --seed <n>`; it prints one JSON summary line and `illegalAppliedActionCount` must be 0. `--lap-target <n>` overrides the Quick 2 Laps default, e.g. `--lap-target 3` for the not-yet-open Standard preset. Currently a stub, replaced by issue #13.

`sim/content.ts` is the Node loader for `content/*.json`: `loadContent()` reads the files and validates them with `parseContent`. The engine itself never reads files.

Spec: §7, §8 (Simulation).
