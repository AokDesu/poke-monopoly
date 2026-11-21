# Engine and sim release-blocker triage

Ticket A64-1 of epic [#64](https://github.com/AokDesu/poke-monopoly/issues/64) (C6 bug fixes and freeze). Spec: §8 (Tests, Human and Simulation layers), §10 C6, §11.

This is a queue of **candidates**, not a list of proven bugs. It tells the owner which candidates are worth a fix ticket (A64-2a/2b), which are only missing evidence, and which already have an owner. It changes no code, spec or schedule.

**Refreshed 2026-11-21 on main `703d372`.** The first version was written on 2026-11-17 on `56fb27f`. Every row was re-read against current main and the open pull requests, and the commands under Re-run were run again. A row is marked resolved only where main or a run of mine shows it. The stretch classes and the freeze checklist and dates are not covered here (the dates are stale until [#183](https://github.com/AokDesu/poke-monopoly/issues/183) is re-planned).

## Result

**No reproduced rule defect.** On the main commit below, no failing seed and no failing invariant was found in 500 sim games. On Node 24 under load the full `npm test` failed 19 of 3,544 tests (13 timeouts, 5 "Unable to find" waits and 1 assertion, all in 10 files); the same 10 files passed (327 of 327) when rerun with 2 workers and the default timeouts (ET-05, ET-09). CI on main passed.

Since the first version, the Event deck, promise settlement and the Deal Card legality and atomic commit (D1) reached main, and with them the two invariants that were `pending` (`deals-atomic` and `promise-closes-on-own-turn`) are now `active`. No invariant is `pending` on main.

| Question                                          | Answer                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Is any rule bug reproduced?                       | No. Events, settlement and the D1 deal path are now on main and ran clean in the sims below. Not attempted for the Deal facts and AI response that are only on open branches ([#269](https://github.com/AokDesu/poke-monopoly/pull/269), [#271](https://github.com/AokDesu/poke-monopoly/pull/271)).                                                    |
| What blocks the release now?                      | Missing features with an owner, not defects: the rest of Deal Cards (D2 [#269](https://github.com/AokDesu/poke-monopoly/pull/269) and D3 [#271](https://github.com/AokDesu/poke-monopoly/pull/271), both approved and not merged; the Deal screen [#138](https://github.com/AokDesu/poke-monopoly/issues/138), unassigned). Events and settlement are done. |
| Does the old timeout report prove a rule defect?  | No. See ET-05. It is a test-reliability candidate under load, and raising timeouts is not the proposed fix.                                                                                                                                                                                                                                            |
| Is there a candidate for a fix ticket (A64-2a/b)? | Not yet. Keep the A64-2 reserve for what playtest [#63](https://github.com/AokDesu/poke-monopoly/issues/63) and the A61-6 run find. ET-05 is still the only candidate that is a plain code change, and it is test-only. ET-09 is a single unexplained assertion failure with no reproduction.                                                          |

## Evidence base

| Item          | Value                                                                                                                                                                                                                                                                                                 |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Build         | main `703d3724141b478691e0808dc9783024d7baaeeb` (merge of #276, committed 2026-11-21), engine 0.22.0, content 1.4.0. The first version used `56fb27f7f786097e2f0d9623191ccdc46fa810d1`, engine 0.18.0, content 1.3.0.                                                                                  |
| Date          | 2026-11-21                                                                                                                                                                                                                                                                                            |
| Machine       | 12 cores, shared with other lanes. Load average 1.8 to 10.4 over the runs below.                                                                                                                                                                                                                      |
| Node          | The repo requires `^24.15.0` (`package.json`, `.node-version` is `24`). Every run below used Node 24.22.3 (the shell default was 22.22.1, so it was switched with `nvm use 24`). The first version's runs A and B used Node 22.22.1 by mistake.                                                       |
| Keys          | `TYPESAFE_API_KEY` and `ANTHROPIC_API_KEY` absent. `JEV_ENABLED` and `HAIKU_ENABLED` unset for `npm test`, `false` for sim and eval. No live Jev or Haiku call.                                                                                                                                       |
| CI            | CI on main at `703d372` passed ([run 44906895252](https://github.com/AokDesu/poke-monopoly/actions/runs/44906895252)). The first version cited run 44067424342 on `56fb27f`.                                                                                                                         |
| Raw output    | Task evidence outside git, not committed. Re-run with the commands below.                                                                                                                                                                                                                             |
| Not examined  | Browser play by me (the 2026-11-21 demo rehearsal in `docs/pr-evidence/64-demo-rehearsal/` is cited, not repeated), live Jev, live Haiku, and anything only on an open branch.                                                                                                                         |
| Open pull requests read | [#269](https://github.com/AokDesu/poke-monopoly/pull/269) (D2), [#271](https://github.com/AokDesu/poke-monopoly/pull/271) (D3), [#278](https://github.com/AokDesu/poke-monopoly/pull/278) (review follow-ups, `ai/`) and [#279](https://github.com/AokDesu/poke-monopoly/pull/279) (300-game rerun report). Read through `gh`, not checked out. |

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

Ordered by what to look at first: completion and information invariants, then demo-blocking Deals, then the rest. Rows that are resolved on main are listed last and stay as the record.

| ID                                                              | Candidate                                                                                                      | Class            | Severity              | Status                                                                                                                                                  | Owner                                  |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ---------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| [ET-01](#et-01-deal-cards)                                      | Deal Cards: D1 is on main; budget, valuation and AI response (D2, D3) are approved and not merged; no Deal screen | Upstream-owned   | S1                    | D1 merged ([#262](https://github.com/AokDesu/poke-monopoly/pull/262)); D2 [#269](https://github.com/AokDesu/poke-monopoly/pull/269) and D3 [#271](https://github.com/AokDesu/poke-monopoly/pull/271) open | Mrmo0p (Stream B); #138 unassigned (C) |
| [ET-05](#et-05-full-suite-timeouts-under-load)                  | Full `npm test` times out under load; the §4.1 leak sweeps are among the timeouts                              | Test reliability | S3                    | reproduced (load)                                                                                                                                       | punkharb, with B and C for their files |
| [ET-09](#et-09-playersarea-assertion-failed-once-in-a-full-run) | One `PlayersArea.test.tsx` assertion failed in a loaded full run and passed alone                              | Evidence hole    | S3                    | not reproduced                                                                                                                                          | AokDesu (Stream C)                     |
| [ET-06](#et-06-the-300-game-evidence)                           | The 300-game record on current main is in an open PR; my 500-game rerun is clean                               | Evidence hole    | S3                    | not reproduced; record in [#279](https://github.com/AokDesu/poke-monopoly/pull/279)                                                                    | punkharb                               |
| [ET-07](#et-07-gate-g1-evidence-is-incomplete)                  | Gate G1 has no combined verdict and no participant latency                                                     | Evidence hole    | S1 (gate), not engine | not attempted                                                                                                                                           | Mrmo0p and AokDesu (B and C)           |
| [ET-02](#et-02-promise-settlement)                              | Promise settlement and `promise-closes-on-own-turn`                                                            | Upstream-owned   | S1                    | **resolved**: merged in [#198](https://github.com/AokDesu/poke-monopoly/pull/198)                                                                      | Mrmo0p (Stream B)                      |
| [ET-03](#et-03-event-deck)                                      | Event squares                                                                                                  | Upstream-owned   | S2                    | **resolved**: merged in [#188](https://github.com/AokDesu/poke-monopoly/pull/188)                                                                      | punkharb (Stream A)                    |
| [ET-04](#et-04-stale-bases-and-version-stamps)                  | Version stamps of #188 and #198; the next stamp is claimed by #269                                             | Upstream-owned   | S3                    | **resolved** for #188 and #198; recheck when #269 merges                                                                                                | punkharb and Mrmo0p                    |
| [ET-08](#et-08-hostile-ability-policy-approval)                 | Hostile Ability policy approval                                                                                | Upstream-owned   | S3                    | **resolved**: spec on main says "Approved rule (#192, captain, 2026-11-17)"                                                                             | captain; punkharb for any change       |

## Candidates

### ET-01: Deal Cards

- **Spec**: §4.8 (Deal Card, concession budget), §5.3, §8 ("deals are atomic"), §10 C6 (never cut Deals), §11 step 6.
- **Build and test**: main `703d372`. `deals-atomic` is `status: 'active'` (`engine/invariants.ts:1234`); the first version found it `pending`. The engine has `engine/deals.ts` and `engine/deals.test.ts`, the five deal actions (`propose_deal`, `respond_deal`, `counter_deal`, `confirm_deal`, `cancel_deal`) are in `engine/contract/schema.ts`, and `web/src/game/tableTalk.ts:102` lists them as table-talk actions. D1 is [#262](https://github.com/AokDesu/poke-monopoly/pull/262), merged 2026-11-21 as `9240c4c`.
- **Expected**: a Deal commits atomically or leaves the state unchanged; over budget is rejected by code with no Jev call; a revealed item is visible only to the two parties; save, resume and replay reproduce a game with deals ([#164](https://github.com/AokDesu/poke-monopoly/issues/164) acceptance).
- **Observed** (run on main, run E below): `npm run sim -- --social --games 100 --seed 1` proposed 291 deals, committed 133, cancelled 137, countered 258, with 0 aborted, 0 illegal applied actions and 0 invariant failures, so `deals-atomic` ran on every deal step. `--require-deals` gave the same counts. What is not on main:
  - **Budget, valuation and concession numbers (D2)**: `engine/deal-facts.ts` and the `dealBudget` content key exist only in [#269](https://github.com/AokDesu/poke-monopoly/pull/269) (approved by Mrmo0p, merge state `CLEAN`, base `main`, bumps `ENGINE_VERSION` to 0.23.0).
  - **The AI's response (D3)**: on main the orchestrator answers every `deal_response` with the `auto` policy (`ai/orchestrator.ts:275` reads "The deal response uses the `auto` policy until S10 adds its question builder."), so there is no budget check and no Jev question. [#271](https://github.com/AokDesu/poke-monopoly/pull/271) is the D3 code, approved, stacked on #269 (base `fm/pm-164-d2-deal-facts`).
  - **The Deal screen and the web filtering of the private payment from Table Talk and the Event Log**: [#138](https://github.com/AokDesu/poke-monopoly/issues/138) is open, has no assignee, and its dependency paragraph is stale: it still says no deal path exists on main, which D1 changed.
- **Reproduction**: owned upstream. The D1 path was run and is clean; D2 and D3 are on open branches and were not run.
- **Severity**: S1. A core conversation feature the spec forbids cutting. D1 and its invariant are done, but a Deal Card cannot yet be answered under a budget or shown on screen.
- **Owner**: Mrmo0p for D2 and D3, per the issue. #138 has no owner.
- **Touched files** still open (from the #269 and #271 file lists): `engine/deal-facts.ts` and test, `engine/deals.ts`, `engine/contract/schema.ts`, `engine/contract/stubs.ts`, `engine/contract/decision.ts`, `engine/invariants.ts`, `engine/versions.ts`, content for `dealBudget`, `ai/` deal question, fallback and lines, eval fixtures, spec and contract; and for #138 the web Deal screen and its Table Talk filtering.
- **Depends on**: merge order #269, then #271 retargeted to `main`. The stamp in ET-04. [#138](https://github.com/AokDesu/poke-monopoly/issues/138), A61-6 and the A64-3 demo recipe depend on it. Flag for the owner: [#271](https://github.com/AokDesu/poke-monopoly/pull/271) says its `engine/contract/decision.ts` change is wire schema only; [#269](https://github.com/AokDesu/poke-monopoly/pull/269) also edits that file, so expect a merge conflict there.
- **Bounded fix**: for D2 and D3, the review is done and the pull requests are mergeable; what remains is sequencing the two merges and one re-verify after each. A date for #138 is not known and the issue has none. **Ask for a date for #138.** A date after 30 Nov puts the 9 Dec freeze at risk (the freeze dates are stale; see #183), and that is a deadline risk to raise, not a reason to cut Deals.

### ET-02: Promise settlement

Resolved on main.

- **Spec**: §4.8, §8 ("Promises close on the correct `ownTurnNo`"), §10 C6, §11 step 6 (memory from a kept or broken promise).
- **Build and test**: main `703d372`. [#198](https://github.com/AokDesu/poke-monopoly/pull/198) merged 2026-11-18 as `9b37350`. `promise-closes-on-own-turn` is `status: 'active'` (`engine/invariants.ts:1255`); the first version found it `pending`. `engine/promise-settlement.test.ts` is in the 168 files of the full run and was not among the failures.
- **Observed**: `npm run sim -- --social --games 100 --seed 1` (Node 24, run E): 113 offered, 68 accepted = 50 broken + 16 kept (4 with a chance, 12 without) + 2 closed by game end, `breachOpportunity` 23, 0 pending, 0 aborted, 0 illegal, 0 invariant failures. The first version saw 144 offered and 72 accepted on `56fb27f`, before settlement; the figures differ because the engine now settles and the game has changed since.
- **Reproduction**: not reproduced. No failing seed.
- **Severity**: S1 when it was open; closed now. No remaining blocker for §11 step 6 on the engine side (the demo scene is under "§11 demo path").
- **Owner**: Mrmo0p (author); punkharb approved.
- **Left over**:
  - The first version's check that the sim and the engine settlement report the same outcomes: `docs/sim.md:53` says each promise count is "read from the engine's settlement record, not counted again from events", so there is one source. I did not diff the two event by event.
  - **Stale text**: `docs/sim.md:61` still says the sim measurements "do not settle engine promises, update trust or add memory; that gameplay work remains deferred under §4.8". That contradicts `docs/sim.md:51` and `:53` and the merged engine. Docs only, S3. It is outside this ticket's single file, so it is raised in the pull request body, not edited here.
  - `PROPERTY_TIMEOUT_MS` is now 240 s (`sim/legal-games.ts:29`). #198 raised it from 120 s. Whether to keep that pattern is step 4 of ET-05.

### ET-03: Event deck

Resolved on main.

- **Spec**: §3.1, §4.6, §6, §8.
- **Build and test**: main `703d372`. [#188](https://github.com/AokDesu/poke-monopoly/pull/188) merged 2026-11-17 as `bd14ade` ([#162](https://github.com/AokDesu/poke-monopoly/issues/162) is closed). `engine/turns.ts:13` imports `drawAndResolveEvent` from `engine/events.ts`; the first version found the landing a logged no-op. `engine/events.test.ts`, `sim/events.test.ts` and `ai/event-visibility.test.ts` were not among the failures.
- **Observed**: every sim run draws and resolves all six cards, and drawn equals resolved for each. Random policy, 2 seats, seeds 1,000,002 to 1,000,101: e1 to e6 resolved 94, 93, 97, 85, 96 and 86 times with 132 deck shuffles. At 3 seats 136, 138, 132, 138, 134 and 143 with 184 shuffles; at 4 seats 179, 175, 174, 173, 173 and 168 with 217 shuffles.
- **Reproduction**: not reproduced. No failing seed.
- **Severity**: S2 when it was open; closed now.
- **Owner**: punkharb.
- **Not checked**: that no seat learns the deck order beyond what `engine/spectator.test.ts` and `ai/event-visibility.test.ts` assert. The spectator sweep timed out at 5 s in the loaded full run and passed in the rerun (ET-05); I did not read the Event rules against §4.6 again.

### ET-04: Stale bases and version stamps

Resolved for #188 and #198. One thing to recheck when #269 merges.

- **Spec**: §6 (save, replay and resume), §8.
- **Build and test**: main is `ENGINE_VERSION = '0.22.0'` (`engine/versions.ts:10`). `git log -L` on that line shows one change per shape change, in merge order: 0.19.0 in `bd14ade` (#188), 0.20.0 in the #198 merge `e9841b6`, 0.21.0 in `09df5e3` (#265), 0.22.0 in `9240c4c` (#262). No stamp is repeated.
- **Expected**: one stamp per shape change, in merge order, and older saves refused.
- **Observed**: the clash the first version predicted did not happen; each merge took the next stamp. [#269](https://github.com/AokDesu/poke-monopoly/pull/269) changes `0.22.0` to `0.23.0`; [#271](https://github.com/AokDesu/poke-monopoly/pull/271) and [#278](https://github.com/AokDesu/poke-monopoly/pull/278) change no stamp, and no other open pull request (checked #230, #225 and #259, which touch no `engine/` file) does. I did not test that a save from the previous stamp is refused with the mismatch message; that check lives in the save and versions tests, which passed in the full run apart from the load failures in ET-05.
- **Reproduction**: not attempted for a stale-save run.
- **Severity**: S3 now (was S2). A second stamp bump from another branch would make #269 or that branch rebase onto the next number.
- **Owner**: whoever merges second.
- **Touched files**: `engine/versions.ts`, the save and resume tests that assert the stamp, and `docs/engine-contract.md`.
- **Depends on**: merge of #269. A64-3 must regenerate any prepared saves after the last stamp change; I did not check whether the prepared scenarios hold stored saves.
- **Bounded fix**: 0.5 h per merge, plus a check that a save made on the previous stamp is refused.

### ET-05: Full suite timeouts under load

This is the "old timeout report" candidate from `docs/c4-300-game-report.md`, re-run. It does not show a rule defect.

- **Spec**: §8 Tests ("100% pass in CI") and §7 (CI).
- **Build and test**: main `703d372`, `npm test` (vitest, 3,544 tests in 168 files; the first version had 2,049 in 119), keys absent, Node 24.22.3.
- **Expected**: the suite passes in one run on a developer machine, so a failure means something.
- **Observed**:

| Run               | Node    | Load average (12 cores)                      | Result                                                                                          | Cause of every failure                                                                                                                                                                                                                                                                                     |
| ----------------- | ------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A to D (`56fb27f`) | 22.22.1 and 24.22.3 | 3 to 18                          | 54 failed on Node 22 under load; 2 failed on Node 24; the two leak tests alone passed           | The first version's table: timeouts, and waits that follow one. Kept for the record; the rows are in the 2026-11-17 version of this file.                                                                                                                                                                  |
| F (`703d372`)     | 24.22.3 | 3.1 at start, 10.4 at 4 minutes, 6.4 at end   | **19 failed, 3,525 passed**, 10 files failed, 307 s                                             | 13 timeouts (10 at the 5 s default, 3 at 60 s). 5 "Unable to find" waits in web tests (role "region" named "Turn actions" twice, button "Leave", label "Turn speed", `data-testid="ui-gallery"`). 1 assertion (ET-09).                                                                                   |
| G (`703d372`)     | 24.22.3 | 4.3 at start, 2.9 at end                      | the 10 failed files again with `--maxWorkers=2`: **10 files passed, 327 tests passed, 0 failed**, 109 s | None.                                                                                                                                                                                                                                                                                                      |

  Run F's failed files: `ai/fallback/fallback.test.ts`, `ai/orchestrator.test.ts`, `ai/speech/speech.test.ts`, `engine/spectator.test.ts`, `sim/sim.test.ts`, `web/src/Root.test.tsx`, `web/src/board/BoardScreen.test.tsx`, `web/src/board/PlayersArea.test.tsx`, `web/src/board/WatchScreen.test.tsx` and `web/src/game/watch.test.tsx`.
- **What it shows**: failures fall from 54 (Node 22, heavy load) to 19 (Node 24, moderate load) to 0 (2 workers, light load), and every one is a timeout, a wait that follows one, or the single assertion in ET-09. Run F differs from the first version's Node 24 run C (2 failures in 2,049 tests) because the suite is now 1.7 times larger and load peaked higher. The committed demo rehearsal saw the same pattern: 44 failures in 19 files at load 17, all passing again with `--testTimeout=120000 --maxWorkers=3`, and 3 left in `BoardScreen.test.tsx` whose tests set their own limits (`docs/pr-evidence/64-demo-rehearsal/README.md`, finding 5). The open [#279](https://github.com/AokDesu/poke-monopoly/pull/279) reports 34 failures in the same way. CI passes on main.
- **The part that matters**: two of the 5 s timeouts in run F are information-leak sweeps, `engine/spectator.test.ts` ("no spectator view, event or record of 25 seeded all-AI games ... holds a secret of any seat", §4.1, §4.8, §5.4) and `ai/speech/speech.test.ts` ("no brief for any seat ... leaks a secret"). Both passed in run G with no assertion failure. `engine/observation.test.ts` (the 500-state leak check, 3.8 to 4.9 s alone against its 5 s limit in the first version) passed in run F. A red leak test gets ignored as noise, so the fix is to keep every check and run count and give each a real budget.
- **Reproduction**: reproduced as load-dependent failure, not as a rule defect. Run G found no assertion failure in the leak sweeps.
- **Severity**: S3 today (CI is green). It becomes S2 if CI turns flaky or a real failure hides in the noise.
- **Owner**: punkharb for `engine/` and `sim/`; Mrmo0p for `ai/`; AokDesu for `web/`.
- **Touched files**: `vitest.config.ts` (it sets no `testTimeout` today), `sim/legal-games.ts` (`PROPERTY_TIMEOUT_MS`, now 240 s), `engine/observation.test.ts`, `engine/spectator.test.ts`, `ai/speech/speech.test.ts`, `ai/orchestrator.test.ts`, `ai/fallback/fallback.test.ts`, `sim/sim.test.ts`, `web/src/game/watch.test.tsx`, `web/src/board/WatchScreen.test.tsx`, `web/src/board/BoardScreen.test.tsx`, `web/src/Root.test.tsx`, `docs/team-setup.md`. The first version also listed `engine/items.test.ts`, `eval/web-sell.test.ts` and `web/src/board/PlayersArea.test.tsx`; the first two did not fail this time.
- **Depends on**: nothing. #198 is merged, so the earlier warning about editing `sim/legal-games.ts`, `sim/runner.ts` and `sim/sim.test.ts` no longer applies.
- **Fix proposal in this doc** (unchanged, 2 to 3 h, no rule change; nothing of it has been done, and this refresh changes no test, timeout or config):
  1. Record per-test durations from one CI run (`vitest run --reporter=json`) and list the tests over 2 s.
  2. Give each of those one named per-test budget with a comment on why, rather than one global `testTimeout`. Keep every run count and every assertion; do not trim the 200-game or 500-state properties.
  3. Say in `docs/team-setup.md` that `npm test` needs Node `^24.15.0` and that a shared machine should use `--maxWorkers=2`. Today `docs/team-setup.md:45` says Node "22.19 or newer" for tools and "the project itself uses Node 24", and has no mention of `--maxWorkers`.
  4. Decide once whether #198's 120 s to 240 s change is the pattern to keep.

### ET-06: The 300-game evidence

- **Spec**: §8 Simulation, §10 C4 and C6.
- **Build and test**: [`docs/c4-300-game-report.md`](../c4-300-game-report.md) was run on `a1c3bb5` (random policies, Social off, Events as placeholders, no keep value). The first version of this row reran it on `56fb27f`. Since then Events (#188), settlement (#198), Abilities, Potion and Shop inventory (#265), Deal Card legality (#262) and Monte Carlo for Hard (#276) merged.
- **Expected**: the exit signal (300 clean games) holds on the build being released, with a report of it on that build.
- **Observed**: rerun on `703d372`, Node 24.22.3, the report's own three commands (seeds 1,000,002 to 1,000,101 per seat count, `--policy random --lap-target 2 --max-steps 5000`), then `--social` at seed 1. Exit 0 each time, 100 of 100 games, 0 aborted, 0 illegal applied actions, 0 invariant failures. All registered invariants are active. Unlike the first rerun, the headline figures now differ from the old report, as they should, since Events and the other slices change a game: mean turns 27.16, 38.64 and 50.64 (old 27.44, 38.97, 49.88); mean final coins 49.30, 48.98 and 49.01 (old 46.26, 44.86, 44.18). Wall time 55 s, 79 s and 115 s. The Social run (seed 1) also finished cleanly (ET-01, ET-02), as did the same run with `--require-deals`. That is 500 games of mine. A 5-game `--policy jev-hard` smoke run is under "Looked at and not queued", not counted here.
- **Reproduction**: not reproduced. No failing seed.
- **What is still missing**:
  - **The record**: [#279](https://github.com/AokDesu/poke-monopoly/pull/279) (punkharb, open, review required, merge state `BLOCKED`) is the report of 600 clean games on `9240c4c` with a Social and deals set. Until it merges, the repository's only 300-game report is the 2026-11-17 one. Its description is the author's claim here, not mine; my 500 games are the evidence.
  - Personalities and the fallback policy with Social on are not in my runs. Those seeds are published, so they are a regression recheck and not a new held-out set (A61-4 keeps that partition).
  - Deal facts and the AI response are on open branches (ET-01).
- **Severity**: S3 now (was S2). The sim is green on every feature on main; what remains is a merged record.
- **Owner**: punkharb (A61-6 refresh; #279 is the author's own).
- **Touched files**: new report file only; no code.
- **Depends on**: #279 merged; after #269 and #271 merge, one more rerun.
- **Bounded fix**: review and merge #279; then 1 h plus about 5 min of machine time per rerun.

### ET-07: Gate G1 evidence is incomplete

Not an engine or sim defect. Kept here because it is a hard gate and a release blocker, and the epic says never to cut the hard gates.

- **Spec**: §1, §8 Human, §10 C2 and G1, `docs/playtest/PROTOCOL.md`.
- **Observed** (from the repository on `703d372`, not re-run): `docs/playtest/g1/G1-report.md` still does not exist (the folder holds `ai-latency.md`, `session-sheet-A.csv` and `session-sheet-B.csv`, last changed 2026-11-15) although [#54](https://github.com/AokDesu/poke-monopoly/issues/54) is closed; [#52](https://github.com/AokDesu/poke-monopoly/issues/52) is open with no comment and asks for two live sessions; the one p95 figure, 1,055 ms over 7 turns, is from a single team game and the file's own header says "not a gate measurement"; the sell and shop decisions it missed ([#150](https://github.com/AokDesu/poke-monopoly/issues/150)) were fixed on 15 Nov and need a re-measure; session sheet A still holds `n/a` for the game length, drop-off, meaningful-choices and hesitation fields.
- **Reproduction**: not attempted. It needs people and a person with the server key.
- **Severity**: S1 as a gate. Not an A64-2 fix.
- **Owner**: Mrmo0p (live sessions and latency) and AokDesu (sheets and report).
- **Touched files**: `docs/playtest/g1/` only.
- **Bounded fix**: two sessions plus a report is outside Stream A's hours. Raised as scout decision D1, not decided here. Related open playtest pull requests by AokDesu, not touched here: [#225](https://github.com/AokDesu/poke-monopoly/pull/225) and [#230](https://github.com/AokDesu/poke-monopoly/pull/230).

### ET-08: Hostile Ability policy approval

Resolved on main.

- **Spec**: §4.1 and Appendix C.3.
- **Build and test**: #200 (merged `a593ad5`) made a hostile Ability's use public while its target, slow, shield and block stay private. The first version found its spec bullet marked "proposed, awaiting captain approval".
- **Observed**: `docs/SPEC-v1.0-PokeMonopoly.md:172` now reads "**Approved rule (#192, captain, 2026-11-17): hostile Ability policy:**", and Appendix C.3 (`:1052`) cites #192. A search of the spec and contract history (`git log -S"awaiting captain"` on both files) finds no commit with the "awaiting" wording, so I could not say when it changed, only that main now says approved. The record of the approval is that spec line; [#192](https://github.com/AokDesu/poke-monopoly/issues/192) is closed and neither it nor #200 has a comment recording it. The known limit stays and the spec states it: Vine Pull's displacement is public, so a third seat can tell a blocked Vine Pull from an unblocked one.
- **Reproduction**: owned upstream. The leak tests in #191 and #200 pass on main: `engine/spectator.test.ts` passed in run G, and `engine/movement-effects.test.ts` was not among the failures.
- **Severity**: S3 when it was open; a decision to record, not a failure.
- **Owner**: captain; punkharb for any change.
- **Touched files** if the captain rejects it: `engine/visibility.ts`, `engine/spectator.ts`, their tests, spec, contract. Hiding the Vine Pull displacement would be a new rule and is not bounded here.

### ET-09: PlayersArea assertion failed once in a full run

New in this refresh.

- **Spec**: §4.1 (the view is a view choice, not a game action), §8.
- **Build and test**: main `703d372`, `web/src/board/PlayersArea.test.tsx`, "opening and closing a seat is a view choice: it never reaches the game" (`:161`).
- **Expected**: four awaited clicks on seat toggles leave `store.getSession()!.log.actions` the same length as before the render, and the public `stateRevision` unchanged.
- **Observed**: in the loaded full run F (above) the test failed with `AssertionError: expected [ { action: { …(5) }, …(2) } ] to have a length of +0 but got 1`, so one action was in the log that was not there before. It passed in the 2-worker rerun G, and again in three runs of the file alone (11 of 11 each, load 1.8). The open [#279](https://github.com/AokDesu/poke-monopoly/pull/279) reports one assertion failure in the same file, seen once and not reproduced.
- **Reproduction**: not reproduced. Two sightings in loaded full runs, none alone.
- **Cause**: unknown. One reading is that the board applies an automatic step on its own between render and the end of the four clicks, which under load takes long enough for it to land. I did not confirm that, and it would mean the test, not the game, is timing-dependent. It is also possible that a click did reach the game. The test and its store are Stream C's.
- **Severity**: S3, as test reliability; it becomes S1 if a click can reach the game (§4.1).
- **Owner**: AokDesu (Stream C, `web/`).
- **Touched files**: `web/src/board/PlayersArea.test.tsx` and, if the cause is in the board, `web/src/board/BoardScreen.tsx`. No change here.
- **Depends on**: ET-05 (the same loaded runs).
- **Bounded fix**: 0.5 to 1 h to run the file under `--maxWorkers` pressure until it fails, read the action that appeared, and then either wait for the board to settle or fix the board. A triage guess.

## Looked at and not queued

- **Offline Jev eval**: `npm run eval:jev -- --offline` exits 0 with 108 of 116 acceptable answers on 84 recorded fixtures (0 synthetic), 12 of the 116 rows scored from the applied last-Sell-Phase sale, 0 illegal applied actions over 84 orchestrator replays, and 0 leaks over 224 chat requests (run E). The eight misses include `sell-researcher-class-bonus / sell_team_2`, the same one as in the 300-game report. The others are Encounter and Strategy answers for Aggressive, Cautious and Opportunist. The chat set scores English intent 39 of 40 and Thai 38 of 40, with manipulation caught 16 of 16 in each language. This is Stream B eval work (#59, [#166](https://github.com/AokDesu/poke-monopoly/issues/166)), not an engine defect. The first version's 27 of 28 was a smaller set.
- **Hard policy with Monte Carlo** ([#276](https://github.com/AokDesu/poke-monopoly/pull/276)): `npm run sim -- --games 5 --seed 1 --policy jev-hard` (no key, no network; offline it uses the seeded fake Jev client of random, invalid, late and failing answers) finished 5 of 5 games in 14 s with 0 aborted, 0 illegal applied actions and 0 invariant failures: 107 decisions, 94 requests to the fake client, 6 invalid outputs, the rest on the fallback. With `JEV_ENABLED=false` the same command put all 113 decisions on the fallback and made no request. It is a smoke run of the wiring, not a live Jev run, not a held-out run and not a measure of how Hard plays; the Monte Carlo class itself is a stretch item and was not examined.
- **"Raise the timeouts"**: not a candidate by itself. See ET-05.
- **Stretch classes**: out of scope by default; not examined.

## §11 demo path against the queue

Steps 1 to 8 were walked on 2026-11-21 in a browser by the demo rehearsal, `docs/pr-evidence/64-demo-rehearsal/README.md` (merged in [#277](https://github.com/AokDesu/poke-monopoly/pull/277), on `b077c1d`). That run is cited, not repeated here.

| §11 step                           | State on main                                                                                                                                                                       | Queue rows                    |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| 2 Prepared scenario, two options   | Pass in the rehearsal ("Two Balls to choose from"). A64-3 built it.                                                                                                                 | ET-04 (saves must be current) |
| 4 PvP challenge, accept or decline | Pass in the rehearsal, including the Rival class's forced challenge.                                                                                                                | none                          |
| 5 Win, coins or evolution          | Pass in the rehearsal (Eevee became Vaporeon).                                                                                                                                      | none                          |
| 6 Memory from a kept or broken promise | Decided by the owner after #277: accepted as memory-only, with no fifth scene (spec §3 stays at four). The rehearsal showed the broken promise, trust −2 and the memory entries (its finding 1). Settlement is on main. Deals: no Deal screen. | ET-01, ET-02 (resolved)       |
| 7 Kill switch and backup bot       | Pass in the rehearsal.                                                                                                                                                              | none                          |
| 8 Policy-only against Jev          | Decided by the owner after #277: the demo is the committed results tables plus the three commands (`sim`, `eval:jev --offline`, `usage`), with no figure page (its finding 2). Live Stream A and B evidence not yet run.                                                                                | ET-06, ET-07                  |

Both points the rehearsal raised were decided by the owner after #277: step 6 is accepted as memory-only (no fifth scene, spec §3 stays at four), and step 8 uses the committed results tables plus the three commands (sim, eval:jev --offline, usage) as the demo, with no figure page.

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
env -u JEV_ENABLED -u HAIKU_ENABLED npm test
env -u JEV_ENABLED -u HAIKU_ENABLED npx vitest run --maxWorkers=2 <the failed files>   # run G
JEV_ENABLED=false HAIKU_ENABLED=false npm run sim -- --games 100 --seed 1000002 --seed-set eval --seats 2 --policy random --lap-target 2 --max-steps 5000   # also --seats 3 and 4
JEV_ENABLED=false HAIKU_ENABLED=false npm run sim -- --social --games 100 --seed 1
JEV_ENABLED=false HAIKU_ENABLED=false npm run sim -- --social --require-deals --games 100 --seed 1
JEV_ENABLED=false HAIKU_ENABLED=false npm run eval:jev -- --offline
```

## Follow-ups outside this ticket

- Ask the #164 owner to sequence the merges of [#269](https://github.com/AokDesu/poke-monopoly/pull/269) and [#271](https://github.com/AokDesu/poke-monopoly/pull/271), and ask for a date for the Deal screen [#138](https://github.com/AokDesu/poke-monopoly/issues/138) (ET-01).
- One version-stamp check when #269 merges (ET-04).
- Review and merge [#279](https://github.com/AokDesu/poke-monopoly/pull/279), then rerun after D2 and D3 (ET-06).
- Fix the stale sentence at `docs/sim.md:61` (ET-02).
- The G1 verdict (ET-07) and the scout's schedule questions ([#183](https://github.com/AokDesu/poke-monopoly/issues/183)) stay with the owner.
