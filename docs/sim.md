# Simulation: seed sets and summary metrics

How `npm run sim` keeps tuning and evaluation seeds apart, and what its summary reports. Usage and flags are in [sim/README.md](../sim/README.md). Spec: §8 (Simulation: variation and scoring), Appendix A (Ball price check).

## Seed sets

Spec §8 keeps tuning seeds separate from evaluation seeds. A run declares its set with `--seed-set tune|eval` (default `tune`):

| Set    | Game seeds         | Use                                                         |
| ------ | ------------------ | ----------------------------------------------------------- |
| `tune` | below 1,000,000    | Exploring and tuning: try changes, compare, iterate.        |
| `eval` | 1,000,000 and up   | Reported results only, after the change is fixed.           |

Game `g` of a run uses seed `--seed + g`, so the check covers every game: `--games 100 --seed 999950` is refused for `tune` because its last games reach 1,000,000. A seed outside the declared set exits with code 2 and a message such as `sim: --seed-set eval takes only seeds from 1000000; this run uses seeds 5 to 6`. A failing `eval` game prints a reproduce command that includes `--seed-set eval`.

Do not tune against `eval` seeds: once a number has been chosen by looking at an evaluation run, that run no longer evaluates it.

## Summary metrics

Standard output carries one JSON line, then a short readable table. Scripts read the first line only.

| Field                  | Meaning                                                                                                                                                                                      |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `seedSet`              | The declared seed set.                                                                                                                                                                       |
| `averageTurns`         | Turns per finished game (`globalTurnNo` at the end).                                                                                                                                         |
| `averageFinalCoins`    | Mean coins per player when a finished game ends, after the final auto-sale.                                                                                                                 |
| `ties`, `tieRate`      | Finished games with co-winners, and their share of finished games. Co-winners score 1/k each in `winners` (§8 Scoring).                                                                     |
| `classInSeat`          | Games each class played in each seat, indexed by seat. Classes rotate by game seed, so over any run the counts differ by at most 1 (§8 Variation).                                          |
| `catching`             | `encounters`, catch `attempts` (each spends one Ball), successful `catches` and `releases`. Every encounter ends in exactly one attempt or one release.                                     |
| `catching.byBallDcLap` | Appendix A's `catchAttempt / encounter`: one row per Ball type, catch DC and Lap with at least one encounter, giving `encounters`, `attempts` and `catches` with that Ball, and `attemptsPerEncounter`. |
| `shop`                 | Shop `purchases` by offer ID (`offer-poke`, `offer-lucky-egg`, ...).                                                                                                                         |
| `features`             | Trigger evidence (§8, Appendix A): Ability activations by effect `primitives`, core `classPassives` that changed a number (a catch or sale class bonus, Rival's combat bonus, Nurse Joy's heal or loss protection), and `battles` (`pvp`, of which `forced`, and `gym`). |
| `hostility`           | Hostile-item `hostileUsed`, `legalHostileOpportunity`, `usedPerOpportunity`, and `byPersonalityLap` rows with the same counts and rate. See definitions below (§8 Scoring). |
| `promises`            | `offered`, `accepted`, `rejected`, `broken`, `kept`, `keptWithOpportunity`, `keptWithoutOpportunity`, `closedByGameEnd`, `breachOpportunity`, and `pending`. Always present, including zero counts without `--social`. |
| `social`              | With `--social`, the existing `promiseOffers`, `promisesAccepted`, and `promisesRejected` fields mirror the corresponding `promises` counts. |
| `salesByLap`           | Start Sell Phase sales by Lap: Pokémon `sold` (Rescue Starters included, at 0) and `coins` paid. Final Table Round auto-sales are not counted.                                               |

**Lap** in `byBallDcLap` and `salesByLap` is the acting player's `creditedLap`: the number of paid Start crossings so far. Lap 0 is before the first crossing; the Sell Phase after the n-th crossing is Lap n.

`catches / attempts` in a row is that Ball's observed success rate at that DC; with the Ball prices in content it gives the success-per-cost comparison Appendix A asks for before any price change. The summary records measurements only: balance changes and policy comparisons are separate work.

## Hostile items and promises

Spec: §4.8 (promise window and attack evidence), §8 (Simulation scoring), §10 C4.

`hostility.legalHostileOpportunity` counts **one opportunity per seat turn** in which an accepted decision had at least one enabled hostile-item choice. Several held items, several legal targets, or another decision in the same turn do not add opportunities. Disabled choices add none. `hostileUsed` counts canonical `attack_attempt` events whose source is `hostile_item`, including attempts blocked by a shield. Hostile Abilities and PvP declarations contribute to promise evidence, rather than this item metric. `usedPerOpportunity` is the count ratio, or JSON `null` (printed as `n/a`) when there were no opportunities.

`hostility.byPersonalityLap` groups both counts by the deciding policy's personality ID and the acting player's `creditedLap`. Fallback and Jev already carry their personality. Random policies, including the human seat under `--social`, are labelled `unassigned`; the sim does not invent a personality for them. Rows exist only when a use or opportunity was observed. All counts cover accepted steps, including the completed portion of an aborted game.

Promise offers and answers come from their engine events. Each acceptance opens one reporting obligation until the end of the promiser's next own turn. A canonical attack attempt by that promiser against that recipient records `broken` immediately, including a shield-blocked attempt; later attempts cannot count it again. Other actors and other targets do not break it.

`breachOpportunity` counts accepted promises with at least one enabled PvP declaration, hostile item or hostile Ability directed at their recipient during their window. Each promise counts at most once, including defensive Ability windows on another seat's turn. At expiry, an unbroken promise is `keptWithOpportunity` or `keptWithoutOpportunity`, and their sum is `kept`. A game ending before the deadline records `closedByGameEnd`, excluded from kept/broken comparisons. Expiry on the game's final turn still counts as kept. Aborted games leave unresolved accepted promises `pending`, rather than treating them as kept or closed by game end.

Accounting identities:

- `accepted = broken + kept + closedByGameEnd + pending`.
- `kept = keptWithOpportunity + keptWithoutOpportunity`.
- In a finished game, `offered = accepted + rejected` and `pending = 0`. An abort while an offer awaits its answer can leave `offered` greater than `accepted + rejected`.

These are simulation measurements of the existing window and attack evidence. They do not settle engine promises, update trust or add memory; that gameplay work remains deferred under §4.8. Event/deck and Sell/keep-value integration and the balanced 300-game report are separate work.
