# Jev decision-scenario eval

Spec: v1.0 §5.5, §5.4, §8, §12. Issues #59 (eval set) and #233 (personality scenarios, stream B).

Spec §8 asks for at least 60 decision scenarios, 15 per personality, each with an acceptable-answer set. Every scenario is one engine state where seat 0 (the AI) decides a Strategy, an Encounter or a Sell Phase. The request goes through the real question builders and the orchestrator, so every number is an engine fact turned into a named bucket, and nothing hidden reaches Jev (the leak, number and size guards run on every scenario).

```sh
npm run eval:jev -- --offline   # replays every fixture: no key, no network
```

The report counts the scenarios per personality, and splits recorded fixtures from synthetic ones (see below). All 65 are recorded; see the results.

## The scenarios

| Personality | Scenarios | Source                                                                                            |
| ----------- | --------: | ------------------------------------------------------------------------------------------------- |
| Greedy      |        20 | `scenarios.ts`: live recordings, 8 Strategy, 6 Encounter, 6 Sell. Already above 15, so none added |
| Aggressive  |        15 | `personality-scenarios.ts`: 6 Strategy, 4 Encounter, 5 Sell                                       |
| Cautious    |        15 | the same 15 table states                                                                          |
| Opportunist |        15 | the same 15 table states                                                                          |

The 15 states are shared. Twelve of them are the exact table state of a Greedy scenario (its `greedyTwin`), and three are new (the two Battle Ticket states and the Weedle Ball choice). A scenario ID is `<personality>-<state>`, for example `aggressive-strategy-repel-leader-near-start`. Within one state the requests differ only in `you.personality`, which is spec §8's "paired scenarios swap personality while holding everything else constant"; a test checks that.

### Acceptable sets and reasons

Each scenario has an acceptable set and a written `reason` (also stored in its fixture). The reason cites the weights in `content/personalities/<id>.json` (`risk`, `aggression`, `liquidity`, `loyalty`), and a test checks that every cited value matches the file. The sets are judgements made from those weights and descriptions, not the output of the fallback policy: the policy cannot pick a Battle Ticket, for example. Where several answers fit, the set lists all of them.

### The four contrasts

| Contrast             | States                                                                                                                                                                       | Where the personalities differ                                                                                                                                    |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hostile item vs skip | `strategy-pickpocket-rich-rival`, `strategy-pickpocket-richer-target`, `strategy-repel-leader-near-start`, `strategy-mixed-items-two-rivals`                                 | Repel on the leader: Aggressive uses it, Cautious skips. With three items, Aggressive picks Repel, Opportunist Pickpocket, Cautious skips or the Lucky Egg        |
| PvP vs not           | `strategy-battle-ticket-leader`, `strategy-battle-ticket-ahead` (a Battle Ticket forces the target to accept PvP)                                                            | Against the leader Aggressive forces the fight, Cautious skips; when far ahead Aggressive may, Cautious and Opportunist skip                                      |
| Sell vs keep         | `sell-snorlax-high-sale-low-keep`, `sell-gyarados-early-lap`, `sell-tired-eevee`, `sell-magikarp-low-sale-high-keep`, `sell-last-phase-final-round` (all personalities sell) | A high sale now: Opportunist sells, Aggressive keeps, Cautious may do either                                                                                      |
| Ball choice          | `encounter-magikarp-only-ultra`, `encounter-weedle-poke-or-great`, `encounter-rare-snorlax-ultra`, `encounter-pidgey-poke-or-great`                                          | One Ultra Ball for a common Magikarp: Aggressive throws, Greedy releases. Weedle: Aggressive and Cautious take the Great Ball, Opportunist may keep the Poké Ball |

Some states are agreement controls (every personality gives the same answer), so a model that only echoes the personality text is not rewarded.

**PvP.** Spec §5.3 (the temporary #55 exception) keeps `declare_pvp` out of Strategy questions until Stream B adds PvP questions, and there is no PvP response question yet. The PvP contrast is therefore expressed through the Battle Ticket item, which is a real Strategy option that forces PvP. When the PvP questions arrive, add scenarios for them here.

## Results of the recording

The captain recorded all 45 personality scenarios live on 2026-11-18 (`jev-1.13.0`, one request each, through the orchestrator). With the 20 Greedy recordings the set is **65 fixtures, 65 recorded, 0 synthetic**. These figures come from `npm run eval:jev -- --offline` on that set; counts are Jev answers (Choice and Noul rows) scored against the acceptable sets, with n as shown:

| Measure                              | Result                                          |
| ------------------------------------ | ----------------------------------------------- |
| Accuracy, recorded fixtures          | 78/91 (85.7%)                                   |
| `illegalAppliedActionCount`          | 0                                               |
| Fallbacks (`low_confidence`)         | 16 of 65 decisions                              |
| Mean confidence, correct / incorrect | 0.688 (n=37) / 0.480 (n=7); Noul rows have none |

| Personality | Fixtures | Rows correct / total | Strategy | Encounter |  Sell |
| ----------- | -------: | -------------------: | -------: | --------: | ----: |
| Greedy      |       20 |                27/28 |      8/8 |       6/6 | 13/14 |
| Aggressive  |       15 |                16/21 |      5/6 |       3/4 |  8/11 |
| Cautious    |       15 |                15/21 |      5/6 |       1/4 |  9/11 |
| Opportunist |       15 |                20/21 |      5/6 |       4/4 | 11/11 |

These are small counts, not a general claim about Jev or the personalities, and the acceptable sets are themselves judgements. The misses below are inputs for #59: tuning the personality instructions, or correcting an acceptable set, whichever the evidence favours. They are not failures of this change.

- **Cautious Encounter, 3 of 4 missed.** Jev answered `release` on `pidgey-poke-or-great`, `weedle-poke-or-great` and `rare-snorlax-ultra` at low confidence (0.35, 0.28 and 0.19). Each fell below the floor, so the fallback policy chose a catch (Poké Ball, Poké Ball, Ultra Ball), which is acceptable. The set expects a catch for all three.
- **Aggressive and Cautious Sell, 5 rows.** Jev's Noul was `true` (sell) where the set expects `false` (keep): Aggressive on `magikarp-low-sale-high-keep` (0.59), `snorlax-high-sale-low-keep` (0.66) and `tired-eevee` (0.63); Cautious on `magikarp-low-sale-high-keep` (0.59) and `tired-eevee` (0.64). None was applied: each Noul is below that personality's sell threshold (0.92 Aggressive, 0.8 Cautious), so nothing was sold. Cautious on `snorlax-high-sale-low-keep` accepts either answer and is not a miss.
- **Aggressive, `strategy-mixed-items-two-rivals`.** Jev picked Pickpocket on the rich rival (confidence 0.75, applied); the set expects Repel on that rival.
- **Aggressive, `encounter-weedle-poke-or-great`.** Jev picked the Poké Ball (0.67, applied); the set expects the Great Ball.
- **Opportunist, `strategy-battle-ticket-ahead`.** Jev used the Battle Ticket while far ahead (0.80, applied); the set expects skip.
- **Cautious, `strategy-repel-leader-near-start`.** Jev chose Repel on the leader at 0.32; the fallback applied skip, which is the acceptable answer.
- **Greedy, `sell-researcher-class-bonus`.** The one earlier miss (recorded before this change).

Still out of scope: tuning the confidence floors and pinning a baseline.

## Synthetic placeholders

A new scenario starts as a **synthetic placeholder** so the offline run, the counts and the guards work before anyone records it. A placeholder is a seeded stand-in, not a Jev answer. It cannot be mistaken for a recording:

- the fixture has `"synthetic": true`, and its `recorded.requestId` starts with `synthetic-`; the loader rejects a fixture where those two disagree, in either direction;
- the report counts it as synthetic, shows `n/a (synthetic)` in the Correct column, and leaves it out of accuracy and mean confidence;
- `npm run eval:jev -- --record` replaces every synthetic fixture and never touches a current recording.

```sh
npm run eval:jev -- --placeholders   # writes placeholders for scenarios with no fixture; offline, no key
```

No fixture is synthetic now. Never run `--placeholders` expecting it to change a recording: it does not replace one.

## Recording (needs the key; a person does it)

An agent never records. Someone with `TYPESAFE_API_KEY` in `.env` runs this on a machine with no `CI` variable set:

```sh
npm run eval:jev -- --record
```

It makes one request per scenario that is missing, synthetic or stale, through the orchestrator, and writes each fixture with `synthetic: false`. Requests are logged to the usage ledger and stop at the spend cap or daily budget (spec §9). A scenario whose request changed (for example after a wording change) is stale and recorded again; a current recording is kept. Afterwards run `npm run eval:jev -- --offline` and commit the changed fixtures.

Fixtures still to record: none. Any synthetic fixture added later must be listed here by ID, one per line, until it is recorded.

## Adding a scenario

1. Add a group in `personality-scenarios.ts`: the table state, and for each personality the acceptable set and a `reason` that cites its weights.
2. Run `npm run eval:jev -- --placeholders`, then list the new IDs under "Fixtures still to record" until a person records them.
3. Run `npm test` and `npm run eval:jev -- --offline`.
