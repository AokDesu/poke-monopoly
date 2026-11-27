# C4: 300 policy-only games, second rerun on main

Issue [#58](https://github.com/AokDesu/poke-monopoly/issues/58). Spec §8 (invariants and simulation variation) and §10 C4 (300-game exit signal). This run follows the [original report](c4-300-game-report.md) and [first rerun](c4-300-game-rerun-report.md).

**Result.** The Social and deals set finished 300/300 games with `illegalAppliedActionCount = 0`, `invariantFailures = 0` and `aborted = 0`. The matched Social-off set also finished 300/300 with all three counts at zero. The focused hidden-information tests observed zero leaks.

## Scope and reproducibility

- Run date 2026-11-27 UTC. Base `origin/main` at `44b02dbb99fe64360a78d9289a1c087b165ab6b0` (2026-11-26), which includes the Deal Card budget facts, Deal AI response, Gym-window fix and server and engine fixes since the first rerun.
- Engine `0.23.0`, content `1.4.0`, Node `v24.22.3`. Dependencies came from `npm ci`. Both server keys were absent and Jev and Haiku were disabled throughout.
- Each set ran 100 games at each of 2, 3 and 4 seats on evaluation seeds **1,000,002–1,000,101 inclusive**, with the seeded random policy, Quick 2 Laps and a 5,000-step limit per game. A seed is the batch seed plus the game index. The same seed labels were used for each seat count.
- Set A leaves the Social window off and uses AI controllers in all seats. Set B opens the Social window, uses a scripted human driven by the same random policy at seat 0, and uses AI controllers in the other seats. Each B batch requires at least one committed deal.

```bash
JEV_ENABLED=false HAIKU_ENABLED=false npm run sim -- --games 100 --seed 1000002 --seed-set eval --seats 2 --policy random --lap-target 2 --max-steps 5000
JEV_ENABLED=false HAIKU_ENABLED=false npm run sim -- --games 100 --seed 1000002 --seed-set eval --seats 3 --policy random --lap-target 2 --max-steps 5000
JEV_ENABLED=false HAIKU_ENABLED=false npm run sim -- --games 100 --seed 1000002 --seed-set eval --seats 4 --policy random --lap-target 2 --max-steps 5000

JEV_ENABLED=false HAIKU_ENABLED=false npm run sim -- --games 100 --seed 1000002 --seed-set eval --seats 2 --policy random --lap-target 2 --max-steps 5000 --social --require-deals
JEV_ENABLED=false HAIKU_ENABLED=false npm run sim -- --games 100 --seed 1000002 --seed-set eval --seats 3 --policy random --lap-target 2 --max-steps 5000 --social --require-deals
JEV_ENABLED=false HAIKU_ENABLED=false npm run sim -- --games 100 --seed 1000002 --seed-set eval --seats 4 --policy random --lap-target 2 --max-steps 5000 --social --require-deals
```

All six commands exited 0 with empty stderr. To replay a single game, replace `--games 100 --seed 1000002` with `--games 1 --seed <game-seed>` and keep the other flags. The 4-seat Social command was restarted with a longer shell deadline and the original per-game step limit. No failing seed was observed.

## Results

| Set | Seats | Games finished | Illegal applied | Invariant failures | Aborted | Ties | Mean turns |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A | 2 | 100/100 | 0 | 0 | 0 | 0 | 27.16 |
| A | 3 | 100/100 | 0 | 0 | 0 | 2 | 38.64 |
| A | 4 | 100/100 | 0 | 0 | 0 | 0 | 50.64 |
| B | 2 | 100/100 | 0 | 0 | 0 | 2 | 26.9 |
| B | 3 | 100/100 | 0 | 0 | 0 | 1 | 38.67 |
| B | 4 | 100/100 | 0 | 0 | 0 | 1 | 51.12 |

All 26 registered invariant checks were active, with none pending. The sim runs the [engine registry](../engine/invariants.ts) on engine steps and reports one aggregate failure count. Both `deals-atomic` and `promise-closes-on-own-turn` were active during Social play.

Deal totals come from the engine's deal events. Set A recorded zero deals in every batch.

| Seats | Proposed | Accepted | Rejected | Countered | Cancelled | Committed |
| --- | --- | --- | --- | --- | --- | --- |
| 2 | 295 | 21 | 47 | 227 | 126 | 122 |
| 3 | 281 | 20 | 43 | 218 | 115 | 123 |
| 4 | 281 | 19 | 48 | 214 | 108 | 125 |
| Total | 857 | 60 | 138 | 659 | 349 | 370 |

Class counts matched between sets at every seat. Each of the six core classes appeared 16 or 17 times per seat per batch, with no repeated class within a game. Vectors start at seat 0.

| Core class | 2-seat counts | 3-seat counts | 4-seat counts |
| --- | --- | --- | --- |
| main-character | 17 / 16 | 17 / 16 / 16 | 17 / 16 / 16 / 17 |
| rival | 17 / 17 | 17 / 17 / 16 | 17 / 17 / 16 / 16 |
| fisherman | 17 / 17 | 17 / 17 / 17 | 17 / 17 / 17 / 16 |
| nurse-joy | 17 / 17 | 17 / 17 / 17 | 17 / 17 / 17 / 17 |
| bug-catcher | 16 / 17 | 16 / 17 / 17 | 16 / 17 / 17 / 17 |
| researcher | 16 / 16 | 16 / 16 / 17 | 16 / 16 / 17 / 17 |

## Required validation

| Check | Exit | Result |
| --- | --- | --- |
| `npm test -- --maxWorkers=2` | 0 | 183 files, 3,996/3,996 tests passed |
| Focused hidden-information and invariant tests (first command below) | 0 | 7 files, 157/157 tests passed, zero leaks observed |
| Deal Card facts and visibility (second command below) | 0 | 2 files, 107/107 tests passed |
| `npm run sim -- --games 100 --seed 1` | 0 | Separate tuning smoke run, 100/100 games finished with zero illegal actions, invariant failures or aborts |
| `npm run eval:jev -- --offline` | 0 | 154/168 acceptable-set answers, 136 recorded orchestrator replays with zero illegal applied actions, 224 chat request checks with zero leaks |
| `npm run lint` and `npm run typecheck` | 0 | Both passed |

The focused leak check repeated the first rerun's command. It covers the observation and spectator boundaries, Social state, hidden chat IDs and Jev request construction.

```bash
npx vitest run engine/observation.test.ts engine/spectator.test.ts engine/social.test.ts engine/hidden-chat-ids.test.ts engine/observation-buckets.test.ts engine/invariants.test.ts eval/jev/state-leaks.test.ts
npx vitest run engine/deal-facts.test.ts engine/deals.test.ts
```

The second command checks Deal Card visibility, including that a private combat debuff leaves the receiving seat's Deal facts unchanged. Raw command output and exit codes are retained with the task evidence.

The format check initially flagged 28 files in the worktree's ignored `.omc/` directory. It passed with that directory excluded by a temporary ignore file.
