# C4: 300 policy-only games, rerun on current main

Issue: [#58](https://github.com/AokDesu/poke-monopoly/issues/58), **300-game run, seat and class balanced, with report**. Spec: §8 (simulation variation, scoring, invariants), §10 C4 (300-game exit signal). This rerun replaces the exit evidence in [c4-300-game-report.md](c4-300-game-report.md), which ran before Events, Sell keep-value and the last two invariants were active.

**Result: 300/300 games finished in each of two sets (600 games in all); `illegalAppliedActionCount = 0`, `invariantFailures = 0` and `aborted = 0` in every batch.** All 26 registered §8 invariants are active, including `deals-atomic` and `promise-closes-on-own-turn`. The hidden-information leak tests pass (156/156 in the focused run). The full `npm test` did not pass in one run on this loaded machine, see [Required validation](#required-validation).

## What changed since the first run

| Item | First run (`a1c3bb52`) | This run (`9240c4c5`) |
| --- | --- | --- |
| Event squares | Logged placeholders | Resolved (the sim prints events drawn and resolved, 1:1 per Event ID) |
| Sell keep-value | Not merged | Merged |
| `deals-atomic` | Pending registry entry, did not run | Active (#262) |
| `promise-closes-on-own-turn` | Pending registry entry, did not run | Active |
| Active invariants | Registry still had two pending | 26 of 26 active, none pending |
| Social window and Deal Cards | Off, not exercised | Second set below, with deals required |
| Node | v24.22.3 | v22.22.1 |

Mean turns and win credit differ from the first report because Events and keep-value change the games. The two runs are not a before/after comparison of one rule.

## Scope and reproducibility

- Run date: 2026-11-21 UTC.
- Engine/content base: main `9240c4c5a94b9362256b9eb79767c7319abbca39` (`feat(engine): Deal Card legality and atomic commit (#164 D1) (#262)`). The worktree was clean before every run. No engine, content, policy, simulation, ai or web code changed; this PR adds documentation only.
- Both server keys absent, `JEV_ENABLED=false`, `HAIKU_ENABLED=false`. No live service was called.
- Plan unchanged from the first report: 100 games at each of 2, 3 and 4 seats, evaluation seeds **1,000,002 to 1,000,101 inclusive**, `--seed-set eval`, `--policy random`, Quick 2 Laps, 5,000-step limit. Nothing was tuned against these seeds, and the seeds are the same ones the first run used.
- Same seeds across seat counts are matched labels, not identical games. Results are reported per batch; no independent-sample policy comparison or difficulty claim is made.

**Set A, Social off** (the first report's commands):

```bash
JEV_ENABLED=false HAIKU_ENABLED=false npm run sim -- --games 100 --seed 1000002 --seed-set eval --seats 2 --policy random --lap-target 2 --max-steps 5000
JEV_ENABLED=false HAIKU_ENABLED=false npm run sim -- --games 100 --seed 1000002 --seed-set eval --seats 3 --policy random --lap-target 2 --max-steps 5000
JEV_ENABLED=false HAIKU_ENABLED=false npm run sim -- --games 100 --seed 1000002 --seed-set eval --seats 4 --policy random --lap-target 2 --max-steps 5000
```

**Set B, Social window on, deals required** (same seeds and limits, plus `--social --require-deals`):

```bash
JEV_ENABLED=false HAIKU_ENABLED=false npm run sim -- --games 100 --seed 1000002 --seed-set eval --seats <2|3|4> --policy random --lap-target 2 --max-steps 5000 --social --require-deals
```

Under `--social`, seat 0 plays as a human seat driven by the same seeded random policy, and the other seats are AI. `--require-deals` is documented in `sim/args.ts` and needs `--social` or `--human-seats`. All six commands exited 0 with empty stderr. Reproduce one game by replacing `--games 100 --seed 1000002` with `--games 1 --seed <game-seed>`. Raw stdout, stderr and exit codes are task evidence outside git; no logs are committed.

## Active §8 invariants

The engine registry (`engine/invariants.ts`) lists these 26 ids, all `active`. Each batch reports 0 failures against all of them.

`pvp-turn-ownership`, `attack-attempt-logged`, `coins-non-negative`, `coin-transfer-sourced`, `start-income-from-bank`, `credited-lap-monotonic`, `start-payment-precedes-sell`, `forced-movement-no-start-income`, `credited-lap-pays-once`, `uid-unique`, `uid-lifecycle-logged`, `rejected-or-stale-unchanged`, `catch-consumes-one-ball`, `replay-reproduces-state`, `game-can-finish`, `deals-atomic`, `move-debuff-until-next-move`, `tired-and-nurse-joy-useful`, `promise-closes-on-own-turn`, `resume-creates-nothing`, `ability-once-per-instance-per-lap`, `ability-once-per-player-turn`, `evolution-keeps-cooldowns`, `rescue-starter-no-coin-loop`, `battle-reward-coins-or-evolution`, `evolution-one-stage-same-uid`.

The sim reports one `invariantFailures` total, not one count per id. A zero means no id returned a failure on any accepted step. `deals-atomic` can only fire when deals happen, which is why Set B exists: Set A has 0 deals.

## Results by seat count

Win credit is split 1/k between k co-winners (§8). Seat vectors start at seat 0. Final coins are the CLI's mean per player at game end. These are observations from a random legal-action policy, not balance recommendations.

### Set A: Social off

| Seats | Games finished | Illegal applied | Invariant failures | Aborted | Ties | Tie rate | Mean turns | Mean final coins/player | Win credit by seat |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2 | 100/100 | 0 | 0 | 0 | 0 | 0 | 27.16 | 49.3 | 54 / 46 |
| 3 | 100/100 | 0 | 0 | 0 | 2 | 0.02 | 38.64 | 48.98 | 38 / 31 / 31 |
| 4 | 100/100 | 0 | 0 | 0 | 0 | 0 | 50.64 | 49.01 | 25 / 28 / 19 / 28 |

Promises and deals: 0 in all three batches, as expected with no Social window.

### Set B: Social window on, deals required

| Seats | Games finished | Illegal applied | Invariant failures | Aborted | Ties | Tie rate | Mean turns | Mean final coins/player | Win credit by seat |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2 | 100/100 | 0 | 0 | 0 | 0 | 0 | 26.98 | 52.09 | 52 / 48 |
| 3 | 100/100 | 0 | 0 | 0 | 0 | 0 | 38.7 | 48.1 | 46 / 26 / 28 |
| 4 | 100/100 | 0 | 0 | 0 | 0 | 0 | 51.12 | 49.66 | 35 / 24 / 18 / 23 |

Deal Cards (§4.8), counted from the engine's own deal events:

| Seats | Proposed | Accepted | Rejected | Countered | Cancelled | Committed |
| --- | --- | --- | --- | --- | --- | --- |
| 2 | 301 | 13 | 32 | 256 | 141 | 128 |
| 3 | 282 | 13 | 23 | 246 | 125 | 134 |
| 4 | 270 | 9 | 23 | 238 | 120 | 127 |
| Total | 853 | 35 | 78 | 740 | 386 | 389 |

So 389 deals were committed across 300 games with `deals-atomic` active, and none failed it. "Accepted" and "committed" are separate engine counts in the CLI summary and are reported as printed, not reconciled here.

Promises (the promise window is part of Social, so `promise-closes-on-own-turn` was exercised too):

| Seats | Offered | Accepted | Rejected | Broken | Kept | Closed by game end | Pending |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2 | 100 | 52 | 48 | 36 | 13 | 3 | 0 |
| 3 | 93 | 40 | 53 | 21 | 19 | 0 | 0 |
| 4 | 93 | 49 | 44 | 16 | 33 | 0 | 0 |

Each batch satisfies `accepted = broken + kept + closedByGameEnd + pending` (52 = 36+13+3+0, 40 = 21+19+0+0, 49 = 16+33+0+0) and `offered = accepted + rejected`.

## Results by class (seat and class balance)

Each participation vector is `classInSeat` from seat 0, with the batch game count in parentheses. `classInSeat` is identical in Sets A and B because rotation depends only on the game seed. Win credit columns are 2, 3 and 4 seats.

| Core class | 2-seat participation (n) | 3-seat participation (n) | 4-seat participation (n) |
| --- | --- | --- | --- |
| main-character | 17 / 16 (33) | 17 / 16 / 16 (49) | 17 / 16 / 16 / 17 (66) |
| rival | 17 / 17 (34) | 17 / 17 / 16 (50) | 17 / 17 / 16 / 16 (66) |
| fisherman | 17 / 17 (34) | 17 / 17 / 17 (51) | 17 / 17 / 17 / 16 (67) |
| nurse-joy | 17 / 17 (34) | 17 / 17 / 17 (51) | 17 / 17 / 17 / 17 (68) |
| bug-catcher | 16 / 17 (33) | 16 / 17 / 17 (50) | 16 / 17 / 17 / 17 (67) |
| researcher | 16 / 16 (32) | 16 / 16 / 17 (49) | 16 / 16 / 17 / 17 (66) |

Each class appears 16 or 17 times at every seat in each batch, the minimum possible spread because 100 is not divisible by six. Classes do not repeat within a game. Participation counts, not equal win rates, define balance.

| Core class | Set A win credit 2 / 3 / 4 seats | Set B win credit 2 / 3 / 4 seats |
| --- | --- | --- |
| main-character | 17 / 16.5 / 22 | 12 / 18 / 15 |
| rival | 24 / 32 / 35 | 22 / 26 / 31 |
| fisherman | 10 / 13 / 14 | 14 / 11 / 15 |
| nurse-joy | 25 / 17 / 12 | 19 / 22 / 22 |
| bug-catcher | 7 / 6.5 / 4 | 14 / 9 / 5 |
| researcher | 17 / 15 / 13 | 19 / 14 / 12 |

Unequal win credit is an observation of a random policy and is not a balance change request. Rival and Bug Catcher sit at the extremes in both sets at 4 seats. That is noted for the balance work, not acted on, and this evaluation set is not to be tuned against.

## Required validation

All ran on the same clean main base before the documentation was written.

| Check | Exit | Result |
| --- | --- | --- |
| `npm run sim -- --games 100 --seed 1` | 0 | Pass |
| `npm run eval:jev -- --offline` | 0 | Pass: 108/116 acceptable-set answers, 84 recorded fixtures, 0 synthetic, 84 orchestrator replays with `illegalAppliedActionCount` 0 and 18 low-confidence fallbacks |
| `npm run lint` | 0 | Pass |
| `npm run typecheck` | 0 | Pass |
| Hidden-information leak tests, focused (below) | 0 | Pass, 156/156 |
| `npm test` (kill switches unset), one full run | 1 | 3274 passed, 34 failed, mostly timeouts on a loaded machine, see below |
| The 13 files that failed, rerun with `--maxWorkers=2` | 1 | 365 passed, 4 failed, all 5 s timeouts |
| The 4 files that still failed, rerun with `--maxWorkers=1` | 0 | Pass, 178/178 |

**Leak tests.** `npx vitest run engine/observation.test.ts engine/spectator.test.ts engine/social.test.ts engine/hidden-chat-ids.test.ts engine/observation-buckets.test.ts engine/invariants.test.ts eval/jev/state-leaks.test.ts` gave 7 files, 156 tests, all passed. This covers the observation boundary, the spectator view of 25 seeded games at 2 to 4 seats, the Social window, hidden chat ids and the Jev request-construction checks. The ai-side `ai/speech/speech.test.ts` leak sweep (25 seeded games) timed out at 5 s in the full run and passed alone (see below). No leak assertion failed in any run.

**Full suite.** As in the first report, `npm test` did not pass in one run on a shared machine (load average 7 to 9 on 12 cores while it ran). Of the 34 failures, the log shows 15 explicit `Test timed out` errors (12 at the 5 s default, 3 at 60 s) and one assertion failure, `web/src/board/PlayersArea.test.tsx` ("opening and closing a seat…", `log.actions` length 1 instead of 0). I did not individually classify the other 18; the second pass cleared all but four, which are the 5 s timeouts named next, and `PlayersArea` passed on that pass. The four 5 s timeouts left after the second pass (`engine/items.test.ts`, `engine/spectator.test.ts`, `ai/fallback/fallback.test.ts`, `ai/speech/speech.test.ts`) all passed with one worker (178/178 in 17 s). No test or timeout was changed. The clean confirmation is a full-suite run on an idle machine or CI. I did not obtain one, and the `PlayersArea` failure was seen once and not reproduced, so a CI run should be watched for it.

## Failure accounting and limits

- **Illegal applied actions:** 0 in each of six batches, 0 across 600 games.
- **Invariant failures:** 0 in each of six batches, with all 26 invariants active.
- **Aborted games:** 0 in each batch. No max-step abort, no-enabled-action abort, engine/policy exception or checker exception was reported.
- **Failure seeds and details:** none; no failing game was dropped, retried or replaced.
- Random policy samples enabled choices. It does not establish coverage of every legal choice, exploit resistance, personality separation, or any Jev or Haiku behaviour. Set B's human seat is the random policy, not a person. The Jev evaluation work (#59), the browser UI, Hard AI and new rules remain out of scope.
- This closes the numerical 300-game exit signal for #58. It does not certify the C5 1,000-policy / 300-live-Jev evidence set, and the full-suite pass above still needs an unloaded run.
