# Final report, stream B draft: A2, A3, A4, A5, A7, B2 and Part D

Issue [#65](https://github.com/AokDesu/poke-monopoly/issues/65), part of the final report ([#223](https://github.com/AokDesu/poke-monopoly/issues/223), outline in [README.md](README.md)). Spec: §1, §8, §9, §10 (C6).

This is a draft of the stream B sections, written early from what is on `main`, so that report week (10 to 14 Dec) is only filling in live numbers. It follows the outline's "Rules for writing the report": every claim names its evidence path and states n and limits, a figure appears only as a quotation from a committed file, and nothing is pending-as-a-guess. Where a live result is not in yet the section says `pending: <what produces it>, #<issue>`.

Section headings and anchors match the outline, so this file can be pasted section by section. The outline's rows stay the index; this file holds the prose and the quotations.

## Build record

|Item|Value|
|---|---|
|Read at|`main` commit `533314e` (2026-11-24), the tip of `origin/main` when this draft was written|
|Offline eval|`npm run eval:jev -- --offline`, run on that commit, exit 0. Node v22.22.1 (`package.json` asks for `^24.15.0`; the command printed no engine complaint). `TYPESAFE_API_KEY` and `ANTHROPIC_API_KEY` unset, no `.env` read, no network call|
|Output|Not committed. The figures below are quoted from `eval/jev/README.md` and `eval/jev/chat/README.md`; the command's output on `533314e` matched both on every figure quoted here (accuracy, confidence, fixture counts, fallbacks, per-personality rows, chat rows, leak check)|
|Not on `main`|[#292](https://github.com/AokDesu/poke-monopoly/pull/292) (G2 duel harness) and [#286](https://github.com/AokDesu/poke-monopoly/pull/286) (Deal Card response, D3) are open. Nothing from them is quoted. [#293](https://github.com/AokDesu/poke-monopoly/issues/293) (server audit follow-ups) is open|

When the report is assembled, re-run the command and re-read every file named below. The totals will move when [#286](https://github.com/AokDesu/poke-monopoly/pull/286) merges, because it adds Deal fixtures.

## Status of the rows

|Row|Status today|Still to come|
|---|---|---|
|[A2](#a2-hidden-information-leaks--0)|have, as "no known leak and tests assert none"|Speech items against recorded Haiku replies (provenance of the committed set to confirm)|
|[A3](#a3-a-game-can-finish-with-jev-or-haiku-off-or-down)|have for Jev or Haiku off or down with the server up; gaps stated|Demo step 7 live; one-human cases under the kill switch|
|[A4](#a4-ai-spend-against-the-caps)|cap values have; actual spend pending|`npm run usage` on every machine that made live calls|
|[A5](#a5-ai-decision-time-per-turn)|provisional G1 figure only|100 Jev games, G2, participant sessions|
|[A7](#a7-personality-or-messages-change-choices-in-controlled-scenarios)|scenario set and accuracy have; effect size pending|Separation table, chat, memory, Deal accuracy|
|[B2](#b2-eval-set)|have, offline|Calibration, separation, speech items, Deal fixtures|
|[Part D](#part-d-jev-results)|structure and headings; one provisional row|Every live row|

## A2. Hidden-information leaks = 0

Spec §1: hard gate, adversarial set including generated speech (§8). Writer: B (Mrmo0p).

**Draft text.** No leak of hidden information is known on `main` at `533314e`. Tests assert that no seat's observation, event feed, record, Jev request or generated-speech brief carries another seat's secrets, the seed, the RNG or the Event deck order, over generated games of 2 to 4 seats. These tests are a finite set of checks with planted sentinels. They do not prove the absence of every leak: three leaks were found after such checks existed (table below), by review and by a bug hunt, and fixed with regression tests. The report states the gate as "no known leak, with these checks and these three fixed", not as a proof.

**No model in the loop**

|Evidence|Status|What it can show|Limits|
|---|---|---|---|
|`engine/observation.test.ts`, test "500 random mid-game states never show a seat another seat's secrets, RNG or deck order in observations, events or records (§1, §4.1, §4.4, §4.8, §5.4, §8)"; and "private changes leave every other seat's observations and legal choices unchanged in 2/3/4-seat play"|have|Sentinel secrets planted in every seat, then observations, events and records read for every other seat. The second test swaps every other seat's secrets, seed, RNG and Event deck and requires the observer's view and legal choices to be identical.|The title's 500 is the test's own count (25 seeded games). Sentinels only catch what they are planted in. `docs/release/engine-triage.md` ET-05: the sweep has little time margin and times out on a loaded machine; CI is the record.|
|`engine/spectator.test.ts`, test "no spectator view, event or record of 25 seeded all-AI games of 2–4 seats holds a secret of any seat"; "two states with the same public history and different secrets give the identical spectator view"|have|The watch-mode view is the public half only.|Same limits.|
|`engine/movement-effects.test.ts` ("a blocked and an unblocked hostile Ability look the same to a third seat")|have|A third seat cannot tell a blocked from an unblocked hostile Ability.|One mechanism, not a sweep.|
|`engine/deal-facts.test.ts` ("paired-state" test added in #288)|have|Two states the AI cannot tell apart give the same Deal valuation and facts.|Covers the Deal facts only.|

**Jev and Haiku**

|Evidence|Status|What it can show|Limits|
|---|---|---|---|
|`eval/jev/state-leaks.test.ts`: for every engine fixture, "each seat's built state contains only its own secrets", and "no chat item or chat request carries another seat's secrets"|have|The state a Jev request is built from holds only the seat's own information, and chat requests carry no other seat's secret.|Request construction only. The service answers with labels and probabilities, so the request is the leak surface (`eval/jev/chat/README.md`, "Pass expectations").|
|`eval/jev/chat/README.md` (Result note), `eval/jev/chat/en.json`, `eval/jev/chat/th.json`, leak check printed by `npm run eval:jev -- --offline`|have|Adversarial chat items for both languages are caught by the manipulation gate and every request built for the leak check is clean. Figures quoted below.|One recording of one pinned model. The Thai margin is thin (the README says so). Recordings are Jev answers, not Haiku replies.|
|`ai/speech/speech.test.ts`, test "across 25 seeded 2 to 4 seat games, no brief for any seat, target and situation leaks a secret, a chat or a digit"; "a brief reads only public data: planting sentinels in the seat's own hand, Balls, peeks and chats changes nothing"|have|The speech brief that goes to Haiku holds public facts only.|A brief is checked, not Haiku's output. It does not show what live Haiku writes.|
|`ai/speech/speech.test.ts` ("the recorded set has at least 30 adversarial replies across every category", then each reply "is rejected" and "becomes a Greedy bank line, never the reply") over `ai/speech/fixtures/recorded-replies.json`; `ai/speech/exchange.test.ts` over `ai/speech/fixtures/exchange-gate.json`|have, with a provenance limit below|The output screen rejects every adversarial reply (quoted instruction, hidden item, number bait, promise bait, format, foreign species, echo) and the line bank speaks instead.|**Provenance is not stated.** `recorded-replies.json` has no provenance field, its commit message calls them "recorded adversarial replies", and spec §9 says no coding agent records Haiku. `exchange-gate.json` says in its own `provenance` that its answers are written by hand and not recorded. Until stream B confirms who produced `recorded-replies.json`, the report calls it "a committed set of adversarial reply strings", not "recorded Haiku replies". Counted from the file on `533314e`: 51 `unsafe` entries and 6 `safe`, with `node -e "const d=require('./ai/speech/fixtures/recorded-replies.json');console.log(d.unsafe.length,d.safe.length)"`.|
|Speech items run against recorded Haiku replies (spec §8 Eval set)|pending|Leaks = 0 for generated speech, against real Haiku output.|pending: a person with the Haiku key records the replies (spec §9, no agent may); no recorder command exists for speech items, only `npm run speech:smoke`, which prints lines and costs and writes no fixture. [#65](https://github.com/AokDesu/poke-monopoly/issues/65).|

**Leaks found after the checks existed, and fixed.** Each is a merged pull request with its regression tests.

|Pull request|What leaked|How it was found|Fix and regression tests|
|---|---|---|---|
|[#265](https://github.com/AokDesu/poke-monopoly/pull/265) (Poison Sting, C4 abilities)|A rival's Poison Sting appeared in catch and battle odds, previews and choices as a lower win chance, so the debuff was readable by another seat.|Review (Mrmo0p, changes requested), per the PR body "Review fixes".|`challengeOdds`, `battlePreview` and the choice previews strip `combatDebuffed` from every seat but the viewer. Commit `267bdaa` adds tests in `engine/battle-preview.test.ts`, `engine/gym.test.ts`, `engine/protection.test.ts` and `engine/resource-effects.test.ts`; the PR body says a third-seat test covers odds and the pending battle preview and shows the owner still sees it.|
|[#262](https://github.com/AokDesu/poke-monopoly/pull/262) (Deal Card engine, D1)|That a deal exists and what was paid: table talk could be triggered by a deal payment, a speech request carried the viewer's revision, a private proposal could start banter, and the event log could show a deal payment to a third seat or a watcher.|Review (punkharb and AokDesu), per the PR body sections "punkharb's re-review" and "Privacy filter in the web".|Deal records and events are hidden from third seats and spectators; the web filters drop deal payments from table talk and the log. Tests in `engine/deals.test.ts`, `web/src/game/tableTalk.test.tsx`, `web/src/game/store.test.ts` and `web/src/board/EventLog.test.tsx`.|
|[#288](https://github.com/AokDesu/poke-monopoly/pull/288) (A64-V1, A64-V2)|(V2) A Deal's concession bucket depended on the proposer's private combat debuff. (V1) The RNG draw cursor `drawCounter` was in seat and watcher feeds and also counts hidden draws.|The epic [#64](https://github.com/AokDesu/poke-monopoly/issues/64) bug hunt on `main` `f35d3a4`, stream A (PR body).|Only the public Tired status counts toward a Potion's value; both feeds drop `drawCounter` while the raw log keeps it for replay. Tests: `engine/deal-facts.test.ts` (failed before the fix) and `engine/spectator.test.ts` (feed test over 4 seats and the watcher).|

**Quoted figures**

|Figure|Quotation|Source and place|Produced by|
|---|---|---|---|
|Chat adversarial set size|"Together they reach 80 and 32."|`eval/jev/chat/README.md`, opening paragraph|`npm run eval:jev -- --offline`; the command's line on `533314e` reads "80/80 chat-intent messages, 32/30 adversarial items" against spec §8's 80 and 30|
|Manipulation gate, both languages|"The Noul caught 16/16 adversarial items in both languages and flagged 0/40 ordinary messages in both."|`eval/jev/chat/README.md`, "Result note"|Same command, one recording of `jev-1.13.0`; n = 16 adversarial and 40 ordinary per language|
|Leak check|"Leak check: 224 chat requests, 0 leaks."|`eval/jev/chat/README.md`, "Result note"|Same command. The check ran on a two-player state, so 224 means 112 messages for 2 seats|
|Gate margin|"in Thai the lowest adversarial message scored 0.56 ... and the highest ordinary one 0.40"|`eval/jev/chat/README.md`, "Result note"|Same command. The README adds that a slightly softer attack could fall under 0.5|

## A3. A game can finish with Jev or Haiku off or down

Spec §1: hard gate, measured by tests and kill switches, with 1, 2 and 3 AIs and in watch mode. Writer: B (Mrmo0p).

**Draft text.** With Jev or Haiku off, or failing in every way the client can report, the game continues: the AI decides from the fallback policy, speech comes from the line bank, and the badge says why. This is shown by tests, a 100-game kill-switch sim, watch-mode tests with an unreachable decision service, and a rehearsal of demo step 7. It is not shown by a live outage, and two cases are not covered by a committed test (stated under Gaps).

**Policy-only (no Jev call happens)**

|Evidence|Status|What it can show|Limits|
|---|---|---|---|
|`ai/orchestrator.test.ts`, test "JEV_ENABLED=false: 100 games, no network call, every Jev decision a disabled fallback"|have|`--policy jev` with the kill switch on, `fetch` stubbed to reject: it asserts 100 games, 0 aborted, `illegalAppliedActionCount` 0, 0 Jev requests, no `fetch` call, and every decision a `disabled` fallback. This exercises the orchestrator's disabled path with no Jev call, so by spec §8 it is a policy-only result.|One seed (`1`), the sim's all-AI games. Not a live Jev outage.|
|`docs/c4-300-game-report.md`; `docs/c4-300-game-rerun-report.md`; `docs/release/engine-triage.md`, ET-06|have|All-AI games at each seat count finish with both keys absent and `JEV_ENABLED=false`, `HAIKU_ENABLED=false`.|Random policy, all-AI only, snapshots of earlier builds (outline L5). They say nothing about a human seat.|

**Jev and Haiku**

|Evidence|Status|What it can show|Limits|
|---|---|---|---|
|`ai/ai.test.ts` (tests "reports backup-only mode under the kill switch"; the table of unrecognised spellings `0`, `off`, `no`, `disabled`, `n`, `f`, `False0`, `banana`, `1`, each of which keeps Jev off; "the real client is made only with Jev enabled and a key set"); [#291](https://github.com/AokDesu/poke-monopoly/pull/291)|have|The kill switch fails closed: Jev is on only when `JEV_ENABLED` is unset, empty or `true`, and the status badge and the decider agree (spec §9).|Tests of the server. The variable is read per request, but a running server's environment cannot change, so on the real server the switch is a restart (demo rehearsal, "Step 7 detail").|
|`ai/orchestrator.test.ts` ("unusable answers fall back with their reason": 429, 500 and a malformed body give `rate_limited`, `server_error`, `schema_mismatch`; the budget, request-limit and token-budget tests; "past the per-game token budget every later decision falls back"); `ai/ai.test.ts` and the two tests added in #291 (a rejecting Jev call on `/api/ai/decide` and `/api/ai/chat` falls back as `decider_error` and does not crash the process)|have|Each failure class falls back with its reason and the decision still returns a legal action.|Fake clients and a fake `fetch`. Reasons are those listed in `ai/README.md`.|
|`ai/speech/speak.test.ts`: "a client that throws is still a 200 with a bank line", "a slow call answers from the bank at the deadline, and the late answer is never returned", "at the Haiku or total cap every game gets the bank and no call is made"; `ai/ai.test.ts` ("reports speech on with HAIKU_ENABLED=true and its own key, independent of Jev")|have|With Haiku off, failing, late or capped the line bank speaks and the game goes on; Haiku and Jev switch independently.|Fake writer. No live Haiku outage.|
|`web/src/game/watch.test.tsx`: "2, 3 and 4 AI seats play themselves to the engine winner, and the log replays"; "an unreachable decision service finishes the game on the backup bot"|have|Watch mode finishes at 2, 3 and 4 AI seats, and with the decision service down every decision is a `fallback` and the game reaches a result.|Browser tests with a fake server; timing caveat in ET-05.|
|`docs/pr-evidence/64-demo-rehearsal/README.md`, step 7 and "Step 7 detail"|have, rehearsal|A one-human game kept going with the "Backup bot mode" badge and the single banner after a mid-game kill-switch flip (on a scratch server with the fake Jev client) and after a real `JEV_ENABLED=false npm start`.|Walked 2026-11-21 at `b077c1d`, before the fail-closed change in #291. Desktop only, headless. A rehearsal, not the demo.|
|Demo step 7 (spec §11), live|pending|The kill switch shown live with a visible badge.|pending: the live demo, [#65](https://github.com/AokDesu/poke-monopoly/issues/65).|

**Gaps to state in the report (no decision needed, the evidence is as it is)**

- The gate says "with 1, 2 and 3 AIs". Watch mode is covered at 2, 3 and 4 AIs, and the kill-switch sim runs all-AI games. I found no committed test that runs a human seat with 1, 2 and 3 AI seats with the kill switch on. The rehearsal covers one human with rival AIs once. Stream B confirms whether such a test exists before the report states the 1, 2 and 3 claim in full.
- In a human game, `web/src/board/BoardScreen.test.tsx` ("an unavailable opponent service has an explicit retry and preserves the decision until success") shows that when the server itself does not answer, the game stops at a retry prompt. In watch mode the same condition finishes on the backup bot (above). "Jev or Haiku down" is covered with the server up; "the server process down" in a human game ends at a retry, not at a finished game.

## A4. AI spend against the caps

Spec §1: hard cap on Jev and Haiku together, and a separate hard cap on Haiku alone, tracked from the usage log (§9). Writer: B (Mrmo0p).

**Draft text.** The caps are enforced in code and tested; actual spend is not yet known to the repository. The report gives the cap values, the guard, the command that reports spend, and then the spend per machine and in total once the logs are read. Until then the spend line reads `pending`.

**Cap values**

|Quantity|Quotation|Source and place|
|---|---|---|
|Total cap, Jev and Haiku together|`totalCapThb: 1500`|`ai/jev/spend.ts`, `SPEND_CONFIG`; spec §1 and §9|
|Haiku cap|`haikuCapThb: 150`|`ai/jev/spend.ts`, `SPEND_CONFIG`; spec §9|
|Haiku per game|`haikuMaxCallsPerGame: 150`, `haikuMaxInputTokensPerGame: 200_000`|`ai/jev/spend.ts`; spec §9 (raised on 18 Nov 2026, issue #214)|
|Warning|`warnAtShareOfCap: 0.8`|`ai/jev/spend.ts`|
|Jev price and rate|`inputUsdPerMillionTokens: 0.042`, `thbPerUsd: 33`|`ai/jev/spend.ts`; spec §5.1, §9|

**Evidence**

|Evidence|Status|What it can show|Limits|
|---|---|---|---|
|`ai/jev/spend.ts`, `ai/jev/spend.test.ts`, `ai/jev/usage-report.ts`, `ai/jev/usage-cli.ts`; `ai/orchestrator.test.ts` ("at 100% of the cap the next decision falls back with budget_exceeded and sends nothing", "the request that reaches the cap is the last", "the daily budget switches to the fallback the same way"); `ai/speech/speak.test.ts` (Haiku hard stops)|have|The guard that enforces both caps, the fallback at the cap and the report.|Code and tests, not a figure. **Known limit:** [#293](https://github.com/AokDesu/poke-monopoly/issues/293) is open, and its item 4 is "Spend cap overshoot under concurrency" (concurrent decisions all pass the guard before any usage is recorded); items 5 and 6 concern the ledger's robustness. #291's own follow-up list names them. The report must not say the cap cannot be exceeded under concurrent requests until item 4 is closed on `main`. Severities in #293 are proposed, not audit verdicts.|
|`docs/jev-spike-report.md`, "Cost" (a projection)|have|Cost per game and per 300 and 1,000 games, from real token counts.|A projection from synthetic state, Jev only, with the spec's 140 requests per game. Quote it labelled a projection (outline, Part E).|
|`docs/playtest/g1/ai-latency.md`, "Results" ("Spend per game")|have, provisional|Spend for one live team game.|One game, Jev only, Sell Phase requests not included (#150).|
|Actual total, Jev and Haiku spend, each against its cap|pending|The spend report.|pending: `npm run usage` run on every machine that made a live call, then summed ([#65](https://github.com/AokDesu/poke-monopoly/issues/65)). The log `logs/jev-usage.jsonl` is git-ignored, so only the captain's machine (and any other that made live calls) can produce it. Live calls so far include the eval recordings, the chat recordings and the G1 game; which machines made them is not recorded in the repository.|
|Haiku spend|pending|Haiku's own spend and its share of THB 150.|pending: no committed Haiku measurement exists. `npm run speech:smoke` (repository owner only) prints tokens and baht per call; the usage log carries `provider: "haiku"` lines for live games.|

**Command at the end:** `npm run usage` on each machine, or `npm run usage -- --log <copy of logs/jev-usage.jsonl>` for a copied log. It prints Jev and Haiku apart, each against its own cap, and the total against the total cap (`docs/team-setup.md`, "usage log").

## A5. AI decision time per turn

Spec §1: a target, p95 at or under the limit in §1, "report actuals"; not a hard gate. Writer: B (Mrmo0p).

**Draft text.** The one measurement from real play so far is provisional: one team game, 7 AI turns. The full measurement comes from the 100 Jev games, the G2 duel and live playtest sessions. The report quotes the provisional figure with its sample and does not call it a result for the target.

|Evidence|Status|What it can show|Limits|
|---|---|---|---|
|`docs/playtest/g1/ai-latency.md`, "Answer" and "Results"|have, provisional|Quotation: "Provisionally yes: p95 1,055 ms over 7 turns, one team-played game; not a gate measurement", with p50 329 ms, 9 requests (9 ok, 0 failed) and a fallback rate of 2 of 11 decisions, both `missing_facts` at the `sell` decision point.|Its own words: not a participant session, "an early indication". With 7 turns the p95 is set by the slowest turn or two. Strategy and Encounter only: no Sell request reached Jev, so it excludes the Sell Phase request and predates the fix ([#150](https://github.com/AokDesu/poke-monopoly/issues/150)). Read with `npm run usage` on that build's log, which is not committed.|
|`docs/jev-spike-report.md`, "Verdict" and "Latency"|have|Quotation: "p95 was 324 ms and 374 ms in the two runs of the 30-minute window".|Request latency on synthetic state from a home network, 100 calls per run, one at a time. It is not decision time per turn.|
|Decision time over the 100 Jev games|pending|p50 and p95 per turn over many games.|pending: `npm run sim -- ... --policy jev` with a key, then `npm run usage`; the plan for the games is not committed. [#62](https://github.com/AokDesu/poke-monopoly/issues/62).|
|Decision time in the G2 duel, Hard and Normal|pending|Latency of Hard against Normal.|pending: G2 harness in open PR [#292](https://github.com/AokDesu/poke-monopoly/pull/292), then the live run. [#62](https://github.com/AokDesu/poke-monopoly/issues/62).|
|Decision time per participant session|pending|Real sessions with live Jev.|pending: sessions run on a live-Jev build, `npm run usage -- --log <copy>` per session (`docs/playtest/PROTOCOL.md`, section 1). [#63](https://github.com/AokDesu/poke-monopoly/issues/63), [#52](https://github.com/AokDesu/poke-monopoly/issues/52).|

How decision time is computed: a turn's time adds each decision once, however many requests that decision sent (`ai/jev/usage-report.ts`, `turnMs`). Fallback and policy-only games are not claimed (outline).

## A7. Personality or messages change choices in controlled scenarios

Spec §1: eval set, reported with n and effect size. Writer: B (Mrmo0p). Policy-only and Jev are in separate tables.

**Draft text.** The eval set holds paired decision scenarios in which only the personality text differs, with an acceptable-answer set for each personality, recorded once against the pinned model. What is reported today is accuracy against those sets. That measures whether Jev's answer is one the team judged acceptable for that personality. It is not an effect size, and it is not yet a separation table: the report does not say personality "changes choices" until the contrast over the paired scenarios is computed.

**No model in the loop**

|Evidence|Status|What it can show|Limits|
|---|---|---|---|
|`sim/analysis/paired.ts`, `docs/experiments/c5-policy-plan.md` ("Background seats")|have|The paired method, and that the policy experiment's personalities are configured behaviour.|Its own words: "not Jev personality evidence". No personality claim about Jev comes from policy-only runs.|

**Jev in the loop**

|Evidence|Status|What it can show|Limits|
|---|---|---|---|
|`eval/jev/scenarios.ts`, `eval/jev/personality-scenarios.ts`, `eval/jev/promise-scenarios.ts`, `eval/jev/scenario-kit.ts`, `eval/jev/fixtures/`; `eval/jev/README.md` ("The scenarios", "The four contrasts", "Results of the recording")|have|Scenarios per personality, each with an acceptable set, a written reason that cites the personality weights (a test checks the citations) and a recorded answer. Within a state the requests differ only in `you.personality` (a test checks that). Some states are agreement controls where every personality should answer alike.|Acceptable sets are judgements, with small counts. The README: "not a general claim about Jev or the personalities". One recording (`jev-1.13.0`, one request each).|
|The four contrasts (`eval/jev/README.md`)|have, as design|Hostile item against skip, PvP against not, Sell against keep, and Ball choice, each as a named set of states. Contrast definitions and the states per contrast are in the README table.|Design, not a result. PvP is expressed through the Battle Ticket item because no PvP question exists yet (the README's "PvP" paragraph).|
|`eval/jev/promise-scenarios.ts` (`promise_response`, four tables by four personalities: high trust after two kept promises, low trust after one broken)|have, partial|A first, narrow look at memory: the answer to a `no_attack` promise question when the memory differs. The README table gives 4 of 4 for each personality.|Trust, history and role change together, so it is not the memory-only contrast spec §8 asks for, and it covers one decision point. It does not replace the pending memory comparison. Stream B decides whether the report calls it memory evidence.|
|Effect size and uncertainty for the personality contrast|pending|"Personality changes choices", with n and effect size.|pending: computed from the paired scenarios and recorded answers; no committed file does it. [#62](https://github.com/AokDesu/poke-monopoly/issues/62).|
|Chat compared as no message, neutral and relevant persuasion|pending|Chat changes choices.|pending: not run, [#62](https://github.com/AokDesu/poke-monopoly/issues/62). Table talk is excluded by spec.|
|A history of kept promises against broken ones, over choices generally|pending|Memory changes choices.|pending: not run, [#62](https://github.com/AokDesu/poke-monopoly/issues/62).|
|Deal Card response, accuracy raw against applied|pending|How often Jev's raw answer to a Deal question is acceptable, and, separately, how often the applied action (after the confidence floor and the fallback) is legal.|pending: the Jev Deal question, `ai/deal-response.ts` and its Deal fixtures are in open PR [#286](https://github.com/AokDesu/poke-monopoly/pull/286); on `main` `deal_response` is still answered by the auto policy (`ai/README.md`). Report the two as separate figures, as the README does for Choice answers (scored on the raw recorded answer, before the floor and fallback).|
|Calibration and personality-separation tables|pending|Spec §8 Eval set deliverables.|pending: not produced, [#62](https://github.com/AokDesu/poke-monopoly/issues/62).|

**Quoted figures** (`eval/jev/README.md`, "Results of the recording"; command and build in the [build record](#build-record); counts are Jev answers scored against the acceptable sets)

|Personality|Fixtures|Rows correct / total|Strategy|Encounter|Sell|Promise|
|---|---:|---:|---:|---:|---:|---:|
|Greedy|24|31/32|8/8|6/6|13/14|4/4|
|Aggressive|20|26/28|5/6|3/4|14/14|4/4|
|Cautious|20|24/28|5/6|1/4|14/14|4/4|
|Opportunist|20|27/28|5/6|4/4|14/14|4/4|

Read with these limits, which the README states: the Sell column includes rows (`sell-last-phase-final-round`) scored from the applied sale because Jev is not asked in the last Sell Phase (spec §5.6); Sell Nouls are scored at each personality's own sell threshold; the Cautious Encounter misses (3 of 4) fell below the confidence floor and the fallback chose an acceptable catch, which is the raw against applied difference, so the raw score understates what the game would have done there. The per-row misses are listed in the README.

## B2. Eval set

Owner: B (Mrmo0p). Gate: report accuracy, calibration and personality separation, leaks = 0 (spec §8). This layer is **Jev-only**; every figure here is Jev answers or request construction, none is a policy-only result.

**Draft text.** The eval set exists and runs offline in CI with no key. It meets the sizes spec §8 asks for on three of four parts, and the fourth (speech items against recorded replies) is pending. Accuracy is reported against acceptable sets; calibration and personality separation are not yet reported.

**Spec §8 sizes against what is on `main`** (`npm run eval:jev -- --offline` on `533314e`)

|Spec §8 asks for|On `main`|Where it comes from|Status|
|---|---|---|---|
|At least 60 decision scenarios, 15 per personality|Command line: "Spec §8 scenario set (at least 60, 15 per personality): met." Fixtures: "Fixtures: 84 (84 recorded, 0 synthetic)." By personality: "Aggressive 20 (20 recorded, 0 synthetic), Cautious 20 (...), Greedy 24 (...), Opportunist 20 (...)".|`eval/jev/README.md`, "Results of the recording"; the command's own lines|have. The 84 include 16 `promise_response` fixtures (4 per personality), so the 15-per-personality count is met by the 68 Strategy, Encounter and Sell scenarios alone (the README table: 20, 16, 16, 16)|
|At least 80 chat-intent messages, half Thai, half English|"80/80 chat-intent messages"; "th: 40 intent messages", "en: 40 intent messages"|`eval/jev/chat/README.md`; the command's chat lines|have|
|At least 30 adversarial items|"32/30 adversarial items" (16 per language, 8 attacks twice)|`eval/jev/chat/README.md`, "Coverage"|have|
|At least 30 speech items against recorded replies|`ai/speech/fixtures/recorded-replies.json` has an unsafe set that a test requires to hold at least 30|[A2](#a2-hidden-information-leaks--0)|pending as "recorded Haiku replies" until the provenance is confirmed; the offline screening tests are have|
|Report accuracy, calibration, separation; leaks = 0|Below and in [A7](#a7-personality-or-messages-change-choices-in-controlled-scenarios) and [A2](#a2-hidden-information-leaks--0)|||

**Quoted figures** (`eval/jev/README.md`, "Results of the recording"; counts with n; recorded by the captain on 2026-11-18 and 2026-11-20 against `jev-1.13.0`, one request each, through the orchestrator; one recording, not a general accuracy claim)

|Measure|Quotation|n|
|---|---|---|
|Accuracy, decision scenarios|"108/116 (93.1%)"|116 scored rows over 84 fixtures; 12 of the 116 are scored from the applied last-Sell-Phase sale, not a Jev answer|
|`illegalAppliedActionCount`|"0"|84 replays through the orchestrator|
|Fallbacks (`low_confidence`)|"18 of 84 decisions"|84|
|Mean confidence, correct and incorrect|"0.721 (n=53) / 0.480 (n=7); Noul rows have none"|The README and the command both say this is not a calibration claim|

Chat-intent scores, from `eval/jev/chat/README.md`, "Result note", the same command and recording:

|Language|Intent accuracy (n)|Ordinary flagged (n)|Adversarial caught (n)|Expected intent on adversarial (n)|Mean confidence right / wrong|
|---|---|---|---|---|---|
|th|38/40 (95.0%)|0/40|16/16|14/16|0.973 / 0.645|
|en|39/40 (97.5%)|0/40|16/16|15/16|0.971 / 0.720|

The Thai against English difference is one message at n = 40 and the note calls it "a trend, not a measurement". The decision to keep Thai and English chat button-only for C4 is recorded as "confirmed by AokDesu, 2026-11-18" in the same note.

**Raw against applied.** Choice accuracy is scored on the raw recorded answer, before the confidence floor and fallback (`eval/jev/README.md`, last paragraph of "Results of the recording"). The applied action is printed per row by the command (the "Applied" and "Fallback" columns) and the applied actions are all legal (`illegalAppliedActionCount` 0). No committed file reports an accuracy figure for the applied action, so the report does not give one; the Cautious Encounter case above shows why the two differ. Deal accuracy raw against applied is pending on [#286](https://github.com/AokDesu/poke-monopoly/pull/286) (see [A7](#a7-personality-or-messages-change-choices-in-controlled-scenarios)).

**Not in the set yet**

|Item|Status|
|---|---|
|Calibration (confidence against correctness) and personality-separation tables|pending: [#62](https://github.com/AokDesu/poke-monopoly/issues/62). The command prints mean confidence by correctness only|
|Speech items against recorded Haiku replies|pending: a person with the Haiku key, [#65](https://github.com/AokDesu/poke-monopoly/issues/65)|
|Deal Card question and its 20 fixtures|pending: open PR [#286](https://github.com/AokDesu/poke-monopoly/pull/286). Offline totals will change when it merges|
|Thai trial (`docs/jev-thai-trial.md`)|have, as a trial only: messages the team wrote, "a trial, not a measurement"; not pooled with the chat set|

**Count source note.** `eval/README.md`, section "Scenarios (spec §10 C2)", still describes 20 Greedy scenarios as "the one personality so far". That is the C2 snapshot. The report takes counts from `eval/jev/README.md` and the command output, not from that section.

## Part D. Jev results

**What it can and cannot show.** Jev results show what Jev answered, how fast, how often a fallback replaced it and what it cost, on the scenarios and games listed. They cannot show a balance result, a human's opinion, or anything about a Jev release other than the pinned one named in spec §12 (`jev-1.13.0`). Policy-only results are in Part C and never share a table with anything below (spec §8, §10 C6).

Every table below is one source. Rows from different sources (a team game, the 100 Jev games, the duel, the scenarios) are never pooled, and each states its n.

### D1. Offline scenarios and recorded chat (have)

Quote, do not retype: the three tables under [A7](#a7-personality-or-messages-change-choices-in-controlled-scenarios) and [B2](#b2-eval-set), produced by `npm run eval:jev -- --offline` on `533314e`. Recorded, replayed, no live call. Not a game result.

### D2. The 100 Jev games (pending)

Spec §8 Simulation asks for 300 Jev-in-the-loop games; the §10 C5 cut is 100. The report states how many were run. The games are about legality, latency, fallback and spend, not about who wins, so there is no win column here. Source of each column: the `sim` summary (`jev.invalidOutputRate`, `jev.fallbackRate` by cause, `policyCounts`, `illegalAppliedActionCount`, `invariantFailures`) per `sim/README.md`, and `npm run usage` for time and spend.

|Seats|Games (n)|Finished|Aborted|`illegalAppliedActionCount`|Invariant failures|Jev requests|Invalid output rate|Fallback rate, total and by cause|Decision time per turn p50 / p95|Spend THB|
|---|---|---|---|---|---|---|---|---|---|---|
|2|pending|pending|pending|pending|pending|pending|pending|pending|pending|pending|
|3|pending|pending|pending|pending|pending|pending|pending|pending|pending|pending|
|4|pending|pending|pending|pending|pending|pending|pending|pending|pending|pending|

pending: the live run with a key, by a person; a plan for the games (seed range, seat counts, balance) is not committed. [#62](https://github.com/AokDesu/poke-monopoly/issues/62). `sim/README.md` says `--policy jev` makes every Greedy seat's decision, so a personality-balanced Jev set would need a documented policy that does not exist yet; stream B decides what the report claims for personality here.

### D3. Gate G2, Hard against Normal (pending)

Spec §8 Difficulty: show win/tie/loss, effect size, uncertainty and n; if Hard does not beat Normal, say so and never add hidden information to make the graph pass. The report states the verdict in plain words, including a null result.

|Seats|Pairs (n)|Win|Tie|Loss|Paired score effect (Hard minus Normal)|95% interval|Hard decision time p50 / p95|AI turn time p50 / p95|Fallback rate by cause, Hard / Normal|Jev requests|Spend THB|Verdict|
|---|---|---|---|---|---|---|---|---|---|---|---|---|
|2|pending|pending|pending|pending|pending|pending|pending|pending|pending|pending|pending|pending|

pending: the harness is in open PR [#292](https://github.com/AokDesu/poke-monopoly/pull/292) (not on `main`), and the live run by a person with the key. Column names follow spec §8 and that PR's description; adjust them to `docs/experiments/g2-hard-vs-normal.md` once it merges. [#62](https://github.com/AokDesu/poke-monopoly/issues/62). Hard is not offered in setup until G2 passes (outline L4).

### D4. Personality, chat and memory scenarios; calibration and separation (pending)

|Table|Columns|Status|
|---|---|---|
|Personality separation|Contrast, scenarios (n), share of paired scenarios where the answer differs by personality, effect size, interval|pending: [#62](https://github.com/AokDesu/poke-monopoly/issues/62)|
|Chat: no message, neutral, relevant persuasion|Condition, n, choice changed (count), effect size, interval|pending: [#62](https://github.com/AokDesu/poke-monopoly/issues/62)|
|Memory: kept against broken promises|History, n, choice changed (count), effect size, interval|pending: [#62](https://github.com/AokDesu/poke-monopoly/issues/62)|
|Calibration|Confidence bin, answers (n), correct (count)|pending: [#62](https://github.com/AokDesu/poke-monopoly/issues/62)|
|Deal Card response, raw against applied|Raw correct (n), applied legal (n)|pending: open PR [#286](https://github.com/AokDesu/poke-monopoly/pull/286)|

### D5. One team game (have, provisional, never pooled)

|Figure|Source and place|n and limits|
|---|---|---|
|AI decision time per turn p50 and p95, fallback rate and cause, tokens, spend per game|`docs/playtest/g1/ai-latency.md`, "Results"|One team game, 7 AI turns, 11 decisions. Strategy and Encounter only. Provisional and "not a gate measurement". Quote as in [A5](#a5-ai-decision-time-per-turn).|

### D6. Latency spike and Thai trial (have, labelled)

|Figure|Source and place|n and limits|
|---|---|---|
|Request latency, errors, tokens, cost projection|`docs/jev-spike-report.md`, "Latency", "Errors and rate limits", "Tokens", "Cost"|Synthetic state, 100 calls per run, a projection for cost. Raw runs in `eval/jev/results/`.|
|Thai chat trial accuracy and latency|`docs/jev-thai-trial.md`, "Verdict" and "Run"; raw `eval/jev/thai-trial.json`|A trial of 20 messages the team wrote, not a measurement.|

### D7. Spend

Part E of the outline holds the spend figures; see [A4](#a4-ai-spend-against-the-caps). Jev and Haiku spend are reported apart and together against their caps.

## Commands for the live numbers

Run by a person on a machine with the keys in its git-ignored `.env`; no agent runs any of these. Each command was checked against `package.json`, a committed doc, or marked pending if it is not on `main`.

|Number|Command|Exists on `main`|Where it is described|
|---|---|---|---|
|Current offline eval totals (re-run at assembly)|`npm run eval:jev -- --offline`|yes, no key needed|`eval/jev/README.md`|
|Re-record a fixture whose request changed (only if the offline run says "request changed, re-record")|`npm run eval:jev -- --record`|yes, key needed|`eval/jev/README.md`, "Recording"|
|Actual spend, Jev and Haiku apart, against the caps; decision time per turn p50 and p95|`npm run usage` (or `npm run usage -- --log <copy of logs/jev-usage.jsonl>`), on every machine that made live calls, then sum|yes|`docs/team-setup.md`, "usage log"; `ai/jev/usage-cli.ts`|
|The 100 Jev games (Part D2, A5)|`npm run sim -- --games 100 --seed <n> --seed-set eval --seats <2\|3\|4> --policy jev`, run per seat count with the key in the environment. The summary prints `jev.fallbackRate` by cause and `policyCounts`; then `npm run usage`|yes, the command; the plan (seed range, seat split) is **pending**|`sim/README.md`; [#62](https://github.com/AokDesu/poke-monopoly/issues/62)|
|Gate G2, Hard against Normal (Part D3)|`npm run experiment:g2` and its `--analyze`; the exact live command is in `docs/experiments/g2-hard-vs-normal.md`|**no, pending**: in open PR [#292](https://github.com/AokDesu/poke-monopoly/pull/292); there is no `experiment:g2` in `package.json` on `533314e`|[#62](https://github.com/AokDesu/poke-monopoly/issues/62)|
|Haiku cost and latency per call|`npm run speech:smoke` (repository owner only)|yes|`docs/team-setup.md`|
|Speech items against recorded Haiku replies|none|**no, pending**: no recorder exists for speech items|[#65](https://github.com/AokDesu/poke-monopoly/issues/65)|
|Calibration, personality separation, chat and memory comparisons|none|**no, pending**: not built|[#62](https://github.com/AokDesu/poke-monopoly/issues/62)|
|Decision time per participant session|`npm run usage -- --log <copy>` after each live-Jev session|yes|`docs/playtest/PROTOCOL.md`, section 1; [#63](https://github.com/AokDesu/poke-monopoly/issues/63)|
|Fallback rate by cause for live human games|`logs/jev-decisions.jsonl`|The log exists; **no committed command reads it** (G1 read it by hand)|`ai/README.md`, `docs/playtest/g1/ai-latency.md`|
|Demo step 7, the kill switch live|`JEV_ENABLED=false npm start`, then a new game shows the badge|yes (rehearsed 2026-11-21, `docs/pr-evidence/64-demo-rehearsal/README.md`)|Spec §11 step 7; [#65](https://github.com/AokDesu/poke-monopoly/issues/65)|
