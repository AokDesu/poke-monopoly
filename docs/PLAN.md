# Plan

The plan record for Poke Monopoly: capacity, owners, cycle dates and gates, and the course calendar. The source of truth for scope is `SPEC-v1.0-PokeMonopoly.md` §10; cycle dates and gates below are copied from it. This file does not change the spec or re-plan cycles.

## Capacity (confirmed)

Working hours are confirmed as **12 hours per person per week**: about **24 hours per person per cycle** and **72 hours for the team** per cycle.

Spec §10 sized the plan for 144 h across the whole team and said that if the hours are per person, stretch items are pulled in after G2. They are per person, so that branch applies. The spec's own blank fields are left as they are.

## Dates

Start Monday 2026-10-05, finish 2026-12-27 (spec §10).

## Stream owners

|Stream|Work|Owner|
|---|---|---|
|A|Engine and sim|punkharb|
|B|Jev and eval|Mrmo0p|
|C|Web UI and playtest|AokDesu|

## Cycles and gates

|Cycle|Dates|Milestone|Gate|
|---|---|---|---|
|C1|5–18 Oct|M1 "Spec + engine skeleton + Jev spike"|Exit: 100 sim games with no invariant failures; real latency and cost figures in hand; working hours confirmed.|
|C2|19 Oct–1 Nov|M2 "Playable vertical slice with Jev"|Gate G1 (1 Nov): 3–5 players (team and friends) find real keep-or-sell hesitation, and AI decision time p95 is ≤2 s. If it fails, spend C3 fixing the core loop and push content back.|
|C3|2–15 Nov|M3 "Full rules alpha"|Exit: every §8 invariant passes; games finish with 1, 2 and 3 AIs; tests exist for deal atomicity and on-time promise closure.|
|C4|16–29 Nov|M4 "Content-complete beta + personalities"|Exit: leaks = 0; `illegalAppliedActionCount = 0` across 300 sim games; baseline eval results pinned to `jev-1.13.0`; a decision on whether Thai free text works or chat stays button-only.|
|C5|30 Nov–13 Dec|M5 "Evidence"|Gate G2 (6 Dec): duel Hard against Normal on paired seeds. If Hard is better with evidence and within the latency budget, keep 3 levels; otherwise ship 2 levels and report it plainly. Exit: complete §8 result tables with n; playtest issues prioritised.|
|C6|14–27 Dec|M6 "Release + demo"|Code freeze on 20 Dec. Exit: the §11 demo runs end-to-end from a clean install; the report separates policy-only results from Jev results.|

Per-cycle deliverables and the "cut if late" line for each cycle are in spec §10.

## Cut list

Order when time runs short (spec §10):

1. Database and public hosting.
2. Stretch classes.
3. Monte Carlo/Hard.
4. Animation and decorative graphs.
5. Free-text chat.
6. Content beyond the core tier.

Never cut playing to completion, the fallback, the hard gates, or the core conversation features (topic buttons + Deals + Promises).

## Course calendar

|Item|Date|Status|Owner to find out|
|---|---|---|---|
|Course deadline|2026-12-15|known: submission due 15 Dec 2026 (source: repository owner, AokDesu, 2026-11-15)|n/a|
|Midterm exam|2026-10-15|past|n/a|
|Other exam weeks|unknown|unknown, ask by 18 Oct|AokDesu|
|No-development weeks|unknown|unknown, ask by 18 Oct|AokDesu|

2026-11-15: course deadline 2026-12-15 → cut-list item 4 (animation and decorative graphs); item 6, only its line-bank part (line bank beyond the core tier); and the stream C cut-list items Thai wording pass and Thai names, which are not on the numbered list above.

Why: the owner's schedule for the date is code frozen about 9 Dec, report and demo assembled 10–14 Dec, due 15 Dec. C5 (30 Nov–13 Dec) then has to hold the evidence, the report and the demo, so work that only decorates or widens the content no longer fits before the date. The other cut-list items do not move: the owner chose only the stream C cut-list (Thai wording pass, Thai names, line bank beyond the core tier, decorative graphs, animation). This record does not re-plan the cycle rows above: C6 (14–27 Dec) and its 20 Dec code freeze fall after the due date, and revising spec §10 is a separate change.

## Rule: when dates become known

When a date in the calendar table becomes known, in the same pull request:

1. Update the table: the date, the status, and the source of the date.
2. Compare the date with the cycle dates and gates above, and list which cut-list items move and why. A cut-list item moves if keeping its scope no longer fits the cycles before the date.
3. Record the list under the table as `YYYY-MM-DD: <date learned> → <cut-list items moved, or "none">`.
