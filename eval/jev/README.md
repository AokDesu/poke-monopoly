# Jev decision-scenario eval

Spec: v1.0 §5.5, §5.4, §8, §12. Issues #59 (eval set), #233 (personality scenarios, stream B) and #56 (S09/S11, the promise response).

Spec §8 asks for at least 60 decision scenarios, 15 per personality, each with an acceptable-answer set. Every scenario is one engine state where seat 0 (the AI) decides a Strategy, an Encounter or a Sell Phase. The request goes through the real question builders and the orchestrator, so every number is an engine fact turned into a named bucket, and nothing hidden reaches Jev (the leak, number and size guards run on every scenario).

```sh
npm run eval:jev -- --offline   # replays every fixture: no key, no network
```

The report counts the scenarios per personality, and splits recorded fixtures from synthetic ones (see below). 136 scenarios: 104 recorded and 32 synthetic. The recorded ones are the 20 Deal Card scenarios (below), the 68 Strategy, Encounter and Sell scenarios (including the three last-Sell Gym twins) and the 16 promise response scenarios (below); the 32 battle decision scenarios (below) are synthetic placeholders until the captain records them; see the results.

## The scenarios

| Personality | Scenarios | Source                                                                                            |
| ----------- | --------: | ------------------------------------------------------------------------------------------------- |
| Greedy      |        20 | `scenarios.ts`: live recordings, 8 Strategy, 6 Encounter, 6 Sell. Already above 15, so none added |
| Aggressive  |        16 | `personality-scenarios.ts`: 6 Strategy, 4 Encounter, 6 Sell                                       |
| Cautious    |        16 | the same 16 table states                                                                          |
| Opportunist |        16 | the same 16 table states                                                                          |

The 16 states are shared. Twelve of them are the exact table state of a Greedy scenario (its `greedyTwin`), and four are new (the two Battle Ticket states, the Weedle Ball choice and the last Sell Phase with a Gym ahead, #59). A scenario ID is `<personality>-<state>`, for example `aggressive-strategy-repel-leader-near-start`. Within one state the requests differ only in `you.personality`, which is spec §8's "paired scenarios swap personality while holding everything else constant"; a test checks that.

### Acceptable sets and reasons

Each scenario has an acceptable set and a written `reason` (also stored in its fixture). The reason cites the weights in `content/personalities/<id>.json` (`risk`, `aggression`, `liquidity`, `loyalty`), and a test checks that every cited value matches the file. The sets are judgements made from those weights and descriptions, not the output of the fallback policy: the policy cannot pick a Battle Ticket, for example. Where several answers fit, the set lists all of them.

### The four contrasts

| Contrast             | States                                                                                                                                                                                                                                                                                             | Where the personalities differ                                                                                                                                    |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hostile item vs skip | `strategy-pickpocket-rich-rival`, `strategy-pickpocket-richer-target`, `strategy-repel-leader-near-start`, `strategy-mixed-items-two-rivals`                                                                                                                                                       | Repel on the leader: Aggressive uses it, Cautious skips. With three items, Aggressive picks Repel, Opportunist Pickpocket, Cautious skips or the Lucky Egg        |
| PvP vs not           | `strategy-battle-ticket-leader`, `strategy-battle-ticket-ahead` (a Battle Ticket forces the target to accept PvP)                                                                                                                                                                                  | Against the leader Aggressive forces the fight, Cautious skips; when far ahead Aggressive may, Cautious and Opportunist skip                                      |
| Sell vs keep         | `sell-snorlax-high-sale-low-keep`, `sell-gyarados-early-lap`, `sell-tired-eevee`, `sell-magikarp-low-sale-high-keep`, `sell-last-phase-final-round` (all personalities sell; Jev is not asked, spec §5.6), `sell-last-phase-gym-ahead` (a Gym follows, so selling and keeping are both acceptable) | A high sale now: Opportunist sells, Aggressive keeps, Cautious may do either                                                                                      |
| Ball choice          | `encounter-magikarp-only-ultra`, `encounter-weedle-poke-or-great`, `encounter-rare-snorlax-ultra`, `encounter-pidgey-poke-or-great`                                                                                                                                                                | One Ultra Ball for a common Magikarp: Aggressive throws, Greedy releases. Weedle: Aggressive and Cautious take the Great Ball, Opportunist may keep the Poké Ball |

Some states are agreement controls (every personality gives the same answer), so a model that only echoes the personality text is not rewarded.

**Sell scenarios and the live question.** Since #189 the Sell scenarios take `keepValue` from the engine's `saleFacts` (`eval/jev/scenarios.ts`) (the same facts the live question gets), not from made-up values. The scenario descriptions' keep wording (for example "worth a medium amount to keep") is prose and is not checked against that engine number.

**Known limit.** The sim sends no Sell facts, so every sim Sell decision falls back as `missing_facts`. Those decisions are counted in the fallback rate (about 9 of 60 decisions in a short run). See `docs/sim.md`.

**PvP.** Spec §5.3 (the temporary #55 exception) keeps `declare_pvp` out of Strategy questions until Stream B adds PvP questions, and there is no PvP response question yet. The PvP contrast is therefore expressed through the Battle Ticket item, which is a real Strategy option that forces PvP. When the PvP questions arrive, add scenarios for them here.

## Promise response scenarios (S09, S11 promise half)

`promise-scenarios.ts`: 16 scenarios of the `promise_response` decision point, four tables by four personalities. Seat 0, the AI, owes the answer to a `no_attack` promise question the human at seat 1 opened in its Social window with the engine's own `offer_promise` action (`promiseTable` in `scenario-kit.ts`). The request is the real `buildPromiseResponseQuestion`: the AI's trust in the human as a named bucket (`low` or `high`), the memory as event evidence (`P2 broke no_attack on turn 3`), the human's earlier message as quoted data, and nothing else; no number reaches Jev. A scenario ID is `<personality>-promise-<role>-<trust>-trust`.

| Table                          | The AI is                     | Trust | History            |
| ------------------------------ | ----------------------------- | ----- | ------------------ |
| `promise-recipient-high-trust` | the recipient: it is promised | high  | two promises kept  |
| `promise-recipient-low-trust`  | the recipient: it is promised | low   | one promise broken |
| `promise-promiser-high-trust`  | the promiser: it is asked     | high  | two promises kept  |
| `promise-promiser-low-trust`   | the promiser: it is asked     | low   | one promise broken |

Within a table the four personalities share the exact table state, so a pair differs only in the personality text. The acceptable sets (`respond:accept`, `respond:reject`) are judgements from `content/personalities/<id>.json` with a `reason` that cites the weights (a test checks the cited values). Greedy accepts at high trust and rejects at low trust in both roles; Cautious, the most loyal, accepts or rejects at low trust; Aggressive and Opportunist may accept or reject when asked to promise at high trust. The fallback policy's own answer is a cross-check: a test requires it to be an acceptable answer for every scenario. These are small counts and judgements, not a claim about Jev.

## Battle decision scenarios (issue #56, C3)

`battle-scenarios.ts`: 32 scenarios of the three battle decision points, eight tables by four personalities. Seat 0, the AI, is the Main Character; the human at seat 1 challenges it, uses Pickpocket on it, or loses to it (`battle-kit.ts` builds each table with the engine's own actions). The request is the real question builder over the engine's own observation and battle preview: the chances as named buckets (`low`, `medium`, `high`), the Ability by name and effect in words, the reward options; no number reaches Jev. A scenario ID is `<personality>-<table>`.

| Table                      | Decision point   | The AI's question                                              |
| -------------------------- | ---------------- | -------------------------------------------------------------- |
| `pvp-response-even`        | `pvp_response`   | accept or decline a challenge at even odds                     |
| `pvp-response-underdog`    | `pvp_response`   | the same as the underdog (the challenger is a Rival)           |
| `pvp-response-favoured`    | `pvp_response`   | the same as the clear favourite (a Gyarados on its team)       |
| `window-defender-underdog` | `ability_window` | use Blaze in its defender window, or none                      |
| `window-defender-favoured` | `ability_window` | Blaze or Block (a Snorlax) while ahead, or none                |
| `window-pickpocket-block`  | `ability_window` | react to a Pickpocket with Block, or not                       |
| `reward-pvp-won`           | `reward`         | coins, or evolve its Charmander or one of three Eevee branches |
| `reward-gym-won`           | `reward`         | coins from the bank, or evolve its Charmander                  |

The acceptable sets are judgements from `content/personalities/<id>.json` with a `reason` that cites the weights (a test checks the cited values). The personalities differ in six of the eight tables (Aggressive takes an even or underdog PvP fight, spends Blaze and takes the evolution; Cautious and Greedy decline, may keep their Abilities and take coins); the favoured PvP table and the Pickpocket table are the controls where all four give the same answer. The fallback policy's own answer is a cross-check: a test requires it to be an acceptable answer for every scenario. The fixtures are synthetic placeholders (`synthetic: true`, a seeded stand-in answer): they prove the harness, count in the scenario totals and are left out of accuracy until recorded.

## Results of the recording

The captain recorded all 45 personality scenarios live on 2026-11-18 (`jev-1.13.0`, one request each, through the orchestrator), the three `sell-last-phase-gym-ahead` twins on 2026-11-20 and the 16 promise response scenarios on 2026-11-20. With the 20 Greedy recordings the set is **84 fixtures, 84 recorded, 0 synthetic**. These figures come from `npm run eval:jev -- --offline` on that set; counts are Jev answers (Choice and Noul rows) scored against the acceptable sets, with n as shown:

| Measure                              | Result                                                                                                                                             |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Accuracy, recorded fixtures          | 108/116 (93.1%); 92/100 before the 16 promise rows, 83/91 with the three Gym twins still synthetic, 77/91 at the Sell scoring fix, 78/91 before it |
| `illegalAppliedActionCount`          | 0                                                                                                                                                  |
| Fallbacks (`low_confidence`)         | 18 of 84 decisions                                                                                                                                 |
| Mean confidence, correct / incorrect | 0.721 (n=53) / 0.480 (n=7); Noul rows have none                                                                                                    |

| Personality | Fixtures | Rows correct / total | Strategy | Encounter |  Sell | Promise |
| ----------- | -------: | -------------------: | -------: | --------: | ----: | ------: |
| Greedy      |       24 |                31/32 |      8/8 |       6/6 | 13/14 |     4/4 |
| Aggressive  |       20 |                26/28 |      5/6 |       3/4 | 14/14 |     4/4 |
| Cautious    |       20 |                24/28 |      5/6 |       1/4 | 14/14 |     4/4 |
| Opportunist |       20 |                27/28 |      5/6 |       4/4 | 14/14 |     4/4 |

Twelve of the 100 rows (`sell-last-phase-final-round`, four fixtures) are not Jev answers any more: Jev is not asked in the last Sell Phase (spec §5.6, below), so each is scored from the sale the orchestrator applies. Recorded answers for those four fixtures are kept and still checked against the request Jev would be sent, but they do not move the score. The three personalities' set of 15 gained one scenario, `sell-last-phase-gym-ahead`, recorded on 2026-11-20; its nine rows all score right and bring the total from 83/91 to 92/100.

These are small counts, not a general claim about Jev or the personalities, and the acceptable sets are themselves judgements. The misses below are inputs for #59: tuning the personality instructions, or correcting an acceptable set, whichever the evidence favours. They are not failures of this change.

- **Cautious Encounter, 3 of 4 missed.** Jev answered `release` on `pidgey-poke-or-great`, `weedle-poke-or-great` and `rare-snorlax-ultra` at low confidence (0.35, 0.28 and 0.19). Each fell below the floor, so the fallback policy chose a catch (Poké Ball, Poké Ball, Ultra Ball), which is acceptable. The set expects a catch for all three.
- **Sell is scored at the personality's own threshold (#59).** The first scoring counted a Sell Noul as `true` at 0.5, but the game sells only at or above `personality.sellThreshold` (`decideSales` in `ai/questions/sell.ts`; derived from `liquidity`, read from `content/personalities/*.json` at run time: Aggressive 0.92, Cautious 0.8, Opportunist 0.68, Greedy 0.56). The eval now scores each Sell Noul at that threshold, from the same recordings, with no re-recording and no change to any acceptable set. The total moves from **78/91 to 77/91**; counts per personality are Greedy 27/28 (unchanged), Aggressive 16/21 (unchanged), Cautious 15/21 (unchanged), Opportunist 20/21 to 19/21. Rows that flipped:
  - Wrong to correct (5): Aggressive `sell-magikarp-low-sale-high-keep` (Noul 0.59), `sell-snorlax-high-sale-low-keep` (0.66) and `sell-tired-eevee` (0.63); Cautious `sell-magikarp-low-sale-high-keep` (0.59) and `sell-tired-eevee` (0.64). Each is below the threshold, so nothing is sold in play, which is what the set expects. They were never real misses.
  - Correct to wrong (6), all `sell-last-phase-final-round`, whose set expects a full sale: Aggressive `sell_team_0` (0.50), `sell_team_1` (0.77), `sell_team_2` (0.86) against 0.92; Cautious `sell_team_0` (0.50) and `sell_team_1` (0.73) against 0.8; Opportunist `sell_team_0` (0.54) against 0.68. Jev answers sell, but below the threshold, so the game would keep these Pokémon and the end of the game sells them for less. These were real misses, left as they were by the Sell scoring fix. They are now closed by the rule below, not by Jev: the game sells everything in the last Sell Phase unless a Gym follows (spec §5.6), so Jev is not asked there and these six rows score right (**77/91 to 83/91**), as do the three Greedy rows that were already right. The acceptable sets are unchanged.
- **Last Sell Phase (#59, spec §5.6).** In the Final Table Round's Sell Phase every personality sells every sellable Pokémon, on the Jev path and the fallback alike, unless the space after selling is a Gym, where Jev still decides. The engine facts are `finalTableRound` and the Sell phase's `destinationPosition` read against the engine's `board` (`ai/last-sell.ts`). Known limit: later seats can still battle a seat that sold, and a kept team could have helped there; this is accepted. `--record` and `--placeholders` skip these scenarios, which ask no request. The twin `sell-last-phase-gym-ahead` (Gym destination, both answers acceptable) is recorded: its Jev request is the same as `sell-last-phase-final-round`'s, since Jev is not told where the seat lands, so recording it only adds a second sample of that request.
- **Aggressive, `strategy-mixed-items-two-rivals`.** Jev picked Pickpocket on the rich rival (confidence 0.75, applied); the set expects Repel on that rival.
- **Aggressive, `encounter-weedle-poke-or-great`.** Jev picked the Poké Ball (0.67, applied); the set expects the Great Ball.
- **Opportunist, `strategy-battle-ticket-ahead`.** Jev used the Battle Ticket while far ahead (0.80, applied); the set expects skip.
- **Cautious, `strategy-repel-leader-near-start`.** Jev chose Repel on the leader at 0.32; the fallback applied skip, which is the acceptable answer.
- **Greedy, `sell-researcher-class-bonus`.** The one earlier miss (recorded before this change).

Still out of scope: tuning the confidence floors and pinning a baseline. Scoring Choice answers as the raw recorded answer, before the floor and fallback, is unchanged.

## Deal Card scenarios (#164 D3)

Spec §4.8, §5.3, §5.5. Seat 1 is the AI answering a Deal Card; seat 0 is the human who proposed it. There are 5 table states for each of the four personalities (`deal-scenarios.ts`: fair, lopsided, counter within budget, low trust, reject within budget), each with an acceptable set and a reason citing the personality's weights. Three over-budget states per personality have no fixture: code rejects and Jev is not asked, so the test replays them through the orchestrator and checks that no request goes out.

**Recorded on 2026-11-20** (`jev-1.13.0`, one request each, through the orchestrator), 20 fixtures. The 8 Repel ones were recorded again on 2026-11-21 (next paragraph):

- `greedy-deal-fair-eevee-sale`
- `greedy-deal-lopsided-snorlax-sale`
- `greedy-deal-counter-repel-overpay`
- `greedy-deal-low-trust-eevee-sale`
- `greedy-deal-reject-repel-overpay-low-trust`
- `aggressive-deal-fair-eevee-sale`
- `aggressive-deal-lopsided-snorlax-sale`
- `aggressive-deal-counter-repel-overpay`
- `aggressive-deal-low-trust-eevee-sale`
- `aggressive-deal-reject-repel-overpay-low-trust`
- `cautious-deal-fair-eevee-sale`
- `cautious-deal-lopsided-snorlax-sale`
- `cautious-deal-counter-repel-overpay`
- `cautious-deal-low-trust-eevee-sale`
- `cautious-deal-reject-repel-overpay-low-trust`
- `opportunist-deal-fair-eevee-sale`
- `opportunist-deal-lopsided-snorlax-sale`
- `opportunist-deal-counter-repel-overpay`
- `opportunist-deal-low-trust-eevee-sale`
- `opportunist-deal-reject-repel-overpay-low-trust`

**Re-recorded on 2026-11-21.** A deal request now names an item by its name only, with no effect text: an effect text carries numbers (Repel's was "Target's next move −2 (minimum 1)"), and §5.4 sends Jev none. That changed the request of every Repel deal, so the 8 recordings below went stale and were synthetic placeholders for a while. The captain recorded them live again on 2026-11-21 (`jev-1.13.0`, one request each, through the orchestrator); they are real recordings now and no fixture is synthetic:

- `greedy-deal-counter-repel-overpay`
- `greedy-deal-reject-repel-overpay-low-trust`
- `aggressive-deal-counter-repel-overpay`
- `aggressive-deal-reject-repel-overpay-low-trust`
- `cautious-deal-counter-repel-overpay`
- `cautious-deal-reject-repel-overpay-low-trust`
- `opportunist-deal-counter-repel-overpay`
- `opportunist-deal-reject-repel-overpay-low-trust`

Scores of the 20 deal rows (Jev's answer against the acceptable set), after the Repel re-recording on 2026-11-21:

| Personality | Fixtures | Correct / total (Jev's answer against the set) |
| ----------- | -------: | ---------------------------------------------: |
| Greedy      |        5 |                                            4/5 |
| Aggressive  |        5 |                                            4/5 |
| Cautious    |        5 |                                            4/5 |
| Opportunist |        5 |                                            3/5 |
| All         |       20 |                                    15/20 (75%) |

The whole offline set now scores 123/136 rows (90.4%), all 104 fixtures recorded, 0 synthetic; mean confidence correct 0.657 (n=68), incorrect 0.400 (n=12); `illegalAppliedActionCount` 0; `low_confidence` fallbacks 34 of 104. Earlier totals: 120/128 (93.8%) with the 8 Repel rows synthetic and left out, 124/136 (91.2%) with the first Repel recordings, 108/116 (93.1%) before the deal scenarios. The 12 non-Repel deal rows are 12/12 against their sets; the 8 Repel rows are 3/8. These are small counts and the acceptable sets are judgements.

Five Jev answers are outside their set in the 2026-11-21 Repel recording. All five were below the confidence floor, so the fallback policy chose the applied action, and each applied action is in its set (illegalAppliedActionCount 0). They are findings, not changes to a set:

- `aggressive-deal-counter-repel-overpay`: Jev `reject` (0.070); applied `respond-deal:accept`; set accept or counter.
- `cautious-deal-counter-repel-overpay`: Jev `accept` (0.430); applied `respond-deal:reject`; set counter or reject.
- `greedy-deal-counter-repel-overpay`: Jev `accept` (0.330); applied `respond-deal:reject`; set counter or reject.
- `opportunist-deal-counter-repel-overpay`: Jev `accept` (0.480); applied `counter-deal:coins-4`; set counter or reject.
- `opportunist-deal-reject-repel-overpay-low-trust`: Jev `accept` (0.130); applied `counter-deal:coins-4`; set counter or reject.

Four are the small-overpay Repel states, where Jev prefers to accept a loss of one or two coins that the personality weights say to counter or refuse; the fifth, `aggressive-deal-counter-repel-overpay`, is the opposite (reject for a small loss on an item the Aggressive weights would accept). The 2026-11-20 recording, with the effect text in the request, missed four of these five (the Aggressive one was right then); one recording per row is too few to say whether the wording caused the change.

**For #59 (the confidence floor; not tuned here).** 16 of the 20 recorded deal answers fall under the 0.6 floor (`ORCHESTRATOR_CONFIG.confidenceFloor.deal`, 0.6 up to 4 options), so for those the fallback policy chose, not Jev. All 20 are three-option questions (accept, reject, counter). In all 20 recordings Jev's reported confidence equals `(top − 1/n) / (1 − 1/n)` for `n` options and the top probability, to rounding: confidence measures the top probability above an even split, so the same confidence needs a different peak for a different option count (0.6 is a top probability of 0.80 for two options and 0.73 for three). The recorded tops run from 0.43 to 0.92, mean 0.60. That is an observation from 20 rows, not a documented Jev rule. The floor stays as it is until #59.

## Synthetic placeholders

A new scenario starts as a **synthetic placeholder** so the offline run, the counts and the guards work before anyone records it. A placeholder is a seeded stand-in, not a Jev answer. It cannot be mistaken for a recording:

- the fixture has `"synthetic": true`, and its `recorded.requestId` starts with `synthetic-`; the loader rejects a fixture where those two disagree, in either direction;
- the report counts it as synthetic, shows `n/a (synthetic)` in the Correct column, and leaves it out of accuracy and mean confidence;
- `npm run eval:jev -- --record` replaces every synthetic fixture and never touches a current recording.

```sh
npm run eval:jev -- --placeholders   # writes placeholders for scenarios with no fixture; offline, no key
```

No fixture is synthetic now. Never run `--placeholders` expecting it to change a recording: it does not replace one; a stale recording is removed first (as the eight Repel deal fixtures were before their re-recording).

## Recording (needs the key; a person does it)

An agent never records. Someone with `TYPESAFE_API_KEY` in `.env` runs this on a machine with no `CI` variable set:

```sh
npm run eval:jev -- --record
```

It makes one request per scenario that is missing, synthetic or stale, through the orchestrator, and writes each fixture with `synthetic: false`. Requests are logged to the usage ledger and stop at the spend cap or daily budget (spec §9). A scenario whose request changed (for example after a wording change) is stale and recorded again; a current recording is kept. Afterwards run `npm run eval:jev -- --offline` and commit the changed fixtures.

Fixtures still to record: the 32 battle decision fixtures (spec §4.4, §5.3, issue #56 C3), synthetic placeholders until the captain records them with `npm run eval:jev -- --record`. Eight tables by four personalities: the PvP challenge (`pvp_response`), the open Ability window (`ability_window`, a battle window and a Pickpocket reaction) and the winner's reward (`reward`, PvP and Gym).

- `greedy-pvp-response-even`
- `aggressive-pvp-response-even`
- `cautious-pvp-response-even`
- `opportunist-pvp-response-even`
- `greedy-pvp-response-underdog`
- `aggressive-pvp-response-underdog`
- `cautious-pvp-response-underdog`
- `opportunist-pvp-response-underdog`
- `greedy-pvp-response-favoured`
- `aggressive-pvp-response-favoured`
- `cautious-pvp-response-favoured`
- `opportunist-pvp-response-favoured`
- `greedy-window-defender-underdog`
- `aggressive-window-defender-underdog`
- `cautious-window-defender-underdog`
- `opportunist-window-defender-underdog`
- `greedy-window-defender-favoured`
- `aggressive-window-defender-favoured`
- `cautious-window-defender-favoured`
- `opportunist-window-defender-favoured`
- `greedy-window-pickpocket-block`
- `aggressive-window-pickpocket-block`
- `cautious-window-pickpocket-block`
- `opportunist-window-pickpocket-block`
- `greedy-reward-pvp-won`
- `aggressive-reward-pvp-won`
- `cautious-reward-pvp-won`
- `opportunist-reward-pvp-won`
- `greedy-reward-gym-won`
- `aggressive-reward-gym-won`
- `cautious-reward-gym-won`
- `opportunist-reward-gym-won`

The 104 other fixtures are recorded, and the 8 Repel deal fixtures were re-recorded on 2026-11-21 (listed under the Deal Card scenarios above).

The 16 promise response fixtures were recorded by the captain on 2026-11-20 (`jev-1.13.0`, one request each, through the orchestrator):

- `greedy-promise-recipient-high-trust`
- `aggressive-promise-recipient-high-trust`
- `cautious-promise-recipient-high-trust`
- `opportunist-promise-recipient-high-trust`
- `greedy-promise-recipient-low-trust`
- `aggressive-promise-recipient-low-trust`
- `cautious-promise-recipient-low-trust`
- `opportunist-promise-recipient-low-trust`
- `greedy-promise-promiser-high-trust`
- `aggressive-promise-promiser-high-trust`
- `cautious-promise-promiser-high-trust`
- `opportunist-promise-promiser-high-trust`
- `greedy-promise-promiser-low-trust`
- `aggressive-promise-promiser-low-trust`
- `cautious-promise-promiser-low-trust`
- `opportunist-promise-promiser-low-trust`

Any synthetic fixture added later must be listed under "Fixtures still to record" by ID, one per line, until it is recorded.

Recorded on 2026-11-20 (the captain, `jev-1.13.0`, replacing the synthetic placeholders):

- aggressive-sell-last-phase-gym-ahead
- cautious-sell-last-phase-gym-ahead
- opportunist-sell-last-phase-gym-ahead

## Adding a scenario

1. Add a group in `personality-scenarios.ts`: the table state, and for each personality the acceptable set and a `reason` that cites its weights.
2. Run `npm run eval:jev -- --placeholders`, then list the new IDs under "Fixtures still to record" until a person records them.
3. Run `npm test` and `npm run eval:jev -- --offline`.
