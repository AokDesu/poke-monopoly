# G2: Hard against Normal

Spec: v1.0 §5.6 (Difficulty), §8 (Simulation: Difficulty), §10 (C5, gate G2, due 6 Dec). Epic [#62](https://github.com/AokDesu/poke-monopoly/issues/62). Plan data: [`sim/experiments/g2-plan.json`](../../sim/experiments/g2-plan.json). Runner and analysis: `npm run experiment:g2` (`sim/experiments/g2.ts`, usage in [sim/README.md](../../sim/README.md)).

**Status: planned, not run.** Every results table below is empty. The only games played so far are an offline dry run on the seeded fake Jev client (see [Dry run](#dry-run-plumbing-only-not-evidence)), which says nothing about Hard or Normal.

## Question

Does Hard (the engine's Monte Carlo rollouts add expected-outcome buckets to each Strategy and Encounter option before the argmax) beat Normal with evidence, and does it decide inside the latency budget? If yes, keep three levels. Otherwise ship two (Easy and Normal) and say so plainly. Spec §8: if Hard does not beat Normal, never add hidden information to make the graph pass. Hard's rollouts read only the deciding seat's own observation; this plan changes nothing about that, and changes none of the rollout defaults (16 worlds, at least 4, 400 ms).

## Design

- **Block:** one held-out seed with one focal seat. **Two games per block.** Treatment: `jev-hard` at the focal seat, `jev` (Normal) at the other seat. Control: `jev` at both seats. Every seat is Greedy and every seat decides through the Jev orchestrator, so difficulty is the one difference. The control game is played again for each block. The two blocks of a seed have the same control configuration (Normal on both seats, same seed, classes and Starters), so they are not fully independent: on a deterministic client the two control games are the same game, and live they share a start but not Jev's answers. The analysis resamples blocks as if independent, which can make the stated interval too narrow when the two control scores agree. The report therefore prints the same difference with whole seeds resampled, as a sensitivity (not part of the rule), so the reader can see how far it moves.
- **Rotation:** each seed makes one block per seat, so Hard sits in every seat for every seed and a seat or class advantage cancels. The 198 seeds are 33 whole class rotations, so every class takes every seat equally often.
- **Seats:** two (a duel). Three- and four-seat tables are not tested (a stated limit).
- **Seeds:** 1,300,002 to 1,300,199, held-out (`--seed-set eval` range, 1,000,000 and up). Disjoint from every range in the C5 seed ledger, and never tuned on; the live run is the first use. A test checks the disjointness against `c5-plan.json`.
- **Score:** k co-winners score 1/k each (§8). The paired effect is the mean over blocks of Hard's focal-seat score minus Normal's, through `sim/analysis/paired.ts` (`analyzePaired`): stratified percentile bootstrap over blocks within (seat count, focal seat) cells, 10,000 resamples, 95% interval.
- **Win, tie, loss:** reported for Hard in the treatment arm (against Normal) beside Normal in the control arm.
- **Not covered:** the sim sends no Sell Phase question (no Sell facts yet), so Sell decisions use the fallback on both difficulties. Hard's rollouts act only on Strategy and Encounter, so every decision where Hard differs from Normal is in the duel.

## Pre-registered verdict rule

Written before any live game, and held in `g2-plan.json` (`rule`), which the analysis code reads. Changing it means a new plan version, never a change after a result. Thresholds marked **captain to confirm** are proposed defaults.

1. **Integrity (else no verdict).** Every row is from the live service. Every planned block has both rows. `illegalAppliedActionCount = 0`, invariant failures 0, replay failures 0, no decision fell back on a spent budget, and aborted pairs are at most 2% of planned blocks. **Jev must have answered (plan v2, see [Plan v2](#plan-v2-decided-from-the-smoke-runs-integrity-check-not-its-effect-estimate)):** for Hard and for Normal each, decisions where Jev returned a valid answer (applied, or below the confidence threshold) are at least **0.80** of the decisions sent to Jev, with `missing_facts` decisions left out of the denominator, and decisions lost to the service, network or key (`timeout`, `network`, `auth`, `rate_limited`, `server_error`, `disabled`) are at most **0.05** (*captain to confirm*). Hard's own `timeout` is left out of Hard's share, because Hard's rollouts spend part of the deadline and the latency rule (3) judges that against Normal's; Normal has no rollout, so all its listed causes count. The report prints both numbers by difficulty and cause in the check detail. Without these checks an outage (service down, key refused, every request timing out) makes every decision fall back for both difficulties, the arms look alike, and the rule would read it as "Hard is no better". Anything else: no G2 verdict; fix the cause and play again on fresh seeds.
2. **Evidence.** The 95% interval of the paired score difference (Hard minus Normal) has its lower bound above 0, **and** the point estimate is at least **0.05** (*captain to confirm*: half of the 0.10 gap the run is sized for).
3. **Latency** (Hard, over decisions that involved Jev): decision p95 at most **1,500 ms** (§5.6), AI turn p95 at most **2,000 ms** (§1 target), and Hard's share of decisions that fall back on a timeout exceeds Normal's by at most **0.02** (*captain to confirm*).
4. **Verdict.** Integrity, evidence and latency all hold: **keep three levels**. Integrity holds and evidence or latency fails: **ship two levels** (Easy and Normal; cut Monte Carlo per §10 "Cut if late"), and the report says which part failed. A failure to show evidence at this n is reported as "not shown", not as "Hard is worse".

Never to do after a result: add hidden information, change what Hard's rollouts read, or retune the rollout defaults to move the verdict. Interim looks at partial rows are labelled and carry no verdict; the analysis refuses one.

## Power and the n to run

Per block, the score difference is two games, each close to a win-or-lose score with variance about 0.25 at two seats, so SD ≈ 0.7071 (a correlation between the arms from the shared seed would lower it; none is assumed; the two blocks of a seed share their control configuration, so a seed's mean difference can vary more than this, see Design). Two-sided 5% test, 80% power: blocks = ((1.96 + 0.84) × 0.7071 / gap)². A seed gives two blocks and four games. Seeds are rounded up to whole class rotations (multiples of 6).

Requests and THB per game are **from the offline dry run, not from live**: 24.5 Jev requests per game (589 requests over 24 games; the fake client changes answers, not how many requests a game asks for, but a live game may run longer or shorter). `logs/jev-usage.jsonl` is absent in this copy, so the price per request is the spec's: 3,242 input tokens per request (`docs/jev-spike-report.md`, 26 Oct live pair; `SPEND_CONFIG` carries 3,240), $0.042 per million input tokens, THB 33 per USD (`ai/jev/spend.ts`), so about **THB 0.0045 per request, THB 0.110 per game**. The live run measures the real figures in the usage log.

| Assumed score gap (Hard 0.5 + gap) | Blocks | Seeds | Games | Power at 198 seeds | Jev requests | Est. THB |
|---|---|---|---|---|---|---|
| 0.05 (55 in 100) | 1,570 | 786 | 3,144 | 0.29 | 77,028 | 347 |
| 0.075 | 698 | 354 | 1,416 | 0.56 | 34,692 | 156 |
| **0.10 (60 in 100)** | **393** | **198** | **792** | **0.80** | **19,404** | **87** |
| 0.15 | 175 | 90 | 360 | 0.99 | 8,820 | 40 |
| 0.20 | 99 | 54 | 216 | 1.00 | 5,292 | 24 |

**Recommended n: 198 seeds (396 blocks, 792 games), powered for a 0.10 gap**, estimated THB 87 and about 19,400 requests, 6% of the THB 1,500 total AI cap (Haiku's THB 150 is separate and unused here). Money is not the limit; wall time is, and it is not yet measured live (guess: one second or less per Jev decision at about 25 requests a game). The smallest useful gap is a product call (**captain to confirm**; the plan assumes 0.10). A gap between 0.05 and 0.10 is under-powered at 198 seeds and would end as "not shown". To size for 0.075 instead, raise `seeds.count` and `seedLedger` in the plan to 354 seeds before the run. n is fixed before the run; the captain may play a prefix with `--seeds k` only by choosing k before the first live game. Each row records the `--seeds` it was played under, and `--analyze` refuses a different `--seeds` (so a run stopped half way is never read as a smaller plan) and a rows file started for another n is never continued.

## Run order

1. **Merge this PR** with the thresholds above confirmed (or changed in the plan before merge): the plan is frozen on merge, and a change after it is a new plan version.
2. **Live smoke run on tuning seeds (not held-out)**, below. It spends about THB 3 (24 games at about THB 0.11), shows that Jev answers (the answered share and the infrastructure share of the check detail), what the real latency is on this machine, and the real requests and THB per game from `logs/jev-usage.jsonl`. Its output is labelled `not-evidence: tuning seeds` and carries no verdict. If the answered share is far from the floor (0.80 since plan v2), or the latency is far from what the plan assumes, change the plan (new version) **before** step 3: the held-out seeds are still unopened.
3. **The held-out run**, below, played once.

Smoke run (tuning seeds 100,200 to 100,205, 6 seeds, 24 games):

```powershell
npx tsx --require $NoPqTls --env-file=.env sim/experiments/g2-cli.ts --seed-base 100200 --seeds 6 --max-thb 10 --out logs/g2-smoke.rows.jsonl
npx tsx --env-file=.env sim/experiments/g2-cli.ts --seed-base 100200 --seeds 6 --analyze --out logs/g2-smoke.rows.jsonl
```

## Plan v2, decided from the smoke run's integrity check, not its effect estimate

Spec: v1.0 §8, §10 (C5). Part of [#62](https://github.com/AokDesu/poke-monopoly/issues/62). The captain released plan version 2 after the live smoke run, before the held-out run (the held-out seeds, 1,300,002 to 1,300,199, are still unopened, which this plan allows: a new version before any held-out game). `g2-plan.json` `version` goes from 1 to 2. The decision rests on the smoke run's integrity check only; no effect estimate of the smoke run was used.

**Reason.** The smoke run (tuning seeds 100,200 to 100,205, 24 games, live) failed the v1 `jev-answered` check: hard **0.364 of 165** decisions, normal **0.244 of 464**, against the floor of 0.30. The infrastructure fallbacks were 0.000. The misses were `low_confidence` (hard 0.545, normal 0.664) and `missing_facts` (hard 0.091, normal 0.093). The check was meant to catch outages, but v1 counted our own low-confidence fallback and the Sell decisions the sim never sends to Jev as if Jev had not answered.

**What changes (only this).**

- `jev-answered` = decisions where Jev returned a valid answer (applied, or below the confidence threshold), over decisions actually sent to Jev. `missing_facts` decisions are left out of the denominator.
- Floor **0.80** per difficulty (v1: 0.30).
- The plan carries the two cause lists the check reads: `jevAnsweredValidCauses` (`low_confidence`) and `jevAnsweredNotSentCauses` (`missing_facts`).

**Cause by cause (from the `DecisionStats` counts recorded in each row's `seatStats`).** `decisions` counts every decision that is not `auto`; each fallback adds `fallback:<cause>`.

| Recorded as | In the denominator | In the numerator |
|---|---|---|
| no fallback (Jev answered, its choice was applied) | yes | yes |
| `fallback:low_confidence` (Jev answered validly, below the threshold, the fallback decided) | yes | yes |
| `fallback:missing_facts` (no facts for the question, e.g. the Sell Phase the sim never asks; no request went to Jev) | **no** | no |
| `fallback:invalid_choice`, `schema_mismatch`, `revision_mismatch` (Jev answered, not usably) | yes | no |
| `fallback:timeout`, `network`, `auth`, `rate_limited`, `server_error`, `disabled` (infrastructure) | yes | no |
| `fallback:request_limit`, `token_budget`, `budget_exceeded` (our own limits) | yes | no |
| `auto` (one legal action, or no question) | not counted | not counted |

The rows record causes per decision as counts, not whether a request left the process for each decision, so "sent to Jev" is read from the cause. `request_limit`, `token_budget` and `budget_exceeded` are kept in the denominator: the counts cannot tell a decision that never sent a request from one that sent some and then hit the limit, and keeping them in can only make the check stricter. `budget_exceeded` is held at zero by its own check anyway. Hard's rollouts count the same way: Hard's own timeouts stay in Hard's denominator and out of its numerator, and stay out of Hard's infrastructure share as in v1.

**Unchanged:** the 0.10 gap and n (198 seeds), the seeds, the 0.05 evidence floor (`minPointEstimate`) and its 95% interval rule, the latency rule (1,500 ms, 2,000 ms, 0.02 timeout excess), the infrastructure check (`timeout`, `network`, `auth`, `rate_limited`, `server_error`, `disabled`, at most 0.05), and the low-confidence threshold (not touched: it lives in `ai/`).

**Rows written under v1.** The plan's SHA-256 is stored in every row, and the runner and `--analyze` refuse rows of another plan version ("the rows were played under another version of the plan"). So v1 rows, including `logs/g2-smoke.rows.jsonl`, are never analysed under the v2 rules by accident, and a v1 rows file is not continued: use a new `--out` for any run under v2. The v1 plan file still parses and reads as v1 (the two cause lists default to empty, which is the v1 definition), so v1 rows can be re-read under their own rules with `--plan <v1 plan file>` (`git show 44b02db:sim/experiments/g2-plan.json`); they cannot be read under v2 without playing the games again. The held-out run is the first to be played under v2.

**Tests.** A 100% `fallback:timeout` run still gives no verdict under v2 (it fails `jev-answered` and `infrastructure-fallbacks`). A synthetic row set shaped like the smoke run (hard 165 decisions, normal 464, with its `low_confidence` and `missing_facts` shares; synthetic, not the smoke rows) passes under v2, where v1 read 0.364 and 0.244.

## Live command (captain, Windows PowerShell, with the key)

Run from the repository root. `.env` holds the Jev key; it is never printed or committed. The run needs the no-pq-tls preload that the captain already uses: set `$NoPqTls` to its path (I do not have that file; it is not in the repository). `--held-out` is refused unless the key is in the environment and `JEV_ENABLED` is not `false`.

```powershell
$NoPqTls = "<path to your no-pq-tls preload .cjs>"
npx tsx --require $NoPqTls --env-file=.env sim/experiments/g2-cli.ts --held-out --max-thb 150 --out logs/g2-hard-vs-normal.rows.jsonl
```

- One process plays the 792 games in order, seed by seed, so a stop leaves whole pairs. Press Ctrl+C at any time and rerun the same command: games already in the rows file are skipped, and a half-written last line is ignored. A game cut off mid-play leaves no row and is played again.
- `--max-thb 150` stops before the next game once the run's measured spend reaches THB 150 (about 1.7 times the estimate), exit code 3; rerun to resume. The spend guard (§9) also stops it at the THB 1,500 cap.
- To split the work over several processes, add `--shard 0/3`, `--shard 1/3`, `--shard 2/3` with a different `--out` for each. Keep shards at or below the physical cores minus one: Hard's rollouts are CPU work, and a saturated machine inflates the latency percentiles.
- Games are the only load on the machine while measuring latency; close other heavy work.

Then analyse (add `--rows a.jsonl,b.jsonl` for shards, and `--json logs/g2-report.json` for the data):

```powershell
npx tsx --env-file=.env sim/experiments/g2-cli.ts --held-out --analyze --out logs/g2-hard-vs-normal.rows.jsonl --json logs/g2-report.json
```

Rows and reports live under `logs/` (git-ignored) and are not committed; paste the analysis output into the tables below.

## Results (to fill after the live run)

Run date, commit, machine and `--seeds` used: _empty_.

**Verdict:** _empty_.

| Check | Pass | Detail |
|---|---|---|
| live, complete, illegalAppliedActionCount, invariantFailures, replay, spend, jev-answered, infrastructure-fallbacks, aborts | | |
| evidence-interval, evidence-size | | |
| latency-decision-p95, latency-turn-p95, latency-timeouts | | |

Win, tie and loss (score = 1/k per co-winner):

| Arm | n | Wins | Ties | Losses | Score |
|---|---|---|---|---|---|
| Hard (treatment, vs Normal) | | | | | |
| Normal (control, vs Normal) | | | | | |

| Paired effect, Hard minus Normal | Mean | 95% interval |
|---|---|---|
| Score | | |
| Sole-win rate | | |
| Standardized score effect (paired d) | | |
| Score, whole seeds resampled (sensitivity, not part of the rule) | | |

| Focal seat | n | Score difference | 95% interval |
|---|---|---|---|
| 0 | | | |
| 1 | | | |

Decision latency and fallbacks (Hard's rollouts limited to 400 ms inside the 1,500 ms deadline):

| Difficulty | Decisions | Requests | p50 / p95 / max decision | p50 / p95 AI turn | Fallback rate | Invalid-output rate |
|---|---|---|---|---|---|---|
| Hard | | | | | | |
| Normal | | | | | | |

| Fallback cause | Hard | Normal |
|---|---|---|
| | | |

Jev requests and THB (from the usage log): _empty_.

**Notes for reading the results (from the tuning-seed smoke run, not evidence, plan v1 numbers).** Fallback share by cause, of each difficulty's decisions:

| Cause | Hard | Normal |
|---|---|---|
| `low_confidence` | 0.545 | 0.664 |
| `missing_facts` | 0.091 | 0.093 |
| infrastructure (`timeout`, `network`, `auth`, `rate_limited`, `server_error`, `disabled`) | 0.000 | 0.000 |

The low-confidence fallback is the largest share on both difficulties. A high fallback share that both difficulties have in common dilutes any Hard effect: on those decisions Hard and Normal play the same fallback policy, so Hard can differ from Normal only on the decisions where Jev's answer is used. Read a small or absent Hard effect with that in mind, and read the live run's `low_confidence` share beside the score difference.

## Dry run (plumbing only, not evidence)

Fake-client output. It proves the plan loads, the seat rotation, per-game rows, resume after an interruption, the analysis and the held-out guard. It says nothing about Hard or Normal: the fake client answers at random, invalid, late and failing, so 89% of decisions fall back, and any win or loss it shows for Hard is noise. Its rows are not committed.

Setup: no key (`TYPESAFE_API_KEY` and `ANTHROPIC_API_KEY` unset), `JEV_ENABLED` unset, `--seed-base 100002 --seeds 6` (tuning range, 12 blocks, 24 games), run on this machine, which was otherwise idle.

- **Rotation.** Treatment rows seat Hard at seat 0 in one block and at seat 1 in the other, Normal opposite; control rows seat Normal at both (checked by a test over the whole plan and in the rows).
- **Resume.** The run was killed with a timeout after 7 games, rerun with the same command (17 played, 7 skipped), and rerun again (0 to play). A test also cuts the last row mid-line and resumes it.
- **Gates.** 24 of 24 games finished; `illegalAppliedActionCount` 0, invariant failures 0, replay failures 0, 0 aborted. A separate one-seed run with `JEV_ENABLED=false` finished all 4 games with every decision on the fallback (mode `disabled`, 0 requests).
- **Held-out guard.** `--held-out` without a key exits 2 and writes nothing.
- **Requests.** 589 Jev requests in 24 games, 24.5 per game (the number behind the cost column above).
- **Hard rollout compute, untimed (offline, this machine).** Hard decision p50 211 ms, p95 435 ms, max 644 ms; Normal p95 21 ms. Hard's p95 is above its 400 ms rollout limit, so live about one Hard decision in twenty will have its rollouts stopped early (fewer than 16 worlds; under 4 worlds gives no buckets and plays as Normal), and the decision still ends well inside 1,500 ms (the worst, 644 ms, is less than half). This does not show that the defaults cannot fit the deadline, so they are unchanged. The live run records the real figures with the 400 ms limit on.

Re-run after the integrity-check change (same setup, killed by a 60 s timeout after 7 games, resumed with 17 to play, 0 failing): 24 of 24 games finished, `illegalAppliedActionCount` 0, 0 invariant failures, 0 replay failures, and the 24.5 requests per game are unchanged. This re-run overlapped with the test suite on the same machine, so its Hard decision p95 (1,743 ms, max 2,574 ms) is load, not Hard; the idle figures above stand. It does show why latency is read on a quiet machine, and that the latency rule would then fail (decision p95 above 1,500 ms) if the live run were this loaded.

Analysis output of that dry run (the banner is what the tool prints on fake rows). The fake client answers 11% of decisions without a fallback and loses 45% of Normal's decisions to timeouts and rate limits, so both new integrity checks (`jev-answered`, `infrastructure-fallbacks`) fail here as they should, besides `live` (plan v1 numbers; under v2 `jev-answered` is the share of valid answers over decisions sent, floor 0.80, and still fails on this fake run):

> **Source: not-evidence: fake-client. This output checks plumbing, latency, fallbacks and cost only. It is not evidence about Hard or Normal, and it carries no verdict.**
> **Verdict: no-verdict.** `live`, `jev-answered` (hard 0.093, normal 0.109, each at least 0.3 under v1) and `infrastructure-fallbacks` fail; a fake run can never produce a verdict.

## Limits of this study

- Greedy on every seat; other personalities are not tested.
- Two seats only; Hard at a three- or four-seat table is not tested.
- No Sell Phase questions in the sim (both difficulties use the fallback there).
- Latency is wall time on one machine; the percentiles depend on its load.
- Hard and Normal share one Jev model and one orchestrator per game.
- The 0.10 gap, the 0.05 floor and the 0.02 timeout excess are proposed defaults for the captain to confirm before the run.
