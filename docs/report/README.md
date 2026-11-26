# Final report: outline, section owners and an index of where each number comes from

Issue [#223](https://github.com/AokDesu/poke-monopoly/issues/223), under [#66](https://github.com/AokDesu/poke-monopoly/issues/66). Spec: §1 (success criteria), §8 (the four verification layers), §9 (spend), §10 C6 (the report separates policy-only results from Jev results), §11 step 8.

This folder is the scaffold of the course report. It holds no results. Course staff can open this file and see what the report will claim, which committed file backs each claim, who writes each part, and what is still open, before any prose is written. The slide deck is assembled from the same index.

Drafts of the stream B sections (A2, A3, A4, A5, A7, B2 and Part D) are in [stream-b-draft.md](stream-b-draft.md). They quote this outline's evidence and mark every live result pending.

The course's required report format and length are not recorded anywhere in the repository (`docs/PLAN.md` lists only the due date), so this scaffold is plain Markdown. Whoever learns the format records it in `docs/PLAN.md` and adjusts this outline in the same pull request.

## How to read this outline

Every row has one of three statuses.

|Status|Meaning|
|---|---|
|have|The evidence file is committed on `main` and answers the claim at the scope named in the row's limits.|
|pending|The evidence is a plan, an open task or a run that has not happened. The row links the plan or the issue. Nothing pending is quoted as a result.|
|not claimed|The report does not make this claim. The row says why, so the omission is a decision and not an oversight.|

Evidence reports are snapshots. Each one was run on a named build and says which merged work it does not cover. When the report is assembled, each file's own build record is read again and any change since then is stated (see the limitations list below).

## Rules for writing the report

1. **No number is typed into the report except as a quoted pointer to its source file.** A figure appears only as a quotation copied from a committed file, next to that file's path, the heading or field it came from, and the command and build that produced it. The outline below types no figure at all: it names the file and the field, and the quotation is made when the report is assembled. A figure that has no committed source file is not used.
2. **Policy-only results and Jev results never share a table.** Policy-only means a game or test where no Jev or Haiku call happens: random, scripted or fallback policies. Jev results are anything where Jev decided or was scored. A table, chart or slide shows one or the other.
3. **Each side says what it can and cannot show** (spec §8, last bullet): graphs from policies we configured ourselves prove only that the rules work, not that Jev understands relationships. The one sentence for each side is in its section below, and the report repeats it at the top of that section.
4. **Pending evidence is marked pending with its link.** A plan is not a result, and an open pull request is not on `main`.
5. **No participant is named.** Playtest evidence refers to participant codes only (spec §9, `docs/playtest/PROTOCOL.md` section 2).
6. **No key, usage-log body or game state** is copied into the report. The usage log is git-ignored and stays on the machine that wrote it.

## Section owners

Stream owners are those in `docs/PLAN.md`: A is punkharb (engine and sim), B is Mrmo0p (Jev, AI and eval), C is AokDesu (web UI and playtest).

Each owner confirms their sections in the review of the pull request that adds this folder: the owner reads the rows of the sections below that name their stream, and says in the review that the claims, evidence paths, statuses and limits are right for their work. The rota puts the stream C pull request with punkharb for review, so the stream B owner is asked to confirm by a review comment as well. A section whose owner has not confirmed is not final.

|Section|Content|Owner|
|---|---|---|
|[A0](#a0-hypotheses-h1-h2-and-h3)|Hypotheses H1, H2 and H3|C (AokDesu)|
|[Part A, section A1](#a1-illegalappliedactioncount--0)|Illegal applied actions, no model in the loop and Jev in the loop|A (punkharb)|
|[A2](#a2-hidden-information-leaks--0)|Hidden-information leaks|B (Mrmo0p)|
|[A3](#a3-a-game-can-finish-with-jev-or-haiku-off-or-down)|A game finishes with Jev or Haiku off or down|B (Mrmo0p)|
|[A4](#a4-ai-spend-against-the-caps)|AI spend against the caps|B (Mrmo0p)|
|[A5](#a5-ai-decision-time-per-turn)|AI decision time per turn|B (Mrmo0p)|
|[A6](#a6-players-can-tell-an-opponents-personality)|Players can tell an opponent's personality|C (AokDesu)|
|[A7](#a7-personality-or-messages-change-choices-in-controlled-scenarios)|Personality or messages change choices in controlled scenarios|B (Mrmo0p)|
|[Part B, B1](#b1-tests)|Tests layer|A (punkharb)|
|[B2](#b2-eval-set)|Eval set layer|B (Mrmo0p)|
|[B3](#b3-critic)|Critic layer|A (punkharb)|
|[B4](#b4-human)|Human layer|C (AokDesu)|
|[Part C](#part-c-policy-only-results)|Policy-only results and their figure index|A (punkharb)|
|[Part D](#part-d-jev-results)|Jev results and their figure index|B (Mrmo0p)|
|[Part E](#part-e-spend-and-playtest-figures)|Spend and playtest figure index|B for spend, C for playtest|
|[Part F](#part-f-limitations)|Limitations|C (AokDesu), each row names its source owner|

Final assembly and the demo script belong to stream C. The results prose is written later, by each owner, from the index below.

## Part A: one section per success criterion (spec §1)

The criteria are the rows of the §1 table, in that order. Evidence is split by what was in the loop, and a criterion that has both kinds gets two tables, one for no model and one for Jev, so no table mixes them. The `Stream` column names who produced or owns the evidence.

### A0. Hypotheses H1, H2 and H3

Spec §1 states three hypotheses. They have no row in the criteria table, so this section says which criteria test each.

|Hypothesis|Tested by|Note|
|---|---|---|
|H1 Fun: keep-or-sell, Ball choice and attacking are decisions players genuinely hesitate over|The Human layer only: the hesitation answers and the facilitator's hesitation record ([B4](#b4-human)).|No criterion row in the §1 table measures H1. The playtest reports findings and claims no statistical significance (spec §8, Human). Gate G1 asked a narrower version of it and has no verdict yet ([limitation L1](#part-f-limitations)).|
|H2 Personality: personality, chat and memory observably change what the AI does|[A6](#a6-players-can-tell-an-opponents-personality) and [A7](#a7-personality-or-messages-change-choices-in-controlled-scenarios)|Chat evidence covers the player's chat only. Table talk never enters a decision (spec §8, Personality and chat).|
|H3 Engineering: Jev decides on time, legally, at controlled cost, with auditable rules|[A1](#a1-illegalappliedactioncount--0) to [A5](#a5-ai-decision-time-per-turn)|"On time" is a target and "controlled cost" is a hard cap, so they are reported differently.|

### A1. `illegalAppliedActionCount = 0`

Spec §1: hard gate, measured over every test, sim and playtest. Writer: A (punkharb). The Jev part is confirmed by B.

**No model in the loop**

|Evidence|Status|What it can show|Limits|Stream|
|---|---|---|---|---|
|`docs/c1-exit-report.md`, section "Criterion 1"|have|Policy-only sim batches at each seat count on the tuning seeds, each reporting `illegalAppliedActionCount` and `invariantFailures`.|An early engine, a random policy, tuning seeds that are not held out. Quote only as the cycle 1 record.|A|
|`docs/c4-300-game-report.md`, section "Results by seat count"|have|Policy-only batches at each seat count on evaluation seeds, class and seat balanced, failures per batch.|Its own words: a pre-merge baseline. Random policy, Social window off, no Events, no keep value, and two invariants then pending. Zero here does not claim the pending checks ran.|A|
|`docs/release/engine-triage.md`, ET-06|have|The same three commands re-run on a later build, with no failing seed.|The file itself calls the evidence stale for Events, Deals and settlement. It is a regression recheck on published seeds, not a new held-out set.|A|
|[C5 policy-only results](../experiments/c5-policy-results.md#run-record)|have|The held-out run finished 1,008 games with 0 illegal applied actions and 0 active-invariant failures.|Fixed policy-only runner and pinned build. The training run is recorded separately.|A|
|`.github/workflows/ci.yml`|have|Every pull request runs the engine tests and policy-only sims at each seat count (spec §7), so the gate is checked on every change.|The run logs are on GitHub and not in the repository. Cite a run by its URL if one is used.|A|

**Jev in the loop**

|Evidence|Status|What it can show|Limits|Stream|
|---|---|---|---|---|
|`docs/c4-300-game-report.md`, section "Required validation", the offline Jev evaluation paragraph|have|Recorded Jev answers replayed through the orchestrator never produced an illegal applied action.|A replay of recordings over a fixed scenario set, not live play. Quote the command output, not the policy-only tables in the same file. That paragraph predates the personality scenarios and the recorded chat sets, so for the offline replay quote the newer source named in [Part D](#part-d-jev-results) instead.|B|
|The Jev-in-the-loop game set (spec §8 Simulation, §10 C5), issue [#62](https://github.com/AokDesu/poke-monopoly/issues/62)|pending|`illegalAppliedActionCount` over live Jev games.|Not run. It spends against the cap in [A4](#a4-ai-spend-against-the-caps).|B|
|Playtest sheets, `docs/playtest/p5/`|pending|Spec §1 says "every playtest". The session sheet has no column for it, so the exported game log is where it would be read.|No Cycle 5 sheet is committed yet. Whether and where the report reads the count from a log is a decision for B and C.|C|

### A2. Hidden-information leaks = 0

Spec §1: hard gate, adversarial set including generated speech (§8). Writer: B (Mrmo0p).

**No model in the loop**

|Evidence|Status|What it can show|Limits|Stream|
|---|---|---|---|---|
|`engine/observation.test.ts`, `engine/spectator.test.ts`, `engine/movement-effects.test.ts`|have|Each seat's observation carries no other seat's private data, over many generated states.|These are tests, so the evidence is the test run, not a table of figures. `docs/release/engine-triage.md` (ET-05) records that the observation check has little time margin and can time out on a loaded machine. The hostile Ability policy behind some of these tests is marked "Approved rule (#192, captain, 2026-11-17)" in spec §4.1 on `main` at commit `5fa9a43`; the triage file's ET-08 still calls it unapproved and is out of date on that point.|A|

**Jev and Haiku**

|Evidence|Status|What it can show|Limits|Stream|
|---|---|---|---|---|
|`eval/jev/chat/README.md` with `eval/jev/chat/en.json` and `eval/jev/chat/th.json`; `eval/jev/state-leaks.test.ts`|have|Adversarial messages and request-construction checks: no hidden information reaches a Jev request.|`docs/c4-300-game-report.md` and the triage file were run before the English half merged, so they count only part of the set. Re-run `npm run eval:jev -- --offline` at assembly and quote the new output.|B|
|`ai/speech/speak.test.ts`, `ai/speech/speech.test.ts`, `ai/speech/exchange.test.ts`, with `ai/speech/fixtures/recorded-replies.json` and `ai/speech/fixtures/exchange-gate.json`|have|Generated speech is screened and cannot carry a digit, an offer, a promise or a non-public item name. The screen rejects every adversarial reply in `recorded-replies.json` (a test requires at least 30 across every category) and the line bank speaks instead.|Tests against a fake writer. They do not show what live Haiku writes. `recorded-replies.json` has no provenance field, so whether its replies came from Haiku is not stated in the repository (`exchange-gate.json` says its answers are hand-written). Until stream B confirms, the report calls it a committed set of adversarial reply strings, not recorded Haiku replies.|B|
|Speech items run against recorded Haiku replies (spec §8 Eval set)|pending|Leaks = 0 for generated speech, against real Haiku output.|`eval/` holds no recorded Haiku replies, and no recorder command for speech items exists. A person with the Haiku key must record, and no coding agent may (spec §9).|B|
|Leaks found and fixed after the sweeps existed: [#265](https://github.com/AokDesu/poke-monopoly/pull/265) (Poison Sting in odds), [#262](https://github.com/AokDesu/poke-monopoly/pull/262) (Deal privacy), [#288](https://github.com/AokDesu/poke-monopoly/pull/288) (Deal value from a private debuff, RNG cursor in feeds)|have|Each was fixed with regression tests. The report states them, so the gate reads "no known leak", not a proof.|Listed with their tests in [stream-b-draft.md](stream-b-draft.md#a2-hidden-information-leaks--0).|A and B|

### A3. A game can finish with Jev or Haiku off or down

Spec §1: hard gate, measured by tests and kill switches, with 1, 2 and 3 AIs and in watch mode. Writer: B (Mrmo0p).

**No model in the loop**

|Evidence|Status|What it can show|Limits|Stream|
|---|---|---|---|---|
|`docs/c4-300-game-report.md`; `docs/release/engine-triage.md`, ET-06|have|Games at each seat count finish with both server keys absent and `JEV_ENABLED=false`, `HAIKU_ENABLED=false`.|Every seat is a policy, so these are the all-AI case. They say nothing about the one-human case.|A|
|`web/src/game/watch.test.tsx`, `web/src/board/BoardScreen.test.tsx`|have|Watch mode and a human game play on in the browser tests.|Tests, with the timing caveat in ET-05.|C|

**Jev and Haiku**

|Evidence|Status|What it can show|Limits|Stream|
|---|---|---|---|---|
|`ai/orchestrator.test.ts`, `ai/ai.test.ts`, `ai/speech/speak.test.ts`|have|Every failure class falls back and the game continues; with Haiku off the line bank speaks and the badge says why.|Tests, not a live outage. The kill switch has not been shown live in a demo.|B|
|`docs/pr-evidence/64-demo-rehearsal/README.md`, step 7 and "Step 7 detail"|have, rehearsal|A one-human game kept going with the backup-bot badge after a mid-game flip (scratch server, fake Jev client) and after a real `JEV_ENABLED=false npm start`.|Walked 2026-11-21 at `b077c1d`, before the fail-closed change in [#291](https://github.com/AokDesu/poke-monopoly/pull/291). Desktop, headless. A rehearsal, not the demo.|B|
|Demo step 7, the kill switch with a visible badge (spec §11), live|pending|A live demonstration.|Owned by the stream B epic [#65](https://github.com/AokDesu/poke-monopoly/issues/65) and the demo recipe in `docs/release/engine-triage.md` (A64-3).|B|

### A4. AI spend against the caps

Spec §1: hard cap on the total of Jev and Haiku together, and a separate hard cap on Haiku alone, tracked from the usage log (spec §9). The cap values are in `ai/jev/spend.ts` (`SPEND_CONFIG.totalCapThb` and `SPEND_CONFIG.haikuCapThb`) and in spec §1 and §9. Writer: B (Mrmo0p).

**How to read spend.** Every Jev and Haiku request writes one line to `logs/jev-usage.jsonl` (`provider` is `jev` or `haiku`; tokens and timings only). `npm run usage` prints Jev and Haiku spend separately, each with its share of its own cap, and the total against the total cap. `npm run usage -- --log <file>` reads another copy of the log. Both behaviours are described in `docs/team-setup.md`, section on the usage log.

The log is git-ignored, so each machine that made a live call has its own. The report's actual spend is the sum over every such machine's log. Which machines made live calls is not recorded in the repository, so stream B lists them when the spend report is written.

|Evidence|Status|What it can show|Limits|Stream|
|---|---|---|---|---|
|`docs/jev-spike-report.md`, section "Cost"|have|The measured cost per game and the projection to larger game sets, from real token counts.|A projection from synthetic state, not actual spend. It covers Jev only. The report must label it a projection.|B|
|`ai/jev/spend.ts`, `ai/jev/usage-report.ts`, `ai/jev/usage-cli.ts`|have|The guard that enforces both caps and the command that reports them.|Code, not a figure. It proves the cap is enforced in code, not how much was spent. Open [#293](https://github.com/AokDesu/poke-monopoly/issues/293) lists "Spend cap overshoot under concurrency" (item 4) and ledger robustness (item 5): do not say the cap cannot be exceeded under concurrent requests until item 4 is closed on `main`.|B|
|The spend report, `npm run usage` output from every machine that made live calls|pending|Actual total spend, Jev spend, Haiku spend, and each against its cap.|Owned by [#65](https://github.com/AokDesu/poke-monopoly/issues/65). Nothing committed. There is no committed Haiku measurement at all.|B|
|`docs/playtest/g1/ai-latency.md`|have|Spend for one live team game.|One game, Jev only, and Sell Phase requests were not included then (issue [#150](https://github.com/AokDesu/poke-monopoly/issues/150), since closed, needs a re-measure).|B|
|Policy-only runs|have|Spend is nil by construction: they ran with both keys absent.|Stated by `docs/c4-300-game-report.md`. No figure is needed.|A|

### A5. AI decision time per turn

Spec §1: a target (the 95th percentile at or under the limit in §1), "report actuals". It is not a hard gate. Writer: B (Mrmo0p).

|Evidence|Status|What it can show|Limits|Stream|
|---|---|---|---|---|
|`docs/jev-spike-report.md`, section "Latency"|have|Live request latency from a home network, with the request deadlines of spec §5.6 compared.|A request-level measurement on synthetic state, not decision time per turn. Network and city are recorded for part of the runs only.|B|
|`docs/playtest/g1/ai-latency.md`, "Results"|have|The one measurement of AI decision time per turn from real play.|Its own words: provisional, from one team game, "not a gate measurement". It covers Strategy and Encounter only and predates the Sell fix.|B|
|Per-session decision time from each live-Jev playtest, read with `npm run usage -- --log <file>` (`docs/playtest/PROTOCOL.md`, section 1)|pending|Decision time per turn over real participant sessions.|Needs sessions run on a build with live Jev. None is committed.|B and C|
|Decision time over the Jev-in-the-loop game set|pending|Percentiles over many games.|Not run ([#62](https://github.com/AokDesu/poke-monopoly/issues/62)).|B|
|Decision time for fallback or policy-only games|not claimed|n/a|The criterion is about Jev. Fallback timing is not a claim.|n/a|

### A6. Players can tell an opponent's personality

Spec §1: playtest with the Human-layer cohort, reported with no claim of statistical significance. Writer: C (AokDesu).

**People**

|Evidence|Status|What it can show|Limits|Stream|
|---|---|---|---|---|
|`docs/playtest/PROTOCOL.md` section 6 (the four questions) and `docs/playtest/session-sheet.csv` (column `q2_opponent_personality`)|have|How the answers will be collected. The protocol is the method.|A method, not results.|C|
|`docs/playtest/p5/README.md`, with the Cycle 5 sheets `docs/playtest/p5/session-sheet-<host>.csv`|pending|The participants' answers about each rival's personality, one row per session.|No Cycle 5 sheet is committed yet and its build record is blank. The README says no sheet is committed before its first real row.|C|
|`docs/playtest/g1/session-sheet-A.csv`, `docs/playtest/g1/session-sheet-B.csv`|have|Early answers from the gate G1 round. Question 2 is answered there.|A different round, a much earlier build, and Jev off in some sessions. Do not mix G1 and Cycle 5 rows in one table.|C|
|Statistical significance of any personality finding|not claimed|n/a|Spec §1 and §8 say none is claimed.|n/a|

### A7. Personality or messages change choices in controlled scenarios

Spec §1: eval set, reported with n and effect size. Writer: B (Mrmo0p). Policy-only and Jev are in separate tables.

**No model in the loop**

|Evidence|Status|What it can show|Limits|Stream|
|---|---|---|---|---|
|`sim/analysis/paired.ts` and `sim/analysis/paired.test.ts`|have|The paired-block method used in the [C5 policy-only results](../experiments/c5-policy-results.md#paired-win-credit-and-ties).|The paired effects describe configured policy choices.|A|
|`docs/experiments/c5-policy-plan.md`, "Background seats"|have|States that personality backgrounds in the policy experiment are configured behaviour.|Its own words: "not Jev personality evidence". Nothing in the policy-only runs supports a personality claim about Jev.|A|

**Jev in the loop**

|Evidence|Status|What it can show|Limits|Stream|
|---|---|---|---|---|
|`eval/jev/scenarios.ts`, `eval/jev/personality-scenarios.ts`, `eval/jev/scenario-kit.ts` and `eval/jev/fixtures/`; the scenario tables and the section "Results of the recording" in `eval/jev/README.md`; `eval/README.md` (merged in pull request [#235](https://github.com/AokDesu/poke-monopoly/pull/235) for issue [#233](https://github.com/AokDesu/poke-monopoly/issues/233))|have|The decision scenarios for Greedy, Aggressive, Cautious and Opportunist, each with an acceptable-answer set, a written reason and a recorded `jev` answer. Within one state the requests differ only in the personality, which is the paired design of spec §8, and a test checks that. The README gives rows correct per personality and the misses.|Accuracy against acceptable sets that are themselves judgements, with small counts. The README says these are "not a general claim about Jev or the personalities", and `eval/README.md` itself says no calibration claim yet. Recorded once against one pinned model.|B|
|Effect size and uncertainty for the personality contrast, computed from those paired scenarios|pending|Personality changes choices, with n and effect size (spec §8).|The scenarios and their recorded answers exist, but no committed file reports an effect size or a separation table over them. Stream B epic [#62](https://github.com/AokDesu/poke-monopoly/issues/62).|B|
|Chat compared as no message, neutral and relevant persuasion|pending|Chat changes choices.|Not run ([#62](https://github.com/AokDesu/poke-monopoly/issues/62)). Table talk is excluded from this comparison by spec.|B|
|`eval/jev/promise-scenarios.ts` and the section "Promise response scenarios" in `eval/jev/README.md`|have, partial|A first, narrow look at memory: the `promise_response` answer after two promises kept (high trust) against one broken (low trust), per personality, with recorded answers.|Trust, history and role change together, and one decision point is covered, so it is not the memory-only contrast of spec §8. It does not replace the row below. Stream B decides whether the report calls it memory evidence.|B|
|A history of kept promises compared with a history of broken ones, over choices generally|pending|Memory changes choices.|Not run ([#62](https://github.com/AokDesu/poke-monopoly/issues/62)). Depends on promise settlement, trust and memory evidence in the engine being what the sim and the scenarios read.|B|
|Deal Card response, accuracy of the raw answer against the applied action|pending|Jev's answer to a Deal question, scored raw and, separately, the applied action's legality.|The Jev Deal question and its fixtures are in open pull request [#286](https://github.com/AokDesu/poke-monopoly/pull/286), not on `main`. Report the two figures apart.|B|
|Calibration (confidence against correctness) and personality-separation tables|pending|Spec §8 Eval set deliverables.|Not produced ([#62](https://github.com/AokDesu/poke-monopoly/issues/62)).|B|

## Part B: one section per verification layer (spec §8)

Each layer covers what the one below misses. A section here names the layer's gate and where the evidence is. Rows that already appear in Part A are named by section, not repeated.

### B1. Tests

Owner: A (punkharb). Gate: every test passes in CI (spec §8).

|Claim|Evidence|Status|Limits|
|---|---|---|---|
|Engine invariants hold over generated action sequences and replay is deterministic|The engine, sim and property tests; `.github/workflows/ci.yml`; [A1](#a1-illegalappliedactioncount--0)|have|The triage file's reading (two invariants pending, deals atomic and promises close on the right turn) is older than `main`. On `main` at commit `5fa9a43`, `engine/invariants.ts` marks `promise-closes-on-own-turn` active and `deals-atomic` still pending, so deal atomicity is not checked by an invariant yet. Read `INVARIANTS` at assembly for what is active.|
|The full suite passes in one run on a developer machine|`docs/release/engine-triage.md`, ET-05|pending|Its own words: the suite times out under load while the rules hold. CI is the record. Do not quote a local full-suite pass unless one was observed.|

### B2. Eval set

Owner: B (Mrmo0p). Gate: report accuracy, calibration and personality separation, leaks = 0 (spec §8). This layer is **Jev-only**.

|Claim|Evidence|Status|Limits|
|---|---|---|---|
|Decision scenarios, chat-intent messages and adversarial items exist and run offline|`eval/README.md`, `eval/jev/README.md`, `eval/jev/scenarios.ts`, `eval/jev/personality-scenarios.ts`, `eval/jev/chat/README.md`, `eval/jev/chat/`, `npm run eval:jev -- --offline`|have|Whether the set meets the sizes spec §8 asks for is read from the command's own output at assembly, not typed here. Speech items are pending ([A2](#a2-hidden-information-leaks--0)). Take counts from `eval/jev/README.md` and the command output: the "Scenarios (spec §10 C2)" section of `eval/README.md` is the C2 snapshot (20 Greedy scenarios) and is out of date.|
|Chat-intent scores from recorded Jev answers, English and Thai|`eval/jev/chat/recorded/en.json`, `eval/jev/chat/recorded/th.json`; the section "Result note" in `eval/jev/chat/README.md` (merged in pull request [#236](https://github.com/AokDesu/poke-monopoly/pull/236))|have|Intent accuracy, ordinary messages wrongly flagged, adversarial items caught and the leak check, per language, with n.|One recording of one pinned model, counts with n, not a general accuracy claim. The recordings are Jev answers, not Haiku replies.|
|Accuracy, calibration, separation tables|[A7](#a7-personality-or-messages-change-choices-in-controlled-scenarios)|pending|Not produced. Accuracy and mean confidence by correctness are printed by the offline command, and the README says that is not a calibration claim.|
|Thai free text works, or chat stays button-only (a spec §10 C4 decision)|`eval/jev/chat/README.md`, "Result note: Thai free text or button-only"; the earlier trial in `docs/jev-thai-trial.md`|have|The note compares Thai with English on the same recorded set and gives its reasons. Its own words: the decision is "proposed; the captain confirms", so the report states it as proposed until the confirmation is recorded in a committed file. The trial before it is "a trial, not a measurement", from messages the team wrote.|

### B3. Critic

Owner: A (punkharb). Gate: no single exploit policy dominates every context, reported with n (spec §8). This layer is **policy-only**.

|Claim|Evidence|Status|Limits|
|---|---|---|---|
|The plan found zero dominance candidates across the tested seat counts|[C5 Critic readout](../experiments/c5-policy-results.md#critic-readout)|have|24 pairs per cell with a seeded random control. Never-negotiate exercised chat and promises. Deal Card coverage is pending [#164](https://github.com/AokDesu/poke-monopoly/issues/164).|
|An LLM agent hunting for exploits through MCP tools|n/a|not claimed|Spec §8 marks it a stretch layer and it is not built.|

### B4. Human

Owner: C (AokDesu). Gate: report issues and findings from a playtest, with no artificial thresholds (spec §8).

|Claim|Evidence|Status|Limits|
|---|---|---|---|
|The playtest followed a written protocol that stores no personal data|`docs/playtest/PROTOCOL.md`|have|A method. Participants appear as codes only.|
|Gate G1 (a gate of cycle 2) has a verdict|`docs/release/engine-triage.md`, ET-07; `docs/playtest/g1/ai-latency.md`|pending|`docs/playtest/g1/G1-report.md` does not exist. See [L1](#part-f-limitations).|
|Cycle 5 findings, issues prioritised|`docs/playtest/p5/`; epic [#63](https://github.com/AokDesu/poke-monopoly/issues/63)|pending|No sheet committed yet.|

## Part C: policy-only results

**What it can and cannot show.** Policy-only results show that the rules, the engine checkers and the simulation work and what configured policies do on given seeds. They cannot show that Jev decides well, understands relationships or plays a personality, because no Jev call happened in any of them (spec §8, last bullet).

Everything in this part comes from games with both server keys absent. This is the figure index for the policy-only results table or slide. No figure is typed here: each row names where the quotation comes from.

|Figure the report will quote|Source file and place|Produced by|Status|
|---|---|---|---|
|Games finished, illegal applied actions, invariant failures and aborts, per seat count, on tuning seeds|`docs/c1-exit-report.md`, "Criterion 1" tables|`npm run sim` with the commands printed in the file|have|
|The same, per seat count, on evaluation seeds, with ties, mean turns, mean final coins and win credit by seat|`docs/c4-300-game-report.md`, "Results by seat count"|The three commands in "Scope and reproducibility"|have|
|Win credit by class and participation by seat and class|`docs/c4-300-game-report.md`, "Results by class"|Same commands|have|
|The same run re-checked on a later build|`docs/release/engine-triage.md`, ET-06|The commands under "Re-run" in that file|have|
|Catching, shop and sale metrics per seat count|`docs/c1-exit-report.md`, the run output under "Criterion 1"; `docs/sim.md` defines every field|`npm run sim`|have (tuning seeds, early engine)|
|Hostile-item use per opportunity and promise accounting|[C5 hostile-item and promise tables](../experiments/c5-policy-results.md#hostile-items-and-promises)|`npm run experiment` on the C5 held-out range|have|
|Exploit-policy paired differences with intervals, per policy and seat count, with missing pairs and vacuity flags|[C5 paired results](../experiments/c5-policy-results.md#paired-win-credit-and-ties) and [exploit opportunities](../experiments/c5-policy-results.md#exploit-opportunities)|`npm run experiment` and `sim/analysis/paired.ts` on the C5 held-out range|have|
|A refreshed record for the current build, including Events, keep value, settlement and personalities|`docs/release/engine-triage.md`, ET-06 "What is still missing"|A refresh run, owned by A|pending|

The C4 report and the C5 held-out run used disjoint evaluation ranges. Both ranges are recorded as consumed in the [C5 seed ledger](../experiments/c5-policy-plan.md#seed-use-ledger).

## Part D: Jev results

**What it can and cannot show.** Jev results show what Jev answered, how fast, how often a fallback replaced it and what it cost, on the scenarios and games listed. They cannot show a balance result, a human's opinion, or anything about a Jev release other than the pinned one named in spec §12.

This is the figure index for the Jev results table or slide.

|Figure the report will quote|Source file and place|Produced by|Status|
|---|---|---|---|
|Live request latency, errors, tokens and the cost projection|`docs/jev-spike-report.md`, "Latency", "Errors and rate limits", "Tokens", "Cost"|`eval/jev/spike.ts`, raw runs in `eval/jev/results/`|have|
|Thai chat trial accuracy and latency|`docs/jev-thai-trial.md`, "Verdict" and "Run"|`eval/jev/thai-trial.ts`, raw run `eval/jev/thai-trial.json`|have, as a trial only|
|Offline scenario accuracy, fixture replays, illegal applied actions and leak checks, for all four personalities|The headline lines of `npm run eval:jev -- --offline`, quoted from the section "Results of the recording" in `eval/jev/README.md` (the same command's output). `docs/c4-300-game-report.md`, "Required validation", is the older quotation and is not used.|The command, run on `main` at commit `9cacb98` and again on `main` at commit `5fa9a43` (Node 24), both on 2026-11-19, after pull requests [#235](https://github.com/AokDesu/poke-monopoly/pull/235) and [#236](https://github.com/AokDesu/poke-monopoly/pull/236) merged, and a third time on `main` at commit `533314e` on 2026-11-24 (Node 22.22.1). Its accuracy, fixture, replay, per-personality and leak lines matched the committed READMEs each time. The run output itself is not committed, so the quotation source is the README. Run it again at assembly and quote that output with the commit it ran on; the totals will change when [#286](https://github.com/AokDesu/poke-monopoly/pull/286) adds Deal fixtures.|have, refreshed on 2026-11-24|
|Chat-intent scores, English and Thai, from recorded answers|`eval/jev/chat/README.md`, "Result note"; per-item answers in `eval/jev/chat/recorded/`|`npm run eval:jev -- --offline`, run in the same refresh|have, one recording, counts with n|
|Personality scenarios: rows correct per personality and the listed misses|`eval/jev/README.md`, "Results of the recording"|`npm run eval:jev -- --offline`, run in the same refresh|have, small counts, not a general claim|
|Decision time per turn and fallback rate, one team game|`docs/playtest/g1/ai-latency.md`, "Results"|`npm run usage` and `logs/jev-decisions.jsonl` (not committed)|have, provisional|
|Results over the Jev-in-the-loop game set|None yet|Stream B, [#62](https://github.com/AokDesu/poke-monopoly/issues/62)|pending|
|Hard against Normal on paired seeds (gate G2) and the plain statement if Hard does not win|None yet. The harness is in open pull request [#292](https://github.com/AokDesu/poke-monopoly/pull/292), not on `main`|Stream B, [#62](https://github.com/AokDesu/poke-monopoly/issues/62), spec §10 C5|pending|
|Personality, chat and memory scenarios; calibration and separation tables|None yet|Stream B, [#62](https://github.com/AokDesu/poke-monopoly/issues/62)|pending|

## Part E: spend and playtest figures

These are neither policy-only nor Jev-only, so they have their own tables. Spend covers Jev and Haiku. Playtest figures come from people.

**Spend**

|Figure the report will quote|Source file and place|Produced by|Status|
|---|---|---|---|
|Total, Jev and Haiku spend against their caps|A spend report built from `npm run usage` output of every machine that made live calls|Stream B, [#65](https://github.com/AokDesu/poke-monopoly/issues/65)|pending|
|Cost per game and projection|`docs/jev-spike-report.md`, "Cost"|The spike|have, labelled a projection|
|Cap values|`ai/jev/spend.ts`, `SPEND_CONFIG`; spec §1 and §9|n/a|have|

**Playtest**

|Figure the report will quote|Source file and place|Produced by|Status|
|---|---|---|---|
|Game length, drop-off, meaningful choices, hesitation counts and the four answers, per participant code. `P5` game length starts at "Go to the board", `G1` at the first-player roll, so the two are not comparable: quote them apart, never pooled (`docs/playtest/p5/README.md`)|`docs/playtest/p5/session-sheet-<host>.csv`|Facilitators, following `docs/playtest/PROTOCOL.md`|pending|
|The build each session ran on|`docs/playtest/p5/README.md`, "Build record"|The build check|pending (the row is blank)|
|Gate G1 sheets and latency|`docs/playtest/g1/`|The G1 round|have, with no verdict ([L1](#part-f-limitations))|

## Part F: limitations

Each row is seeded from what is known today. Whoever assembles the report re-reads each source and updates it. The owner is the stream that knows the row best.

|ID|Limitation|Source|Owner|
|---|---|---|---|
|L1|**Gate G1 has no verdict.** There is no combined G1 report, one measurement of decision time per turn exists and is called provisional, and no facilitator-observed hesitation is logged in the committed G1 sheets. The triage file calls it a hard gate, and the epic says never to cut the hard gates.|`docs/release/engine-triage.md`, ET-07; `docs/playtest/g1/ai-latency.md`; issue [#52](https://github.com/AokDesu/poke-monopoly/issues/52)|B and C|
|L2|**Sample sizes are small and differ by source.** One team game for decision time. A trial of messages the team wrote for Thai chat. Synthetic state for the latency spike. Each cell of the policy experiment has few pairs by design and its intervals will be wide. The playtest has no pass threshold and no claim of significance. The report quotes n from each source next to each figure and never pools sources.|`docs/playtest/g1/ai-latency.md`; `docs/jev-thai-trial.md`; `docs/jev-spike-report.md`; `docs/experiments/c5-policy-plan.md`, "Analysis"|A, B and C|
|L3|**Spend is read from a log that stays on each machine.** Jev and Haiku are counted together against one cap and Haiku also has its own. `npm run usage` reports both, each against its cap. The committed cost figures are projections, not actual spend. There is no committed Haiku measurement.|[A4](#a4-ai-spend-against-the-caps)|B|
|L4|**Shipped differs from specified.** Hard is not offered in setup because it waits for gate G2 (`web/src/game/setup.ts`), so a report that mentions Hard says whether the duel was run. Deal Cards are still an open ticket ([#164](https://github.com/AokDesu/poke-monopoly/issues/164)), and `deals-atomic` is still pending in `engine/invariants.ts`. These three statements were re-checked on `main` at commit `5fa9a43` on 2026-11-19, which also holds the promise settlement and Social window work. The hostile Ability policy is no longer a difference: spec §4.1 marks it approved, and only the triage file's ET-08 still says otherwise. Re-check each row against `main` again at assembly and add a row for any other difference found.|Spec §1 "Delivery scope", `docs/release/engine-triage.md` (ET-01, ET-08), `docs/engine-contract.md`|A and C|
|L5|**Evidence files are snapshots.** The 300-game policy-only report is a pre-merge baseline with the Social window off, and the triage file calls it stale. Both predate work merged since, for example the English chat set, the personality scenarios, settled promises and the Social window screen. The report cites the build each file was run on and says what has changed. The triage file's ET-02 text (promise settlement not yet on main) is already out of date: the invariant is active on `main` at commit `5fa9a43`.|`docs/c4-300-game-report.md`; `docs/release/engine-triage.md`|A|
|L6|**Policy-only graphs do not show that Jev understands relationships** (spec §8, last bullet).|Spec §8|A|
|L7|**The full test suite is not clean in one local run on a shared machine.** It times out under load while the rules hold, and CI is the record.|`docs/release/engine-triage.md`, ET-05|A|
|L8|**Course report format and length are not recorded.** This scaffold is plain Markdown.|`docs/PLAN.md`|C|
|L9|**The Cycle 5 playtest has no data yet and holds codes only.** Nothing in the report names a participant.|`docs/playtest/p5/README.md`; `docs/playtest/PROTOCOL.md` section 2|C|

## Open items that block the final report

None of these is done by this folder.

- The Jev-in-the-loop games, the Hard against Normal duel, and the personality, chat and memory scenarios: [#62](https://github.com/AokDesu/poke-monopoly/issues/62).
- The spend report and the demo's kill-switch step: [#65](https://github.com/AokDesu/poke-monopoly/issues/65).
- The held-out policy-only run and its report: tickets under [#61](https://github.com/AokDesu/poke-monopoly/issues/61).
- Cycle 5 playtest sessions and the build record: [#63](https://github.com/AokDesu/poke-monopoly/issues/63).
- A verdict for gate G1 and a re-measure of decision time after the Sell fix: [#52](https://github.com/AokDesu/poke-monopoly/issues/52).
- Deal Cards: [#164](https://github.com/AokDesu/poke-monopoly/issues/164).
- The speech items for the eval set, recorded by a person with the Haiku key.
