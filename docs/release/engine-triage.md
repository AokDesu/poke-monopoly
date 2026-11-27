# Engine and sim release-blocker triage

Ticket A64-1 of epic [#64](https://github.com/AokDesu/poke-monopoly/issues/64) (C6 bug fixes and freeze). Spec §8 (Tests, Human and Simulation layers), §10 C4 and C6, §11.

This is a queue of **candidates**. It tells the owner which candidates are worth a fix ticket (A64-2a/2b), which are missing evidence, and which already have an owner.

**Refreshed 2026-11-28 (UTC+7) on main `44b02db`, committed 2026-11-26.** The previous refresh ran on `703d372` on 2026-11-21 and checked the text on `eee81c5` on 2026-11-22. This refresh rechecks every row against main, the forge and the offline runs below.

## Result

**No reproduced rule defect.** The 500-game CLI recheck finished with zero aborts, illegal applied actions or invariant failures. All 26 registered engine invariants are active, including `deals-atomic` and `promise-closes-on-own-turn`. The test counts and load are in ET-05.

| Question | Answer |
| --- | --- |
| Is any rule bug reproduced? | No failing seed or invariant in this refresh. D1, D2 and D3 are on main (ET-01). |
| What blocks the release now? | G1 still lacks a combined verdict and gate-quality latency (ET-07, S1). The required Deal screen and browser routing remain stacked upstream (ET-01, S2 for content completeness). The clean-install browser rehearsal still waits on the layout stack. |
| Does the old timeout report prove a rule defect? | The historical failures were test reliability candidates. Named budgets and the `PlayersArea` setup fix are on main. See ET-05 and ET-09 for the current measurements. |
| Is there a candidate for a fix ticket (A64-2a/b)? | No reproduced rule bug qualifies. New findings can come from playtest [#63](https://github.com/AokDesu/poke-monopoly/issues/63) or the A61-6 runs. The post-D3 300-game report is already owned (ET-06). |

## Evidence base

| Item | Value |
| --- | --- |
| Build | Main `44b02dbb99fe64360a78d9289a1c087b165ab6b0` (merged 2026-11-26), engine 0.23.0, content 1.4.0. |
| Date | 2026-11-28 (UTC+7). |
| Machine | 12 logical CPUs, shared. Test load samples are in ET-05. |
| Node | `24.22.3` for all fresh runs, meeting `^24.15.0` in `package.json` (`.node-version` is `24`). |
| Keys | Both API keys absent. `JEV_ENABLED=false` and `HAIKU_ENABLED=false` for every run. |
| CI | Green on this main SHA. [Run 45787121002](https://github.com/AokDesu/poke-monopoly/actions/runs/45787121002/job/139796599123) |
| Raw output | Task evidence outside git. The commands are under Re-run. |
| Prior sweep | The [epic closeout](https://github.com/AokDesu/poke-monopoly/issues/64#issuecomment-7138143537) reports about 4,400 engine games, 1,090 CLI games and 26,000 random mid-game resumes without a rule defect. Those counts are from the closeout. |
| Open pull requests | Reviewed the stack and file lists for the browser [#259](https://github.com/AokDesu/poke-monopoly/pull/259), [#281](https://github.com/AokDesu/poke-monopoly/pull/281), [#283](https://github.com/AokDesu/poke-monopoly/pull/283), [#302](https://github.com/AokDesu/poke-monopoly/pull/302), playtest [#230](https://github.com/AokDesu/poke-monopoly/pull/230), server [#299](https://github.com/AokDesu/poke-monopoly/pull/299), [#300](https://github.com/AokDesu/poke-monopoly/pull/300), and sim evidence [#303](https://github.com/AokDesu/poke-monopoly/pull/303), [#304](https://github.com/AokDesu/poke-monopoly/pull/304). Fresh runs cover main. |
| Not examined | A fresh browser rehearsal, participant sessions, and live Jev or Haiku. |

## How to read the queue

**Class** (the ticket asks for these to stay apart):

- **Upstream-owned**: a feature or fix someone already owns. The row says who, what it needs, and what could go wrong at merge. Do not open a second ticket.
- **Rule bug**: observed behavior differs from the spec section. None found.
- **Test reliability**: a test fails because of machine load or margin, while the rule it checks holds.
- **Evidence hole**: no evidence exists, or it is stale, so a claim cannot be made either way. An evidence hole is not a failure.

**Severity**:

- **S1**: blocks the §11 demo, a hard gate, or a completion, asset or information invariant of §8.
- **S2**: blocks content-complete or the evidence run, but the §11 demo can still run with a stated caveat.
- **S3**: reliability or polish. Does not change what the product does.

**Reproduction status**: `reproduced`, `not reproduced` (tried, found nothing), `not attempted` (nothing on main to run), or `owned upstream`. A row is **resolved** only when the row says what on main (a merged pull request) or which run of mine shows it. A pull request description alone never resolves a row.

## Queue

Open candidates are ordered by severity. Resolved rows stay as the record.

| ID | Candidate | Class | Severity | Status | Owner |
| --- | --- | --- | --- | --- | --- |
| [ET-07](#et-07-gate-g1-evidence-is-incomplete) | Gate G1 verdict and gate-quality latency | Evidence hole | S1 (gate) | not attempted; verdict missing | Mrmo0p and AokDesu |
| [ET-01](#et-01-deal-cards) | Deal screen and browser routing after D3 | Upstream-owned | S2 | owned upstream; D1–D3 on main, [#283](https://github.com/AokDesu/poke-monopoly/pull/283) open | AokDesu (issue); punkharb (handoff) |
| [ET-06](#et-06-the-300-game-evidence) | Published 300-game record predates D2 and D3 | Evidence hole | S3 | not reproduced; current recheck clean, updated record pending | punkharb |
| [ET-02](#et-02-promise-settlement) | Promise settlement and `promise-closes-on-own-turn` | Upstream-owned | S1 when open | **resolved** in [#198](https://github.com/AokDesu/poke-monopoly/pull/198) | Mrmo0p |
| [ET-03](#et-03-event-deck) | Event squares | Upstream-owned | S2 when open | **resolved** in [#188](https://github.com/AokDesu/poke-monopoly/pull/188) | punkharb |
| [ET-04](#et-04-stale-bases-and-version-stamps) | Version stamps and stale saves | Upstream-owned | S3 | **resolved**; stamps through 0.23.0 checked on main | punkharb and Mrmo0p |
| [ET-05](#et-05-full-suite-timeouts-under-load) | Historical full-suite timeouts under load | Test reliability | S3 | **resolved** for the historical failures; 0 in the current full run | punkharb, with B and C for their files |
| [ET-08](#et-08-hostile-ability-policy-approval) | Hostile Ability policy approval | Upstream-owned | S3 when open | **resolved**; approval recorded in spec §4.1 | Spec owner; punkharb for implementation |
| [ET-09](#et-09-playersarea-assertion-failed-once-in-a-full-run) | `PlayersArea` assertion after an automatic step | Test reliability | S3 when open | **resolved** in [#290](https://github.com/AokDesu/poke-monopoly/pull/290) | AokDesu (Stream C); punkharb (fix) |

## Candidates

### ET-01: Deal Cards

- **Spec** §4.8 (Deal Card, concession budget), §5.3, §5.4, §8, §10 C5/C6, §11 step 6.
- **Build and test** D1 landed as `9240c4c` and D2 as `44415b4`. D3 first merged to the D2 branch, then reached main on 2026-11-25 as `d942ce9`. On `44b02db`, `ai/orchestrator.ts` routes `deal_response` to the Choice in `ai/questions/deal.ts`. The `until S10` placeholder is gone. [D1](https://github.com/AokDesu/poke-monopoly/pull/262), [D2](https://github.com/AokDesu/poke-monopoly/pull/269), [D3 branch merge](https://github.com/AokDesu/poke-monopoly/pull/271), [D3 main merge](https://github.com/AokDesu/poke-monopoly/pull/286)
- **Expected** A Deal commits atomically on human confirmation. The engine rechecks terms and budget. When no accept is listed, §5.3 makes the AI refuse in code without a Jev request, including when the engine lists a cheaper counter. Private terms and facts reach only the allowed seats.
- **Observed** Social at seed 1 completed 100 games with 300 proposals, 18 accepts, 49 rejects, 233 counters, 126 cancels and 125 commits. The `--require-deals` rerun exited 0 with the same six counts and `deals-atomic` active. These use the random driver. D3 itself is exercised by `ai/deal-response.test.ts` and the offline Deal fixtures. The 60 D3 response tests passed. `engine/deals.test.ts` and `engine/deal-facts.test.ts` cover atomic commit, budget, privacy and pending-state replay. The private debuff valuation regression is in the merged change and the current suite. [Deal value and feed privacy](https://github.com/AokDesu/poke-monopoly/pull/288)
- **Reproduction** Owned upstream. The browser on main still has no Deal Card component or `deal_response` bridge. The open change at `a1775ec` adds the screen and final confirmation, and its `web/src/game/store.ts` diff routes the pending rival decision as `deal_response` and applies the answer without diagnostic metadata. The latest review approved that revision. [Deal screen](https://github.com/AokDesu/poke-monopoly/pull/283)
- **Severity** S2 for content completeness (was S1). Deals remain required under §10. The engine and server parts are on main, and the owner's accepted §11 step 6 uses promise memory.
- **Owner** AokDesu is named in the open issue, whose dependency paragraph still describes the old placeholder. AokDesu handed the implementation branch to punkharb. Mrmo0p delivered the engine and server work. [#138](https://github.com/AokDesu/poke-monopoly/issues/138), [handoff](https://github.com/AokDesu/poke-monopoly/pull/283#issuecomment-7166254271)
- **Touched files still open** Deal Card UI, the browser store and its tests, with engine reason codes in the existing change. The screen's acceptance still includes final confirmation, reload and payment visibility.
- **Depends on** The screen is approved and stacked on the one-screen layout, which is stacked on the readable-pace change. The base needs retargeting and a fresh main check as that stack lands. [Deal screen](https://github.com/AokDesu/poke-monopoly/pull/283), [one-screen layout](https://github.com/AokDesu/poke-monopoly/pull/281), [readable pace](https://github.com/AokDesu/poke-monopoly/pull/259)
- **Bounded fix** The issue estimates 3 h for the screen. The remaining acceptance check belongs to the existing branch after the stack lands.

### ET-02: Promise settlement

Resolved on main.

- **Spec** §4.8, §8 (promises close on the correct `ownTurnNo`), §11 step 6.
- **Build and test** The settlement merge is `9b37350` (2026-11-18). On `44b02db`, `promise-closes-on-own-turn` is active in `engine/invariants.ts`. `engine/promise-settlement.test.ts` and `sim/interactions.test.ts` cover settlement and the sim's accounting from engine events. [Settlement merge](https://github.com/AokDesu/poke-monopoly/pull/198)
- **Observed** Social at seed 1, 100 games, recorded 111 offered and 64 accepted. Those 64 settled as 48 broken, 15 kept (4 with an opportunity, 11 without) and 1 closed by game end. The run recorded 23 breach opportunities and 0 pending. No failing seed or invariant.
- **Reproduction** Not reproduced.
- **Severity** S1 when open.
- **Owner** Mrmo0p (settlement author).
- **Left over** `docs/sim.md:61` still calls settlement deferred, while the preceding accounting section and `sim/interactions.ts` use the engine's recorded outcomes. That sentence is a docs follow-up.

### ET-03: Event deck

Resolved on main.

- **Spec** §3.1, §4.6, §6, §8.
- **Build and test** The Event deck landed as `bd14ade` (2026-11-17). `engine/turns.ts` calls `drawAndResolveEvent` from `engine/events.ts`. The current suite passed `engine/events.test.ts`, `sim/events.test.ts` and `ai/event-visibility.test.ts`. [Event deck merge](https://github.com/AokDesu/poke-monopoly/pull/188), [#162](https://github.com/AokDesu/poke-monopoly/issues/162)
- **Observed** All six cards were drawn and resolved in each of the five 100-game batches, with draw and resolution counts matching for each card. The 2-, 3- and 4-seat eval batches reshuffled 132, 184 and 217 times. The Event and spectator tests cover role-scoped visibility. The merged mid-game command guard also has regression coverage in `engine/engine-commands.test.ts`. [Engine command guard](https://github.com/AokDesu/poke-monopoly/pull/287)
- **Reproduction** Not reproduced. No failing seed.
- **Severity** S2 when open.
- **Owner** punkharb.

### ET-04: Stale bases and version stamps

Resolved on main.

- **Spec** §6.7–§6.9 and §8.
- **Build and test** The first-parent history of `engine/versions.ts` shows 0.19.0 (Events), 0.20.0 (settlement), 0.21.0 (Abilities, Potion and Shop), 0.22.0 (D1) and 0.23.0 (D2). `44b02db` still uses 0.23.0. D3 and the current open changes have no engine-version edit.
- **Expected and observed** The predicted stamp collision did not occur. `engine/save.test.ts` and `web/src/game/save.test.tsx` exercise older stamp rejection and the mismatch message. The current engine `loadGame` verifies the replay before returning a save, with tamper checks in `engine/save.test.ts`. Prepared scenes in `web/src/game/demoScenes.ts` build from current setup, seed and scripted choices, and `web/src/game/demoScenes.test.ts` checks that their logs replay. [Verified save loading](https://github.com/AokDesu/poke-monopoly/pull/289)
- **Reproduction** Not reproduced by history or the current tests.
- **Severity** S3 (was S2).
- **Owner** punkharb and Mrmo0p for the original merges. The author merging second owns a future stamp collision.
- **Touched files if a clash recurs** `engine/versions.ts`, the save and resume tests and `docs/engine-contract.md`.
- **Bounded fix** 0.5 h per conflicting merge, including an older-save check.

### ET-05: Full suite timeouts under load

- **Spec** §7 and §8 (100% pass in CI).
- **Build and test** Node 24.22.3 on `44b02db`, both services off. `npm test` used default worker counts and timeouts, with an additional JSON reporter for per-test results.
- **Expected** The full suite passes and the leak sweeps can finish within their test budgets.
- **Observed**

| Run | Load average (12 logical CPUs) | Result | Failure accounting |
| --- | --- | --- | --- |
| Historical F (`703d372`, Node 24) | 3.1 at start, 10.4 at 4 min, 6.4 at end | 3,525 passed, 19 failed in 10 files | 13 timeouts, 5 UI waits, 1 assertion (ET-09). |
| Historical G (`703d372`, 2 workers) | 4.3 at start, 2.9 at end | 327 passed in the 10 rerun files | 0 failures. |
| Current (`44b02db`, Node 24, default workers) | 3.06 at start, 18.54 sampled during, 7.04 at end | 3,996 passed in 183 files; 285 s | 0 timeouts, wait failures or assertions. No reduced-worker rerun needed. |

- **What it shows** The JSON reporter recorded 137 tests over 2 s in the current local run. The spectator, speech and 500-state observation leak sweeps passed in 6.29 s, 7.37 s and 11.29 s respectively. All three exceeded the old 5 s default.
- **Reproduction** The historical failures were reproduced under load. The current full run passed after the targeted budget and fixture changes, with a one-minute load average sampled at 18.54.
- **Severity** S3. CI on this main SHA passed.
- **Owner** punkharb for engine and sim, Mrmo0p for AI, AokDesu for web.
- **Fix proposal in this doc** Capture per-test durations (`vitest run --reporter=json`), list tests over 2 s, use named per-test budgets with a reason, and preserve every assertion and run count, including the 200-game and 500-state properties. Document Node 24 and `--maxWorkers=2` for a shared machine. The original proposal also asked whether to keep the 120 s to 240 s property-budget change from the settlement merge.
- **What landed** The engine and sim budgets and the Node/worker guidance landed as `d214f49`. Named budgets for the slow AI and web tests, plus test setup for an exported kill switch, landed as `fc1b978`. The 240 s property budget is still scoped to its properties in `sim/legal-games.ts`. The suite config has no global `testTimeout`. [Engine and sim budgets](https://github.com/AokDesu/poke-monopoly/pull/282), [AI and web budgets](https://github.com/AokDesu/poke-monopoly/pull/290)

### ET-06: The 300-game evidence

- **Spec** §8 Simulation, §10 C4 and C6.
- **Build and test** The committed [300-game rerun report](../c4-300-game-rerun-report.md) records 600 clean games on `9240c4c` (300 in each of two sets, with Social and deals required in the second). That build predates D2 and D3. The report merged as `eee81c5` on 2026-11-22. [Report merge](https://github.com/AokDesu/poke-monopoly/pull/279)
- **Expected** The C4 exit signal of 300 clean games has a committed record on a build that includes D2 and D3.
- **Observed** On `44b02db` the three random-policy eval batches (seeds 1,000,002–1,000,101 at each seat count, 2 Laps and a 5,000-step cap) and two seed-1 Social batches finished 100 of 100 each. All five exited 0 with 0 aborted, 0 illegal applied actions and 0 invariant failures. At 2, 3 and 4 seats the eval batches averaged 27.16, 38.64 and 50.64 turns, and 49.30, 48.98 and 49.01 final coins per player. The Social and deal counts are in ET-01 and ET-02.
- **Reproduction** Not reproduced. These are published regression seeds. The random-policy runs cover engine legality and interactions. D3 answers are checked by the tests and offline eval (ET-01).
- **Severity** S3. The regression recheck is clean, and the committed report still needs its build and evidence refreshed.
- **Owner** punkharb. The separate `poke-58-300-rerun2` report refresh is pending under [#58](https://github.com/AokDesu/poke-monopoly/issues/58).
- **Touched files** The report refresh owns the committed report.
- **Depends on** Publishing that evidence. D2 and D3 are already on main.
- **Bounded fix** Tracked in the report refresh.

### ET-07: Gate G1 evidence is incomplete

- **Spec** §1, §8 Human, §10 C2 and G1, `docs/playtest/PROTOCOL.md`.
- **Observed** On `44b02db`, `docs/playtest/g1/G1-report.md` is absent. Both issues are closed. The latency owner recorded a provisional result and pointed to the 100 Jev-in-the-loop games for gate-quality latency. The committed note reports p95 1,055 ms across 7 turns of one team game, covering Strategy and Encounter. Both B participants played with Jev off. Two of the three coded rows self-report keep-or-sell hesitation. The two positive rows have no facilitator count, and sheet A still has several `n/a` fields. [Latency issue](https://github.com/AokDesu/poke-monopoly/issues/52), [combined-report issue](https://github.com/AokDesu/poke-monopoly/issues/54), [latency note](../playtest/g1/ai-latency.md)
- **Reproduction** Not attempted. Gate-quality measurement and the verdict need owner evidence. The merged sheet tools and the open C5 tables cover separate deliverables. [Sheet tools](https://github.com/AokDesu/poke-monopoly/pull/225), [C5 tables](https://github.com/AokDesu/poke-monopoly/pull/230)
- **Severity** S1 as a hard gate.
- **Owner** Mrmo0p (latency) and AokDesu (combined report).
- **Touched files** `docs/playtest/g1/`.
- **Bounded fix** The owners need to confirm what evidence meets the 3–5 participant hesitation criterion and the p95 ≤2 s criterion, then record the combined verdict.

### ET-08: Hostile Ability policy approval

Resolved on main.

- **Spec** §4.1 and Appendix C.3.
- **Build and test** The visibility change landed as `a593ad5`. Main `44b02db` records the approved policy in §4.1 and cites the closed issue in Appendix C.3. `engine/visibility.ts` and `engine/spectator.ts` expose the hostile Ability use while keeping its target and private effects scoped. `engine/spectator.test.ts` and `engine/movement-effects.test.ts` exercise the rule. [Visibility change](https://github.com/AokDesu/poke-monopoly/pull/200), [#192](https://github.com/AokDesu/poke-monopoly/issues/192)
- **Observed** The spec still records the known limit that Vine Pull's displacement is public. The spectator sweep also checks the current feed privacy contract.
- **Reproduction** Owned upstream and settled by the recorded approval.
- **Severity** S3 when open.
- **Owner** Spec owner for the decision, punkharb for implementation.

### ET-09: PlayersArea assertion failed once in a full run

Resolved on main.

- **Spec** §4.1 and §8.
- **Build and test** `web/src/board/PlayersArea.test.tsx`, “opening and closing a seat is a view choice: it never reaches the game”. The four seat-toggle clicks must preserve the action log length and the seat's revision.
- **Observed** Historical run F saw one extra action, and the prior 300-game rerun report recorded the same assertion once. The merged fixture fix (`fc1b978`, 2026-11-24) completes the automatic first-player roll and advances to the human decision before measuring the log. The test still asserts both original conditions. All 11 tests in the file passed in the current full suite. [Fixture fix](https://github.com/AokDesu/poke-monopoly/pull/290), [prior rerun report](../c4-300-game-rerun-report.md)
- **Reproduction** Not reproduced on current main. The historical fixture allowed an automatic game step during the click sequence.
- **Severity** S3 when open.
- **Owner** AokDesu for the web test, punkharb for the merged fixture fix.

## Looked at and not queued

- **Offline Jev eval** `npm run eval:jev -- --offline` exited 0. It scored 154 of 168 answers acceptable on 136 recorded fixtures, including 12 scored from the applied Last Sell Phase sale. It found 0 illegal applied actions in 136 orchestrator replays and 0 leaks in 224 chat requests. Chat intent was 39 of 40 in English and 38 of 40 in Thai, with 16 of 16 adversarial messages detected in each language.
- **Hard policy with Monte Carlo** `npm run sim -- --games 5 --seed 1 --policy jev-hard` finished all 5 games in 5.16 s with 0 aborts, illegal applied actions or invariant failures. All 130 decisions used the backup policy with cause `disabled`, and the run made 0 Jev requests.
- **Merged epic fixes** Current regressions cover the mid-game engine-command guard, private Deal valuation and feed fields, verified save loading, the kill switch and rejected calls, and leaving a Gym window with no battle-ready challenger. These fixes are on main and the fresh runs found no failing seed to queue. [Command guard](https://github.com/AokDesu/poke-monopoly/pull/287), [privacy](https://github.com/AokDesu/poke-monopoly/pull/288), [save loading](https://github.com/AokDesu/poke-monopoly/pull/289), [kill switch and request handling](https://github.com/AokDesu/poke-monopoly/pull/291), [Gym window](https://github.com/AokDesu/poke-monopoly/pull/297)
- **Open server and evidence work** Server audit follow-ups and the Windows runner/G2 plan changes already have Stream B owners. [Server limits](https://github.com/AokDesu/poke-monopoly/pull/299), [server backlog](https://github.com/AokDesu/poke-monopoly/pull/300), [Windows paths](https://github.com/AokDesu/poke-monopoly/pull/303), [G2 plan](https://github.com/AokDesu/poke-monopoly/pull/304)

## §11 demo path against the queue

The browser rehearsal on 2026-11-21 walked steps 1 to 8. A fresh clean-install browser rehearsal still waits on the layout stack. [Recorded rehearsal](../pr-evidence/64-demo-rehearsal/README.md), [epic closeout](https://github.com/AokDesu/poke-monopoly/issues/64#issuecomment-7138143537)

| §11 step | State on main | Queue rows |
| --- | --- | --- |
| 2 Prepared scenario, two options | “Two Balls to choose from” passed in the rehearsal. Current scene tests build and replay it. | ET-04 (resolved) |
| 4 PvP challenge, accept or decline | Passed in the rehearsal, including the Rival class's forced challenge. | none |
| 5 Win, coins or evolution | Passed in the rehearsal (Eevee became Vaporeon). | none |
| 6 Memory from a kept or broken promise | Owner accepted memory-only with no fifth scene. Rehearsal showed the broken promise, trust −2 and memory entries. D3 is on main and the Deal screen is upstream. | ET-02 (resolved), ET-01 (content completeness) |
| 7 Kill switch and backup bot | Passed in the rehearsal. Main has the additional kill-switch and failure-handling regressions. | none |
| 8 Policy-only against Jev | Owner accepted committed results tables plus `sim`, `eval:jev --offline` and `usage`. The live evidence is separate from this offline recheck. | ET-06, ET-07 |

## Add to this queue

Playtest ([#63](https://github.com/AokDesu/poke-monopoly/issues/63)) and A61-6 findings append here under their owner. A row needs all of these, or it is not ready for a fix ticket:

- build SHA and a seed or test identifier, with the command;
- expected behavior and the spec section;
- observed behavior, quoted, and the reproduction status;
- class and severity from the scale above;
- owner, the smallest touched-file set, and dependencies;
- a bounded estimate, and what to cut if it overruns.

Turn a row into an A64-2a or A64-2b ticket only when it is `reproduced` as a rule bug with a named failing seed or test. A rule interpretation is the team's to make, not the fixer's. Do not copy work owned upstream into a second ticket.

## Re-run

```bash
nvm use 24            # the repo requires ^24.15.0
npm ci
unset TYPESAFE_API_KEY ANTHROPIC_API_KEY
export JEV_ENABLED=false HAIKU_ENABLED=false
npm test -- --reporter=default --reporter=json --outputFile.json=/tmp/poke-engine-triage-vitest.json
# If the full run fails under load, rerun the affected files with:
# npx vitest run --maxWorkers=2 path/to/failed.test.ts
npm run sim -- --games 100 --seed 1000002 --seed-set eval --seats 2 --policy random --lap-target 2 --max-steps 5000   # also --seats 3 and 4
npm run sim -- --social --games 100 --seed 1
npm run sim -- --social --require-deals --games 100 --seed 1
npm run sim -- --games 5 --seed 1 --policy jev-hard
npm run eval:jev -- --offline
```

## Follow-ups outside this ticket

- Land the existing Deal screen stack and check the Deal Card flow on its final base (ET-01). [Deal screen](https://github.com/AokDesu/poke-monopoly/pull/283)
- Publish the pending 300-game report refresh (ET-06). [#58](https://github.com/AokDesu/poke-monopoly/issues/58)
- Fix the stale sentence about settlement in `docs/sim.md:61` (ET-02).
- Record the G1 verdict with its evidence (ET-07), and run the clean-install browser rehearsal once the layout stack lands. [G1](https://github.com/AokDesu/poke-monopoly/issues/54), [rehearsal follow-up](https://github.com/AokDesu/poke-monopoly/issues/64#issuecomment-7138143537)
