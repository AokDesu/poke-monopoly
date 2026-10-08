# Engine contract v1

Issue #3 supplies compile-ready contracts and self-contained decision fixtures for streams B/C. Import types, Zod schemas, `positionOf`, `applyAction`, `legalActions` and `observe` from `engine/index.ts`. Spec: v1.0 §3.1, §4.2, §6.1, §6.3, §6.4, §6.5, §6.6, §8; observations also follow §5.4.

## Records and counters

| Field | Meaning |
| --- | --- |
| `seatIndex` | Fixed, zero-based seat in turn order; distinct from actor identity and turn counters. |
| `globalTurnNo` | Number of turns started across all seats. |
| `Player.ownTurnNo` | Number of turns started for that player only. |
| `Player.routeProgress` | Signed whole number of squares travelled; `positionOf(p)` is `((p % 24) + 24) % 24`. |
| `Player.creditedLap` | Monotonic number of Start crossings already paid; it never decreases when movement goes backwards. |
| `GameState.stateRevision` | Number of accepted actions so far, initially 0. |
| `Action.actionSeq` | Starts at 1 and advances by exactly 1 for **every accepted action**, including engine-generated dice results, shuffles and event draws. |
| `Action.stateRevisionBefore` | Revision the actor saw; any value different from the current revision is stale. |

**Approved clarification (2026-10-07):** accepted actions, rather than turns or only player commands, determine both sequence and revision. The next accepted record has `actionSeq = stateRevisionBefore + 1`; the resulting revision equals its sequence. Rejection advances neither counter and changes no state. `actorId` is the configured player ID, or the reserved ID `engine` for generated records; `kind` discriminates `payload`. Do not configure a player with actor ID `engine`.

`GameConfig` records seats, seed, Lap target and engine/content/RNG versions. `GameState` embeds configuration and minimal content, players, active seat, phase, current budgets, optional Final Table Round target, private RNG cursor/state and private Event draw/discard piles. It contains **no nested log**. A fixture's separate `log` contains `{ action, events }` records. `EngineEvent` covers random results, sourced coin transfers (bank or player endpoints), UID creation/destruction, resolved spaces and phase changes. Pokémon and utility items each have `instanceId`; Balls use counted `poke`, `great`, `ultra` pouch entries. Pokémon record starter origin, evolution stage, tired status and ability readiness; items record public/secret visibility. Final Table Round records the triggering seat and target own-turn count, without implementing settlement.

## Public seam and visibility

- `applyAction(state, action): ApplyActionResult` is a stub: always `{ rejected: true, reason: 'not_implemented' }`, without mutation. The eventual success branch is `{ accepted: true, state, events }`; sequence/stale validation and rule execution remain future work.
- `legalActions(state, seatIndex): LegalActions` returns stable-ID `{ id, kind, payload }` choices and disabled choices with `reasonCode`/English `reasonText`. This scaffold lists fixture-facing Move, Strategy, Encounter, Sell and Shop choices only. Target selection, budgets, cooldowns, full-hand checks, combat, Gym, Abilities and social/deal/promise/chat execution remain deferred. Other phases return empty lists; out-of-turn seats receive only a disabled skip. IDs describe the same choice across repeated calls; records must still carry the current revision when submitted.
- `observe(state, seatIndex): Observation` explicitly projects public board, players' coins/positions/teams, utility-item counts, known starting-kit items, Lap and ability readiness, phase and counters; `own` contains only that seat's utility items, Ball pouch and peek results. Opponent secrets, RNG state and Event order never appear. Returned observations are detached copies. Unknown seats throw `RangeError` in both read seams. Streams B/C should consume observations, not snapshots/logs; Jev's named buckets remain stream B's responsibility (§5.4).

**Approved Shop clarification (2026-10-08):** `shop-low-coins` retains 1 coin: Poké Ball is enabled at price 1, Great/Ultra Balls are disabled with `NOT_ENOUGH_COINS`. Added `shop-no-coins` uses 0 coins, disables all purchases and enables skip, demonstrating the all-unaffordable §3.1 row. Appendix A prices are unchanged.

## Content and fixtures

`Content` is the structural TypeScript contract inferred from exported `contentSchema`: `board` has 24 `{ position, kind, name }` spaces; `species` has `{ id, name, rarity, dc, battle, base, tags }`; `classes` has `{ id, name, starterSpeciesIds, classItemId }`; `items` has `{ id, name, kind, price }` and Ball definitions also carry `ballType`. IDs join definitions to instances. This is the minimum fixture-facing interface, not a full effect/content catalogue; the content stream can provide additional data separately as later engine issues need it.

Each `engine/fixtures/*.json` contains `name`, full `state` (including fixture content), expected `legalActions` and `observation` maps keyed by seat index, plus a separate `log`. All include seat 0 and seat 1 projections. `fixtureSchema` validates their shapes; tests compare every expected projection/choice with the public functions. These are hand-authored snapshots, not an engine-generated replay or proof of implemented gameplay. `log-short` illustrates six contiguous accepted records; later replay code will enforce transitions and invariants.
