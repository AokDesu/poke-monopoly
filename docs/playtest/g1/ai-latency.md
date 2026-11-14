# G1 AI decision time (issue #52)

Spec: v1.0 §1, §8, §9.

## Answer

**Yes: p95 1,055 ms <= 2 s.** The spec §1 target for AI decision time per turn is a p95 of 2 s or less.

## Sample: one team-played game, not a participant session

These figures come from **one Quick game played by the team with live Jev**: 7 AI turns, which is a small sample. It is not a participant session. Sessions G1-B01 and G1-B02 ran with Jev off, before #131 merged (#131 wired live Jev into `POST /api/ai/decide`), so they produced no Jev timings. Treat the p95 as an early indication, not a measured gate result over many games.

## Results

| Measure | Value |
|---|---|
| Requests | 9 (9 ok, 0 failed) |
| AI decision time per turn, p50 | 329 ms |
| AI decision time per turn, p95 | 1,055 ms (over 7 turns) |
| Fallback rate | 2 of 11 decisions (18%) |
| Fallback cause | `missing_facts`: 2 of 2 |
| Input tokens per game | 15,778 |
| Output tokens per game | 318 |
| Spend per game | THB 0.0219 (USD 0.0007) |

Decision log: 11 decisions, 9 used a Jev answer, 2 used the fallback. Both fallbacks were at the `sell` decision point with cause `missing_facts`. Tokens and spend are for the one game.

## Source

- `npm run usage`, run against the build's `logs/jev-usage.jsonl` (requests, tokens, spend, decision time per turn).
- `logs/jev-decisions.jsonl` (decisions and fallback causes).

The logs are not committed. They hold game state identifiers and stay on the machine that ran the game.

## Scope of the figures

The p50, p95, tokens and cost cover **Strategy and Encounter questions only**: the 9 requests are 2 Strategy and 7 Encounter. No Sell Phase question reached Jev in this game. Both Sell Phases fell back with `missing_facts` because the web client sends no sale facts. The figures therefore exclude Sell questions (up to 3 per AI turn, §9) and should be re-measured once that is fixed (issue #150).

The 4 Shop decisions have no decision-log row (same issue). That is why the exported game log shows 15 AI decisions against 11 rows in the decision log.
