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
| `salesByLap`           | Start Sell Phase sales by Lap: Pokémon `sold` (Rescue Starters included, at 0) and `coins` paid. Final Table Round auto-sales are not counted.                                               |

**Lap** in `byBallDcLap` and `salesByLap` is the acting player's `creditedLap`: the number of paid Start crossings so far. Lap 0 is before the first crossing; the Sell Phase after the n-th crossing is Lap n.

`catches / attempts` in a row is that Ball's observed success rate at that DC; with the Ball prices in content it gives the success-per-cost comparison Appendix A asks for before any price change. The summary records measurements only: balance changes and policy comparisons are separate work.
