# C5: exploit policy experiment plan

Issue: [#61](https://github.com/AokDesu/poke-monopoly/issues/61), ticket A61-4. Spec: §8 (Critic, Simulation), §9 (sim limits), §10 C5. Data: [`sim/experiments/c5-plan.json`](../../sim/experiments/c5-plan.json), which a runner reads.

This design was on `main` before any evaluation game was played on purpose. One accidental test run had already played 144 `sell-all` held-out games; the [seed-use ledger](#seed-use-ledger) records it. The analysis-method wording was revised in `5b96619`, before the evaluation run ([wording history](#analysis)).

## Question

§8 asks the Critic layer for one thing: **no single exploit policy dominates every context**, reported with n. The seven policies are always PvP, force weak targets, sell everything every Start, keep everything to evolve, use Abilities immediately, buy only Ultra Balls and never negotiate.

Each policy is compared with a baseline in matched games. The result is a table of paired differences with uncertainty, by context. There is no pass threshold: §8 sets none, and this plan does not invent one.

These are policies we configured ourselves. They show that the rules and the sim work, not that Jev understands relationships (§8, Personality and chat). No Jev or Hard claim comes from this experiment.

## Design

| Item                | Value                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------ |
| Policies            | 7 (list above; ids in the data file)                                                       |
| Seat counts         | 2, 3, 4                                                                                    |
| Blocks per cell     | 24 matched seed blocks per policy and seat count                                           |
| Arms                | 2: control and treatment                                                                   |
| **Cells**           | 7 × 3 = **21** (policy × seat count)                                                       |
| **Pairs**           | 21 × 24 = **504**                                                                          |
| **Physical games**  | 504 × 2 = **1,008**, which meets the §8 and §10 C5 "1,000 policy-only games"              |
| Rules               | Quick 2 Laps (`--lap-target 2`), 5,000 steps per game (§9 "max steps per game"), core classes |
| Services            | None. Both server keys absent, `JEV_ENABLED=false`, `HAIKU_ENABLED=false`                  |

1,008 counts **games**, not pairs. A pair is one block: the same seed played twice. Each cell has 24 pairs, 48 games. Each seat count has 336 games and each policy 144.

### Arms and baseline

- **Control:** the focal seat plays the **baseline**, the registered `random` policy. The non-focal AI seats play a fallback personality background.
- **Treatment:** the focal seat plays the exploit policy. Everything else is identical.
- **Why `random`:** an exploit policy is a rule layered over the baseline. For every choice the rule does not specify, the policy takes the baseline's seeded choice, so the one rule is the only intended difference. A61-1 and A61-2 must use that same fallback; if their policies fall back to something else, A61-5 reconciles this before the ledger opens.
- **Background seats:** every non-focal AI seat plays the fallback policy of one personality from greedy, aggressive, cautious and opportunist, the same in both arms. This is configured policy behaviour, not Jev personality evidence.

A block shares between its two arms the seed, seat count, focal seat, the class in every seat, the starter species, the background personality, the controller of every seat, the Social window, the Lap target and the step limit. The seed fixes the class rotation (`seatSetup`: class in seat i is `classPool[(seed + i) % 6]`) and the starter rotation.

The arms share their initial state and the per-seat policy RNG keys. They do **not** share trajectories: once the focal seat chooses differently, the game's dice stream is used differently. Those differing trajectories are recorded as they are. Equal dice are never assumed.

### Class, seat and personality schedule

The data file lists the exact 24-block schedule for each seat count. One schedule serves all seven policies at that seat count. A block's seed is its cell's first seed plus its block number. The balance achieved, per cell:

| Seats | Focal seat           | Focal class                       | Background personality | Seat × class                          | Seat × personality            |
| ----- | -------------------- | --------------------------------- | ---------------------- | ------------------------------------- | ----------------------------- |
| 2     | 12 / 12              | 4 each of 6                       | 6 each of 4            | 12 combinations, 2 each (exact)       | 8 combinations, 3 each (exact) |
| 3     | 8 / 8 / 8            | 4 each of 6                       | 6 each of 4            | 18 combinations: 12 once, 6 twice     | 12 combinations, 2 each (exact) |
| 4     | 6 / 6 / 6 / 6        | 4 each of 6                       | 6 each of 4            | 24 combinations, 1 each (exact)       | 16 combinations: 8 once, 8 twice |

24 blocks do not divide evenly into every crossing. For 3 seats, 24 is not a multiple of the 18 seat-by-class combinations, so six combinations appear twice (the six extras use each seat twice and each class once). For 4 seats, 24 is not a multiple of 16 seat-by-personality combinations. These are the closest attainable counts. The runner publishes the actual counts it played; this table is the intent.

### Social window

- **Never negotiate:** window on, in both arms. A never-negotiate comparison where nobody can offer anything is vacuous, so the cell has to contain real opportunities.
- **The other six policies:** window off, so negotiation does not add noise to combat, selling or shopping comparisons.
- **Human seat:** with the window on, seat 0 is the human controller, as `--social` already does. The policy that decides that seat is the arm's per-seat policy: the exploit policy when the focal seat is 0, the baseline otherwise.
- **Vacuity rule:** each never-negotiate cell reports its enabled chat or promise offer opportunities and promise response opportunities per arm. If the control arm has neither, the cell is labelled vacuous and supports no conclusion.
- **Coverage on main:** the runner counts legal chat and promise decisions, including responses, and reports the outcomes recorded by promise settlement. Deal Card coverage requires the legal Deal Card path in [#164](https://github.com/AokDesu/poke-monopoly/issues/164).

## Seeds

The existing partition holds: **tune seeds below 1,000,000, evaluation seeds from 1,000,000** (`--seed-set`, [docs/sim.md](../sim.md)). Game `g` of a run uses seed `--seed + g`.

The C4 report used evaluation seeds 1,000,002–1,000,101 and published their observations. Those seeds are **no longer unseen**, so they are not held out for C5.

### Seed-use ledger

| Range                  | Seeds                  | Use                                                                      | Status                       |
| ---------------------- | ---------------------- | ------------------------------------------------------------------------ | ---------------------------- |
| `tune`                 | 100,000–199,999        | Tuning and smoke runs. Excluded from the 1,008.                          | open                         |
| `c4-published`         | 1,000,002–1,000,101    | C4 300-game report                                                       | consumed                     |
| `withheld-below-c5`    | 1,000,000–1,099,999    | Holds the C4 range. No C5 evaluation seeds.                              | withheld                     |
| `alignment-gap`        | 1,100,000–1,100,003    | Skipped so every cell starts at a multiple of 6 and keeps class rotation | withheld                     |
| **`c5-held-out`**      | **1,100,004–1,100,507** | **The 1,008 evaluation games**                                           | **consumed**                 |
| `c5-contingency`       | 1,200,000–1,200,503    | One replacement set, same layout, only if a fix forces re-evaluation     | unopened                     |

Each of the 21 cells owns 24 consecutive seeds, in the order of the policies in the data file, seat counts 2, 3, 4 within each policy. Cell `i` (counting from 0) uses `1,100,004 + 24i` to `1,100,027 + 24i`. The contingency range has the same 504 seeds and the same cell order; cell `i` uses `1,200,000 + 24i` to `1,200,023 + 24i`. Its first seed is a multiple of 6 (1,200,000 = 6 × 200,000), so every row of the schedule gets the same focal class as in the held-out range. Each seed is played twice, once per arm, so the 504 seeds give 1,008 physical games. No seed is shared between cells, so the 504 control arms are different games.

`c5-held-out` was opened twice in the sense of rule 1 below. Both openings belong to Stream A (punkharb). The machine-readable entry is in `sim/experiments/c5-plan.json`; [run record and results](c5-policy-results.md).

1. **By accident, 2026-11-18: the `sell-all` cells only.**
   - **What ran.** A CLI guard test in the A61-5 runner work ran `npm run experiment -- --held-out --policy sell-all` against the real manifest, expecting a refusal. The command did not refuse. It played the three `sell-all` cells (cells 6 to 8, seeds 1,100,148 to 1,100,219). By the manifest that is 3 cells × 24 blocks × 2 arms = **144 games**. The run exited 0. The rows were deleted with the test's temporary directory, so the count could not be checked against rows.
   - **When.** Inside one vitest run that started at 08:02:48 UTC and had returned by 08:05:14 UTC. The time the games themselves started was not recorded.
   - **Commit.** `124a3beb080798b880d880e3abb71ecc84b4c935` (main) plus uncommitted A61-5 changes, committed afterwards as `ce661039cc2d6b830d643a42997d9cbe49c80515` at 08:33:51 UTC (merged as PR [#237](https://github.com/AokDesu/poke-monopoly/pull/237)). That was before A61-5 had merged, so rule 1's "not before" was not met.
   - **Outputs unread.** The rows went to a file in a temporary directory that the test removes when it ends. The failing assertion showed only the exit code and an empty error list. Nobody read a win credit, coin figure or any other result.
   - **Nothing changed because of it.** No policy, manifest cell, seed, analysis rule or run setting was changed because of this run. The only change made after it was to the test, which now uses a copy of the manifest shifted below the evaluation floor and never passes `--held-out` with the real manifest. Before the commit, the session's own transcript shows edits to that test file and to `sim/README.md`, and a Prettier formatting pass, and nothing else. Between `ce661039` and the evaluation run, `sim/exploits/`, `sim/policy.ts`, `sim/experiments/run.ts` and the manifest cells did not change.
   - **Disclosure and decision.** PR #237 disclosed the run in its description. Its reviewer, Mrmo0p, wrote on 2026-11-18 (09:09 UTC) that he would treat those cells as not consumed, since no result was seen and games are deterministic, and asked for the run to be recorded in this ledger. It was not recorded until this entry.
   - **Not claimed.** The 144 games are not guaranteed to be the same games the evaluation run played for the same seeds. Main moved from `124a3be` to `1456099` between the two runs, with engine, content and sim commits merged in between, and the engine version string stayed `0.20.0`, so it does not tell the two builds apart. The rows from 2026-11-18 no longer exist, so the two runs cannot be compared. The only `sell-all` rows reported are from the evaluation run.
2. **The evaluation run, 2026-11-20 at 10:22:03 UTC,** from `5b9661923006809e746053191d1dad1705d1bfd4`. All 1,008 planned games ran once in it, including the `sell-all` seeds above.

The 10:22:03 UTC time is when the evaluation run opened. Under rule 1 the range was first opened on 2026-11-18.

Rules:

1. **Opening a range** means starting any game in it. The ledger entry then records the date, the commit and who opened it. Do this once the manifest is validated runnable (A61-5) and not before.
2. **No tuning after seeing held-out results.** Once `c5-held-out` is opened, a policy or rule change made because of what it showed marks the whole range consumed. Re-evaluate on `c5-contingency`, then reserve a new range. Do not tune and re-report on the same seeds.
3. **No re-rolls.** An aborted or failing game keeps its seed and its row. It is never replaced, retried with another seed, or filtered out.
4. **Tuning runs** stay in `tune`, outside the 1,008, and the report keeps them apart.
5. **Other work** takes its seeds from the ledger by PR. The C4 addendum A61-6 plans may re-run the C4 seeds for comparison with history. That is a refresh of the historical report, not a held-out claim, and it is not part of the 1,008.

If the schedule or integration baseline changes after G1, revise this plan **before** the held-out range is opened.

## Analysis

- **Unit and estimate.** The unit is a block. The primary measure is the focal seat's win credit (1/k for k co-winners, 0 for a loss, §8). The primary estimate is the mean over complete pairs of treatment minus control, per policy and seat count.
- **Uncertainty.** `sim/analysis/paired.ts` (A61-3) draws whole pairs within each focal-seat group at the given seat count, preserving the observed number of blocks per focal seat. It uses 10,000 resamples, a 95% percentile interval and analysis RNG seed 610004. It sorts pairs by block id before resampling. If any resampling group has fewer than two complete blocks, interval bounds are null.
- **Wording history.** Commit `5b96619` rewrote the uncertainty, secondary-measure and strata wording in this section, and the matching `analysis` block of the data file, so that they describe the merged `sim/analysis/paired.ts` as it is: resampling within each focal seat, paired Cohen's d, and the observed combination of non-focal personalities. It aligns the text with the merged code. It was written before any held-out data was seen: the accidental 2026-11-18 rows were discarded unread, and the evaluation run opened on 2026-11-20, after that commit.
- **n is small by design.** A cell has 24 pairs, so its interval will be wide. Report it as it comes out. Do not widen the claim.
- **Secondary, reported alongside.** Tie rate per arm, focal final coins, win/tie/loss counts per arm and paired Cohen's d for win credit and coins. Report descriptive strata by focal class, focal seat and the actual combination of personalities in non-focal seats, per seat count. The simulated human on `random` has personality `unassigned`.
- **Missing pairs.** An abort, step-limit stop or a game with `invariantFailures` above 0 (a checker failure) makes its pair incomplete: it is not scored, it is counted as missing and it is reported. Each cell reports planned, complete and missing pairs and lists every failing seed with its reproduce command. Planned pairs per cell (24) come from this manifest, not from `paired.ts`; A61-5 joins them.
- **Not allowed:** a universal pass threshold, tuning on held-out results, a Jev or Hard claim, or a pooled-across-seat-counts figure as the primary result.

### Reading the non-domination result

Read the 21 cells as a grid, by policy and by seat count.

- A cell whose interval lies wholly above zero is evidence of an advantage **in that context**. One that straddles zero is not evidence of one, and not evidence of none. A cell wholly below zero is a disadvantage.
- Per policy, state how many of its three seat counts are above, straddling and below zero.
- A policy whose interval is above zero at all three seat counts is flagged as a **dominance candidate**. The flag is a prompt for the team to look, not a verdict. With 21 cells, one such pattern can appear by chance; no multiplicity adjustment is claimed.
- No flagged policy supports §8's statement. A grid with none supports it for this design and n only, and says nothing about untested contexts.
- Vacuous never-negotiate cells are shown but excluded from this reading.

## Run and result tables

The field lists are in the data file under `tables`. The A61-5 runner writes the game rows and A61-3 scores the complete pairs.

- **Game row** (one per physical game, aborts included): cell, block, arm, seed, classes and policies by seat, focal seat and class, background personality, Social window, Lap target, step limit, finished or abort reason, turns and steps, winners, focal win credit, final coins, `illegalAppliedActionCount`, `invariantFailures`, the focal policy's opportunities and uses, hostility and promise accounting, and the main SHA, engine and content versions and manifest hash.
- **Pair row:** cell, block, seed, the two game ids, whether complete, win-credit difference, coin difference and both winner sets.
- **Result row** (one per cell, 21 rows): planned, complete and missing pairs; the mean difference with interval, resamples and RNG seed; tie rate and mean win credit per arm; opportunities per arm; the vacuity flag; and failing seeds.

Preserve the individual rows, not only averaged JSON, and no row carries a server key or hidden information.

## Scope

- A61-5 integrates the seven policy IDs with per-seat policies and validates the manifest against the engine. A61-6 runs the games and publishes the report.
- **Out of scope:** the 300 Jev-in-the-loop games (Stream B, [#62](https://github.com/AokDesu/poke-monopoly/issues/62)), the Hard/Normal duel, Monte Carlo rollouts, stretch classes and the MCP stretch layer, the browser UI and any rule change.

## Dependencies

| Needed by                    | From                                                                           |
| ---------------------------- | ------------------------------------------------------------------------------ |
| Always PvP, force weak, immediate Ability | A61-1                                                             |
| Sell all, keep to evolve, Ultra only, never negotiate | A61-2                                                 |
| Paired analysis              | A61-3                                                                          |
| Runnable manifest, per-seat policies, game rows | A61-5                                                       |
| Event baseline               | [#188](https://github.com/AokDesu/poke-monopoly/pull/188)                      |
| Promise settlement           | [#198](https://github.com/AokDesu/poke-monopoly/pull/198)                      |
| Deal Cards                   | [#164](https://github.com/AokDesu/poke-monopoly/issues/164)                    |
| Final run and report         | A61-6, after the above                                                         |
