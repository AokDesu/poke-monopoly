# C5: exploit policy experiment plan

Issue: [#61](https://github.com/AokDesu/poke-monopoly/issues/61), ticket A61-4. Spec: §8 (Critic, Simulation), §9 (sim limits), §10 C5. Data: [`sim/experiments/c5-plan.json`](../../sim/experiments/c5-plan.json), which a runner reads.

This plan is written **before any evaluation game is run**. It is a design, not a result. Nothing in it claims a policy wins or loses.

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

- **Control:** the focal seat plays the **baseline**, the registered `random` policy. Every other seat plays a fallback personality background.
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
- **Vacuity rule:** each never-negotiate cell reports its enabled offer and response opportunities per arm. If the control arm has none, the cell is labelled vacuous and supports no conclusion.
- **Depends on upstream work.** Real deal opportunities need Deal Cards ([#164](https://github.com/AokDesu/poke-monopoly/issues/164)) and promise settlement ([#198](https://github.com/AokDesu/poke-monopoly/pull/198)). A zero-deal base cannot certify this policy.

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
| **`c5-held-out`**      | **1,100,004–1,100,507** | **The 1,008 evaluation games**                                           | **unopened**                 |
| `c5-contingency`       | 1,200,004–1,200,507    | One replacement set, same layout, only if a fix forces re-evaluation     | unopened                     |

Each of the 21 cells owns 24 consecutive seeds, in the order of the policies in the data file, seat counts 2, 3, 4 within each policy. Cell `i` (counting from 0) uses `1,100,004 + 24i` to `1,100,027 + 24i`. Each seed is played twice, once per arm, so the 504 seeds give 1,008 physical games. No seed is shared between cells, so the 504 control arms are different games.

Rules:

1. **Opening a range** means starting any game in it. The ledger entry then records the date, the commit and who opened it. Do this once the manifest is validated runnable (A61-5) and not before.
2. **No tuning after seeing held-out results.** Once `c5-held-out` is opened, a policy or rule change made because of what it showed marks the whole range consumed. Re-evaluate on `c5-contingency`, then reserve a new range. Do not tune and re-report on the same seeds.
3. **No re-rolls.** An aborted or failing game keeps its seed and its row. It is never replaced, retried with another seed, or filtered out.
4. **Tuning runs** stay in `tune`, outside the 1,008, and the report keeps them apart.
5. **Other work** takes its seeds from the ledger by PR. The C4 addendum A61-6 plans may re-run the C4 seeds for comparison with history. That is a refresh of the historical report, not a held-out claim, and it is not part of the 1,008.

If the schedule or integration baseline changes after G1, revise this plan **before** the held-out range is opened.

## Analysis

- **Unit and estimate.** The unit is a block. The primary measure is the focal seat's win credit (1/k for k co-winners, 0 for a loss, §8). The primary estimate is the mean over complete pairs of treatment minus control, per policy and seat count.
- **Uncertainty.** A paired block bootstrap within a cell: 10,000 resamples, a 95% percentile interval and analysis RNG seed 610004. The seats of one game are never treated as independent n. `sim/analysis/paired.ts` (A61-3) fixes the implementation; any other documented paired method has to be named before the held-out range opens.
- **n is small by design.** A cell has 24 pairs, so its interval will be wide. Report it as it comes out. Do not widen the claim.
- **Secondary, reported alongside.** Tie rate per arm, focal final coins, win/tie/loss counts per arm, and counts by focal class, focal seat and background personality. The strata are counts only; their n is too small for inference.
- **Missing pairs.** An abort, step-limit stop or checker failure makes its pair incomplete. Each cell reports planned, complete and missing pairs and lists every failing seed with its reproduce command.
- **Not allowed:** a universal pass threshold, tuning on held-out results, a Jev or Hard claim, or a pooled-across-seat-counts figure as the primary result.

### Reading the non-domination result

Read the 21 cells as a grid, by policy and by seat count.

- A cell whose interval lies wholly above zero is evidence of an advantage **in that context**. One that straddles zero is not evidence of one, and not evidence of none. A cell wholly below zero is a disadvantage.
- Per policy, state how many of its three seat counts are above, straddling and below zero.
- A policy whose interval is above zero at all three seat counts is flagged as a **dominance candidate**. The flag is a prompt for the team to look, not a verdict. With 21 cells, one such pattern can appear by chance; no multiplicity adjustment is claimed.
- No flagged policy supports §8's statement. A grid with none supports it for this design and n only, and says nothing about untested contexts.
- Vacuous never-negotiate cells are shown but excluded from this reading.

## Run and result tables

The field lists are in the data file under `tables`. They are planned fields; A61-5 owns the game row and A61-3 the pair and result types, and the lists are reconciled with those before the ledger opens.

- **Game row** (one per physical game, aborts included): cell, block, arm, seed, classes and policies by seat, focal seat and class, background personality, Social window, Lap target, step limit, finished or abort reason, turns and steps, winners, focal win credit, final coins, `illegalAppliedActionCount`, `invariantFailures`, the focal policy's opportunities and uses, hostility and promise accounting, and the main SHA, engine and content versions and manifest hash.
- **Pair row:** cell, block, seed, the two game ids, whether complete, win-credit difference, coin difference and both winner sets.
- **Result row** (one per cell, 21 rows): planned, complete and missing pairs; the mean difference with interval, resamples and RNG seed; tie rate and mean win credit per arm; opportunities per arm; the vacuity flag; and failing seeds.

Preserve the individual rows, not only averaged JSON, and no row carries a server key or hidden information.

## What this plan does not do

- **No code.** It adds this document and the data file only. The runner, per-seat policies, analysis and report belong to A61-1 to A61-3, A61-5 and A61-6.
- **Not run-validated.** The file is checked for valid JSON and counts, not for being runnable. A61-5 owns that check against the real runner and the seven registered policies.
- **Policy ids are planned.** If A61-5 registers other names, the data file changes before the ledger opens.
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
