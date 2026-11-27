# docs/

- `SPEC-v1.0-PokeMonopoly.md`: the final specification. A rule change updates it in the same pull request as the code and tests.
- `PLAN.md`: confirmed working hours, stream owners, cycle dates and gates, and the course calendar (spec §10).
- `team-setup.md`: the team's tool and agent-skill guide.
- `sim.md`: the simulation seed sets (`--seed-set tune|eval`) and the summary metrics (spec §8, Appendix A).
- `jev-spike-report.md`: live Jev latency, token and cost measurements (spec §5.1, §5.6, §9).
- `c1-exit-report.md`: the cycle 1 exit check, with evidence for each exit criterion and the open C1 items (spec §10 C1).
- `c4-300-game-report.md`: 300 policy-only games at 2, 3 and 4 seats, seat and class balanced, with `illegalAppliedActionCount` and the run plan (spec §8, §10 C4).
- `c4-300-game-rerun-report.md`: the same 300 policy-only games rerun on current main with Events, Sell keep-value and all 26 §8 invariants active, plus a Social-on set with deals required (spec §8, §10 C4).
- `c4-300-game-rerun-2-report.md`: the second rerun of both 300-game sets, with Deal Card counts and hidden-information test results on the updated main base (spec §8, §10 C4).
- [C5 policy-only results](experiments/c5-policy-results.md) cover seven exploit policies across 1,008 held-out games, with paired effects, uncertainty, tie rates and n (spec §8, §10 C5).
- `advisor-notice.md`: the notice telling the advisor that AI dialogue changed to a line bank (spec §0, §12).
- `playtest/`: the playtest protocol (`PROTOCOL.md`) and the empty session-sheet template (`session-sheet.csv`); filled sheets go in a copy under this folder (spec §8, §9, §10 C2).
- `playtest/p5/`: the cycle 5 Human-layer round (`P5`): its filled sheets, one per facilitator, and its build record (spec §8, §9, §10 C5). `playtest/g1/` holds the gate G1 sheets.
- `report/`: the outline of the final course report: one section per spec §1 success criterion and §8 layer, who writes each part, the committed file each figure comes from, and what is still open. Policy-only and Jev results are kept in separate sections (spec §1, §8, §9, §10 C6, §11).

Prettier skips this folder to preserve document formatting.
