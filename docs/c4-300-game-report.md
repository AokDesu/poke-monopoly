# C4: 300 policy-only games on main

Issue: [#58](https://github.com/AokDesu/poke-monopoly/issues/58), **300-game run, seat and class balanced, with report** only. Spec: §8 (simulation variation and scoring), §10 C4 (300-game exit signal).

**Result: 300/300 games finished; `illegalAppliedActionCount = 0`, `invariantFailures = 0`, and `aborted = 0`.** This meets the numerical 300-game exit signal for the content and active checkers on the main commit below. It does not close the content-complete epic or certify the separate invariant/leak-test slice.

## Scope and reproducibility

- Run date: 2026-11-17 UTC.
- Engine/content base: main `a1c3bb52c823f3f188fc2642f7a213f4f883ff4f` (merge of the C3 Stream C slice). The worktree was clean before all evaluation and validation commands; no engine, content, policy or simulation code was changed.
- Runtime: Node v24.22.3. All seats used the seeded `random` policy and AI controllers; the Social window was off. Both server keys were absent, `JEV_ENABLED=false`, `HAIKU_ENABLED=false`. No live service was called.
- Fixed plan, chosen before running: 100 games at each of 2, 3 and 4 seats, using evaluation seeds **1,000,002–1,000,101 inclusive** for each size. Quick 2 Laps and a 5,000-step limit per game. These seeds remain evaluation-only; no parameters were tuned against results.
- The same seeds across seat counts are matched seed labels, not identical games: changing the seats changes the game trajectory. Results are reported separately; no independent-sample policy comparison or difficulty claim is made.
- Event resolution ([unmerged change](https://github.com/AokDesu/poke-monopoly/pull/188)) and Sell keep-value ([unmerged change](https://github.com/AokDesu/poke-monopoly/pull/189)) were **not included**. Event squares remain logged placeholders on this base. Neither branch was cherry-picked or merged.

Run from that commit, with both server keys absent:

```bash
JEV_ENABLED=false HAIKU_ENABLED=false npm run sim -- --games 100 --seed 1000002 --seed-set eval --seats 2 --policy random --lap-target 2 --max-steps 5000
JEV_ENABLED=false HAIKU_ENABLED=false npm run sim -- --games 100 --seed 1000002 --seed-set eval --seats 3 --policy random --lap-target 2 --max-steps 5000
JEV_ENABLED=false HAIKU_ENABLED=false npm run sim -- --games 100 --seed 1000002 --seed-set eval --seats 4 --policy random --lap-target 2 --max-steps 5000
```

The CLI uses `seed + game index`, so reproduce a single game by replacing `--games 100 --seed 1000002` with `--games 1 --seed <game-seed>` and preserving the other flags. No failing seed was observed. Each evaluation command exited 0 and its stderr was empty. Raw stdout/stderr and command exit records are task evidence outside git; no generated logs are committed.

## Bounded audit

| Requirement | Existing capability | Run decision |
| --- | --- | --- |
| 2 / 3 / 4 seats | `--seats` selects one size per invocation. | Three batches of 100 games; exactly 300 total. |
| Seat and class balance | `seatSetup` rotates the six core classes by game seed; `classInSeat` reports every assignment. Existing Vitest tests cover rotation and counts within one. | Each class appears 16 or 17 times at every seat in each batch (100 is not divisible by 6); no repeated class within a game. This is the closest possible per-seat balance with 100 games. |
| Deterministic seeds | Game g uses seed s + g; single games reproduce alone. `--seed-set eval` isolates seeds from tuning (< 1,000,000). Starter alternatives rotate once per six seeds. | Preselect evaluation seeds 1,000,002–1,000,101 for each seat count; report batches separately, not as independent policy comparisons. No tuning. |
| Policy-only / no live service | `--policy random` chooses enabled actions with a separately seeded RNG. No key required. | Explicit random policy, both server keys absent, Jev and Haiku disabled. Every seat is AI; no `--social`. Personality comparisons are outside this slice. |
| Completion and safety gate | CLI calls the engine invariant checker on automatic and policy steps; reports illegal applied actions, invariant failures, aborts and failing seeds. Nonzero on any failure. | Quick 2 Laps; explicit 5,000-step limit per game. Preserve stdout/stderr outside git and report every failure. |
| Coverage limits on current main | Registry still has pending `deals-atomic` and `promise-closes-on-own-turn`; Events are placeholders. Event and Sell keep-value changes are unmerged. | State limits plainly; rerun after those changes and the invariant slice merge. Zero active-checker failures is not proof every §8 gate is complete. |

The audit found the run already expressible. Existing Vitest tests in `sim/sim.test.ts` cover class rotation and class-in-seat counts differing by at most one for all three sizes. This delivery adds documentation only, so no new behavior test, flag or rule change was needed.

## Results by seat count

Win credit is split 1/k between k co-winners (§8). Seat vectors below start at seat 0. Final coins are the CLI's mean per player at game end, including final auto-sale. These are observations from a random legal-action policy, not balance recommendations.

| Seats | Games finished | Illegal applied | Invariant failures | Aborted | Ties | Tie rate | Mean turns | Mean final coins/player | Win credit by seat |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2 | 100/100 | 0 | 0 | 0 | 1 | 0.01 | 27.44 | 46.26 | 52.5 / 47.5 |
| 3 | 100/100 | 0 | 0 | 0 | 0 | 0 | 38.97 | 44.86 | 28 / 36 / 36 |
| 4 | 100/100 | 0 | 0 | 0 | 0 | 0 | 49.88 | 44.18 | 27 / 27 / 24 / 22 |

Each seat count has exactly 100 games. Each class appears 16 or 17 times at every seat within each batch, the minimum possible spread because 100 is not divisible by six. Classes do not repeat within a game. The total is 900 class-seat participations; participation counts, rather than equal win rates, define balance here.

## Results by class

Each participation vector is `classInSeat`, ordered from seat 0. The number in parentheses is the class's game count in that batch, and the last three columns are its win credit at that seat count. CLI win credits are rounded to two decimals.

| Core class | 2-seat participation (n) | 3-seat participation (n) | 4-seat participation (n) | 2-seat win credit | 3-seat win credit | 4-seat win credit |
| --- | --- | --- | --- | --- | --- | --- |
| main-character | 17 / 16 (33) | 17 / 16 / 16 (49) | 17 / 16 / 16 / 17 (66) | 15 | 23 | 19 |
| rival | 17 / 17 (34) | 17 / 17 / 16 (50) | 17 / 17 / 16 / 16 (66) | 25 | 25 | 36 |
| fisherman | 17 / 17 (34) | 17 / 17 / 17 (51) | 17 / 17 / 17 / 16 (67) | 14.5 | 11 | 10 |
| nurse-joy | 17 / 17 (34) | 17 / 17 / 17 (51) | 17 / 17 / 17 / 17 (68) | 20.5 | 27 | 18 |
| bug-catcher | 16 / 17 (33) | 16 / 17 / 17 (50) | 16 / 17 / 17 / 17 (67) | 7 | 6 | 6 |
| researcher | 16 / 16 (32) | 16 / 16 / 17 (49) | 16 / 16 / 17 / 17 (66) | 18 | 8 | 11 |

## Failure accounting and limits

- **Illegal applied actions:** 0 in each batch, 0 across 300 games.
- **Invariant failures:** 0 returned by the engine's active checkers in each batch, 0 across 300 games. On this base, `deals-atomic` and `promise-closes-on-own-turn` are still pending registry entries. A zero here does not claim those checks ran. The separate invariant worker owns completing that coverage.
- **Aborted games:** 0 in each batch, 0 across 300 games. No max-step abort, no-enabled-action abort, engine/policy exception or checker exception was reported.
- **Failure seeds and details:** none; no failing game was dropped, retried or replaced.
- Random policy samples enabled choices. This run does not establish coverage of every legal choice, exploit resistance, hidden-information safety, personality separation, hostile-item opportunity rates or promise accounting. The other #58 slices own invariant/leak coverage and additional sim reporting. Jev evaluation work (#59), browser UI and new rules remain out of scope.
- Stretch classes were excluded by the existing core-class selector. Personality balancing is not claimed: the selected random policy has no personality, and no Jev decisions occurred.

## Required validation

All commands below ran on the same clean, unmodified main base before the documentation was written. The required tuning smoke run is separate from the 300 evaluation games and is not counted in their results.

| Check | Exit code | Result |
| --- | --- | --- |
| `npm run sim -- --games 100 --seed 1` | 0 | Pass |
| `npm run eval:jev -- --offline` | 0 | Pass |
| `npm test` (first attempt, kill switches inherited) | 1 | Fail; environment, see below |
| `npm run lint` | 0 | Pass |
| `npm run typecheck` | 0 | Pass |
| `npm test -- --maxWorkers=2` and `npm test` (kill switches unset) | 1 | Fail; load-dependent timeouts only, see below |
| The three timed-out test files, run alone | 0 | Pass (22/22) |

The first `npm test` attempt inherited `JEV_ENABLED=false` and `HAIKU_ENABLED=false` from the simulation runner: 41 tests failed across four files (38 orchestrator tests, one Thai-trial test, one web-Sell test, and a 5-second watch UI timeout). Those simulation-only switches had to be unset for the suite, so every later suite run unsets them and keeps both server keys absent.

Two more full-suite runs, with no code or test changed and seeds and timeouts untouched, both failed only on **timeouts**, never on an assertion, and on different tests:

| Run | Result | Timed out |
| --- | --- | --- |
| `npm test -- --maxWorkers=2` | 1721 passed, 1 failed (284 s) | `sim/legal-games.property.test.ts`, Social-window property, 120 s limit |
| `npm test` at default concurrency (JSON reporter) | 1720 passed, 2 failed (170 s) | `web/src/board/BoardScreen.test.tsx` 20 seeded human turns (60 s limit); `web/src/game/watch.test.tsx` pause/step/resume (5 s limit) |

The machine was shared with other lanes (load average 4 to 7 on 12 cores during these runs), and the property tests are CPU-bound. The three timed-out tests were then run alone, in one `vitest run` invocation: **3 files, 22 tests, all passed** (126 s). Re-running the property file by itself, the Social-window property took 48 s against its 120 s limit (it took more than 120 s under load), the 200-game property 53 s. So the full suite has not passed in one run on this machine; the failures are load-dependent timeouts in tests this PR does not touch, and each one passes in isolation. A full-suite run on an idle machine (or CI) is the clean confirmation and I did not obtain it. Raising those timeouts, or trimming run counts, is a follow-up and is not part of this slice.

Offline Jev evaluation exited 0 on clean main: **27/28** acceptable-set answers, 20 recorded fixture replays, 0 illegal applied actions and seven low-confidence fallbacks. The existing incorrect answer was `sell-researcher-class-bonus / sell_team_2`. Its chat inventory was 40/80 intent messages and 16/30 adversarial items, with 0 leaks across 112 request-construction checks; chat answers have no recordings yet. This is a successful offline command, not a claim that every answer or the full §8 eval-set coverage passed. Expanding the Jev eval set remains separate work (#59).

`npm run format:check` also passed after writing these documentation files.

## Follow-ups

1. Rerun the fixed evaluation plan after Event resolution and Sell keep-value merge; publish results against the new main SHA. This report is a pre-merge baseline, not evidence for those changes.
2. Rerun after the invariant/leak-test and sim-reporting slices merge so the complete #58 evidence includes their checks and metrics. Review any failing seed openly; do not tune against this evaluation set.
3. Complete the remaining C4 content, leak and eval gates independently. This report alone does not establish the full §8 simulation programme or the C5 1,000-policy / 300-live-Jev evidence set.
