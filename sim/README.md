# sim/

Simulation CLI: plays full games through the engine with bots. No network. Output goes to `sim/out/` (git-ignored).

Run with `npm run sim -- --games 100 --seed <n>`; it prints one JSON summary line and `illegalAppliedActionCount` must be 0. Currently a stub, replaced by issue #13.

Spec: §7, §8 (Simulation).
