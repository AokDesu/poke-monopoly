# C1 exit report

The cycle 1 exit check (issue #27). Spec: v1.0 §10 C1 (exit criteria), §1 (hard gates), §8 (invariants and simulation).

## Verdict

| Exit criterion (spec §10 C1) | Met | Evidence |
| --- | --- | --- |
| 100 sim games with no invariant failures | **Yes** | [Sim runs](#criterion-1-100-sim-games-with-no-invariant-failures): 100 games each at 2, 3 and 4 seats; `invariantFailures: 0`, `illegalAppliedActionCount: 0` and `aborted: 0` in every run. |
| Real latency and cost figures in hand | **Yes** | [`jev-spike-report.md`](jev-spike-report.md): p50 281 ms, p95 364 ms over 200 live calls; about $0.019 (THB 0.63) per Standard 4-seat game. |
| Working hours confirmed | **Yes** | [`PLAN.md`](PLAN.md) (issue #10): 12 hours per person per week. The course calendar in the same file is still incomplete; see [open items](#open-c1-items). |

C1 passes its exit criteria, checked on 2026-10-27, nine days after C1's planned end (18 Oct). Two C1 issues stay open on stream B and one cut-list issue on stream C; they are listed below with what spilled into C2.

## Environment

- Commit: `68c015f` (`origin/main` on 2026-10-27, after pull requests #111 and #113 merged).
- Node `v22.22.1`, npm `9.2.0`, after `npm ci`. The repository pins Node 24 (`.node-version`, `engines: ^24.15.0`), so `npm ci` warns about the engine; CI runs these checks on Node 24.
- The sim uses the real engine and the spec §8 invariant checker: `sim/cli.ts` passes `realEngine` and `checkInvariants` from `engine/` to the runner (wired since issue #14), so every applied action is checked. The run exits 1 when any game has an illegal applied action, an invariant failure or an abort (spec §1, §8).

## Criterion 1: 100 sim games with no invariant failures

**Yes.** Each run played 100 games on the `tune` seed set from seed 1, with class and seat balanced across games, and exited 0.

| Seats | Command | Exit code | `invariantFailures` | `illegalAppliedActionCount` | `aborted` | Average turns | Ties |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 2 | `npm run sim -- --games 100 --seed 1 --seats 2` | 0 | 0 | 0 | 0 | 26.56 | 8 |
| 3 | `npm run sim -- --games 100 --seed 1 --seats 3` | 0 | 0 | 0 | 0 | 38.19 | 4 |
| 4 | `npm run sim -- --games 100 --seed 1 --seats 4` | 0 | 0 | 0 | 0 | 49.92 | 2 |

No run reported a failure, so no issue was opened. The full output of each run follows, copied unchanged (blank lines removed). The JSON line is the machine-readable summary; the lines after it are the same summary formatted for reading.

### 2 seats

```text
> poke-monopoly@0.0.0 sim
> tsx sim/cli.ts --games 100 --seed 1 --seats 2
{"games":100,"seedSet":"tune","seats":2,"averageTurns":26.56,"averageFinalCoins":39.57,"winners":{"bySeat":[49,51],"byClass":{"main-character":20,"rival":17,"fisherman":18,"nurse-joy":14.5,"bug-catcher":17,"researcher":13.5}},"ties":8,"tieRate":0.08,"classInSeat":{"main-character":[16,16],"rival":[17,16],"fisherman":[17,17],"nurse-joy":[17,17],"bug-catcher":[17,17],"researcher":[16,17]},"aborted":0,"illegalAppliedActionCount":0,"invariantFailures":0,"catching":{"encounters":1229,"attempts":695,"catches":500,"releases":534,"byBallDcLap":[{"ballType":"poke","dc":2,"lap":0,"encounters":247,"attempts":109,"catches":90,"attemptsPerEncounter":0.44},{"ballType":"poke","dc":2,"lap":1,"encounters":234,"attempts":103,"catches":96,"attemptsPerEncounter":0.44},{"ballType":"poke","dc":2,"lap":2,"encounters":16,"attempts":6,"catches":6,"attemptsPerEncounter":0.38},{"ballType":"poke","dc":3,"lap":0,"encounters":160,"attempts":74,"catches":48,"attemptsPerEncounter":0.46},{"ballType":"poke","dc":3,"lap":1,"encounters":162,"attempts":70,"catches":44,"attemptsPerEncounter":0.43},{"ballType":"poke","dc":3,"lap":2,"encounters":12,"attempts":5,"catches":3,"attemptsPerEncounter":0.42},{"ballType":"poke","dc":4,"lap":0,"encounters":110,"attempts":52,"catches":31,"attemptsPerEncounter":0.47},{"ballType":"poke","dc":4,"lap":1,"encounters":109,"attempts":56,"catches":28,"attemptsPerEncounter":0.51},{"ballType":"poke","dc":4,"lap":2,"encounters":13,"attempts":3,"catches":2,"attemptsPerEncounter":0.23},{"ballType":"poke","dc":5,"lap":0,"encounters":92,"attempts":40,"catches":16,"attemptsPerEncounter":0.43},{"ballType":"poke","dc":5,"lap":1,"encounters":65,"attempts":31,"catches":7,"attemptsPerEncounter":0.48},{"ballType":"poke","dc":5,"lap":2,"encounters":9,"attempts":6,"catches":3,"attemptsPerEncounter":0.67},{"ballType":"great","dc":2,"lap":0,"encounters":247,"attempts":26,"catches":26,"attemptsPerEncounter":0.11},{"ballType":"great","dc":2,"lap":1,"encounters":234,"attempts":17,"catches":17,"attemptsPerEncounter":0.07},{"ballType":"great","dc":2,"lap":2,"encounters":16,"attempts":0,"catches":0,"attemptsPerEncounter":0},{"ballType":"great","dc":3,"lap":0,"encounters":160,"attempts":10,"catches":9,"attemptsPerEncounter":0.06},{"ballType":"great","dc":3,"lap":1,"encounters":162,"attempts":18,"catches":15,"attemptsPerEncounter":0.11},{"ballType":"great","dc":3,"lap":2,"encounters":12,"attempts":1,"catches":0,"attemptsPerEncounter":0.08},{"ballType":"great","dc":4,"lap":0,"encounters":110,"attempts":13,"catches":12,"attemptsPerEncounter":0.12},{"ballType":"great","dc":4,"lap":1,"encounters":109,"attempts":4,"catches":4,"attemptsPerEncounter":0.04},{"ballType":"great","dc":4,"lap":2,"encounters":13,"attempts":2,"catches":2,"attemptsPerEncounter":0.15},{"ballType":"great","dc":5,"lap":0,"encounters":92,"attempts":7,"catches":4,"attemptsPerEncounter":0.08},{"ballType":"great","dc":5,"lap":1,"encounters":65,"attempts":4,"catches":1,"attemptsPerEncounter":0.06},{"ballType":"great","dc":5,"lap":2,"encounters":9,"attempts":0,"catches":0,"attemptsPerEncounter":0},{"ballType":"ultra","dc":2,"lap":0,"encounters":247,"attempts":7,"catches":7,"attemptsPerEncounter":0.03},{"ballType":"ultra","dc":2,"lap":1,"encounters":234,"attempts":8,"catches":8,"attemptsPerEncounter":0.03},{"ballType":"ultra","dc":2,"lap":2,"encounters":16,"attempts":1,"catches":1,"attemptsPerEncounter":0.06},{"ballType":"ultra","dc":3,"lap":0,"encounters":160,"attempts":3,"catches":3,"attemptsPerEncounter":0.02},{"ballType":"ultra","dc":3,"lap":1,"encounters":162,"attempts":8,"catches":8,"attemptsPerEncounter":0.05},{"ballType":"ultra","dc":3,"lap":2,"encounters":12,"attempts":0,"catches":0,"attemptsPerEncounter":0},{"ballType":"ultra","dc":4,"lap":0,"encounters":110,"attempts":2,"catches":2,"attemptsPerEncounter":0.02},{"ballType":"ultra","dc":4,"lap":1,"encounters":109,"attempts":3,"catches":3,"attemptsPerEncounter":0.03},{"ballType":"ultra","dc":4,"lap":2,"encounters":13,"attempts":1,"catches":1,"attemptsPerEncounter":0.08},{"ballType":"ultra","dc":5,"lap":0,"encounters":92,"attempts":1,"catches":0,"attemptsPerEncounter":0.01},{"ballType":"ultra","dc":5,"lap":1,"encounters":65,"attempts":4,"catches":3,"attemptsPerEncounter":0.06},{"ballType":"ultra","dc":5,"lap":2,"encounters":9,"attempts":0,"catches":0,"attemptsPerEncounter":0}]},"shop":{"purchases":{"offer-great":91,"offer-lucky-egg":44,"offer-pickpocket":49,"offer-poke":77,"offer-repel":51,"offer-ultra":63}},"salesByLap":{"1":{"sold":125,"coins":910},"2":{"sold":69,"coins":475}}}
Sim: 100 games, 2 seats, seed set tune
  Turns per game        26.56
  Average final coins   39.57
  Tie rate              0.08 (8 ties)
  Catching              1229 encounters, 695 attempts, 500 catches, 534 releases
  Shop                  offer-great 91, offer-lucky-egg 44, offer-pickpocket 49, offer-poke 77, offer-repel 51, offer-ultra 63
  Sales by Lap          Lap 1: 125 sold for 910; Lap 2: 69 sold for 475
  Class in seat         main-character 16/16, rival 17/16, fisherman 17/17, nurse-joy 17/17, bug-catcher 17/17, researcher 16/17
  catchAttempt / encounter by DC and Lap (Poké / Great / Ultra):
    DC 2 Lap 0  n=247   0.44 / 0.11 / 0.03
    DC 2 Lap 1  n=234   0.44 / 0.07 / 0.03
    DC 2 Lap 2  n=16    0.38 / 0 / 0.06
    DC 3 Lap 0  n=160   0.46 / 0.06 / 0.02
    DC 3 Lap 1  n=162   0.43 / 0.11 / 0.05
    DC 3 Lap 2  n=12    0.42 / 0.08 / 0
    DC 4 Lap 0  n=110   0.47 / 0.12 / 0.02
    DC 4 Lap 1  n=109   0.51 / 0.04 / 0.03
    DC 4 Lap 2  n=13    0.23 / 0.15 / 0.08
    DC 5 Lap 0  n=92    0.43 / 0.08 / 0.01
    DC 5 Lap 1  n=65    0.48 / 0.06 / 0.06
    DC 5 Lap 2  n=9     0.67 / 0 / 0
```

### 3 seats

```text
> poke-monopoly@0.0.0 sim
> tsx sim/cli.ts --games 100 --seed 1 --seats 3
{"games":100,"seedSet":"tune","seats":3,"averageTurns":38.19,"averageFinalCoins":38.08,"winners":{"bySeat":[23,35.5,41.5],"byClass":{"main-character":17,"rival":11,"fisherman":16.5,"nurse-joy":22.5,"bug-catcher":16,"researcher":17}},"ties":4,"tieRate":0.04,"classInSeat":{"main-character":[16,16,17],"rival":[17,16,16],"fisherman":[17,17,16],"nurse-joy":[17,17,17],"bug-catcher":[17,17,17],"researcher":[16,17,17]},"aborted":0,"illegalAppliedActionCount":0,"invariantFailures":0,"catching":{"encounters":1740,"attempts":958,"catches":681,"releases":782,"byBallDcLap":[{"ballType":"poke","dc":2,"lap":0,"encounters":363,"attempts":161,"catches":134,"attemptsPerEncounter":0.44},{"ballType":"poke","dc":2,"lap":1,"encounters":323,"attempts":137,"catches":114,"attemptsPerEncounter":0.42},{"ballType":"poke","dc":2,"lap":2,"encounters":16,"attempts":6,"catches":4,"attemptsPerEncounter":0.38},{"ballType":"poke","dc":3,"lap":0,"encounters":252,"attempts":106,"catches":73,"attemptsPerEncounter":0.42},{"ballType":"poke","dc":3,"lap":1,"encounters":198,"attempts":85,"catches":61,"attemptsPerEncounter":0.43},{"ballType":"poke","dc":3,"lap":2,"encounters":15,"attempts":6,"catches":3,"attemptsPerEncounter":0.4},{"ballType":"poke","dc":4,"lap":0,"encounters":161,"attempts":65,"catches":32,"attemptsPerEncounter":0.4},{"ballType":"poke","dc":4,"lap":1,"encounters":166,"attempts":79,"catches":46,"attemptsPerEncounter":0.48},{"ballType":"poke","dc":4,"lap":2,"encounters":14,"attempts":5,"catches":3,"attemptsPerEncounter":0.36},{"ballType":"poke","dc":5,"lap":0,"encounters":109,"attempts":48,"catches":17,"attemptsPerEncounter":0.44},{"ballType":"poke","dc":5,"lap":1,"encounters":115,"attempts":52,"catches":19,"attemptsPerEncounter":0.45},{"ballType":"poke","dc":5,"lap":2,"encounters":8,"attempts":5,"catches":3,"attemptsPerEncounter":0.63},{"ballType":"great","dc":2,"lap":0,"encounters":363,"attempts":34,"catches":34,"attemptsPerEncounter":0.09},{"ballType":"great","dc":2,"lap":1,"encounters":323,"attempts":25,"catches":25,"attemptsPerEncounter":0.08},{"ballType":"great","dc":2,"lap":2,"encounters":16,"attempts":1,"catches":1,"attemptsPerEncounter":0.06},{"ballType":"great","dc":3,"lap":0,"encounters":252,"attempts":21,"catches":17,"attemptsPerEncounter":0.08},{"ballType":"great","dc":3,"lap":1,"encounters":198,"attempts":15,"catches":12,"attemptsPerEncounter":0.08},{"ballType":"great","dc":3,"lap":2,"encounters":15,"attempts":0,"catches":0,"attemptsPerEncounter":0},{"ballType":"great","dc":4,"lap":0,"encounters":161,"attempts":21,"catches":11,"attemptsPerEncounter":0.13},{"ballType":"great","dc":4,"lap":1,"encounters":166,"attempts":11,"catches":10,"attemptsPerEncounter":0.07},{"ballType":"great","dc":4,"lap":2,"encounters":14,"attempts":0,"catches":0,"attemptsPerEncounter":0},{"ballType":"great","dc":5,"lap":0,"encounters":109,"attempts":7,"catches":4,"attemptsPerEncounter":0.06},{"ballType":"great","dc":5,"lap":1,"encounters":115,"attempts":8,"catches":3,"attemptsPerEncounter":0.07},{"ballType":"great","dc":5,"lap":2,"encounters":8,"attempts":0,"catches":0,"attemptsPerEncounter":0},{"ballType":"ultra","dc":2,"lap":0,"encounters":363,"attempts":7,"catches":7,"attemptsPerEncounter":0.02},{"ballType":"ultra","dc":2,"lap":1,"encounters":323,"attempts":15,"catches":15,"attemptsPerEncounter":0.05},{"ballType":"ultra","dc":2,"lap":2,"encounters":16,"attempts":1,"catches":1,"attemptsPerEncounter":0.06},{"ballType":"ultra","dc":3,"lap":0,"encounters":252,"attempts":4,"catches":4,"attemptsPerEncounter":0.02},{"ballType":"ultra","dc":3,"lap":1,"encounters":198,"attempts":8,"catches":8,"attemptsPerEncounter":0.04},{"ballType":"ultra","dc":3,"lap":2,"encounters":15,"attempts":0,"catches":0,"attemptsPerEncounter":0},{"ballType":"ultra","dc":4,"lap":0,"encounters":161,"attempts":6,"catches":5,"attemptsPerEncounter":0.04},{"ballType":"ultra","dc":4,"lap":1,"encounters":166,"attempts":10,"catches":7,"attemptsPerEncounter":0.06},{"ballType":"ultra","dc":4,"lap":2,"encounters":14,"attempts":1,"catches":1,"attemptsPerEncounter":0.07},{"ballType":"ultra","dc":5,"lap":0,"encounters":109,"attempts":2,"catches":2,"attemptsPerEncounter":0.02},{"ballType":"ultra","dc":5,"lap":1,"encounters":115,"attempts":5,"catches":4,"attemptsPerEncounter":0.04},{"ballType":"ultra","dc":5,"lap":2,"encounters":8,"attempts":1,"catches":1,"attemptsPerEncounter":0.13}]},"shop":{"purchases":{"offer-great":108,"offer-lucky-egg":74,"offer-pickpocket":73,"offer-poke":107,"offer-repel":72,"offer-ultra":101}},"salesByLap":{"1":{"sold":180,"coins":1209},"2":{"sold":89,"coins":580}}}
Sim: 100 games, 3 seats, seed set tune
  Turns per game        38.19
  Average final coins   38.08
  Tie rate              0.04 (4 ties)
  Catching              1740 encounters, 958 attempts, 681 catches, 782 releases
  Shop                  offer-great 108, offer-lucky-egg 74, offer-pickpocket 73, offer-poke 107, offer-repel 72, offer-ultra 101
  Sales by Lap          Lap 1: 180 sold for 1209; Lap 2: 89 sold for 580
  Class in seat         main-character 16/16/17, rival 17/16/16, fisherman 17/17/16, nurse-joy 17/17/17, bug-catcher 17/17/17, researcher 16/17/17
  catchAttempt / encounter by DC and Lap (Poké / Great / Ultra):
    DC 2 Lap 0  n=363   0.44 / 0.09 / 0.02
    DC 2 Lap 1  n=323   0.42 / 0.08 / 0.05
    DC 2 Lap 2  n=16    0.38 / 0.06 / 0.06
    DC 3 Lap 0  n=252   0.42 / 0.08 / 0.02
    DC 3 Lap 1  n=198   0.43 / 0.08 / 0.04
    DC 3 Lap 2  n=15    0.4 / 0 / 0
    DC 4 Lap 0  n=161   0.4 / 0.13 / 0.04
    DC 4 Lap 1  n=166   0.48 / 0.07 / 0.06
    DC 4 Lap 2  n=14    0.36 / 0 / 0.07
    DC 5 Lap 0  n=109   0.44 / 0.06 / 0.02
    DC 5 Lap 1  n=115   0.45 / 0.07 / 0.04
    DC 5 Lap 2  n=8     0.63 / 0 / 0.13
```

### 4 seats

```text
> poke-monopoly@0.0.0 sim
> tsx sim/cli.ts --games 100 --seed 1 --seats 4
{"games":100,"seedSet":"tune","seats":4,"averageTurns":49.92,"averageFinalCoins":36.87,"winners":{"bySeat":[19.5,27,27.5,26],"byClass":{"main-character":20,"rival":16.5,"fisherman":15,"nurse-joy":16,"bug-catcher":18,"researcher":14.5}},"ties":2,"tieRate":0.02,"classInSeat":{"main-character":[16,16,17,17],"rival":[17,16,16,17],"fisherman":[17,17,16,16],"nurse-joy":[17,17,17,16],"bug-catcher":[17,17,17,17],"researcher":[16,17,17,17]},"aborted":0,"illegalAppliedActionCount":0,"invariantFailures":0,"catching":{"encounters":2283,"attempts":1240,"catches":877,"releases":1043,"byBallDcLap":[{"ballType":"poke","dc":2,"lap":0,"encounters":481,"attempts":200,"catches":163,"attemptsPerEncounter":0.42},{"ballType":"poke","dc":2,"lap":1,"encounters":413,"attempts":187,"catches":156,"attemptsPerEncounter":0.45},{"ballType":"poke","dc":2,"lap":2,"encounters":24,"attempts":10,"catches":8,"attemptsPerEncounter":0.42},{"ballType":"poke","dc":3,"lap":0,"encounters":306,"attempts":138,"catches":100,"attemptsPerEncounter":0.45},{"ballType":"poke","dc":3,"lap":1,"encounters":274,"attempts":115,"catches":79,"attemptsPerEncounter":0.42},{"ballType":"poke","dc":3,"lap":2,"encounters":17,"attempts":4,"catches":0,"attemptsPerEncounter":0.24},{"ballType":"poke","dc":4,"lap":0,"encounters":242,"attempts":106,"catches":61,"attemptsPerEncounter":0.44},{"ballType":"poke","dc":4,"lap":1,"encounters":220,"attempts":101,"catches":57,"attemptsPerEncounter":0.46},{"ballType":"poke","dc":4,"lap":2,"encounters":6,"attempts":3,"catches":3,"attemptsPerEncounter":0.5},{"ballType":"poke","dc":5,"lap":0,"encounters":153,"attempts":59,"catches":23,"attemptsPerEncounter":0.39},{"ballType":"poke","dc":5,"lap":1,"encounters":137,"attempts":54,"catches":18,"attemptsPerEncounter":0.39},{"ballType":"poke","dc":5,"lap":2,"encounters":10,"attempts":5,"catches":0,"attemptsPerEncounter":0.5},{"ballType":"great","dc":2,"lap":0,"encounters":481,"attempts":57,"catches":57,"attemptsPerEncounter":0.12},{"ballType":"great","dc":2,"lap":1,"encounters":413,"attempts":22,"catches":22,"attemptsPerEncounter":0.05},{"ballType":"great","dc":2,"lap":2,"encounters":24,"attempts":1,"catches":1,"attemptsPerEncounter":0.04},{"ballType":"great","dc":3,"lap":0,"encounters":306,"attempts":23,"catches":21,"attemptsPerEncounter":0.08},{"ballType":"great","dc":3,"lap":1,"encounters":274,"attempts":17,"catches":14,"attemptsPerEncounter":0.06},{"ballType":"great","dc":3,"lap":2,"encounters":17,"attempts":0,"catches":0,"attemptsPerEncounter":0},{"ballType":"great","dc":4,"lap":0,"encounters":242,"attempts":21,"catches":9,"attemptsPerEncounter":0.09},{"ballType":"great","dc":4,"lap":1,"encounters":220,"attempts":6,"catches":4,"attemptsPerEncounter":0.03},{"ballType":"great","dc":4,"lap":2,"encounters":6,"attempts":0,"catches":0,"attemptsPerEncounter":0},{"ballType":"great","dc":5,"lap":0,"encounters":153,"attempts":12,"catches":3,"attemptsPerEncounter":0.08},{"ballType":"great","dc":5,"lap":1,"encounters":137,"attempts":13,"catches":4,"attemptsPerEncounter":0.09},{"ballType":"great","dc":5,"lap":2,"encounters":10,"attempts":0,"catches":0,"attemptsPerEncounter":0},{"ballType":"ultra","dc":2,"lap":0,"encounters":481,"attempts":12,"catches":12,"attemptsPerEncounter":0.02},{"ballType":"ultra","dc":2,"lap":1,"encounters":413,"attempts":20,"catches":20,"attemptsPerEncounter":0.05},{"ballType":"ultra","dc":2,"lap":2,"encounters":24,"attempts":1,"catches":1,"attemptsPerEncounter":0.04},{"ballType":"ultra","dc":3,"lap":0,"encounters":306,"attempts":4,"catches":4,"attemptsPerEncounter":0.01},{"ballType":"ultra","dc":3,"lap":1,"encounters":274,"attempts":15,"catches":15,"attemptsPerEncounter":0.05},{"ballType":"ultra","dc":3,"lap":2,"encounters":17,"attempts":3,"catches":3,"attemptsPerEncounter":0.18},{"ballType":"ultra","dc":4,"lap":0,"encounters":242,"attempts":13,"catches":9,"attemptsPerEncounter":0.05},{"ballType":"ultra","dc":4,"lap":1,"encounters":220,"attempts":7,"catches":5,"attemptsPerEncounter":0.03},{"ballType":"ultra","dc":4,"lap":2,"encounters":6,"attempts":0,"catches":0,"attemptsPerEncounter":0},{"ballType":"ultra","dc":5,"lap":0,"encounters":153,"attempts":2,"catches":1,"attemptsPerEncounter":0.01},{"ballType":"ultra","dc":5,"lap":1,"encounters":137,"attempts":8,"catches":3,"attemptsPerEncounter":0.06},{"ballType":"ultra","dc":5,"lap":2,"encounters":10,"attempts":1,"catches":1,"attemptsPerEncounter":0.1}]},"shop":{"purchases":{"offer-great":136,"offer-lucky-egg":94,"offer-pickpocket":99,"offer-poke":153,"offer-repel":92,"offer-ultra":151}},"salesByLap":{"1":{"sold":251,"coins":1709},"2":{"sold":87,"coins":632}}}
Sim: 100 games, 4 seats, seed set tune
  Turns per game        49.92
  Average final coins   36.87
  Tie rate              0.02 (2 ties)
  Catching              2283 encounters, 1240 attempts, 877 catches, 1043 releases
  Shop                  offer-great 136, offer-lucky-egg 94, offer-pickpocket 99, offer-poke 153, offer-repel 92, offer-ultra 151
  Sales by Lap          Lap 1: 251 sold for 1709; Lap 2: 87 sold for 632
  Class in seat         main-character 16/16/17/17, rival 17/16/16/17, fisherman 17/17/16/16, nurse-joy 17/17/17/16, bug-catcher 17/17/17/17, researcher 16/17/17/17
  catchAttempt / encounter by DC and Lap (Poké / Great / Ultra):
    DC 2 Lap 0  n=481   0.42 / 0.12 / 0.02
    DC 2 Lap 1  n=413   0.45 / 0.05 / 0.05
    DC 2 Lap 2  n=24    0.42 / 0.04 / 0.04
    DC 3 Lap 0  n=306   0.45 / 0.08 / 0.01
    DC 3 Lap 1  n=274   0.42 / 0.06 / 0.05
    DC 3 Lap 2  n=17    0.24 / 0 / 0.18
    DC 4 Lap 0  n=242   0.44 / 0.09 / 0.05
    DC 4 Lap 1  n=220   0.46 / 0.03 / 0.03
    DC 4 Lap 2  n=6     0.5 / 0 / 0
    DC 5 Lap 0  n=153   0.39 / 0.08 / 0.01
    DC 5 Lap 1  n=137   0.39 / 0.09 / 0.06
    DC 5 Lap 2  n=10    0.5 / 0 / 0.1
```

## Criterion 2: real latency and cost figures in hand

**Yes.** [`docs/jev-spike-report.md`](jev-spike-report.md) (issue #5, pull request #113) records three runs of 100 live server-side SDK calls to `jev-1.13.0` from a Bangkok home network:

- **Latency:** the required 26 Oct pair (200 calls) had p50 281 ms and p95 364 ms. Every run's p95 was under 400 ms, inside the §5.6 deadlines of 1,000 ms per request and 1,500 ms per decision.
- **Tokens:** about 3,242 mean input tokens per request, not the 2,500 that §9 assumed.
- **Cost:** about $0.019 (THB 0.63) per Standard 4-seat game; 1,000 games cost about THB 629, under the THB 1,500 cap (§1).
- **Errors:** 299 of 300 calls succeeded; the one failure was a timeout at the 1,000 ms deadline, which §5.6 handles by falling back. No 429 or 5xx.

The raw run files are in `eval/jev/results/`.

## Criterion 3: working hours confirmed

**Yes.** [`docs/PLAN.md`](PLAN.md) (issue #10, pull request #92) records working hours as confirmed at **12 hours per person per week** (about 24 hours per person and 72 hours for the team per cycle). That answers the open question in spec §10 ("per person or for the whole team"): the hours are per person, so the spec's branch "pull stretch items in after G2" applies.

The calendar half of #10 is not finished: the course deadline, other exam weeks and no-development weeks are still `unknown` in the `PLAN.md` course calendar (owner AokDesu, due 18 Oct). This does not block the hours criterion, but it is listed as an open item.

## Open C1 items

From the GitHub milestone "C1 · M1 Spec + engine skeleton + Jev spike" on 2026-10-27: 4 issues open, 22 closed. #27 is this check.

| Item | Owner | State | Next step |
| --- | --- | --- | --- |
| #7 Tell the advisor that AI dialogue changed to a line bank | Mrmo0p | The notice is written ([`advisor-notice.md`](advisor-notice.md)) but not yet sent. | A person sends it to the advisor. |
| #12 Jev spike: classify 20 Thai chat messages | Mrmo0p | The Thai trial script and its 20 messages merged in pull request #111 (`eval/jev/thai-trial.ts`, `eval/jev/thai-trial.json`). The live run is pending. | The key holder runs `npx tsx eval/jev/thai-trial.ts` with the key in `.env` and records the results. |
| #19 Replay and state inspector page | AokDesu | Not started. It is a cut-list issue: spec §10 C1 says to keep going with the CLI sim before building UI. | Pulled in only if a cycle runs ahead of plan. |
| Course calendar in `PLAN.md` (from #10) | AokDesu | Course deadline, exam weeks and no-development weeks are `unknown`. | Fill in the dates and apply the `PLAN.md` rule for moving cut-list items. |

## Spilled into C2

- **#7 and #12** carry into C2 on stream B. #12's live run matters for C2 and later: its result feeds the C4 decision on whether Thai free text works or chat stays button-only (spec §10 C4).
- **The course calendar** carries into C2. Until the dates are known, the cut list in `PLAN.md` cannot be checked against them.
- **The §5.6 and §9 notes from the spike report** apply to C2 work (issue #48 kill switch, usage log and spend guard): fall back at once on a timeout, check each response's `model` field instead of `models.list()`, and budget about 3,240 input tokens per request.

## Moved to the cut list

- **#19** (replay and state inspector page) moves to the cut list. It was planned as cut-list work from the start; nothing else moved in C1.
- Property-based tests were not cut. They landed on 2026-10-21, three days after C1's end date (`sim/legal-games.property.test.ts`, `sim/replay.property.test.ts`).
