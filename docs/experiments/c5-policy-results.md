# C5 policy-only results

Epic [#61](https://github.com/AokDesu/poke-monopoly/issues/61), A61-6. Spec §8 (Critic and Simulation), §9 (sim limits), §10 C5.

**1,008/1,008 held-out games finished with 504 complete seed pairs, 0 illegal applied actions and 0 active-invariant failures.** The plan flagged zero dominance candidates across the 2-, 3- and 4-seat contexts.

## Run record

The engine and policy base was main `1456099ab161da848dd8fe0e95bf3be5d89f532e` (engine 0.20.0, content 1.3.0). Main already contained the combat and economy policies, paired analysis, seed manifest, and per-seat runner. The training matrix and the held-out run used `5b9661923006809e746053191d1dad1705d1bfd4`, which records the analysis and coverage in the [experiment plan](c5-policy-plan.md). Both runs used identical engine, content, policies, schedule and runner code.

Both runs used Node v24.22.3, the six core classes, Quick 2 Laps and a 5,000-step limit. The control focal seat played seeded `random` and the treatment focal seat played the named exploit. Other seats played the same policies across the two arms. The Social window was enabled in both never-negotiate arms. Seat 0 then used the human controller and was still played by a policy. Both server keys were absent and Jev and Haiku were disabled.

| Set | Seed range | Games recorded | Finished | Replay passed | Complete pairs | Missing pairs | Aborted | Illegal applied | Invariant failures |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Training | 101,004–101,487 | 168 | 168 | 168 | 84 | 0 | 0 | 0 | 0 |
| Held out | 1,100,004–1,100,507 | 1,008 | 1,008 | 1,008 | 504 | 0 | 0 | 0 | 0 |

The training matrix checked four pairs per policy and seat count before the evaluation opened. Its seed range gives the minimum and maximum played seeds, with gaps for blocks outside the training subset. The schedule, replays and Social opportunities passed the training checks, so all seven registered decision rules were used as written. An earlier serial training pilot was stopped for runtime, and its 126 completed rows were retained separately.

| Seats | Control offer | Control response | Treatment offer | Treatment response |
| --- | --- | --- | --- | --- |
| 2 | 56 | 0 | 59 | 0 |
| 3 | 27 | 2 | 24 | 2 |
| 4 | 49 | 0 | 51 | 0 |

The evaluation run opened on 2026-11-20 at 10:22:03 UTC. All 1,008 planned games ran once in it, with zero failing seeds. It was not the first time games in the held-out range had been played. On 2026-11-18 an accidental test run played the 144 `sell-all` held-out games (seeds 1,100,148 to 1,100,219) and discarded the rows unread. Under plan rule 1 that run opened the range. Nothing was changed because of it, and the `sell-all` rows reported here come only from the evaluation run. The [seed-use ledger](c5-policy-plan.md#seed-use-ledger) gives its time, commit and what is and is not known about it. The C4 published and C5 contingency ranges were unused.

### Reproduce

From the run revision above, use these commands to reproduce the exact manifest and game rows.

```bash
output_dir=$(mktemp -d)
env -u TYPESAFE_API_KEY -u ANTHROPIC_API_KEY JEV_ENABLED=false HAIKU_ENABLED=false \
  npm run experiment -- --seed-base 101004 --blocks 0-3 --out "$output_dir/train-games.jsonl"
env -u TYPESAFE_API_KEY -u ANTHROPIC_API_KEY JEV_ENABLED=false HAIKU_ENABLED=false \
  npm run experiment -- --held-out --out "$output_dir/held-out-games.jsonl"
```

For the recorded runs, cells were played in separate processes with `--policy` and `--seats`, then concatenated in manifest order. The combined command above uses that same order. For a single game, also pass `--blocks <block>-<block> --arms <arm>`. The sanitized game rows, pair rows and analysis output for both runs are committed in [`c5-policy-evidence/`](c5-policy-evidence/README.md), with the script that produced the pair rows and analysis.

| SHA-256 | Training | Held out |
| --- | --- | --- |
| Manifest at run time (`5b96619`) | `3ddcf8b108f67867fdb4282ebb9a3c3dc3bcaba63fc2f5d83e11143e38d85c9b` | same manifest |
| Game rows in manifest order | `bedf084624e06685c054df7e1ee2040ca5c5dc0276ae4c873103c031a0d38ae0` | `c2119dcf5f77654e6effba8c92b7300e880d615568b737af557f1bd94015ba15` |
| Pair rows | `f7e444c09b47a0d1e5e7168e034c05bd82260a5c0453c6f8bab676a911c3e5af` | `6b3eed2a31d4d6c957ccc17c64a77fed9965ffbc37e2777b8cddfbf9db4f4dff` |
| Analysis output | `3bf6c430c163ac92c065c1c86240051c7ac2e7c05e773f27c9bd197f6dee06c0` | `397d8caa5fad52102072a18d0c4ee371e89aad0945409115a856e05b6f2f0cd4` |

Analyze the held-out rows using the merged `toPairedRecord` adapter and `analyzePaired`:

```bash
node --import tsx --input-type=module - "$output_dir/held-out-games.jsonl" <<'JS'
import { readFileSync } from 'node:fs';
import { analyzePaired } from './sim/analysis/paired.ts';
import { toPairedRecord } from './sim/experiments/run.ts';

const games = readFileSync(process.argv[2], 'utf8').trim().split('\n').map(JSON.parse);
const records = games.map(toPairedRecord);
const result = analyzePaired(records, {
  seedSet: 'eval',
  analysisSeed: 610004,
  resamples: 10000,
  confidence: 0.95,
});
console.log(JSON.stringify(result, null, 2));
JS
```

## Held-out balance

The audit matched every game row to its manifest seed, arm, seat assignments and policy schedule. Each policy and seat count followed the schedule below in both arms. Scheduled personality counts describe the assignment for non-focal AI seats. When a non-focal human controller played `random`, the observed personality was `unassigned`. In two-seat Social games with the AI focal, that human controller was its only background.

| Seats | Blocks by focal seat | Focal classes | Scheduled backgrounds | Seat × class groups | Seat × background groups |
| --- | --- | --- | --- | --- | --- |
| 2 | 12 / 12 | 6 at 4 each | 4 at 6 each | 12 at 2 each | 8 at 3 each |
| 3 | 8 / 8 / 8 | 6 at 4 each | 4 at 6 each | 12 at 1 each, 6 at 2 each | 12 at 2 each |
| 4 | 6 / 6 / 6 / 6 | 6 at 4 each | 4 at 6 each | 24 at 1 each | 8 at 1 each, 8 at 2 each |

## Paired win credit and ties

A block is one seed played twice. Only the focal seat is scored. Win credit is 1 for a solo win, 1/k for a share among k winners, and 0 for a loss. All effects are treatment minus control, with C and T denoting the two arms. Win credits and game tie rates are percentages. Game ties count any game with co-winners. The paired win-credit difference is in percentage points (pp), and paired d divides the mean block difference by its sample standard deviation.

The 95% percentile intervals use 10,000 paired bootstrap resamples with analysis seed 610004. Whole blocks are sampled within focal seat at the given seat count, holding the seat mix fixed. The two arms share a starting state and diverge when their decisions differ.

| Policy | Seats | Planned | Complete (n) | Missing | C credit % | T credit % | Δ pp | 95% CI pp | Paired d | C ties % | T ties % |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `always-pvp` | 2 | 24 | 24 | 0 | 31.25 | 33.33 | 2.08 | [-25.00, 27.08] | 0.03 | 4.17 | 0.00 |
| `always-pvp` | 3 | 24 | 24 | 0 | 33.33 | 29.17 | -4.17 | [-29.17, 20.83] | -0.06 | 0.00 | 0.00 |
| `always-pvp` | 4 | 24 | 24 | 0 | 37.50 | 31.25 | -6.25 | [-27.08, 14.58] | -0.10 | 0.00 | 4.17 |
| `force-weak-target` | 2 | 24 | 24 | 0 | 33.33 | 41.67 | 8.33 | [0.00, 20.83] | 0.30 | 0.00 | 0.00 |
| `force-weak-target` | 3 | 24 | 24 | 0 | 25.00 | 20.83 | -4.17 | [-16.67, 8.33] | -0.12 | 0.00 | 0.00 |
| `force-weak-target` | 4 | 24 | 24 | 0 | 29.17 | 29.17 | 0.00 | [-8.33, 8.33] | 0.00 | 0.00 | 0.00 |
| `sell-all` | 2 | 24 | 24 | 0 | 58.33 | 50.00 | -8.33 | [-25.00, 8.33] | -0.20 | 0.00 | 0.00 |
| `sell-all` | 3 | 24 | 24 | 0 | 37.50 | 27.08 | -10.42 | [-29.17, 8.33] | -0.20 | 0.00 | 4.17 |
| `sell-all` | 4 | 24 | 24 | 0 | 35.42 | 41.67 | 6.25 | [-12.50, 25.00] | 0.11 | 4.17 | 0.00 |
| `keep-to-evolve` | 2 | 24 | 24 | 0 | 50.00 | 37.50 | -12.50 | [-33.33, 8.33] | -0.23 | 0.00 | 0.00 |
| `keep-to-evolve` | 3 | 24 | 24 | 0 | 27.08 | 29.17 | 2.08 | [-12.50, 16.67] | 0.06 | 4.17 | 4.17 |
| `keep-to-evolve` | 4 | 24 | 24 | 0 | 25.00 | 14.58 | -10.42 | [-25.00, 4.17] | -0.22 | 4.17 | 4.17 |
| `immediate-ability` | 2 | 24 | 24 | 0 | 27.08 | 52.08 | 25.00 | [8.33, 43.75] | 0.54 | 4.17 | 4.17 |
| `immediate-ability` | 3 | 24 | 24 | 0 | 29.17 | 41.67 | 12.50 | [-12.50, 37.50] | 0.20 | 0.00 | 0.00 |
| `immediate-ability` | 4 | 24 | 24 | 0 | 37.50 | 37.50 | 0.00 | [-25.00, 20.83] | 0.00 | 0.00 | 0.00 |
| `ultra-only` | 2 | 24 | 24 | 0 | 29.17 | 31.25 | 2.08 | [-12.50, 18.75] | 0.05 | 0.00 | 4.17 |
| `ultra-only` | 3 | 24 | 24 | 0 | 37.50 | 41.67 | 4.17 | [-18.75, 27.08] | 0.06 | 8.33 | 4.17 |
| `ultra-only` | 4 | 24 | 24 | 0 | 29.17 | 20.83 | -8.33 | [-20.83, 4.17] | -0.20 | 0.00 | 8.33 |
| `never-negotiate` | 2 | 24 | 24 | 0 | 50.00 | 41.67 | -8.33 | [-29.17, 12.50] | -0.14 | 0.00 | 0.00 |
| `never-negotiate` | 3 | 24 | 24 | 0 | 58.33 | 54.17 | -4.17 | [-20.83, 12.50] | -0.09 | 0.00 | 0.00 |
| `never-negotiate` | 4 | 24 | 24 | 0 | 29.17 | 41.67 | 12.50 | [0.00, 25.00] | 0.37 | 0.00 | 0.00 |

All 504 planned pairs scored. The Deal Card checker remained pending on this revision.

## Focal outcomes and coins

W/T/L counts are sole wins, shared wins and losses **of the focal seat**. Final coins include the game-end auto-sale. Each row uses the same complete pairs as the win-credit table. The [strata CSV](c5-policy-strata.csv) gives the corresponding n, scores, tie rates and coin effects by focal seat, focal class and actual background-personality combination. These small strata are descriptive. Blank CSV intervals mark a resampling group with fewer than two complete blocks. A blank paired d denotes an undefined standard deviation or a zero standard deviation.

| Policy | Seats | C W/T/L | T W/T/L | C coins | T coins | Δ coins | 95% CI coins | Paired d |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `always-pvp` | 2 | 7/1/16 | 8/0/16 | 42.42 | 48.12 | 5.71 | [-2.46, 14.38] | 0.27 |
| `always-pvp` | 3 | 8/0/16 | 7/0/17 | 47.92 | 42.25 | -5.67 | [-15.00, 3.46] | -0.22 |
| `always-pvp` | 4 | 9/0/15 | 7/1/16 | 49.54 | 49.88 | 0.33 | [-8.33, 8.79] | 0.01 |
| `force-weak-target` | 2 | 8/0/16 | 10/0/14 | 47.92 | 52.00 | 4.08 | [0.12, 9.21] | 0.35 |
| `force-weak-target` | 3 | 6/0/18 | 5/0/19 | 43.83 | 40.46 | -3.38 | [-6.21, -0.92] | -0.49 |
| `force-weak-target` | 4 | 7/0/17 | 7/0/17 | 47.88 | 48.42 | 0.54 | [-2.12, 3.38] | 0.07 |
| `sell-all` | 2 | 14/0/10 | 12/0/12 | 48.50 | 52.46 | 3.96 | [0.67, 7.12] | 0.47 |
| `sell-all` | 3 | 9/0/15 | 6/1/17 | 47.79 | 47.08 | -0.71 | [-7.75, 5.92] | -0.04 |
| `sell-all` | 4 | 8/1/15 | 10/0/14 | 46.92 | 51.46 | 4.54 | [-0.96, 10.12] | 0.31 |
| `keep-to-evolve` | 2 | 12/0/12 | 9/0/15 | 47.50 | 42.00 | -5.50 | [-11.38, 0.38] | -0.36 |
| `keep-to-evolve` | 3 | 6/1/17 | 7/0/17 | 44.71 | 44.42 | -0.29 | [-3.92, 3.54] | -0.03 |
| `keep-to-evolve` | 4 | 6/0/18 | 3/1/20 | 49.00 | 43.75 | -5.25 | [-8.92, -1.50] | -0.45 |
| `immediate-ability` | 2 | 6/1/17 | 12/1/11 | 46.25 | 50.88 | 4.62 | [-2.88, 12.08] | 0.24 |
| `immediate-ability` | 3 | 7/0/17 | 10/0/14 | 43.75 | 51.33 | 7.58 | [-0.08, 15.50] | 0.38 |
| `immediate-ability` | 4 | 9/0/15 | 9/0/15 | 48.33 | 51.12 | 2.79 | [-3.08, 8.75] | 0.17 |
| `ultra-only` | 2 | 7/0/17 | 7/1/16 | 46.29 | 44.29 | -2.00 | [-6.62, 2.88] | -0.16 |
| `ultra-only` | 3 | 8/2/14 | 10/0/14 | 50.25 | 48.83 | -1.42 | [-6.96, 4.46] | -0.09 |
| `ultra-only` | 4 | 7/0/17 | 5/0/19 | 45.21 | 45.50 | 0.29 | [-4.12, 4.83] | 0.02 |
| `never-negotiate` | 2 | 12/0/12 | 10/0/14 | 44.50 | 45.17 | 0.67 | [-7.29, 8.79] | 0.03 |
| `never-negotiate` | 3 | 14/0/10 | 13/0/11 | 55.71 | 55.58 | -0.12 | [-5.96, 6.38] | -0.01 |
| `never-negotiate` | 4 | 7/0/17 | 10/0/14 | 45.25 | 49.25 | 4.00 | [2.12, 6.42] | 0.61 |

## Exploit opportunities

Each entry gives focal uses / enabled decision opportunities. For never negotiate, `offer` measures skipping when chat or a promise offer was enabled and `respond` measures rejecting an enabled promise response. The vacuity check uses the control arm's opportunities. The Social results cover chat and promises on this build. Deal Card legality remains pending. [Deal Cards issue](https://github.com/AokDesu/poke-monopoly/issues/164)

Force-weak-target control opportunities and uses are unavailable. The treatment requests the challenge-source facts needed by the recorder. The control plays `random` without those facts. Win credit, coins and ties are scored from the completed outcomes of both arms.

| Policy | Seats | Control uses / opportunities | Treatment uses / opportunities | Vacuous |
| --- | --- | --- | --- | --- |
| `always-pvp` | 2 | challenge 146/349 | challenge 323/323 | — |
| `always-pvp` | 3 | challenge 177/330 | challenge 305/305 | — |
| `always-pvp` | 4 | challenge 201/315 | challenge 303/303 | — |
| `force-weak-target` | 2 | Unavailable | force 8/8 | — |
| `force-weak-target` | 3 | Unavailable | force 11/11 | — |
| `force-weak-target` | 4 | Unavailable | force 10/10 | — |
| `sell-all` | 2 | sell 32/41 | sell 41/41 | — |
| `sell-all` | 3 | sell 17/33 | sell 30/30 | — |
| `sell-all` | 4 | sell 25/35 | sell 37/37 | — |
| `keep-to-evolve` | 2 | evolve 12/19, keep 15/37 | evolve 24/24, keep 36/36 | — |
| `keep-to-evolve` | 3 | evolve 21/34, keep 11/34 | evolve 42/42, keep 33/33 | — |
| `keep-to-evolve` | 4 | evolve 26/34, keep 10/32 | evolve 38/38, keep 32/32 | — |
| `immediate-ability` | 2 | ability 64/134 | ability 72/72 | — |
| `immediate-ability` | 3 | ability 55/144 | ability 77/77 | — |
| `immediate-ability` | 4 | ability 72/179 | ability 75/75 | — |
| `ultra-only` | 2 | ultra 11/56 | ultra 62/62 | — |
| `ultra-only` | 3 | ultra 10/52 | ultra 58/58 | — |
| `ultra-only` | 4 | ultra 7/45 | ultra 50/50 | — |
| `never-negotiate` | 2 | offer 10/164, respond 4/16 | offer 155/155, respond 15/15 | No |
| `never-negotiate` | 3 | offer 1/104, respond 4/9 | offer 102/102, respond 9/9 | No |
| `never-negotiate` | 4 | offer 1/73, respond 2/5 | offer 74/74, respond 5/5 | No |

## Hostile items and promises

Hostile items are counted across all seats and policies at each seat count (168 games per arm). Each entry is hostile-item uses / legal opportunities, with one opportunity per eligible seat turn. Lap is the acting seat's credited Lap. A dash means no opportunities or uses. Counts and eligibility follow the [sim metric definitions](../sim.md#hostile-items-and-promises).

| Personality | Lap | 2 seats C | 2 seats T | 3 seats C | 3 seats T | 4 seats C | 4 seats T |
| --- | --- | --- | --- | --- | --- | --- | --- |
| aggressive | 0 | 8/76 | 11/74 | 24/143 | 27/151 | 40/200 | 40/195 |
| aggressive | 1 | 9/87 | 6/70 | 19/119 | 23/121 | 35/180 | 30/155 |
| cautious | 0 | 7/74 | 7/72 | 13/135 | 14/146 | 22/227 | 16/212 |
| cautious | 1 | 3/90 | 4/82 | 12/157 | 16/172 | 15/240 | 7/246 |
| greedy | 0 | 6/68 | 4/70 | 7/140 | 12/137 | 19/216 | 19/218 |
| greedy | 1 | 2/59 | 3/68 | 7/150 | 5/125 | 16/209 | 18/224 |
| opportunist | 0 | 17/77 | 10/71 | 24/136 | 21/136 | 33/213 | 35/220 |
| opportunist | 1 | 15/81 | 11/71 | 11/131 | 26/137 | 29/213 | 21/197 |
| unassigned | 0 | 66/194 | 58/217 | 100/206 | 69/204 | 92/202 | 79/234 |
| unassigned | 1 | 50/150 | 41/208 | 55/105 | 37/131 | 64/144 | 47/189 |

Promises are counted across all seats in the Social window games. The engine recorded a breach opportunity for 10 of 60 accepted promises. This counter covers public hostile items and hostile Abilities. A PvP declaration can break a promise and is outside that opportunity counter. [Sim metric definitions](../sim.md#hostile-items-and-promises)

| Seats | Arm | Games | Offered | Accepted | Rejected | Broken | Kept with chance | Kept without chance | Closed at game end | Breach opportunity | Pending |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2 | control | 24 | 35 | 19 | 16 | 7 | 3 | 8 | 1 | 4 | 0 |
| 2 | treatment | 24 | 15 | 0 | 15 | 0 | 0 | 0 | 0 | 0 | 0 |
| 3 | control | 24 | 32 | 19 | 13 | 4 | 4 | 9 | 2 | 5 | 0 |
| 3 | treatment | 24 | 18 | 4 | 14 | 1 | 0 | 2 | 1 | 1 | 0 |
| 4 | control | 24 | 28 | 11 | 17 | 4 | 0 | 6 | 1 | 0 | 0 |
| 4 | treatment | 24 | 21 | 7 | 14 | 3 | 0 | 3 | 1 | 0 | 0 |

## Critic readout

Intervals wholly above zero: `immediate-ability` at 2 seats. Intervals wholly below zero: none. A bound equal to zero counts as including zero. A candidate needs an interval wholly above zero at all three seat counts. The intervals are unadjusted across the 21 comparisons.

| Policy | Above zero | Includes zero | Below zero | Unavailable | Candidate |
| --- | --- | --- | --- | --- | --- |
| always-pvp | 0 | 3 | 0 | 0 | No |
| force-weak-target | 0 | 3 | 0 | 0 | No |
| sell-all | 0 | 3 | 0 | 0 | No |
| keep-to-evolve | 0 | 3 | 0 | 0 | No |
| immediate-ability | 1 | 2 | 0 | 0 | No |
| ultra-only | 0 | 3 | 0 | 0 | No |
| never-negotiate | 0 | 3 | 0 | 0 | No |

Immediate Ability at two seats gained 25 percentage points of focal win credit (95% CI 8.33 to 43.75, n = 24). The other 20 intervals include zero and leave the direction of the effect unresolved. The readout applies to these seat counts, the configured backgrounds and the seeded random control.
