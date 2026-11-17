# Engine and sim release-blocker triage

Ticket A64-1 of epic [#64](https://github.com/AokDesu/poke-monopoly/issues/64) (C6 bug fixes and freeze). Spec: §8 (Tests, Human and Simulation layers), §10 C6, §11.

This is a queue of **candidates**, not a list of proven bugs. It tells the owner which candidates are worth a fix ticket (A64-2a/2b), which are only missing evidence, and which already have an owner. It changes no code, spec or schedule.

## Result

**No reproduced rule defect.** On the main commit below, no failing seed and no failing invariant was found. On Node 24 the only failures were two 5 s timeouts, and both tests pass when given time. On Node 22 under heavy load, 54 tests failed; 36 of those were timeouts, and the other 18 were web-test waits and assertions in files that also timed out. None of them appeared on Node 24 (ET-05).

| Question                                          | Answer                                                                                                                                                                                                                                                                   |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Is any rule bug reproduced?                       | No. Not attempted for anything that is not on main yet (Deals, Events, settlement).                                                                                                                                                                                      |
| What blocks the release now?                      | Missing features with an owner, not defects: Deal Cards ([#164](https://github.com/AokDesu/poke-monopoly/issues/164), no branch yet), promise settlement ([#198](https://github.com/AokDesu/poke-monopoly/pull/198)) and the Event deck ([#188](https://github.com/AokDesu/poke-monopoly/pull/188)). |
| Does the old timeout report prove a rule defect?  | No. See ET-05. It is a test-reliability candidate under load, and raising timeouts is not the proposed fix.                                                                                                                                                              |
| Is there a candidate for a fix ticket (A64-2a/b)? | Not yet. Keep the A64-2 reserve for what playtest [#63](https://github.com/AokDesu/poke-monopoly/issues/63) and the A61-6 run find. ET-05 is the only candidate that is a plain code change today, and it is test-only.                                                   |

## Evidence base

| Item          | Value                                                                                                                                                                                                  |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Build         | main `56fb27f7f786097e2f0d9623191ccdc46fa810d1` (merge of #203), engine 0.18.0, content 1.3.0                                                                                                          |
| Date          | 2026-11-17                                                                                                                                                                                             |
| Machine       | 12 cores, shared with other lanes. Load average 2.7 to 18 over the runs below.                                                                                                                         |
| Node          | The repo requires `^24.15.0` (`package.json`, `.node-version` is `24`). Runs A and B used Node 22.22.1 by mistake (`npm ci` warns `EBADENGINE`). Runs C to E used Node 24.22.3. Run E is the sim and offline eval commands under Re-run; runs A to D are the `npm test` runs in ET-05.                        |
| Keys          | `TYPESAFE_API_KEY` and `ANTHROPIC_API_KEY` absent. `JEV_ENABLED` and `HAIKU_ENABLED` unset for `npm test`, `false` for sim and eval. No live Jev or Haiku call.                                        |
| CI            | CI on main at `56fb27f` passed ([run 44067424342](https://github.com/AokDesu/poke-monopoly/actions/runs/44067424342)): typecheck, lint, format, `npm test`, three 100-game sims at seed 1, offline eval. |
| Raw output    | Task evidence outside git, not committed. Re-run with the commands below.                                                                                                                              |
| Not examined  | Browser play with a person, live Jev, live Haiku, and anything only on an open branch.                                                                                                                 |

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

**Reproduction status**: `reproduced`, `not reproduced` (tried, found nothing), `not attempted` (nothing on main to run), or `owned upstream`.

## Queue

Ordered by what to look at first: completion and information invariants, then demo-blocking Deals and Promises, then the rest.

| ID                       | Candidate                                                          | Class           | Severity | Status                | Owner                         |
| ------------------------ | ------------------------------------------------------------------ | --------------- | -------- | --------------------- | ----------------------------- |
| [ET-01](#et-01-deal-cards) | Deal Cards have no engine implementation                           | Upstream-owned  | S1       | owned upstream        | Mrmo0p (Stream B)             |
| [ET-02](#et-02-promise-settlement) | Promise settlement and `promise-closes-on-own-turn` not on main    | Upstream-owned  | S1       | owned upstream        | Mrmo0p (Stream B)             |
| [ET-03](#et-03-event-deck) | Event squares are still a logged no-op                             | Upstream-owned  | S2       | owned upstream        | punkharb (Stream A)           |
| [ET-04](#et-04-stale-bases-and-version-stamps) | #188 and #198 are stale against main and claim overlapping version stamps | Upstream-owned  | S2       | owned upstream        | punkharb and Mrmo0p           |
| [ET-05](#et-05-full-suite-timeouts-under-load) | Full `npm test` times out under load, and one leak test has no margin | Test reliability | S3       | reproduced (load)     | punkharb, with B and C for their files |
| [ET-06](#et-06-the-300-game-evidence-is-stale) | The 300-game evidence predates Events, Deals and settlement         | Evidence hole   | S2       | not reproduced        | punkharb                      |
| [ET-07](#et-07-gate-g1-evidence-is-incomplete) | Gate G1 has no combined verdict and no participant latency          | Evidence hole   | S1 (gate), not engine | not attempted         | Mrmo0p and AokDesu (B and C)  |
| [ET-08](#et-08-hostile-ability-policy-is-merged-but-unapproved) | Hostile Ability policy is merged but marked "awaiting captain approval" | Upstream-owned  | S3       | owned upstream        | captain decision; punkharb for any change |

## Candidates

### ET-01: Deal Cards

- **Spec**: §4.8 (Deal Card, concession budget), §5.3, §8 ("deals are atomic"), §10 C6 (never cut Deals), §11 step 6.
- **Build and test**: main `56fb27f`. `deals-atomic` is `status: 'pending'` at `engine/invariants.ts:885`. `deal` is an empty-payload placeholder at `engine/contract/schema.ts:369` and `:476`, and `engine/contract/stubs.ts` has no deal path. No test names it.
- **Expected**: a Deal commits atomically or leaves the state unchanged; over budget is rejected by code with no Jev call; a revealed item is visible only to the two parties; save, resume and replay reproduce a game with deals ([#164](https://github.com/AokDesu/poke-monopoly/issues/164) acceptance).
- **Observed**: none of that exists. `git branch -r` and `gh pr list` show no Deal branch or pull request. The issue has no comment and no ETA. [#138](https://github.com/AokDesu/poke-monopoly/issues/138) (the Deal screen) is blocked behind it.
- **Reproduction**: owned upstream. There is nothing to run.
- **Severity**: S1. A core conversation feature the spec forbids cutting, and one of the two pending invariants.
- **Owner**: Mrmo0p, per the issue.
- **Touched files** (from the #164 scope, not a diff): `engine/contract/schema.ts`, `engine/contract/stubs.ts`, a new engine deal module and test, `engine/invariants.ts` and its test, `engine/visibility.ts`, `engine/spectator.ts`, `docs/SPEC-v1.0-PokeMonopoly.md`, `docs/engine-contract.md`, then `sim/legal-games.ts` and the Stream B response code under `ai/`.
- **Depends on**: nothing in the queue. [#138](https://github.com/AokDesu/poke-monopoly/issues/138), A61-2 ("never negotiate" is vacuous without Deals), A61-6 and the A64-3 demo recipe depend on it. The `deals-atomic` checker should land in the same change.
- **Bounded fix**: 6 to 8 h, a triage guess and not owner-confirmed, with low confidence. Four acceptance blocks (legality and commit, budget and valuation, AI response, save and replay) against a comparable slice like #198. **Ask the owner for a date.** A date after 30 Nov puts the 9 Dec freeze at risk, and that is a deadline risk to raise, not a reason to cut Deals.

### ET-02: Promise settlement

- **Spec**: §4.8, §8 ("Promises close on the correct `ownTurnNo`"), §10 C6, §11 step 6 (memory from a kept or broken promise).
- **Build and test**: main `56fb27f`. `promise-closes-on-own-turn` is `status: 'pending'` at `engine/invariants.ts:901`. Main has offers and answers (`engine/promises.ts`) but no settlement, trust or `promise_closed` evidence. The sim counts them itself: `docs/sim.md` says its figures "do not settle engine promises, update trust or add memory".
- **Expected**: a due promise closes at the promiser's own End as kept or broken, trust changes, and the pair sees the evidence.
- **Observed**: `npm run sim -- --social --games 100 --seed 1` (Node 24, run E): 144 offered, 72 accepted = 50 broken + 18 kept with opportunity + 4 closed by game end, `breachOpportunity` 71, 0 aborted, 0 illegal, 0 invariant failures. These are the sim's own counts. There is no engine trust and no memory evidence on main.
- **Reproduction**: owned upstream. [#198](https://github.com/AokDesu/poke-monopoly/pull/198) (head `17b7162`) implements it and activates the invariant. It is approved (punkharb) and its [CI run 44046071034](https://github.com/AokDesu/poke-monopoly/actions/runs/44046071034) passed.
- **Correction to the scout report**: it read "2 pass, 1 fail" on #198. The failing entry was an earlier run, [44046038901](https://github.com/AokDesu/poke-monopoly/actions/runs/44046038901), which was `cancelled` after 30 s by the workflow's `cancel-in-progress` and replaced by the passing run. It is not a test failure.
- **Severity**: S1 (§11 step 6, and the second pending invariant).
- **Owner**: Mrmo0p (author). The approving review is punkharb's.
- **Touched files** (the #198 diff): `engine/promises.ts`, `engine/items.ts`, `engine/game-end.ts`, `engine/turns.ts`, `engine/visibility.ts`, `engine/contract/schema.ts`, `engine/contract/stubs.ts`, `engine/invariants.ts` and test, `engine/versions.ts`, `sim/runner.ts`, `sim/legal-games.ts`, `sim/sim.test.ts`, `sim/README.md`, `web/src/board/EventLog.tsx`, spec, contract.
- **Depends on**: a rebase on main (see ET-04). It also raises `PROPERTY_TIMEOUT_MS` from 120 s to 240 s; weigh that with ET-05. After it merges, check that the sim's promise counters and the engine's settlement report the same outcomes. Two competing counters would make the A61-6 table disagree with itself (the PR keeps the sim reporting, so this needs a check, not a rewrite).
- **Bounded fix**: 1 to 1.5 h of rebase, version bump and re-verification by the author. No new design.

### ET-03: Event deck

- **Spec**: §3.1, §4.6, §6, §8.
- **Build and test**: main `56fb27f`; `engine/turns.ts:166` reads "Events remain explicit placeholders until their own slice."
- **Expected**: landing on an Event square draws, discards and resolves one of e1 to e6; empty piles recycle with a logged seeded shuffle; no seat learns the deck order.
- **Observed**: the landing is a logged no-op. [#188](https://github.com/AokDesu/poke-monopoly/pull/188) (head `0913931`) implements it ([#162](https://github.com/AokDesu/poke-monopoly/issues/162)). It is approved (Mrmo0p), its checks passed, and GitHub reports it `DIRTY` (conflicts with main).
- **Reproduction**: owned upstream.
- **Severity**: S2. It is part of content-complete, and an Event square in a demo game would do nothing. It is not a §11 step.
- **Owner**: punkharb.
- **Touched files** (the #188 diff, 27 files): `engine/events.ts` and test, `engine/turns.ts`, `engine/setup.ts`, `engine/abilities.ts`, `engine/visibility.ts`, `engine/spectator.ts` and test, `engine/contract/schema.ts`, `engine/contract/stubs.ts`, `engine/versions.ts`, `sim/metrics.ts`, `sim/report.ts`, `sim/README.md`, `sim/events.test.ts`, `web/src/board/EventLog.tsx`, `ai/` tests, spec, contract.
- **Depends on**: ET-04. #200 (merged) changed `engine/visibility.ts`, `engine/spectator.ts`, `engine/spectator.test.ts`, spec and contract, and the #200 description names #188 as the likely conflict.
- **Bounded fix**: 1 to 2 h of rebase and re-verification by punkharb.

### ET-04: Stale bases and version stamps

- **Spec**: §6 (save, replay and resume), §8.
- **Build and test**: main is already `ENGINE_VERSION = '0.18.0'` (`engine/versions.ts:10`). #188 changes `0.17.0` to `0.18.0`, so on its old base it claims a stamp main already has. #198 changes `0.18.0` to `0.19.0`. Both change save, event or observation shapes.
- **Expected**: one stamp per shape change, in merge order, and older saves refused.
- **Observed**: the two pull requests cannot both be right once merged. The second to merge needs the next stamp. Not reproduced because neither is merged; this is read from the two `engine/versions.ts` patches.
- **Reproduction**: not attempted.
- **Severity**: S2. A wrong or repeated stamp would let an older save load into a changed shape, or break the prepared demo saves (A64-3).
- **Owner**: punkharb and Mrmo0p, whoever merges second.
- **Touched files**: `engine/versions.ts`, the save and resume tests that assert the stamp, and `docs/engine-contract.md`.
- **Depends on**: merge order of #188 and #198, then #164. A64-3 must regenerate its prepared saves after the last of them.
- **Bounded fix**: 0.5 h per merge, plus a final check that `npm test` and a save made on the previous stamp is refused with the existing mismatch message.

### ET-05: Full suite timeouts under load

This is the "old timeout report" candidate from `docs/c4-300-game-report.md`, re-run. It does not show a rule defect.

- **Spec**: §8 Tests ("100% pass in CI") and §7 (CI).
- **Build and test**: main `56fb27f`, `npm test` (vitest 5.0.3, 2,049 tests in 119 files), keys absent.
- **Expected**: the suite passes in one run on a developer machine, so a failure means something.
- **Observed**:

| Run | Node    | Load average (12 cores) | Result                                                | Cause of every failure                                                                                                                                                         |
| --- | ------- | ----------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A   | 22.22.1 | 10 to 14                | 54 failed, 1,995 passed, 24 files, 427 s              | 36 timeouts (28 at 5 s, 4 at 120 s, 2 at 60 s, 2 at 20 s). 18 UI failures: "Unable to find" and two assertions, in web tests. I did not inspect each; they follow a timeout or the default wait. |
| B   | 22.22.1 | 11 to 18                | the 24 failed files again, 2 workers: 15 failed, 568 passed | 13 timeouts. 2 web failures, one `expected 'strategy' to be 'sell'` after the 60 s timeout in the same file left overlapping `act()` calls.                                  |
| C   | 24.22.3 | 3 to 7                  | **2 failed, 2,047 passed**, 161 s                     | `engine/observation.test.ts` "500 random mid-game states" and `web/src/game/watch.test.tsx` "paused holds the game", both at the 5 s default.                                  |
| D   | 24.22.3 | 5 to 6                  | `watch.test.tsx` passed alone. `observation.test.ts` alone with `--testTimeout=300000`, twice: 15 of 15 pass, the 500-state test took **3.8 s and 4.9 s** against its 5 s limit | None. The leak assertions held.                                                                                                                                                |

- **What it shows**: the load and the Node version changed together between A/B and C, so the Node version alone is not proven to matter. What is clear: every failure is a timeout or a wait that follows one; the failing set moves between runs; failures fall from 54 to 2 as load falls; and the same pattern is described in the #200 body (6 files at the 5 s default, all pass with `--testTimeout=300000`) and the old report. CI passes in about 4 minutes on the same commit.
- **The part that matters**: `engine/observation.test.ts` is the §4.1 and §8 information-leak check over 500 states. It runs in 3.8 to 4.9 s alone, so on a slower or busier runner it fails or is skipped in people's minds, and a red leak test gets ignored as noise. The test body passes. The fix is to keep the check and its 500 states and give it a real budget.
- **Reproduction**: reproduced as load-dependent failure, not as a rule defect. Runs C and D found no assertion failure.
- **Severity**: S3 today (CI is green). It becomes S2 if CI turns flaky or a real failure hides in the noise.
- **Owner**: punkharb for `engine/` and `sim/`; Mrmo0p for `ai/`; AokDesu for `web/`.
- **Touched files**: `vitest.config.ts`, `sim/legal-games.ts` (`PROPERTY_TIMEOUT_MS`), `engine/observation.test.ts`, `engine/items.test.ts`, `engine/spectator.test.ts`, `ai/speech/speak.test.ts`, `ai/speech/speech.test.ts`, `ai/orchestrator.test.ts`, `ai/fallback/fallback.test.ts`, `eval/web-sell.test.ts`, `web/src/game/watch.test.tsx`, `web/src/board/BoardScreen.test.tsx`, `docs/team-setup.md`.
- **Depends on**: nothing. Avoid touching `sim/legal-games.ts`, `sim/runner.ts` and `sim/sim.test.ts` while #198 is open, as it edits them.
- **Bounded fix**, 2 to 3 h and no rule change:
  1. Record per-test durations from one CI run (`vitest run --reporter=json`) and list the tests over 2 s.
  2. Give each of those one named per-test budget with a comment on why, rather than one global `testTimeout`. Keep every run count and every assertion; do not trim the 200-game or 500-state properties.
  3. Say in `docs/team-setup.md` that `npm test` needs Node `^24.15.0` and that a shared machine should use `--maxWorkers=2`.
  4. Decide once whether #198's 120 s to 240 s change is the pattern to keep.

### ET-06: The 300-game evidence is stale

- **Spec**: §8 Simulation, §10 C4 and C6.
- **Build and test**: [`docs/c4-300-game-report.md`](../c4-300-game-report.md) was run on `a1c3bb5`: random policies, Social off, Events as placeholders, no keep value. Since then these merged: keep value (#189), leak tests (#191), hostile Ability visibility (#200), AI table talk (#203).
- **Expected**: the exit signal (300 clean games) holds on the build being released.
- **Observed**: rerun on `56fb27f`, Node 24.22.3, the report's own three commands (seeds 1,000,002 to 1,000,101 per seat count, `--policy random --lap-target 2 --max-steps 5000`, run E). Exit 0, empty stderr apart from the timing line, 100 of 100 games each, 0 illegal applied actions, 0 invariant failures, 0 aborted. The headline figures equal the old report for every seat count: 27.44, 38.97 and 49.88 mean turns, 46.26, 44.86 and 44.18 mean final coins, and the same win credit by seat. I did not trace why they are identical; it is consistent with the merged slices not changing a random-policy game. Wall time 69 s, 105 s and 132 s. The Social run above (seed 1, tune set) also finished cleanly.
- **Reproduction**: not reproduced. No failing seed.
- **What is still missing**: no run covers Events (ET-03), Deals (ET-01) or settlement (ET-02), personalities, or the fallback policy with Social on. Those seeds are published, so they are a regression recheck and not a new held-out set (A61-4 keeps that partition).
- **Severity**: S2. The sim being green says nothing about features that are not in it yet.
- **Owner**: punkharb (A61-6 refresh).
- **Touched files**: new report file only; no code.
- **Depends on**: ET-01, ET-02, ET-03 merged, and the two pending invariants active.
- **Bounded fix**: 1 h plus about 5 min of machine time for the three batches, after the dependencies merge.

### ET-07: Gate G1 evidence is incomplete

Not an engine or sim defect. Kept here because it is a hard gate and a release blocker, and the epic says never to cut the hard gates.

- **Spec**: §1, §8 Human, §10 C2 and G1, `docs/playtest/PROTOCOL.md`.
- **Observed** (from the repository, not re-run): `docs/playtest/g1/G1-report.md` does not exist although [#54](https://github.com/AokDesu/poke-monopoly/issues/54) is closed; [#52](https://github.com/AokDesu/poke-monopoly/issues/52) is open and asks for two live sessions; the one p95 figure, 1,055 ms over 7 turns, is from a single team game and says it is "not a gate measurement"; the sell and shop decisions it missed ([#150](https://github.com/AokDesu/poke-monopoly/issues/150)) were fixed on 15 Nov and need a re-measure; no committed row records an observed hesitation (`session-sheet-A.csv` and `session-sheet-B.csv` hold `n/a`).
- **Reproduction**: not attempted. It needs people and a person with the server key.
- **Severity**: S1 as a gate. Not an A64-2 fix.
- **Owner**: Mrmo0p (live sessions and latency) and AokDesu (sheets and report).
- **Touched files**: `docs/playtest/g1/` only.
- **Bounded fix**: two sessions plus a report is outside Stream A's hours. Raised as scout decision D1, not decided here.

### ET-08: Hostile Ability policy is merged but unapproved

- **Spec**: §4.1 and Appendix C.3.
- **Build and test**: #200 (merged `a593ad5`) made a hostile Ability's use public while its target, slow, shield and block stay private. It marks the spec bullet "proposed, awaiting captain approval".
- **Expected**: a rule change has a recorded approval (house rule 4, and a team review per §7).
- **Observed**: Mrmo0p approved the PR. No captain approval is recorded in the issue or the PR. A known limit stays: Vine Pull's `player_displaced` is public, so a third seat can tell a blocked Vine Pull from an unblocked one. The spec says so.
- **Reproduction**: owned upstream. The leak tests in #191 and #200 pass on main (run C: `engine/movement-effects.test.ts` and `engine/spectator.test.ts` passed).
- **Severity**: S3. It is a decision to record, not a failure.
- **Owner**: captain to decide; punkharb for any change.
- **Touched files** if the captain rejects it: `engine/visibility.ts`, `engine/spectator.ts`, their tests, spec, contract. Hiding the Vine Pull displacement would be a new rule and is not bounded here.
- **Bounded fix**: 0.25 h to record the approval.

## Looked at and not queued

- **Offline Jev eval**: `npm run eval:jev -- --offline` exits 0 with 27 of 28 acceptable answers, 0 illegal applied actions and 0 leaks over 112 requests (run E). The one wrong answer, `sell-researcher-class-bonus / sell_team_2`, is the same as in the 300-game report. This is Stream B eval work (#59, [#166](https://github.com/AokDesu/poke-monopoly/issues/166)), not an engine defect.
- **"Raise the timeouts"**: not a candidate by itself. See ET-05.
- **Stretch classes, Monte Carlo and Hard**: out of scope by default.

## §11 demo path against the queue

| §11 step                           | State on main                                                         | Queue rows                    |
| ---------------------------------- | --------------------------------------------------------------------- | ----------------------------- |
| 2 Prepared scenario, two options   | Not built. A64-3 owns it.                                             | ET-04 (saves must be current) |
| 4 PvP challenge, accept or decline | In the full rules engine (#152). Not re-run end to end here.          | none                          |
| 5 Win, coins or evolution          | In the full rules engine (#152). Not re-run end to end here.          | none                          |
| 6 Memory from a kept or broken promise | Offers and answers only; no settlement or memory                  | ET-02, ET-01                  |
| 7 Kill switch and backup bot       | Stream B (#65). Fallback runs in the sim and passes.                  | none                          |
| 8 Policy-only against Jev          | Stream A and B evidence not yet run                                   | ET-06, ET-07                  |

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
JEV_ENABLED=false HAIKU_ENABLED=false npm run sim -- --games 100 --seed 1000002 --seed-set eval --seats 2 --policy random --lap-target 2 --max-steps 5000   # also --seats 3 and 4
JEV_ENABLED=false HAIKU_ENABLED=false npm run sim -- --social --games 100 --seed 1
JEV_ENABLED=false HAIKU_ENABLED=false npm run eval:jev -- --offline
```

## Follow-ups outside this ticket

- Ask the #164 owner for a date (ET-01).
- Merge order for #188 and #198, then one version-stamp check (ET-04).
- Record the captain's answer on the hostile Ability policy (ET-08).
- The G1 verdict (ET-07) and the scout's schedule questions ([#183](https://github.com/AokDesu/poke-monopoly/issues/183)) stay with the owner.
