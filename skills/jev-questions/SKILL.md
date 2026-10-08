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
- **Keep value types apart:** cash, expected sale value, benefit of keeping the team, risk and promises are separate buckets. They are never merged into one coin figure, and badges are never counted as coins.
- **Wording:** questions and criteria are written **in English**, literally, with boundary cases spelled out in the criteria.
- **One question = one decision.** Multi-item work is split into one question per item and combined in code.
- **Size:** state ≤ ~4k tokens per request.
  - At most the last 3 relevant chat messages, as quoted data with the speaker's name.
  - Memory is included as event evidence, e.g. "broke no_attack on turn 5".
