# Jev decision-scenario eval

Spec: v1.0 §5.5, §5.4, §8, §12. Issues #59 (eval set) and #233 (personality scenarios, stream B).

Spec §8 asks for at least 60 decision scenarios, 15 per personality, each with an acceptable-answer set. Every scenario is one engine state where seat 0 (the AI) decides a Strategy, an Encounter or a Sell Phase. The request goes through the real question builders and the orchestrator, so every number is an engine fact turned into a named bucket, and nothing hidden reaches Jev (the leak, number and size guards run on every scenario).

```sh
npm run eval:jev -- --offline   # replays every fixture: no key, no network
```

The report counts the scenarios per personality, and splits recorded fixtures from synthetic ones (see below).

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

## Synthetic placeholders

The 45 personality scenarios start as **synthetic placeholders** so the offline run, the counts and the guards work before anyone records them. A placeholder is a seeded stand-in, not a Jev answer. It cannot be mistaken for a recording:

- the fixture has `"synthetic": true`, and its `recorded.requestId` starts with `synthetic-`; the loader rejects a fixture where those two disagree, in either direction;
- the report counts it as synthetic, shows `n/a (synthetic)` in the Correct column, and leaves it out of accuracy and mean confidence;
- `npm run eval:jev -- --record` replaces every synthetic fixture and never touches a current recording.

```sh
npm run eval:jev -- --placeholders   # writes missing or stale placeholders, offline, no key
```

## Recording (needs the key; a person does it)

An agent never records. Someone with `TYPESAFE_API_KEY` in `.env` runs this on a machine with no `CI` variable set:

```sh
npm run eval:jev -- --record
```

It makes one request per scenario that has no current recording (45 here), through the orchestrator, and writes each fixture with `synthetic: false`. Requests are logged to the usage ledger and stop at the spend cap or daily budget (spec §9). A scenario whose request changed (for example after a wording change) is recorded again; a current recording is kept. Afterwards run `npm run eval:jev -- --offline` and commit the changed fixtures.

Fixtures to record (45, one per line; each is `eval/jev/fixtures/<id>.json`):

```text
aggressive-strategy-battle-ticket-ahead
aggressive-strategy-battle-ticket-leader
aggressive-strategy-mixed-items-two-rivals
aggressive-strategy-pickpocket-rich-rival
aggressive-strategy-pickpocket-richer-target
aggressive-strategy-repel-leader-near-start
aggressive-encounter-magikarp-only-ultra
aggressive-encounter-pidgey-poke-or-great
aggressive-encounter-rare-snorlax-ultra
aggressive-encounter-weedle-poke-or-great
aggressive-sell-gyarados-early-lap
aggressive-sell-last-phase-final-round
aggressive-sell-magikarp-low-sale-high-keep
aggressive-sell-snorlax-high-sale-low-keep
aggressive-sell-tired-eevee
cautious-strategy-battle-ticket-ahead
cautious-strategy-battle-ticket-leader
cautious-strategy-mixed-items-two-rivals
cautious-strategy-pickpocket-rich-rival
cautious-strategy-pickpocket-richer-target
cautious-strategy-repel-leader-near-start
cautious-encounter-magikarp-only-ultra
cautious-encounter-pidgey-poke-or-great
cautious-encounter-rare-snorlax-ultra
cautious-encounter-weedle-poke-or-great
cautious-sell-gyarados-early-lap
cautious-sell-last-phase-final-round
cautious-sell-magikarp-low-sale-high-keep
cautious-sell-snorlax-high-sale-low-keep
cautious-sell-tired-eevee
opportunist-strategy-battle-ticket-ahead
opportunist-strategy-battle-ticket-leader
opportunist-strategy-mixed-items-two-rivals
opportunist-strategy-pickpocket-rich-rival
opportunist-strategy-pickpocket-richer-target
opportunist-strategy-repel-leader-near-start
opportunist-encounter-magikarp-only-ultra
opportunist-encounter-pidgey-poke-or-great
opportunist-encounter-rare-snorlax-ultra
opportunist-encounter-weedle-poke-or-great
opportunist-sell-gyarados-early-lap
opportunist-sell-last-phase-final-round
opportunist-sell-magikarp-low-sale-high-keep
opportunist-sell-snorlax-high-sale-low-keep
opportunist-sell-tired-eevee
```

Out of scope here: tuning the confidence floors and pinning a baseline, which come after the recording.

## Adding a scenario

1. Add a group in `personality-scenarios.ts`: the table state, and for each personality the acceptable set and a `reason` that cites its weights.
2. Run `npm run eval:jev -- --placeholders`, then add the new IDs to the list above.
3. Run `npm test` and `npm run eval:jev -- --offline`.
