---
name: jev-questions
description: 'Rules for writing Jev state and questions: role-scoped state, named buckets, English criteria, one question per decision, size limits. Read before touching ai/ or any state builder or question text.'
---

# Jev questions

Source: spec §5.4 (`docs/SPEC-v1.0-PokeMonopoly.md`). Decision points and their question types are in §5.3; the division of labour between engine and Jev is in §5.2.

- **Role-scoped:** send only what that seat can really see.
  - Public: board, coins, teams, Lap, ability readiness.
  - Own: hand, Balls, peek results, interactions.
  - Never: Event order, opponents' secret items or RNG state.
- **Numbers become named buckets**, e.g. `"win_chance": "low"` or `"coins_vs_you": "far ahead"`. Never send numbers for Jev to compare.
  - The state builder is `ai/state/buildJevState` (exported from `ai/state/index.ts`); its input is only the engine's `Observation` from `observe()`.
  - Numeric derivations live in `engine/observation-buckets.ts`, with thresholds in its single `STATE_BUCKET_CONFIG` object. These are presentation thresholds, not gameplay rules.
  - `coins_vs_you`: opponent minus own coins is **far ahead** at +10 or more, **ahead** from +1 to +9, **level** at 0, **behind** from −1 to −9, and **far behind** at −10 or less.
  - `squares_to_start`: **near** at 0–6 squares, **middle** at 7–12, **far** at 13 or more. At Start the distance is 0; otherwise it is the forward distance on the observed board.
  - `team_count`, `item_count` and own Ball counts (`poke`, `great`, `ultra`): **none** at 0, **one** at 1, **few** at 2–3, **many** at 4 or more.
  - `coins_rank` is an ordinal label such as **2nd of 4**; tied cash totals share the same rank, and badges do not contribute. `lap` is the current Lap label (credited crossings + 1), capped at the target, such as **2 of 3**.
  - Raw numbers are allowed only at explicit seat/board identifier paths. The builder runs `assertNoComparableNumbers` and the JSON characters ÷ 4 size guard before returning; rank and Lap labels are descriptive strings, not numeric values.
- **Keep value types apart:** cash, expected sale value, benefit of keeping the team, risk and promises are separate buckets. They are never merged into one coin figure, and badges are never counted as coins.
- **Wording:** questions and criteria are written **in English**, literally, with boundary cases spelled out in the criteria.
- **One question = one decision.** Multi-item work is split into one question per item and combined in code.
- **Size:** state ≤ ~4k tokens per request.
  - At most the last 3 relevant chat messages, as quoted data with the speaker's name.
  - Memory is included as event evidence, e.g. "broke no_attack on turn 5".
