---
name: jev-questions
description: 'Rules for writing Jev state and questions: role-scoped state, named buckets, English criteria, one question per decision, size limits. Read before touching ai/ or any state builder or question text.'
---

# Jev questions

Source: spec §5.4 (`docs/SPEC-v1.0-PokeMonopoly.md`). Decision points and their question types are in §5.3; the division of labour between engine and Jev is in §5.2.

- **Role-scoped:** send only what that seat can really see.
  - Public: board, coins, teams, Lap, ability readiness.
  - Own: hand, Balls, peek results, interactions.
  - Never: Event order, opponents' secret items or RNG state. Opponents' Ball counts are not exposed directly in observations but can be inferred from public play (§4.1).
- **Numbers become named buckets**, e.g. `"win_chance": "low"` or `"coins_vs_you": "far ahead"`. Never send numbers for Jev to compare.
  - The state builder is `ai/state/buildJevState` (exported from `ai/state/index.ts`); its input is only the engine's `Observation` from `observe()`.
  - Numeric derivations live in `engine/observation-buckets.ts`, with thresholds in its single `STATE_BUCKET_CONFIG` object. These are presentation thresholds, not gameplay rules.
  - `coins_vs_you`: opponent minus own coins is **far ahead** at +10 or more, **ahead** from +1 to +9, **level** at 0, **behind** from −1 to −9, and **far behind** at −10 or less.
  - `squares_to_start`: **near** at 0–6 squares, **middle** at 7–12, **far** at 13 or more. It is the forward distance on the observed board to the next pass of Start, so a player standing on Start is the full board length away (**far**).
  - `team_count`, `item_count` and own Ball counts (`poke`, `great`, `ultra`): **none** at 0, **one** at 1, **few** at 2–3, **many** at 4 or more.
  - `coins_rank` is an ordinal label such as **2nd of 4**; tied cash totals share the same rank, and badges do not contribute. `lap` is the current Lap label (credited crossings + 1), capped at the target, such as **2 of 3**.
  - Raw numbers are allowed only at explicit seat/board identifier paths, and numeric-looking strings only at explicit opaque engine-ID paths (actor, class, Pokémon, species, item and event IDs). The builder runs `assertNoComparableNumbers` and the JSON characters ÷ 4 size guard before returning; rank and Lap labels are descriptive strings, not numeric values.
- **Question builders** live in `ai/questions/` (exported from `ai/questions/index.ts`): `buildStrategyQuestion` and `buildEncounterQuestion` return `skip` (no enabled action), `autoApply` (exactly one, spec §3.1) or a question with `options` mapping each criteria label to its engine action ID (`actionIdFor`). The state is `buildJevState` plus `you.personality`, checked by the same guards.
  - Strategy labels are `a1`, `a2`, … in the engine's order, plus `skip`. The shortlist holds at most 12 actions with `skip`; an action kind is the engine `kind`, with item uses split by item (`use_item:repel`). The personality drops actions whose weighted traits are negative, but every kind keeps its best-ranked action (liked first, then the richer target).
  - Encounter labels are `poke_ball`, `great_ball`, `ultra_ball` and `release`. Catch chance comes from the engine's `successFaces` (`oddsForAllBalls`): **very low** at 0–1 of 6 faces, **low** at 2, **even** at 3, **high** at 4, **very high** at 5–6. The Balls of that type held now, counting the one thrown, are **none**, **one**, **a few** (2–3) or **many** (4 or more).
  - Sell Phase: `buildSellQuestions` asks one Noul per offered Pokémon, named `sell_team_<i>` after its position in `you.team`, with its buckets in `sell_phase.offers` under the same name. Its `SellFacts` are engine numbers per Pokémon: sale price now (tired adjustment, no class bonus), class bonus when sold alone and when every offered Pokémon is sold, and keep value. Sale value now and keep value are separate buckets, **low** at 0–5 coins, **medium** at 6–12 and **high** at 13 or more; `class_bonus` is **yes**, **no** or "only if you do not also sell a Pokémon that takes it instead". `laps_remaining` uses the count words, and `last_sell_phase` is true once the Final Table Round is announced. Rescue Starters are never offered. Up to 12 questions share a request; more split into requests of 12 within the requests left this turn (3 per AI turn), and the rest are returned as `fallbackIds`. `sellAnswers` maps a request's answers to instance IDs, and `decideSales` sells each Noul at or above the personality's `sellThreshold`; it never reads a confidence.
  - Criteria name the effect (item effect text and names come from `content/`) and every unknown, such as the target's roll. Price Shield is not mentioned while the engine defers it (spec §4.6). Snapshots in `ai/questions/__snapshots__/` record the exact text, so wording changes show up in review.
- **Keep value types apart:** cash, expected sale value, benefit of keeping the team, risk and promises are separate buckets. They are never merged into one coin figure, and badges are never counted as coins.
- **Wording:** questions and criteria are written **in English**, literally, with boundary cases spelled out in the criteria.
- **One question = one decision.** Multi-item work is split into one question per item and combined in code.
- **Size:** state ≤ ~4k tokens per request.
  - At most the last 3 relevant chat messages, as quoted data with the speaker's name.
  - Memory is included as event evidence, e.g. "broke no_attack on turn 5".
