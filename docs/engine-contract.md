# Engine contract v1

Issues #3, #11, #20, #21, #22, #23, #24, #25, #29, #30, #31, #32, #33, #34, #35 and #37 supply compile-ready contracts, deterministic command execution, setup/turn flow, movement, Wild encounters, catching and catch odds, atomic selling, the Shop, utility items, game end, class bonuses (Researcher, Main Character, Fisherman, Bug Catcher), C2 presets, placeholder Event/Gym spaces, role-scoped observation and event visibility, and self-contained decision fixtures for streams B/C, plus save, resume and replay verification. Import types, Zod schemas, `positionOf`, `createGame`, `catchOdds`, `oddsForAllBalls`, `applyAction`, `legalActions`, `observe`, `eventsVisibleTo`, `actionVisibleTo`, `advanceAutomatically`, `replay`, `serialize`, `deserialize`, `resume`, `verifyReplay`, `GAME_PRESETS`, `LAP_TARGETS` and `winner` from `engine/index.ts`. Spec: v1.0 §1, §3, §3.1, §4.1, §4.2, §4.3, §4.5, §4.6, §4.7, §6.1, §6.3, §6.4, §6.5, §6.6, §6.7, §6.8, §6.9, §8, §10 C2, Appendix A; observations also follow §5.4.

## Records and counters

| Field | Meaning |
| --- | --- |
| `seatIndex` | Fixed, zero-based seat in turn order; distinct from actor identity and turn counters. |
| `globalTurnNo` | Number of turns started across all seats. |
| `Player.ownTurnNo` | Number of turns started for that player only. |
| `Player.routeProgress` | Signed whole number of squares travelled; `positionOf(p)` is `((p % 24) + 24) % 24`. |
| `Player.creditedLap` | Monotonic count of paid owner Start crossings; increments by 1 per payment and determines the Lap target. |
| `Player.highestRewardedMilestone` | Highest route milestone already paid, initially 0. Unlike the paid count, it can skip indices after forced forward movement. Optional only for historical contract snapshots; new games always include it. |
| `GameState.stateRevision` | Number of accepted actions so far, initially 0. |
| `Action.actionSeq` | Starts at 1 and advances by exactly 1 for **every accepted action**, including engine-generated dice results, shuffles and event draws. |
| `Action.stateRevisionBefore` | Revision the actor saw; any value different from the current revision is stale. |

**Approved clarification (2026-10-07):** accepted actions, rather than turns or only player commands, determine both sequence and revision. The next accepted record has `actionSeq = stateRevisionBefore + 1`; the resulting revision equals its sequence. Rejection advances neither counter and changes no state. `actorId` is the configured player ID, or the reserved ID `engine` for generated records; `kind` discriminates `payload`. Do not configure a player with actor ID `engine`.

`GameConfig` records seats, seed, Lap target and engine/content/RNG versions. A seat may also specify `starterSpeciesId` to choose among its class's Starter alternatives. `GameState` embeds configuration and minimal content, players, active seat, phase, current budgets, optional Final Table Round target, private RNG cursor/state and private Event draw/discard piles. It contains **no nested log**. A fixture's separate `log` contains `{ action, events }` records. `EngineEvent` covers random results, sourced coin transfers (bank or player endpoints), UID creation/destruction, resolved spaces, phase changes and the Final Table Round announcement. Pokémon and utility items each have `instanceId`; Balls use counted `poke`, `great`, `ultra` pouch entries. Pokémon record starter origin, evolution stage, tired status and ability readiness. New Rescue Starters also carry `tradeable: false`; historical instances may omit that field; items record public/secret visibility. Final Table Round records the triggering seat and target own-turn count; game end is described below.

## Public seam and visibility

Issue #11 adds pure RNG and version/header contracts (spec §4.6, §6.8, §8):

- `createRng(seed)` accepts a safe integer or nonempty string and returns `{ state, cursor: 0 }`. The current `RNG_VERSION` is exported from [engine/rng.ts](../engine/rng.ts); numeric seeds wrap to uint32 and string seeds use FNV-1a over UTF-16 code units. State is a canonical decimal uint32 string; helpers accept a safe nonnegative cursor below `Number.MAX_SAFE_INTEGER`. A final draw may return that maximum cursor, but it cannot be used as helper input again. Sequence/seed mapping/helper changes require a new version.
- `d6(rng, purpose?)`, `int(rng, n, purpose?)`, `weightedPick(rng, entries, purpose?)` and `shuffle(rng, input, purpose?)` return `{ value, rng, events }` without mutating input. Retain the returned `rng` for the next draw or snapshot; serializing it resumes the same sequence. `int` is zero-based with integer bounds 1 through 2^32. Weighted entries are `{ value, weight }`; weights must be finite, nonnegative and have a positive finite total.
- Every consumed draw returns `{ kind: 'random_result', purpose, result, drawCounter }`. Counters start at 1 and equal the resulting cursor. Dice/integers record their value; weighted picks record the selected entry index; Fisher-Yates shuffle records each swap's selected index in descending position order. Empty/singleton shuffles consume no draws. Invalid inputs throw `RangeError` without changing state. The historical issue #3 event schema allows omitted `drawCounter` for its unchanged illustrative fixtures; the new `RandomResultEvent` type always requires it.
- `createGameConfig(input)` stamps `ENGINE_VERSION`, existing `CONTENT_VERSION` and `RNG_VERSION`. `createLogHeader(config)` returns a detached header, preserving the supplied config's versions rather than replacing historical stamps. [engine/contract/schema.ts](../engine/contract/schema.ts) owns the `gameConfigSchema` and `logHeaderSchema` fields and validation, including header seed/version equality with the initial config. These helpers preserve historical stamps; the command-log executor below additionally checks that it supports the stamped engine and RNG versions.

- `applyAction(state, action: unknown): ApplyActionResult` validates untrusted command shape, current revision, next sequence, active configured actor and exact enabled choice (kind **and** payload), or complete Sell-batch validity for current-version sales. Rejection is `{ rejected: true, state, reason }` with the original state reference; reasons are `malformed_action`, `stale_revision`, `invalid_sequence`, `wrong_actor`, or `illegal_action`, checked in that order before player-choice membership. Acceptance is `{ accepted: true, state, events, record }` with a detached snapshot, resulting revision equal to the action sequence, and a separate `{ action, events }` record. The reserved engine identity takes the generated-record path after revision/sequence validation. Callers must retain the returned state and append the returned record to their separate log; no log is nested in state.
- `legalActions(state, seatIndex): LegalActions` returns stable-ID `{ id, kind, payload }` choices and disabled choices with `reasonCode`/English `reasonText`. Current-version games expose roll during first-player selection and Move, and skip during Start, Social, Strategy, Resolve and End. Pending dice results expose no player choice. Current-version Strategy adds `use_item` choices for held Lucky Eggs, Repels and Pickpockets as described below, and targeted Potion choices described in S03 below; historical contract fixtures retain their illustrative untargeted item choices. Current-version Sell exposes valid single-instance `sell` choices and an empty `sell` batch (`id: "finish-sell"`). Any distinct subset of owned instance IDs can be submitted as one atomic batch, without enumerating every subset in the choices. `finish_sell` remains accepted as an empty-batch compatibility alias. Either command finishes Sell and enters Resolve. Historical fixtures retain illustrative Sell choices. Current-version Encounter and Shop execute catching and purchases as described below; historical Encounter and Shop choices remain illustrative. Other budget spending, cooldowns, other full-hand checks, combat, Gym, Abilities and deal/promise execution remain deferred; chat is described in the Social window section below and is off unless `GameConfig.socialWindow` is true. Other phases return empty lists; out-of-turn seats receive only a disabled skip. IDs describe the same choice across repeated calls; records must still carry the current revision when submitted.
- `observe(state, seatIndex): Observation` explicitly projects public board, players' coins/positions/teams, utility-item counts, publicly visible utility items, Lap and ability readiness, phase and counters; `own` contains only that seat's utility items, Ball pouch and peek results. Opponents' Ball counts are not exposed directly (approved §4.1 rule, issue #37), but they can be inferred from public play: the public starting kit, the Ball type in a public catch roll and public Shop purchase prices. Opponent secrets, the seed, RNG cursor/state/version and Event order never appear. Returned observations are detached copies. Unknown seats throw `RangeError` in all four read seams. Streams B/C should consume observations, not snapshots/logs; Jev's named buckets remain stream B's responsibility (§5.4).
- `eventsVisibleTo(before, events, seatIndex): EngineEvent[]` returns detached copies of the events of one accepted action that the seat may see, in order; `before` is the state the action was applied to. The visibility rule hides an item's `uid_created` from everyone but its owner (items created during play are bought and secret), a secret item's `uid_destroyed` from everyone but its owner, `hostile_item_used` from everyone but its user and target, and every `shuffle:` `random_result` from all seats, since the draws reveal deck order. Other events are public. Pass a seat only its filtered events; `applyAction` still returns, and logs record, the full list.
- `actionVisibleTo(before, record, seatIndex): SeatActionRecord` returns a detached, seat-safe copy of one accepted `ActionRecord`; `before` is the state it was applied to. Its events are `eventsVisibleTo`'s, and its payload drops what the seat may not see: another seat's `buy.offerId`, another seat's secret `use_item.itemInstanceId`, a hostile item's `targetSeatIndex` for seats other than the user and target, every seat's `shuffle.order` and `event_draw.eventId`, and all of a `chat` payload for seats other than its sender and recipient. A dropped field is absent, not blanked.

**Raw records and logs never go to a seat (issue #37, captain 2026-10-17).** `applyAction`'s `record`, `advanceAutomatically`'s `records` and the command log are full-information engine data for replay and audit. Never send them, or any part of them, to a seat, `ai/` or a seat's UI. Consumers use `observe`, `legalActions`, `eventsVisibleTo` and `actionVisibleTo` only.

**Hidden-information tests (issue #37, spec §1, §4.1, §4.8, §5.4, §8):** [engine/observation.test.ts](../engine/observation.test.ts) plays 25 seeded random games of 2–3 seats whose secret items carry sentinel names and IDs, with a sentinel seed and Event draw pile. Across 500 sampled mid-game states no seat's observation or legal actions, and across every accepted action no seat's filtered events or redacted record, contain another seat's secret, the seed, RNG state/version or deck order; another seat's redacted `buy` has no `offerId`, and `hostile_item_used` reaches only its user and target. Shop offers stay in the public phase: the drawn offers are shown to every seat, so an opponent knows a bought utility item is one of the two offered, but not which.

**Approved Shop clarification (2026-10-08):** `shop-low-coins` retains 1 coin: Poké Ball is enabled at price 1, Great/Ultra Balls are disabled with `NOT_ENOUGH_COINS`. Added `shop-no-coins` uses 0 coins, disables all purchases and enables skip, demonstrating the all-unaffordable §3.1 row. Appendix A prices are unchanged.

## Content and fixtures

`Content` is the structural TypeScript contract inferred from exported `contentSchema` in [engine/contract/schema.ts](../engine/contract/schema.ts), the authoritative source for its fields and validation constraints. IDs join definitions to instances. This is the minimum fixture-facing interface, not a full effect/content catalogue; the content stream can provide additional data separately as later engine issues need it. The fixture validation test in [engine/fixtures.test.ts](../engine/fixtures.test.ts) checks the shipped content against this schema.

Each `engine/fixtures/*.json` contains `name`, full `state` (including fixture content), expected `legalActions` and `observation` maps keyed by seat index, plus a separate `log`. All include seat 0 and seat 1 projections. `fixtureSchema` validates their shapes; tests compare every expected projection/choice with the public functions. These are hand-authored snapshots, not an engine-generated replay or proof of implemented gameplay. `log-short` illustrates six contiguous accepted records; the executable command-log contract below is separate from these illustrative fixtures.

## Setup and turn flow (issue #21)

Spec: §3, §4.1, §4.2, §6.4. `createGame(config, content): GameState` validates and detaches both inputs, then constructs a revision-zero state before any first-player roll. It requires 2–4 unique actors/classes and fixed seats numbered 0 through n−1; input seat arrays are sorted by their configured indices, without changing seat identities. Engine and RNG stamps must be supported. Class, Starter and class-item references must exist in the supplied minimal contract content. Content must include, for each Wild rarity, at least one species not excluded from Wild draws (see [Wild encounters](#wild-encounters-and-catching-issue-23)); otherwise setup throws `RangeError`. A sole class Starter is selected automatically; alternatives require the seat's explicit `starterSpeciesId`, which must belong to that class.

Every player receives the starting kit, with no setup income, as defined in [spec §4.1](SPEC-v1.0-PokeMonopoly.md#41-setup-and-board), with route progress and credited Lap zero and an original base-form Starter. Ball class items go into the counted Ball pouch; utility class items receive distinct instance IDs and public visibility. Starter instance IDs are also distinct. Before play, all own-turn counters and the global counter are zero, and budgets are zero because no turn has started. The Event deck is empty until the later content/deck work supplies it; creation consumes no RNG.

Create the log immediately with `createGameLog(createGame(config, content))` and retain each subsequent returned record. `first_player_roll` carries the current contenders, completed rolls in that round and `awaitingResult`. Each configured contender, in seat order, accepts `roll`, then an engine `dice_result` with purpose `first-player:<seatIndex>`. No second player roll is enabled while awaiting the result. Once the round finishes, only tied highest rollers remain; their next round starts with no prior rolls. A unique leader starts the first turn. Every die result consumes one seeded draw, logs its counted random event and advances the accepted-action sequence separately from its roll command.

Starting a turn enters Start, increments `globalTurnNo` and only the active player's `ownTurnNo`, and **replaces** all three budgets with 1 (plus `socialInteraction` when the [Social window](#social-window-and-chat-messages-issue-56-s01) is on). The issue #21 skeleton was Start → Social → Strategy → Move → Resolve → End; #22 adds movement and optional Sell as described below. The social window (unless `GameConfig.socialWindow` is on) and Strategy pass through via the sole skip choice. Start/Resolve/End also use skip to drive the skeleton. Move accepts roll and waits for the engine result with purpose `move:<seatIndex>:<globalTurnNo>`. Every phase change emits `phase_changed`. Issue #21 did not implement movement or Start crossing; these are implemented by #22 below. The Researcher and Main Character passives ([#30](#class-framework-and-the-researcher-issue-30), [#35](#main-character-issue-35)) and the Fisherman/Bug Catcher hooks (issue #55 S01), plus utility items ([#31](#utility-items-issue-31)), are described below; Nurse Joy turn-start healing and Tired settlement are implemented by S03 below; remaining class passives, Abilities and other end-effect settlement remain deferred. Unless the [Final Table Round completes the game](#game-end-issue-25), End starts the next configured seat, wrapping to seat zero after the last seat; the highest roller never reorders the seats.

The current engine stamp is owned by `ENGINE_VERSION` in [engine/versions.ts](../engine/versions.ts), and changed because accepted commands execute these new transitions. Unchanged historical `0.0.0` decision fixtures remain illustrative projections; they are not executable logs under the current version.

## Movement and Start crossing (issue #22)

Spec: §4.1, §4.2 steps 4–5, §4.7, §6.5, §8. A Move uses the existing player `roll` command followed by its verified engine `dice_result`; no extra unlogged movement command or RNG draw is introduced. The result adds the d6 to the active player's signed route progress. `positionOf` projects the visible square, including negative progress. A rejected, duplicate or stale roll result never moves or pays.

For a new positive Start milestone actually crossed or landed on by owner movement, the executor pays Start income from the bank, increments the paid-lap count once, and records the milestone in `highestRewardedMilestone`. The logged `coin_transfer` has bank source, player destination and reason `start_income`; it precedes `phase_changed` from Move to Sell. Sell retains `destinationPosition`; issue #24 implements its atomic sale/empty-sale commit and Rescue Starter below. Resolve's sole skip dispatches on the destination space type and emits `space_resolved`, entering Encounter on Wild, Shop on Shop squares and End elsewhere. Wild and Shop spaces work as described below; Event and Gym spaces are logged no-ops (issue #34 below); other space effects remain deferred. Ability reset remains a stub, and real push/pull effects and slowing remain deferred. See [Game end](#game-end-issue-25) for final settlement.

The watermark is separate from `creditedLap` so forced forward movement that skipped an unpaid milestone cannot make a later paid milestone pay twice after pushback. New games initialize both to zero. Historical contract-only snapshots may omit the watermark; their paid count is used as the fallback watermark. Old executable engine stamps are rejected by setup and replay rather than silently executing new movement rules. The engine version advances as recorded in [engine/versions.ts](../engine/versions.ts); the command-log format and RNG version are unchanged.

Tests import `forceMove(state, seatIndex, delta)` directly from `engine/testing.ts`, outside the production barrel. It returns a detached snapshot changing only that seat's signed route progress, rejects unknown seats or unsafe/non-whole displacement, and never changes coins, paid count, watermark, phase, RNG or revision. It creates no action record: it is a scenario-building helper, not a replayable game action. Use a revision-zero forced scenario before `createGameLog` when testing replay; real effects will eventually use logged commands.

## Atomic Sell and Rescue Starter (issue #24)

Spec: §3.1, §4.5, §4.7 steps 1–2, §8. `sell` carries `{ pokemonInstanceIds: string[] }`, including an empty list to keep the team. Each command commits the entire phase once. Unknown, foreign or duplicate UIDs reject the whole batch with no state, revision, RNG or event change. Actor, revision and sequence checks use the existing executor boundary. A sale that would exceed the safe integer coin range is also rejected before any mutation.

Sale pricing follows [spec §4.7 step 2](SPEC-v1.0-PokeMonopoly.md#47-selling-at-start-laps-and-game-end), using the current species definition's `base` for Base Sale. The class sale bonus (issue #30 below) is added after the tired adjustment. Each sold instance emits a bank-to-owner `coin_transfer` (reason `pokemon_sale`, including zero-value rescue sales) carrying `sale: { basePrice, classBonus }`, followed by `uid_destroyed` (reason `sold`). The selected team members are removed together.

If the resulting team is empty, the same commit grants exactly one class base Starter with `origin: "rescue_starter"`, stage 0, fresh status/readiness and `tradeable: false`. It uses the configured Starter selection when a class has alternatives. Its UID derives deterministically from seat and accepted-action revision, with a suffix when needed to avoid any existing Pokémon/item UID or a UID destroyed in that batch. Creation emits `uid_created` after the destructions. The phase then changes to Resolve; destination resolution remains the next action. A second sale in that phase is consequently impossible. Later-phase rescue sales still pay zero and can replace the rescue only once per commit, without a coin loop.

`origin` is the persistent rescue flag: future evolution must preserve it and the trading restriction while changing form/stage. This issue reads the existing tired flag and evolved form data but does not itself implement Tired application (added by S03 below), evolution, trading, UI or a Jev Sell decision. Final liquidation is described in [Game end](#game-end-issue-25). The engine version advances as recorded in [engine/versions.ts](../engine/versions.ts) because accepted commands now execute sales; command-log and RNG versions are unchanged. Historical illustrative 0.0.0 fixtures remain unchanged, and prior executable versions are rejected by setup/replay.

Issue #46 adds the read-only `saleQuote(state, seatIndex, pokemonInstanceIds): SaleQuote`
export for the active seat in Sell. It returns selected rows in selection order as
`{ instanceId, basePrice, classBonus }`, the engine-computed batch `total`, and
`rescueStarter: { saleValue: 0 }` when the committed selection would leave no Pokémon
(otherwise `null`). It uses the existing `salePrices` for the complete selected batch.
Unknown/inactive seats, other phases, duplicate/foreign/unknown UIDs and unsafe resulting
balances throw `RangeError` without mutation. Quotes neither commit nor consume a bonus;
the subsequent `sell` command still validates through `applyAction`. This additive API
changes no rule, existing function behavior, version stamp or save format.

## Game end (issue #25)

Spec: §1, §4.7 steps 3–4, §6.4, §8. `config.lapTarget` sets the paid Laps that end the game; `LAP_TARGETS` exports Quick 2 and Standard 3. The first owner Start crossing that brings a player's `creditedLap` to the target sets `finalTableRound` to that seat and its current `ownTurnNo`, and logs `final_table_round` with the same fields between the `start_income` transfer and the change to Sell. That player still completes Sell and the rest of the turn. Later arrivals at the target are paid and sell as usual but never re-announce or move the target.

**Approved clarification (2026-10-07):** play continues until every seat's `ownTurnNo` equals the trigger player's. Seats after the trigger player in turn order, before the rotation returns to the first player, therefore still take one more turn; when the trigger player is last in that order, the game ends after their own turn. The End skip that completes the round does not start another turn.

That skip instead auto-sells, in seat and team order, every remaining Pokémon except Rescue Starters at `round(saleBasis × 0.5)` (halves round up) with no class bonus or tired adjustment. Each sale logs a bank-to-owner `coin_transfer` with reason `final_sale`, followed by `uid_destroyed` with reason `final_sale`. Rescue Starters stay on the team and items stay in inventory, without coins or events. The phase then changes from End to `finished`. A finished game has no enabled choices, `advanceAutomatically` does nothing, and `applyAction` rejects every further player or engine-generated record as `illegal_action` after the revision and sequence checks.

`winner(state)` returns `{ winners, reason }`, with winners as actor IDs in seat order. The single richest player wins with reason `coins`. A coin tie goes to the most badges (reason `badges`; badges stay 0 until Gyms award them in cycle 3); a remaining tie returns every tied player with reason `co_winners`. Pokémon and evolution counts are never compared. The engine version advances as recorded in [engine/versions.ts](../engine/versions.ts) because accepted commands now end games; command-log and RNG versions are unchanged.

## Class framework and the Researcher (issue #30)

Spec: §4.1, §4.5, §4.7, Appendix A. A content class may name a `passive`; the engine's `classBonus` dispatcher ([engine/classes.ts](../engine/classes.ts)) owns each passive's amount and timing and serves the catch snapshot, Sell and combat hooks. Classes without a passive add 0. `lap_first_sale_bonus` is the Researcher's +3 in the Start Sell Phase; `lap_first_catch_bonus` is the Main Character's catch bonus (issue #35 below); `water_catch_bonus` and `bug_catch_sale_bonus` are the Fisherman's and Bug Catcher's (issue #55 S01 below); `combat_bonus` is the Rival's (issue #55 S05 below).

Within one atomic sale, the bonus goes to exactly one sold Pokémon: the highest `saleBasis` (before the tired adjustment), ties broken by the lowest instance ID in string order, so listing order never matters ([spec §4.7 step 2](SPEC-v1.0-PokeMonopoly.md#47-selling-at-start-laps-and-game-end)). A Rescue Starter is never a candidate. An empty sale pays nothing and uses no bonus. Each Sell Phase follows exactly one credited Lap, so once per phase is once per Lap; the bonus is available again after the next qualifying Start crossing without extra state. The sale event's `sale` field shows the parts, for example `{ basePrice: 12, classBonus: 3 }` for amount 15.

The Researcher's starting kit comes from the generic setup: 20 coins, an Original Starter Porygon (sale basis 5 in base form), 5 Poké Balls and a public Potion. Potion now uses the targeted S03 healing path described below. With no own Tired Pokémon it is disabled with `NO_VALID_TARGET`; combat debuffs and remaining class passives remain deferred. The engine version advances as recorded in [engine/versions.ts](../engine/versions.ts) because sale payouts and events changed; command-log and RNG versions are unchanged, and prior executable versions are rejected by setup/replay.

## Main Character (issue #35)

Spec: §4.1, §4.3, §10 C2, Appendix A. A Main Character seat picks Bulbasaur, Charmander or Squirtle with `starterSpeciesId`, which the generic setup requires when content lists the three alternatives. Its starting kit is 20 coins, that Original Starter, 5 Poké Balls and its Great Ball class item in the Ball pouch (`great: 1`); there is no utility item.

Content names the passive `lap_first_catch_bonus`; the engine gives +1 `classBonus` in the catch snapshot while the player's `catchBonusUsedLap` differs from its `creditedLap`. The logged catch `dice_result` records the use by setting `catchBonusUsedLap` to the current `creditedLap`, on success or failure ([spec §4.3](SPEC-v1.0-PokeMonopoly.md#43-catching)). Release, which makes no roll, leaves it unchanged. The field is absent until the first real roll and is never set for other classes. The next qualifying Start crossing increments `creditedLap`, so the bonus is available again without further state; an unused bonus does not accumulate. Availability is not yet projected in observations. The engine version advances as recorded in [engine/versions.ts](../engine/versions.ts) because catch snapshots changed; command-log and RNG versions are unchanged, and prior executable versions are rejected by setup/replay.

## C2 presets and placeholder spaces (issue #34)

Spec: §1, §4.1, §10 C2. `GAME_PRESETS` exports `quick` (`lapTarget: 2`, `enabled: true`) and `standard` (`lapTarget: 3`, `enabled: false`); `LAP_TARGETS` derives from it. `enabled` only tells setup which presets to offer: `createGame` still accepts any positive `config.lapTarget`. The sim plays real games at `--lap-target <n>` (default 2, Quick), so `--lap-target 3` runs Standard.

Resolve on an Event (2, 8, 14, 17, 22) or Gym (6, 12, 18) space emits `space_resolved` with `effect: "none_yet"`, then enters End. It changes no coins, items, Pokémon, budgets or RNG. Start and Shop resolutions keep the event without `effect`. Event cards and Gym battles replace this in cycles 4 and 3. The engine version advances as recorded in [engine/versions.ts](../engine/versions.ts) because accepted commands emit the new field; prior executable versions are rejected by setup/replay. Command-log and RNG versions are unchanged.

## Command log and replay (issue #20)

Spec: §3.1, §6.1, §6.3, §6.8, §8. The command pipeline now executes the setup/turn, movement and selling transitions above, plus catching, Shop `buy`/`skip_shop` and Strategy `use_item` as described below; other fixture-facing player commands still advance the accepted-action revision without gameplay effects. Other costs and gameplay effects remain later rule issues. `roll` and its engine-generated `dice_result` are separate accepted records. The engine orchestration layer supplies generated records with actor `engine`; player/AI deciders must only submit player choices. Config schemas reject `engine` as a player ID.

Generated `dice_result` records verify `payload.value` against the next seeded `d6` for `payload.purpose`. The reserved `first-player:`, `move:` and `catch:` purposes additionally require the matching outstanding roll; wrong or repeated outcomes reject without consuming RNG. Other purposes retain the generic command-log draw behavior only outside first-player selection and when no roll result is pending. Generated `shuffle` records currently support `deckId: "events"` and verify `payload.order` against Fisher-Yates on the current draw pile, with purpose `shuffle:events`. Both retain the advanced RNG state and every counted `random_result` event. A shuffle is one action even when it consumes multiple draws, or no draws for an empty/singleton pile. Generated `event_draw` records must name the current first draw-pile entry; they move that entry to the discard pile without applying its game effect or consuming randomness. Invalid generated outcomes/deck IDs are `illegal_action`, and generated kinds submitted by a player are not enabled player choices.

`advanceAutomatically(state)` performs **one** acceptance step for an outstanding engine dice result, or when there is exactly one enabled player choice, returning `{ state, records, events }` and marking the record `auto: true`. Without an outstanding result, zero or multiple enabled choices return the original state with empty arrays. It has no decider argument and does not loop: the caller retains the returned state/log records and advances again to expose the next phase or decision. Roll and its generated result remain separate acceptance steps, including while resuming or replaying a pending roll. Disabled choices do not count toward the single-choice rule.

`GameLog` / `gameLogSchema` add `logVersion: "command-log-v1"`, `initialState` and ordered `actions: ActionRecord[]` to the existing versioned header. `createGameLog(initialState)` returns a detached, empty log. The explicit revision-zero snapshot preserves exact initial players, phase, content and deck without loading content via IO. New games use the pre-roll state from `createGame`; explicit revision-zero snapshots remain supported for contract scenarios. It must match `initialConfig` and its RNG must equal `createRng(seed)` at cursor zero. Headers retain the supplied content stamp and embedded content rather than substituting the current catalogue. The executor supports the current `ENGINE_VERSION` and `RNG_VERSION`; incompatible executors fail explicitly. Historical illustrative fixture RNG stamps/sentinel states are not executable logs.

`replay(log)` validates shape, header/snapshot consistency and supported versions, then runs each logged action through the same pure command boundary. It checks contiguous sequences, legality, every emitted event (including draw counters and outcomes), and any `auto` marker against the expected automatic step (pending engine result or sole enabled player choice). Invalid logs throw; the input log is never mutated. Seeded verification consumes the same recorded sequence, preserves its RNG cursor, and never calls a decider, network, storage or clock. The returned state can continue from its verified RNG state.

`stateHash(state)` is a pure TypeScript, non-cryptographic comparison aid: eight lowercase hex digits from FNV-1a over canonical JSON UTF-16 code units. Object keys are sorted lexically; array order matters. All state fields, including private RNG/deck/content, participate. Hash equality is useful in tests, not proof of authenticity or collision-free equality. A future change to executable effects must update the engine version and relevant rules/tests together; the log format and RNG have their own version stamps.

## Fisherman and Bug Catcher hooks (issue #55 S01)

Spec: §4.3, §4.5 Rescue Starter, §4.7, §6.1, §8, Appendix A Classes. Content registers `water_catch_bonus` and `bug_catch_sale_bonus`; amounts and timing live in `engine/classes.ts`. Catch hooks receive the encounter species tags: Fisherman gets +2 against water and Bug Catcher +1 against bug on every attempt, with no Lap-use counter. The shared catch snapshot feeds both odds and confirmed rolls. Bug Catcher adds +2 to every bug Pokémon sold at Start after Tired rounding. Original Starter normalization still precedes the bonus; Rescue Starter sales get zero, and final auto-sales call no class hook. S01 leaves trainer-level catch/combat passive suppression for Rescue Starter teams unresolved for S00 and adds no suppression rule. The browser roster remains limited to Main Character and Researcher through a temporary guard in `web/src/game/content.ts`; a later UI slice removes it when the new classes have browser support. Engine and content versions advance for the new executable hooks and registered content IDs; older executable logs/saves are rejected by the existing version checks.

## Save, resume and replay verification (issue #33)

Spec: §3.1, §6.7, §6.8, §6.9, §8. A save is the text `serialize({ state, log })` returns: a strict object with `saveVersion: "save-v1"`, the `engineVersion`, `contentVersion` and `rngVersion` stamps, the current `state` and the command `log` as sibling keys. The log carries the initial config, seed, stamps, revision-zero state and every accepted record with its `random_result` events, so the dice are never re-rolled. No log is nested inside `state`, and the schema admits no other field, so no key or token can be saved. The schema also requires the top-level stamps to equal the log header, `state.config` to equal `initialConfig`, and `state.stateRevision` to equal the number of logged actions. The engine only builds and reads the text; storage belongs to the caller (the browser for stream C, files for the sim).

`deserialize(text)` refuses another `saveVersion`, `engineVersion`, `contentVersion` or `rngVersion` before the full schema check, with a message naming both versions (for example "This save was made with engine version 0.11.0; this game runs engine version 0.15.0. Old saves cannot be loaded yet."); migrating old saves is a later issue. Any other schema failure throws `Invalid save: <path>: <message>; ...`.

`resume(game)` returns `{ state, lastAction, waitingFor }` from the saved snapshot without applying anything: `lastAction` is the last committed record (so a dice result taken before the save is shown again), and `waitingFor` is `{ kind: "decision", seatIndex, actorId, phase, legalActions }`, `{ kind: "engine_result", purpose }` for a die still to be generated, or `{ kind: "finished" }`. A request pending when the browser closed is not in the save; the caller asks again for `waitingFor` from the same state and never starts a new turn. A sole enabled choice is still reported as a decision; the caller applies it with `advanceAutomatically` as during play.

`verifyReplay(game)` runs `replay(log)` and compares `stateHash` of the result with the saved state: `{ pass: true, stateHash }`, or `{ pass: false, reason }` when the log is invalid (for example a changed die) or the hashes differ. Like `replay`, it calls no decider, network, storage or clock. `npm run sim -- --replay <save.json>` prints its PASS or FAIL line; lint keeps `ai/`, `web/` and the Jev SDK out of `sim/` as well as `engine/`.

## Wild encounters and catching (issue #23)

Spec: §3.1, §4.3, §4.5, §8. Current-version Encounter accepts one held Ball type or release. Catch confirmation consumes exactly one chosen Ball and the turn's `catchAttempt`, and snapshots `catchDC`, `ballType`, and all four bonuses in `phase.catchRoll`. No RNG or UID creation occurs at confirmation. Pending catches have no player choices; `advanceAutomatically` produces the verified `dice_result` with purpose `catch:<seatIndex>:<globalTurnNo>`. Equality with DC succeeds. The result enters End, creating a fresh caught Pokémon and `uid_created` only on success. Release enters End without changing Balls, budgets, RNG or teams. The class bonus comes from the issue #30 dispatcher, which applies Main Character's first-catch +1 (issue #35), Fisherman's +2 against `water`, or Bug Catcher's +1 against `bug` (issue #55 S01); the Ability bonus hook returns zero, and the item hook returns the Lucky Egg bonus described below; Ball bonuses are 0/1/2 for Poké/Great/Ultra. Odds are described in issue #32 below; the Shop is described below.

No Balls disables catch with `NO_BALL` / `No Ball`; a spent catch budget disables otherwise available Balls with `ALREADY_USED_THIS_TURN`. Historical decision snapshots remain illustrative. The new engine stamp rejects older executable logs rather than changing their rules on replay.

Resolve's skip logs `space_resolved` first. On Wild it draws rarity with weights 50/33/17, then a uniform species index in that rarity, recording both counted random events as `encounter:rarity` and `encounter:species`. Bulbasaur, Charmander, Squirtle and Porygon are excluded by species ID. Live `phase.pokemon` contains only `speciesId`; historical fixtures may still carry their illustrative instance shape. Repeated species are allowed. The minimal executable fixture adds Chansey to represent rare encounters, using Appendix A data; it is not the final 15-species catalogue. `createGame` rejects content that leaves any rarity without an eligible species (see setup above). Start income and Sell still precede the destination draw.

## Catch odds and disabled reasons (issue #32)

Spec: §3, §3.1 rows 3–4, §4.3, §4.6. `catchOdds(state, seatIndex, ballType)` returns `{ needed, successFaces, probability, percent }` for the current Encounter. It builds the same modifier snapshot that catch confirmation stores and runs each of the six d6 faces through the same resolver as the logged roll, so displayed odds cannot drift from play. `needed` is `catchDC` minus all four bonuses and may be 1 or less (probability 1) or above 6 (probability 0); `percent` is `round(100 × successFaces / 6)`. `oddsForAllBalls(state, seatIndex)` lists `{ ballType, ...odds }` for each Ball type the seat holds, in Poké/Great/Ultra order. Both are pure reads; any seat other than the active seat in the Encounter (including unknown seats) and phases other than Encounter throw `RangeError`, because the snapshot reads the active player's turn effects such as Lucky Egg. The odds follow whatever the class, Ability and item hooks return: an active Lucky Egg (issue #31) raises them by one face, and the class dispatcher adds the Main Character's +1 (issue #35) while that seat's first-catch bonus for the current Lap is unused; Fisherman and Bug Catcher use the same encounter-tag bonuses in odds and confirmed rolls; the Researcher's passive applies only in the Sell Phase.

Disabled reasons for catch and Shop use `NO_BALL` / `No Ball`, `NOT_ENOUGH_COINS` / `Not enough coins` and `ITEMS_FULL` / `Items full` with the precedence described for catching above and the Shop below (§3.1).

## Shop (issue #29)

Spec: §3.1, §4.1, §4.6, Appendix A. Resolve's skip on Shop squares 4, 10, 15 and 20 logs `space_resolved`, then enters `phase.offers`: every Ball (`offer-poke`/`-great`/`-ultra` at the content prices 1/2/3) followed by 2 distinct utility items drawn from this cycle's pool (Lucky Egg, Repel, Pickpocket). The items are drawn without replacement as two counted `shop:item` random events over the pool entries present in content, in content order; content must contain at least two of them, and `createGame` rejects content that does not. The minimal executable fixture adds Pickpocket at its Appendix A price of 3. Utility offer IDs are `offer-<itemId>`. Item effects are described below.

The player accepts at most one `buy { offerId }` or `skip_shop` (`id: "skip-shop"`, always enabled); either enters End, so a second purchase or a refresh is impossible. A purchase pays the price to the bank with a player-to-bank `coin_transfer` (reason `shop_purchase`). A Ball adds one to the counted pouch. A utility item adds a secret item instance `bought:<seatIndex>:<revision>` and emits `uid_created` after the payment. Offers are disabled with `ITEMS_FULL` / `Items full` for utility items while 4 items are held (approved §3.1 row; Balls stay buyable), otherwise with `NOT_ENOUGH_COINS` / `Not enough coins` when unaffordable; disabled offers are rejected as `illegal_action`. With 0 coins `skip_shop` is the sole choice and advances automatically. Class Shop discounts remain deferred. The engine version advances as recorded in [engine/versions.ts](../engine/versions.ts) because Resolve and Shop commands now change state; historical `0.0.0` Shop fixtures keep their illustrative `skip` choice.

## Utility items (issue #31)

Spec: §4.1, §4.2, §4.3, §4.6, Appendix A, §8. Current-version Strategy lists, before its `skip`, one `use_item` choice per held usable item: Lucky Egg as `use-item:<instanceId>` with payload `{ itemInstanceId }`, and Repel/Pickpocket once per opponent as `use-item:<instanceId>:seat-<n>` with payload `{ itemInstanceId, targetSeatIndex }`. Hostile items never list the user and ignore board distance. A held Potion uses the targeted S03 choices below; Price Shield exposes no choice yet. Using an item spends the turn's `tacticalAction`, removes that instance and logs `uid_destroyed` (reason `used`) after any effect event; a Repel or Pickpocket also logs `hostile_item_used { userSeatIndex, targetSeatIndex, itemId }` just before it, seen only by the user and target (spec §4.1, §4.4); the phase stays in Strategy, so the remaining choice is `skip`. With the budget spent every item choice is disabled with `ALREADY_USED_THIS_TURN` / `Tactical action already used this turn`; otherwise a Pickpocket target with 0 coins and a Repel target with a Repel still pending are disabled with `NO_VALID_TARGET` / `Target has no coins` or `Target is already slowed`. Disabled, self-targeted and untargeted hostile uses are rejected as `illegal_action`.

- **Lucky Egg** sets `GameState.turnEffects.itemBonus = 1`; the catch item hook snapshots it into `phase.catchRoll.itemBonus`, and the [shared combat snapshot](#shared-combat-arithmetic-issue-55-s05) reads it for its owner. The next turn start clears `turnEffects`, and movement ignores it.
- **Repel** appends `'repel'` to the target's `Player.pendingSlows`. The target's next move result adds `max(1, d6 − 2)` squares, and that actual move clears its pending slows. The die value and its logged random event are unchanged.
- **Pickpocket** moves `min(5, target.coins)` from target to user with one player-to-player `coin_transfer` (reason `pickpocket`), so coins stay nonnegative and are conserved.

Both new state fields are optional and absent when no effect is active. `observe` does not project them yet. The engine version advances as recorded in [engine/versions.ts](../engine/versions.ts) because Strategy commands now change state; command-log and RNG versions are unchanged. AI item selection and the remaining items stay deferred.

## Invariant checker (issue #14)

Spec: §1 (hard gates), §6.5, §8. `checkInvariants(before, action, result)` in [engine/invariants.ts](../engine/invariants.ts) takes the state and untrusted action passed to `applyAction` plus its result, and returns `Violation[]` (`{ invariant, message }`); an empty array means every active invariant held. It is pure, deterministic and imports only `engine/` modules. `INVARIANTS` registers every spec §8 invariant by ID with its section, the exact spec line, and `active` or `pending` status; pending invariants switch on when their rules land. Active this cycle: non-negative coins, sourced `coin_transfer` events that account for every coin change, Start income (reason `start_income`) paid only by the bank to a player, paid laps (`creditedLap`) and the rewarded-milestone watermark (`highestRewardedMilestone`) that never decrease with `creditedLap` never above the watermark, one Start income per new milestone crossed in that step with a matching `creditedLap` +1 and watermark (the §6.5 rule that a push, pull or re-crossed milestone pays nothing), payment before the Sell Phase and destination resolution only from Resolve after it, Start income only while the engine resolves the payee's own move roll (forced movement never pays), unique instance IDs across teams, items and a historical encounter's Pokémon, a logged `uid_created` or `uid_destroyed` for every team or item instance that appears or vanishes (an instance ID is created at the catch, per issue #23, so a wild encounter's Pokémon is never in the lifecycle sets), unchanged state hash after a rejected or stale action, exactly 1 Ball per catch and none per release, step replay that reproduces the logged state and events, and an unfinished game whose active seat always has an enabled choice or awaits the engine's dice result. `createInvariantChecker(applyActionFn)` builds the same checker against another engine function, which tests use to model a deliberately broken engine. `npm run sim` (issue #13) calls it after every action; see [sim/README.md](../sim/README.md). Current-version catches spend their Ball (issue #23) and pass the checker; the fixture sweep skips catch choices only in fixtures whose `engineVersion` differs from the current engine version, because historical fixtures record no catch effects and their catch spends no Ball.

## Dialogue log events (issue #42)

Spec: §3, §5.2, §5.5, §5.7, §9. `EngineEvent` also accepts `line_selected` with `situation`, `personalityId`, `trustBucket` and `lineId`. `GameLog` has an optional `dialogueEvents` array for these events and `random_result` events whose purpose starts with `line:`. Callers append `selectLine`'s returned events here; `serialize` and `deserialize` preserve them. Selection uses a separate presentation RNG, retained by the caller between picks. These annotations do not alter accepted actions or gameplay state and command replay ignores them. Gameplay display and Jev selection integration are deferred.

### Effective forms (issue 55 S02)

Spec: §4.5, §4.7, §6.1/6.8, §8, Appendix A Evolution.

`toEngineContent(parseContent(files))` retains `evolutions` and species `ability` descriptions.
`effectiveForm(content, formId)` returns detached effective stats and Ability metadata. Explicit
species definitions win; other declared forms inherit from the preceding stage with Battle +2
and Base Sale rounded after each ×1.5 step. No fallback species rows are added. The same lookup
feeds Sell, final liquidation and Bug Catcher sale-tag checks; combat and Ability execution can consume it in later slices.
`nextEvolutionForms` lists next-stage IDs and `evolvedForm` rejects a target outside that list.
These reads neither change instances/cooldowns nor consume RNG; they do not execute evolution.
Ability prose is retained as data. The proposed primitive mapping is in [spec Appendix C](SPEC-v1.0-PokeMonopoly.md#appendix-c--ability-and-battle-timing-contract), pending approval.

Historical illustrative fixtures may omit evolution metadata and Ability descriptions; direct
species lookup still works for them. The engine stamp advances to 0.13.0 because effective sale
values change. Prior executable engine versions remain rejected; content JSON, content version,
RNG version and command-log format are unchanged.

## Tired, Nurse Joy and Potion (issue #55 S03)

Spec: §4.2 steps 1/7, §4.4–§4.6, §8, Appendix A.
`applyStatus(owner, uid, 'tired', reason)` and `healStatus` mutate only the executor's
working snapshot and return UID-bound `status_changed` events. Tired retains its boolean
for pricing and observations, with optional `tiredExpiresOwnTurnNo` metadata (historical
fixtures omit it). Application sets the expiry to at least `owner.ownTurnNo + 1`;
reapplication never shortens it. End clears due statuses before liquidation or rotation.
`battleReadyMembers` excludes Tired members. Existing Sell rounding and ×0.8 pricing remain.
Nurse Joy's `turn_start_team_heal` content ID clears the entire team's Tired on entry to
Start, including the first selected turn, using the same healing helper. Coin-loss immunity
belongs to later combat work. Browser setup keeps Nurse Joy unavailable until that portion ships;
status event records do not add new UI announcements in this engine slice.

Strategy Potion choices carry `itemInstanceId`, `targetPokemonInstanceId` and
`status: 'tired'`. Only own Tired UIDs are enabled; no target produces `NO_VALID_TARGET`,
and a spent tactical budget produces `ALREADY_USED_THIS_TURN`. Use clears the selected
status, destroys that item UID, and spends one tactical action. Foreign, absent or healthy
targets reject atomically. Later debuffs extend the typed status seam; none are invented here.
Statuses, expiry and events round-trip through saves, observations and command replay.
The combined engine stamp advances to 0.14.0; older executable saves are refused rather than migrated.
No battle, Event or Ability Tired source is introduced by this slice.

## Social window and chat messages (issue #56 S01)

Spec: §4.2, §4.8 Chat, §5.4, §9.

**Flag.** `GameConfig.socialWindow` is optional. Absent or `false`, Social offers only `skip` to every seat, a `chat` command is rejected as `illegal_action`, no budget key exists and `observe` has no `own.chats`: behaviour is exactly as before, so the browser keeps skipping Social. Stream C turns the flag on together with the chat screen (#57); this slice does not.

**Command.** `chat` has the payload `{ targetSeatIndex, topic, leaderSeatIndex?, itemId? }`, with `topic` one of `truce`, `trade`, `point_leader`, `use_item`, `hold_item`. Free text is not part of this slice. It is accepted only from the active **human** seat in Social while the flag is on and the turn's social interaction is unspent. AI seats are never offered one (§4.2: the human starts conversations). Validity is decided by `validChat` in [engine/social.ts](../engine/social.ts) over exactly the set `legalActions` enumerates (id `chat:seat-<target>:<topic>[:seat-<leader>|:<itemId>]`):

| Topic | Extra fields | Allowed values |
| --- | --- | --- |
| `truce`, `trade` | none | any other seat as target |
| `point_leader` | `leaderSeatIndex` | a seat that is neither the speaker nor the target (so none in a 2-seat game); words only, it is not checked against who actually leads |
| `use_item`, `hold_item` | `itemId` | a content utility item ID, never an instance ID and never a Ball |

**Budget.** `turnBudgets.socialInteraction` is `1` at Start when the flag is on, and `0` after one message. One message uses the whole §4.2 interaction (one opponent, one conversation per human turn); afterwards only `skip` is offered. It is absent when the flag is off. The reply and counteroffer that complete an interaction belong to later slices.

**What the engine stores.** `GameState.chats` holds the last 3 messages per unordered pair (`seats` low to high), each `{ fromSeatIndex, toSeatIndex, topic, leaderSeatIndex?, itemId?, globalTurnNo }`. The key is absent until a first message. An accepted chat emits one `chat_sent` event and changes nothing else.

**The hard line (§4.8).** A chat changes no coins, teams, items, Balls, RNG, dice, phase or legality: the only differences between the states before and after are `chats`, `turnBudgets.socialInteraction` and `stateRevision`, and the legal set shrinks only by the chat choices. Asking about an item cannot reveal a holding: the item choices come from content, so `legalActions`, events and state do not depend on what the target holds.

**Visibility.** `observe(state, seat).own.chats` lists only the messages that seat sent or received (oldest first; present only when the flag is on). `chat_sent` reaches only its sender and recipient. `actionVisibleTo` strips every `chat` payload field for any other seat, but the record itself still exists in the sequence, so a third seat can see that some seat took a `chat` action, not what or to whom. Nothing about chat reaches `ai/` until stream B's slices read `own.chats` through `observe`.

**Versioning.** The stamp advances to 0.15.0 because the action union, events, state and observation gain fields; saves of 0.14.0 are refused rather than migrated. Chats round-trip through saves and command replay. Tests: [engine/social.test.ts](../engine/social.test.ts).

## Shared combat arithmetic (issue #55 S05)

Spec: §3 board odds, §4.3, §4.4, §4.6, §5.2, §6.1/6.8, §8, Appendix A Rival/Lucky Egg.

`highestBattleMember(content, player, members?)` selects the highest effective battle among
non-Tired members, breaking ties by UID in string order. `printedBattle` is the current
effective form's stat (including fallback evolution), while `effectiveBattle` includes that
member's pre-roll `battleBonus` and `debuffs`. An empty/all-Tired team has no selected member.
`combatSnapshot(state, seatIndex, modifiers?)` adds the engine class hook, the active owner's
Lucky Egg turn effect, and the pre-roll team `abilityBonus`/`debuffs` slots. These slots are
inputs from future engine effect hooks, not a new Ability mapping or caller/AI arithmetic.
Member adjustments must name unique owned UIDs; bonuses and debuffs are nonnegative integers.
Selection precedes team-wide modifiers; values are not clamped at zero.

`pvpSnapshot(state, attackerSeatIndex, defenderSeatIndex, { attacker?, defender? }?)` snapshots
both parties together. `gymSnapshot(state, seatIndex, position, modifiers?)` assigns DC 5/7/9
at 6/12/18. Both reject missing readiness or unknown seats; PvP rejects self-targeting, Gym
rejects other squares. These are arithmetic prerequisites, not tactical/phase/declaration
legality: S06/S09 own those checks and the pending confirmation flow.

Snapshots contain detached scalar evidence and are recursively frozen, with readonly types
and serializable schemas exported from `engine/contract/combat.ts`. Parsing a saved snapshot
freezes it again. `resolvePvp(snapshot, attackerFace, defenderFace)` and
`resolveGym(snapshot, face)` accept only the confirmed snapshot and d6 faces, never fresh
modifiers or live state. PvP returns attacker-relative `win`/`tie`/`loss`, both totals and
`rewardSeatIndex` (null on a tie). Gym returns `win` at or above DC, otherwise `loss`, the
total/DC and a reward seat only for a win. No resolver transfers coins, grants badges, evolves,
applies Tired, consumes effects, or advances RNG.

`pvpOdds(snapshot)` enumerates all 36 die pairs through `resolvePvp`; `gymOdds(snapshot)`
enumerates all six faces through `resolveGym`. Both return `totalOutcomes` and `win`, `tie`,
`loss` records with `outcomes`, exact `probability`, and independently rounded whole-number
`percent`. Gym's tie record is always zero. Displayed and resolved odds use the same snapshot.

Content registers Rival's `combat_bonus` passive; the engine supplies +1 for attack, defence
and Gym, without granting the later once-per-Lap forced challenge. Lucky Egg's existing
Strategy use/cost/expiry stays in the item executor and turn driver; its turn effect now
feeds combat as well as catching and never benefits a different seat. Rescue Starter teams
retain trainer passives pending S00, matching S01's unresolved-interpretation boundary.
S00 still decides the activation/confirmation sequence. This slice exposes no late modifier
or reroll operation: S11's approved Porygon path must preserve the confirmed snapshot while
replacing only the permitted own die. It adds no primitive names or Ability bindings.

Engine/content stamps advance to 0.15.0/1.2.0 for the new combat contract and registered
passive; prior executable saves/logs reject through the existing version checks. Historical
illustrative fixtures, RNG version and command-log format are unchanged. PvP/Gym phases,
rewards, Gym entry choice and UI/AI integration belong to later slices.
## Evolution and exclusive reward helpers (issue #55 S04)

Spec: §4.4 Battle Reward/Gym, §4.5, §4.7, §6.1/6.8, §8, Appendix A.
`evolvePokemon(content, owner, instanceId, nextFormId)` validates a legal next form using
S02's lookup, then changes only `speciesId` and `evolutionStage` on the existing instance.
It returns one `pokemon_evolved` event and no UID creation/destruction. Defined forms replace
stats/Ability; fallback forms use the current form's per-stage arithmetic. Status, expiry,
origin, tradeability and cooldowns survive. Sell/final liquidation continue through the
existing `saleBasis` path: evolved Original Starters use current Base Sale; Rescue stays zero.

`rewardChoices(state, request)` lists `coins` plus explicit `{ kind: 'evolve', instanceId,
nextFormId }` choices for the winner's eligible team, including Tired members. A request is
`{ rewardId, winnerId, source }`, where source is `{ kind: 'gym' }` or
`{ kind: 'pvp', loserId, coinLossBlocked }`. PvP pays only `min(6, loser.coins)` from the loser,
or zero with confirmed protection; Gym pays 6 from the bank. There is no bank substitute for
blocked/unfunded PvP coins. Evolution charges neither player. Zero payments emit no transfer.

`resolveReward(next, request, choice)` is an internal mutation helper for the caller's detached
snapshot. It validates the complete choice before writing, returns accepted events or a rejection,
and leaves rejected snapshots unchanged. It records the reward ID in optional
`resolvedRewardIds` and emits `battle_reward_resolved`; transfers carry the same `rewardId`.
A repeated ID rejects with `already_resolved`, even if the retry selects the other outcome.
Receipts persist in snapshots/saves; callers must use a stable ID for a single resolved fight.
Both helpers leave RNG, phase, turn budgets and badges alone. Callers in S06/S09 must own the
pending request, create it only on a win, check responder/revision, persist returned events in
the accepted action record, and continue the turn. There is no public reward command yet;
command-level reward replay/resume integration belongs to those callers. Protection timing,
shield consumption and Ability primitive mapping are deferred; no S00 choice is needed here.

The §8 one-stage/same-UID, evolution preservation and exclusive reward invariant checkers are
active, with adversarial mutation coverage. The engine stamp advances to 0.15.0 for the new
state/events; content/RNG versions and the command-log format remain unchanged.
## Ability and battle timing contract (issue #55 S00)

Spec: §4.2, §4.4–§4.6, §6.1, §8, Appendix A timing, Appendix C. [Spec Appendix C](SPEC-v1.0-PokeMonopoly.md#appendix-c--ability-and-battle-timing-contract) proposes the contract that the Ability, combat, Gym and protection slices (S05–S14) implement: the core Starter Ability to primitive-operation mapping, the timing windows, the PvP and Gym decision order, activation costs, shields, slows and the worked acceptance cases AC-1 to AC-5. Its decisions D1–D13 await Stream A team approval. The contract is not implemented: engine behaviour and the engine, content, RNG and command-log versions are unchanged.


## Voluntary PvP and decision ownership (issue #55 S06)

Spec: §4.2, §4.4, §4.8 (attack evidence), §6.1/6.3/6.4/6.8/6.9, §8;
Appendix C.3 proposed D3/D4. S06 implements that proposed order for voluntary challenges;
Ability activations, reactions, rerolls and protection remain later slices.

In Strategy, `declare_pvp { targetSeatIndex }` is legal against any other seat at any
board distance if both teams have a non-Tired member and the challenger has a tactical
action. Declaration spends that action immediately, leaving other budgets untouched.
It appends one public `attack_attempt` to `attackHistory` and the accepted action events:
`{ attackId, actorId, targetId, source: 'pvp_declaration', actionSeq, globalTurnNo }`.
The stable attack/battle/reward ID is `pvp:<declaration actionSeq>`. The canonical evidence
survives declines and ties; later `no_attack` consumers need not infer attacks from dice,
coin transfers or final outcomes. Observations and seat-visible event copies expose public
declarations; no private item or willingness state is added. This slice adds no promises.

`pendingDecision(state)` returns `{ seatIndex, actorId }`, distinct from active turn
ownership. It returns the defender for `respond_pvp { accept }`, the winner for
`choose_reward` (an explicit S04 `coins` or `evolve` choice), and null while either engine
die is pending or the game is finished. All other decisions belong to the active seat.
Wrong actors, stale revisions and unlisted choices reject without state or RNG changes.
The automatic driver, resume, progress invariant, sim runner and property driver use this
query, including when the deciding seat is an AI defender. Automatic singleton choices
are still recorded as actions owned by their actual deciding seat.

A decline costs no coins, rolls nothing and returns to the challenger's Strategy. On
acceptance, `pvp_response` precedes `pvp_confirmed`. Appendix C only offers Ability windows
when a ready eligible Ability exists; no such executable Ability exists in S06. Thus the
attacker and defender windows close in that order without extra prompts, then S05's
`pvpSnapshot` freezes all combat terms. S10 can insert its windows before that snapshot.
The pending phase retains the confirmation and then the attacker's face. The engine draws
one die per accepted `dice_result`, attacker first, with purposes
`pvp:<declaration actionSeq>:attacker_roll` and `pvp:<declaration actionSeq>:defender_roll`.
Dice with the wrong pending purpose or face reject; other generated actions cannot
interleave into pending PvP. S05's `resolvePvp` supplies totals, outcome and reward seat in
`pvp_resolved`. A tie returns directly to Strategy. On a win S04's resolver offers only
the winner's reward and records its receipt; evolution never charges the loser.
Protection is not added here: the pending request uses `coinLossBlocked: false` until S07.

Every pending phase is serializable: declaration/response, confirmed attacker roll,
defender roll, and winner reward. Save/resume re-asks the current owner from that exact
revision; replay executes those accepted records without drawing or awarding twice.
Throughout PvP the active seat, global turn and every own-turn counter stay fixed.
Continuation returns to Strategy with the action spent, so neither a second item nor a
second PvP is legal. End/next-seat advancement remains exclusively in the turn driver.

The combined engine stamp is 0.16.0, one step beyond the dependency branches' 0.15.0.
Historical illustrative fixtures and RNG/log/save format versions remain unchanged.
The browser event formatter only recognizes the new event variants for type compatibility;
PvP UI and AI integration are outside this slice.


### Known limitation / follow-up for Stream B

AI seats temporarily do not declare PvP; the Jev Strategy filter, fallback penalty and
removal condition are specified in [spec §5.3](SPEC-v1.0-PokeMonopoly.md#53-decision-points--questions).
