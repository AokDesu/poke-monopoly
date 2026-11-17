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
| `GameState.stateRevision` | Global count of accepted actions so far, initially 0. The engine, its replay log, saves, resume and replay use it. Never sent to a seat. |
| `Observation.public.stateRevision` | The seat's revision: the accepted actions that seat can see. It equals the global revision unless a chat or promise record between two other seats was hidden from it (`GameState.stateRevision` minus `Player.unseenRecords`). |
| `Action.actionSeq` | The actor's observed revision plus 1. For engine-generated dice results, shuffles and event draws, and for any seat that has missed nothing, that is the global revision plus 1. |
| `Action.stateRevisionBefore` | Revision the actor observed. `applyAction` compares it with that actor's current observed revision: a chat hidden from the actor never makes it stale, and any record the actor can see does. |

**Approved clarification (2026-10-07):** accepted actions, rather than turns or only player commands, determine both sequence and revision. The next accepted record has `actionSeq = stateRevisionBefore + 1`, and every accepted record raises the global revision by exactly 1. Rejection advances neither counter and changes no state. **Seat-relative revision (#56 S01, #143):** before, a seat observed and submitted the global revision. Now `observe` gives each seat its own revision (see the table), a seat submits `actionSeq = observed + 1` and `stateRevisionBefore = observed`, and `applyAction` checks both against that actor's observed revision. Engine records use the global revision. A record then keeps the numbers its actor submitted. The global revision in state, the replay log, saves, resume and replay counts every record as before. With the Social window off, or before any chat is hidden from a seat, the two revisions are equal, so nothing changes. Details: [Social window](#social-window-and-chat-messages-issue-56-s01). `actorId` is the configured player ID, or the reserved ID `engine` for generated records; `kind` discriminates `payload`. Do not configure a player with actor ID `engine`.

`GameConfig` records seats, seed, Lap target and engine/content/RNG versions. A seat may also specify `starterSpeciesId` to choose among its class's Starter alternatives. `GameState` embeds configuration and minimal content, players, active seat, phase, current budgets, optional Final Table Round target, private RNG cursor/state and private Event draw/discard piles. It contains **no nested log**. A fixture's separate `log` contains `{ action, events }` records. `EngineEvent` covers random results, sourced coin transfers (bank or player endpoints), UID creation/destruction, resolved spaces, phase changes and the Final Table Round announcement. Pokémon and utility items each have `instanceId`; Balls use counted `poke`, `great`, `ultra` pouch entries. Pokémon record starter origin, evolution stage, tired status and ability readiness. New Rescue Starters also carry `tradeable: false`; historical instances may omit that field; items record public/secret visibility. Final Table Round records the triggering seat and target own-turn count; game end is described below.

## Public seam and visibility

Issue #11 adds pure RNG and version/header contracts (spec §4.6, §6.8, §8):

- `createRng(seed)` accepts a safe integer or nonempty string and returns `{ state, cursor: 0 }`. The current `RNG_VERSION` is exported from [engine/rng.ts](../engine/rng.ts); numeric seeds wrap to uint32 and string seeds use FNV-1a over UTF-16 code units. State is a canonical decimal uint32 string; helpers accept a safe nonnegative cursor below `Number.MAX_SAFE_INTEGER`. A final draw may return that maximum cursor, but it cannot be used as helper input again. Sequence/seed mapping/helper changes require a new version.
- `d6(rng, purpose?)`, `int(rng, n, purpose?)`, `weightedPick(rng, entries, purpose?)` and `shuffle(rng, input, purpose?)` return `{ value, rng, events }` without mutating input. Retain the returned `rng` for the next draw or snapshot; serializing it resumes the same sequence. `int` is zero-based with integer bounds 1 through 2^32. Weighted entries are `{ value, weight }`; weights must be finite, nonnegative and have a positive finite total.
- Every consumed draw returns `{ kind: 'random_result', purpose, result, drawCounter }`. Counters start at 1 and equal the resulting cursor. Dice/integers record their value; weighted picks record the selected entry index; Fisher-Yates shuffle records each swap's selected index in descending position order. Empty/singleton shuffles consume no draws. Invalid inputs throw `RangeError` without changing state. The historical issue #3 event schema allows omitted `drawCounter` for its unchanged illustrative fixtures; the new `RandomResultEvent` type always requires it.
- `createGameConfig(input)` stamps `ENGINE_VERSION`, existing `CONTENT_VERSION` and `RNG_VERSION`. `createLogHeader(config)` returns a detached header, preserving the supplied config's versions rather than replacing historical stamps. [engine/contract/schema.ts](../engine/contract/schema.ts) owns the `gameConfigSchema` and `logHeaderSchema` fields and validation, including header seed/version equality with the initial config. These helpers preserve historical stamps; the command-log executor below additionally checks that it supports the stamped engine and RNG versions.

- `applyAction(state, action: unknown): ApplyActionResult` validates untrusted command shape, current revision, next sequence, active configured actor and exact enabled choice (kind **and** payload), or complete Sell-batch validity for current-version sales. Rejection is `{ rejected: true, state, reason }` with the original state reference; reasons are `malformed_action`, `stale_revision`, `invalid_sequence`, `wrong_actor`, or `illegal_action`, checked in that order before player-choice membership. Acceptance is `{ accepted: true, state, events, record }` with a detached snapshot, a resulting global revision one higher than before (the submitted sequence and revision are checked against the actor's observed revision, see [Social window](#social-window-and-chat-messages-issue-56-s01)), and a separate `{ action, events }` record. The reserved engine identity takes the generated-record path after revision/sequence validation. Callers must retain the returned state and append the returned record to their separate log; no log is nested in state.
- `legalActions(state, seatIndex): LegalActions` returns stable-ID `{ id, kind, payload }` choices and disabled choices with `reasonCode`/English `reasonText`. Current-version games expose roll during first-player selection and Move, and skip during Start, Social, Strategy, Resolve and End. Pending dice results expose no player choice. Current-version Strategy adds `use_item` choices for held Lucky Eggs, Repels and Pickpockets as described below, and targeted Potion choices described in S03 below; historical contract fixtures retain their illustrative untargeted item choices. Current-version Sell exposes valid single-instance `sell` choices and an empty `sell` batch (`id: "finish-sell"`). Any distinct subset of owned instance IDs can be submitted as one atomic batch, without enumerating every subset in the choices. `finish_sell` remains accepted as an empty-batch compatibility alias. Either command finishes Sell and enters Resolve. Historical fixtures retain illustrative Sell choices. Current-version Encounter and Shop execute catching and purchases as described below; historical Encounter and Shop choices remain illustrative. Other budget spending, cooldowns, other full-hand checks, combat, Gym, Abilities and deal/promise execution remain deferred; chat is described in the Social window section below and is off unless `GameConfig.socialWindow` is true. Other phases return empty lists; out-of-turn seats receive only a disabled skip. IDs describe the same choice across repeated calls; records must still carry the current revision when submitted.
- `observe(state, seatIndex): Observation` explicitly projects public board, players' coins/positions/teams, utility-item counts, publicly visible utility items, Lap and ability readiness, phase and counters; `own` contains only that seat's utility items, Ball pouch and peek results. Opponents' Ball counts are not exposed directly (approved §4.1 rule, issue #37), but they can be inferred from public play: the public starting kit, the Ball type in a public catch roll and public Shop purchase prices. Opponent secrets, the seed, RNG cursor/state/version and Event order never appear. Returned observations are detached copies. Unknown seats throw `RangeError` in all four read seams. Streams B/C should consume observations, not snapshots/logs; Jev's named buckets remain stream B's responsibility (§5.4).
- `eventsVisibleTo(before, events, seatIndex): EngineEvent[]` returns detached copies of the events of one accepted action that the seat may see, in order; `before` is the state the action was applied to. The visibility rule hides an item's `uid_created` from everyone but its owner (items created during play are bought and secret), a secret item's `uid_destroyed` from everyone but its owner, `hostile_item_used` from everyone but its user and target, and every `shuffle:` `random_result` from all seats, since the draws reveal deck order. A `chat_sent` reaches only its sender and recipient ([Social window](#social-window-and-chat-messages-issue-56-s01)). Issue #55 adds feature rules, each owned by its section: attack attempts, `protection_applied` and secret `shield_armed` ([S07](#price-shield-and-nurse-joy-protection-issue-55-s07)), hostile `ability_activated`, public with its target removed for other seats ([S12](#fixed-movement-slows-and-displacement-issue-55-s12)), and `ball_gained` plus the Lucky Splash die ([S13](#gainball-peek-and-the-event-deck-issue-55-s13)). Other events are public. Pass a seat only its filtered events; `applyAction` still returns, and logs record, the full list.
- `actionVisibleTo(before, record, seatIndex, shownBefore): SeatActionRecord | null` returns a detached, seat-safe copy of one accepted `ActionRecord`, or `null` when the seat must not know the action happened; `before` is the state it was applied to and `shownBefore` is how many records that seat's feed already holds. Its events are `eventsVisibleTo`'s, and its payload drops what the seat may not see: another seat's `buy.offerId`, another seat's secret `use_item.itemInstanceId`, a hostile item's `targetSeatIndex` for seats other than the user and target, and every seat's `shuffle.order` and `event_draw.eventId`, plus the issue #55 drops in those sections (a hostile Ability's `activate_ability.targetSeatIndex`, the Lucky Splash `dice_result.value`). A dropped field is absent, not blanked. A `chat` between two other seats returns `null` (see [Social window](#social-window-and-chat-messages-issue-56-s01)). The copy's `actionSeq` and `stateRevisionBefore` are numbered within the seat's own feed (`shownBefore + 1` and `shownBefore`), so a record the seat never sees leaves no gap. Callers pass the feed's current length and skip `null`s; the unnumbered, unfiltered record stays in the replay log.

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

For a new positive Start milestone actually crossed or landed on by owner movement, the executor pays Start income from the bank, increments the paid-lap count once, and records the milestone in `highestRewardedMilestone`. The logged `coin_transfer` has bank source, player destination and reason `start_income`; it precedes `phase_changed` from Move to Sell. Sell retains `destinationPosition`; issue #24 implements its atomic sale/empty-sale commit and Rescue Starter below. Resolve's sole skip dispatches on the destination space type and emits `space_resolved`, entering Encounter on Wild, Shop on Shop squares, the Gym flow on Gym squares and End elsewhere. Wild, Shop and [Gym](#gym-issue-55-s09) spaces work as described below; Event spaces draw and resolve a card ([Event contract](#event-draw-and-resolution-issue-162)). Ability reset is in [Ability lifecycle](#ability-lifecycle-and-windows-issue-55-s10); pushback and slowing are in [Fixed movement](#fixed-movement-slows-and-displacement-issue-55-s12). See [Game end](#game-end-issue-25) for final settlement.

The watermark is separate from `creditedLap` so forced forward movement that skipped an unpaid milestone cannot make a later paid milestone pay twice after pushback. New games initialize both to zero. Historical contract-only snapshots may omit the watermark; their paid count is used as the fallback watermark. Old executable engine stamps are rejected by setup and replay rather than silently executing new movement rules. The engine version advances as recorded in [engine/versions.ts](../engine/versions.ts); the command-log format and RNG version are unchanged.

Tests import `forceMove(state, seatIndex, delta)` directly from `engine/testing.ts`, outside the production barrel. It returns a detached snapshot changing only that seat's signed route progress, rejects unknown seats or unsafe/non-whole displacement, and never changes coins, paid count, watermark, phase, RNG or revision. It creates no action record: it is a scenario-building helper, not a replayable game action. Use a revision-zero forced scenario before `createGameLog` when testing replay; real effects will eventually use logged commands.

## Atomic Sell and Rescue Starter (issue #24)

Spec: §3.1, §4.5, §4.7 steps 1–2, §8. `sell` carries `{ pokemonInstanceIds: string[] }`, including an empty list to keep the team. Each command commits the entire phase once. Unknown, foreign or duplicate UIDs reject the whole batch with no state, revision, RNG or event change. Actor, revision and sequence checks use the existing executor boundary. A sale that would exceed the safe integer coin range is also rejected before any mutation.

Sale pricing follows [spec §4.7 step 2](SPEC-v1.0-PokeMonopoly.md#47-selling-at-start-laps-and-game-end), using the current species definition's `base` for Base Sale. The class sale bonus (issue #30 below) is added after the tired adjustment. Each sold instance emits a bank-to-owner `coin_transfer` (reason `pokemon_sale`, including zero-value rescue sales) carrying `sale: { basePrice, classBonus }`, followed by `uid_destroyed` (reason `sold`). The selected team members are removed together.

If the resulting team is empty, the same commit grants exactly one class base Starter with `origin: "rescue_starter"`, stage 0, fresh status/readiness and `tradeable: false`. It uses the configured Starter selection when a class has alternatives. Its UID derives deterministically from seat and accepted-action revision (not counting chats, see [Social window](#social-window-and-chat-messages-issue-56-s01)), with a suffix when needed to avoid any existing Pokémon/item UID or a UID destroyed in that batch. Creation emits `uid_created` after the destructions. The phase then changes to Resolve; destination resolution remains the next action. A second sale in that phase is consequently impossible. Later-phase rescue sales still pay zero and can replace the rescue only once per commit, without a coin loop.

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

Issue #150 adds the read-only `saleFacts(state, seatIndex): SalePriceFact[]` on top of `saleQuote`: for
every Pokémon on the active seat's team, in team order, `{ instanceId, salePrice, classBonusAlone,
classBonusTogether, saleValue }`, where the bonus is quoted selling it alone and selling the whole team
in one batch (§4.7), and `saleValue` (`salePrice + classBonusTogether`) is what that batch pays for it.
The browser sends it to `/api/ai/decide` as `facts.sell`, so AI seats get the same engine prices the
Sell UI shows. Same errors and no-mutation guarantee as `saleQuote`; no rule, version or save change.

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

Resolve on an Event (2, 8, 14, 17, 22) space now emits `space_resolved` and draws/resolves a card ([Event contract](#event-draw-and-resolution-issue-162)); this supersedes the C2 `effect: "none_yet"` placeholder. Start and Shop resolutions keep the event without `effect`; Gym squares resolve since #55 S09 ([Gym](#gym-issue-55-s09)). The engine version advances as recorded in [engine/versions.ts](../engine/versions.ts) because accepted commands emit the new field; prior executable versions are rejected by setup/replay. Command-log and RNG versions are unchanged.

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

`deserialize(text)` refuses another `saveVersion`, `engineVersion`, `contentVersion` or `rngVersion` before the full schema check, with a message naming both versions (for example "This save was made with engine version 0.11.0; this game runs engine version 0.19.0. Old saves cannot be loaded yet."); migrating old saves is a later issue. Any other schema failure throws `Invalid save: <path>: <message>; ...`.

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

The player accepts at most one `buy { offerId }` or `skip_shop` (`id: "skip-shop"`, always enabled); either enters End, so a second purchase or a refresh is impossible. A purchase pays the price to the bank with a player-to-bank `coin_transfer` (reason `shop_purchase`). A Ball adds one to the counted pouch. A utility item adds a secret item instance `bought:<seatIndex>:<revision>` (revision not counting chats) and emits `uid_created` after the payment. Offers are disabled with `ITEMS_FULL` / `Items full` for utility items while 4 items are held (approved §3.1 row; Balls stay buyable), otherwise with `NOT_ENOUGH_COINS` / `Not enough coins` when unaffordable; disabled offers are rejected as `illegal_action`. With 0 coins `skip_shop` is the sole choice and advances automatically. Class Shop discounts remain deferred. The engine version advances as recorded in [engine/versions.ts](../engine/versions.ts) because Resolve and Shop commands now change state; historical `0.0.0` Shop fixtures keep their illustrative `skip` choice.

## Utility items (issue #31)

Spec: §4.1, §4.2, §4.3, §4.6, Appendix A, §8. Current-version Strategy lists, before its `skip`, one `use_item` choice per held usable item: Lucky Egg as `use-item:<instanceId>` with payload `{ itemInstanceId }`, and Repel/Pickpocket once per opponent as `use-item:<instanceId>:seat-<n>` with payload `{ itemInstanceId, targetSeatIndex }`. Hostile items never list the user and ignore board distance. A held Potion uses the targeted S03 choices below; Price Shield arms protection (S07), Battle Ticket forces PvP (S08) and Sticky Web applies its slow (S12). Using an item spends the turn's `tacticalAction`, removes that instance and logs `uid_destroyed` (reason `used`) after any effect event; a Repel or Pickpocket also logs `hostile_item_used { userSeatIndex, targetSeatIndex, itemId }` just before it, seen only by the user and target (spec §4.1, §4.4); the phase stays in Strategy, so the remaining choice is `skip`. With the budget spent every item choice is disabled with `ALREADY_USED_THIS_TURN` / `Tactical action already used this turn`; otherwise a Pickpocket target with 0 coins and a Repel target with a Repel still pending are disabled with `NO_VALID_TARGET` / `Target has no coins` or `Target is already slowed`. Disabled, self-targeted and untargeted hostile uses are rejected as `illegal_action`.

- **Lucky Egg** sets `GameState.turnEffects.itemBonus = 1`; the catch item hook snapshots it into `phase.catchRoll.itemBonus`, and the [shared combat snapshot](#shared-combat-arithmetic-issue-55-s05) reads it for its owner. The next turn start clears `turnEffects`, and movement ignores it.
- **Repel** appends `'repel'` to the target's `Player.pendingSlows`. The target's next move result adds `max(1, d6 − 2)` squares, and that actual move clears its pending slows. The die value and its logged random event are unchanged.
- **Pickpocket** moves `min(5, target.coins)` from target to user with one player-to-player `coin_transfer` (reason `pickpocket`), so coins stay nonnegative and are conserved.

Both new state fields are optional and absent when no effect is active. `observe` does not project them yet. The engine version advances as recorded in [engine/versions.ts](../engine/versions.ts) because Strategy commands now change state; command-log and RNG versions are unchanged. AI item selection and the remaining items stay deferred.

`itemEffectStatus(contentItem)` ([engine/items.ts](../engine/items.ts), exported from the engine) tells screens how much of an item's Appendix A effect this engine applies, so a card never claims more: `active` for every Ball and for Lucky Egg, Repel, Pickpocket, Price Shield, Sticky Web and Battle Ticket; `partial` for Potion, which clears Tired only because combat debuffs are not tracked yet; `planned` is reserved for utility effects that have no Strategy choice or effect, and none of the current catalogue is in that category. It is a read-only classification: it draws no randomness and changes no rule or number, and its test holds it to whether Strategy offers a choice for the held item. Whoever implements one of the planned effects moves it to `active` there.

## Invariant checker (issue #14)

Spec: §1 (hard gates), §6.5, §8. `checkInvariants(before, action, result)` in [engine/invariants.ts](../engine/invariants.ts) takes the state and untrusted action passed to `applyAction` plus its result, and returns `Violation[]` (`{ invariant, message }`); an empty array means every active invariant held. It is pure, deterministic and imports only `engine/` modules. `INVARIANTS` registers every spec §8 invariant by ID with its section, the exact spec line, and `active` or `pending` status; pending invariants switch on when their rules land. Active this cycle: non-negative coins, sourced `coin_transfer` events that account for every coin change, Start income (reason `start_income`) paid only by the bank to a player, paid laps (`creditedLap`) and the rewarded-milestone watermark (`highestRewardedMilestone`) that never decrease with `creditedLap` never above the watermark, one Start income per new milestone crossed in that step with a matching `creditedLap` +1 and watermark (the §6.5 rule that a push, pull or re-crossed milestone pays nothing), payment before the Sell Phase and destination resolution only from Resolve after it, Start income only while the engine resolves the payee's own move roll (forced movement never pays), unique instance IDs across teams, items and a historical encounter's Pokémon, a logged `uid_created` or `uid_destroyed` for every team or item instance that appears or vanishes (an instance ID is created at the catch, per issue #23, so a wild encounter's Pokémon is never in the lifecycle sets), unchanged state hash after a rejected or stale action, exactly 1 Ball per catch and none per release, step replay that reproduces the logged state and events, and an unfinished game whose active seat always has an enabled choice or awaits the engine's dice result. `createInvariantChecker(applyActionFn)` builds the same checker against another engine function, which tests use to model a deliberately broken engine. `npm run sim` (issue #13) calls it after every action; see [sim/README.md](../sim/README.md). Current-version catches spend their Ball (issue #23) and pass the checker; the fixture sweep skips catch choices only in fixtures whose `engineVersion` differs from the current engine version, because historical fixtures record no catch effects and their catch spends no Ball.

## Spectator projection (issue #169)

Spec: §4.1, §4.8, §5.4, §6, §8. A watcher of a game it holds no seat in, such as one whose seats are all `controller: 'ai'`, sees the public view only: coins, positions, teams, item counts and public items, Lap, ability readiness, phase and counters. Never a Ball pouch, a secret item, a peek result, a chat, the seed, the RNG state or the Event order. A spectator is not a seat; `observe`, `legalActions`, `eventsVisibleTo` and `actionVisibleTo` still throw `RangeError` for any seat that does not exist, and none of them changed. Import the functions below from [engine/spectator.ts](../engine/spectator.ts) (re-exported by `engine/index.ts`); they are pure and return detached copies.

- `observeSpectator(state): SpectatorObservation` returns `{ public }`, the public fields of `observe` with no `own` and with attack history restricted to public PvP declarations. Hostile item/Ability attempts remain private to their actor and target, even when one is seat 0; secret shields, pending decision queries and legal Ability choices are never included. Public battle phases and public shields remain visible. Its `stateRevision` is the count of records in the spectator's feed, `GameState.stateRevision` minus `chatsSent` and `promiseRecords`, so a chat or promise record leaves no gap. A spectator submits nothing; there is no spectator `legalActions`.
- `eventsVisibleToSpectator(before, events): SeatEvent[]` keeps only events every seat may see, and none that a pair of seats shares. It drops `chat_sent` and `hostile_item_used` even in a two-seat game, where both seats are party to them, so a hostile item use shows only its already-public effects, such as Pickpocket's `coin_transfer`. It also drops every `shuffle:` `random_result`, an item's `uid_created`, and a secret item's `uid_destroyed`. It also drops Lucky Splash's `random_result` and Ball gain, hostile Ability attempts and their protection events, and secret shield arming. A hostile `ability_activated` is kept with its `targetId` removed. Public battle, displacement, readiness, non-hostile Ability and public protection events are kept. Public PvP attack attempts omit the internal global `actionSeq`, as seat events do. The filter is an allowlist: an event kind added later stays hidden from spectators until it is listed in `publicEvent`.
- `actionVisibleToSpectator(before, record, shownBefore): SeatActionRecord | null` returns the record for the spectator's feed, or `null` for a `chat`, which is absent, not redacted. The copy is numbered after the records already shown (`actionSeq = shownBefore + 1`, `stateRevisionBefore = shownBefore`), so a hidden chat leaves no gap in sequence or revision, and a game where a chat was skipped gives an identical feed. Its payload drops `buy.offerId`, a secret `use_item.itemInstanceId`, every `use_item.targetSeatIndex`, `shuffle.order`, `event_draw.eventId`, hostile Ability targets and Lucky Splash's `dice_result.value`; the `auto` flag is dropped in a Social window, as for a seat. Raw records and logs still never go to a watcher: this copy is the only form it may receive.

`resume(game).waitingFor` and the invariant checker read configured seats, not controllers, so a save with no human seat resumes unchanged: `waitingFor` is `finished`, an `engine_result`, or a `decision` naming the active AI seat. `sim` is unchanged.

**Table talk (`ai_speech`).** `aiSpeechEventSchema` describes one generated line: `speakerSeatIndex`, optional `addressedSeatIndex`, `source` (`haiku` or `bank`), optional `lineId`, `text` (1 to 280 characters, the chat free-text limit) and `globalTurnNo`. It is a presentation event, not an `EngineEvent`: it may appear only in `GameLog.dialogueEvents`, and an `ActionRecord`, a fixture log or any other place rejects it. The speaker and addressee must be configured seats and differ. It is not an action, spends no budget and changes neither state nor revision; command replay ignores it, so a log reaches the same state hash with or without it, and `serialize` and `deserialize` keep it. Public table talk is not filtered per seat; engine chats stay private (§4.8).

**Hidden-information test (issue #169):** [engine/spectator.test.ts](../engine/spectator.test.ts) plays 25 seeded all-AI games of 2, 3 and 4 seats with sentinel secrets in every seat: secret items, Ball pouches, peek results, a chat record and the Event deck, plus a sentinel seed and the real RNG state. Across 1,500 sampled states and every accepted action, no spectator view, event or record contains a sentinel, an `own`, `balls`, `chats` or RNG key, a shuffle draw or a bought item; a twin state differing only in its secrets gives an identical view.

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

Content registers Rival's `combat_bonus` passive; the engine supplies +1 for PvP attack and
defence only, never at a Gym (spec Appendix C D14), without granting the later once-per-Lap forced challenge. Lucky Egg's existing
Strategy use/cost/expiry stays in the item executor and turn driver; its turn effect now
feeds combat as well as catching and never benefits a different seat. Rescue Starter teams
retain trainer passives pending S00, matching S01's unresolved-interpretation boundary.
S00 still decides the activation/confirmation sequence. This slice exposes no late modifier
or reroll operation: S11's approved Porygon path must preserve the confirmed snapshot while
replacing only the permitted own die. It adds no primitive names or Ability bindings.

Engine/content stamps advance to 0.16.0/1.2.0 for the new combat contract and registered
passive; prior executable saves/logs reject through the existing version checks. Historical
illustrative fixtures, RNG version and command-log format are unchanged. PvP/Gym phases,
rewards, Gym entry choice and UI/AI integration belong to later slices.

## Ability and battle timing contract (issue #55 S00)

Spec: §4.2, §4.4–§4.6, §6.1, §8, Appendix A timing, Appendix C. [Spec Appendix C](SPEC-v1.0-PokeMonopoly.md#appendix-c--ability-and-battle-timing-contract) is the contract that the Ability, combat, Gym and protection slices (S05–S14) implement: the core Starter Ability to primitive-operation mapping, the timing windows, the PvP and Gym decision order, activation costs, shields, slows and the worked acceptance cases AC-1 to AC-5. Its decisions D1–D14 are approved (D1–D13 in the S00 review, D14 recorded at the reviewer's suggestion). The sections below record each slice's implementation.

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

## Voluntary PvP and decision ownership (issue #55 S06)

Spec: §4.2, §4.4, §4.8 (attack evidence), §6.1/6.3/6.4/6.8/6.9, §8;
Appendix C.3 D3/D4. S06 implements that order for voluntary challenges; later #55 slices add
protection (S07), forced sources (S08), Ability windows (S10) and rerolls (S11).

In Strategy, `declare_pvp { targetSeatIndex }` is legal against any other seat at any
board distance if both teams have a non-Tired member and the challenger has a tactical
action. Declaration spends that action immediately, leaving other budgets untouched.
It appends one public `attack_attempt` to `attackHistory` and the accepted action events:
`{ attackId, actorId, targetId, source: 'pvp_declaration', actionSeq, globalTurnNo }`.
The stable attack/battle/reward ID is `pvp:<public revision>`, where the public revision is
`publicRevision` after the declaration: the accepted-record count without chats (§6.3), so a
chat a seat was not part of never shifts an ID that seat sees. `actionSeq` is the global
sequence of the declaring record. It is engine-internal: it counts hidden chats, so
`observe(...).public.attackHistory` and seat-visible event copies (`SeatEvent`) drop it. The
canonical evidence survives declines and ties; later `no_attack` consumers need not infer
attacks from dice, coin transfers or final outcomes. Observations and seat-visible event copies
expose public declarations; no private item or willingness state is added. This slice adds no promises.

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
when a ready eligible Ability exists; S10 opens them in attacker-then-defender order, and
without one the windows close without extra prompts. S05's `pvpSnapshot` then freezes all
combat terms.
The pending phase retains the confirmation and then the attacker's face. The engine draws
one die per accepted `dice_result`, attacker first, with purposes
`<battleId>:attacker_roll` and `<battleId>:defender_roll`.
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

The engine stamp advances to 0.17.0, one step beyond S05's 0.16.0.
Historical illustrative fixtures and RNG/log/save format versions remain unchanged.
The browser event formatter only recognizes the new event variants for type compatibility;
PvP UI and AI integration are outside this slice.


### Known limitation / follow-up for Stream B

AI seats temporarily do not declare PvP; the Jev Strategy filter, fallback penalty and
removal condition are specified in [spec §5.3](SPEC-v1.0-PokeMonopoly.md#53-decision-points--questions).

## Price Shield and Nurse Joy protection (issue #55 S07)

Spec: §4.4, §4.6, §4.8 (attack evidence only), §6.1, §8; Appendix A Nurse Joy/Price Shield;
Appendix C.4 D6/D7 and D10 (approved in the S00 review).

`player.armedShield` holds at most one `{ scope, visibility }`: `price` (Price Shield) or
`battle_coin_loss` (Shell Guard, S14). Using Price Shield in Strategy spends the tactical
action, destroys the item UID and emits `shield_armed`; it is disabled with "A shield is already
armed" while any shield is armed. `engine/protection.ts` owns the shared hooks:

- `declareHostileAction` records one `attack_attempt` (`source: 'hostile_item' | 'hostile_ability'`,
  `attackId` `hostile:<public revision>` or `ability:<public revision>`), then, against an armed `price`
  shield, consumes it, emits `protection_applied` and reports the whole action blocked. The
  caller keeps every cost spent and applies no effect.
- `applyCoinLossProtection` handles a coin loss of `pvp_coin_loss` or `gym_coin_loss`. Nurse
  Joy's class passive (`turn_start_team_heal`) covers PvP losses first and consumes nothing; then
  `battle_coin_loss` covers PvP and Gym, and `price` covers PvP only. A zero-coin loss consumes
  nothing. PvP's `choose_reward { kind: 'coins' }` applies it before S04's resolver and sets the
  request's `coinLossBlocked`, so a protected loser pays 0 and the winner receives 0.

Visibility: hostile item attempts and their `protection_applied` are filtered to user and target in
`eventsVisibleTo` and in `observe().public.attackHistory`; PvP declarations and coin-loss blocks
stay public. A secret shield's `shield_armed` is the owner's alone and `observe` shows another
seat's `armedShield` only when public; `own.armedShield` always shows the seat's own shield.

## Forced PvP (issue #55 S08)

Spec: §4.2, §4.4 (forced PvP, attack counting), §4.6 (Battle Ticket), §8; Appendix A Rival/Battle
Ticket; Appendix C.1 `forceChallenge`, C.3 D4, C.4 D6.

`pvpDisabledReason` is the one legality check for every PvP source: an unspent tactical action
and a battle-ready member on both teams. A forced battle has `battle.forced: true` and starts at
confirmation, skipping `respond_pvp`; the phase never names its source, so a secret Battle
Ticket stays secret from third seats.

- **Rival:** `declare_pvp { targetSeatIndex, force: 'rival' }` (choice ID
  `declare-pvp:<seat>:rival`) is offered while `forcePvpUsedLap !== creditedLap`, records a public
  `pvp_declaration` attempt and sets `forcePvpUsedLap`. A shield protects only the coin loss.
- **Battle Ticket:** `use_item` with a target seat; it emits `hostile_item_used` and one private
  `hostile_item` attempt. An armed Price Shield blocks it whole; otherwise the ticket UID is
  destroyed and the forced battle begins.
- **forcePvP Ability:** `forceChallenge(next, attacker, defender)` in `engine/pvp.ts` is the
  adapter an Ability activation calls (S10/S14). It records a `hostile_ability` attempt, spends the
  tactical action, and begins the forced battle unless a Price Shield blocks it.

## Gym (issue #55 S09)

Spec: §4.2 Resolve, §4.4 Gym/Battle Reward, §4.7 winner, §6.1, §8; Appendix C.3 D5, C.4 D7, D14.

Resolving a Gym square replaces the C2 `none_yet` placeholder with phase
`{ kind: 'gym', battle: { battleId: 'gym:<public revision>', position, step } }`; Event squares now draw and resolve cards (#162); they previously stayed
placeholders. Steps:

1. `entry` — the active seat chooses `challenge_gym` or `skip` (to End). Without a battle-ready
   member the challenge is disabled with "No battle-ready Pokémon" and the automatic driver
   applies the single `skip`.
2. `roll` — `gym_confirmed` carries S05's `gymSnapshot` (DC 5/7/9 by square; no Rival bonus). The
   engine owes one `dice_result` with purpose `gym:<revision>:challenger_roll`.
3. Win (`total >= dc`): `gym_resolved`, `badge_awarded` (badges +1), then step `reward`, where the
   winner owns `choose_reward` over S04's Gym request (6 coins from the bank or one evolution).
   Loss: `gym_resolved`, then `min(3, coins)` to the bank (`coin_transfer` reason `gym_loss`),
   unless `applyCoinLossProtection` finds an armed `battle_coin_loss` shield. Price Shield and
   Nurse Joy cover only PvP.

Every step serializes; the phase then returns to End. Reward choice IDs are shared with PvP via
`pendingRewardChoices`. A Gym reached after a Start-crossing Sell resolves only after that Sell and
any Rescue Starter, so it uses the resulting team.

## Ability lifecycle and windows (issue #55 S10)

Spec: §4.2, §4.4 snapshots, §4.5, §4.7 step 1, §6.1/6.4/6.8/6.9, §8; Appendix C.1, C.3 D3/D4/D5,
C.6 D10.

Content binds a species' Ability to an engine effect with `ability.effect` (an
`abilityEffectIdSchema` value); fallback evolved forms inherit it through `effectiveForm`.
`ABILITY_EFFECTS` in `engine/abilities.ts` owns each effect's primitive, operation, timing and
hostility. Content 1.3.0 binds Chansey `heal_pulse` and Squirtle `shell_guard`; later slices bind
the rest.

Windows (`currentWindow`): Strategy (S and C timings, active seat), Encounter before a Ball is
confirmed (B, active seat), PvP `attacker_window` (B) then `defender_window` (B or R), and the Gym
`window` (B). A battle window is entered only when its owner has an eligible activation; otherwise
the engine continues to the snapshot. `pendingDecision` names the window owner, and its choices are
the `activate_ability` options plus `pass-window` (`skip`), which spends nothing. One activation or
a pass closes that window; windows never reopen.

`activate_ability { instanceId, targetSeatIndex?, targetPokemonInstanceId?, scope? }` is legal only
when listed. It sets the instance's `abilityReady = false`, sets `abilityUsedGlobalTurnNo`, spends
`pokemonAbility` only when the owner is the active seat, and emits `ability_activated`. Costs stay
spent whatever the effect does. `heal_pulse` clears the chosen own UID's Tired; `shell_guard` arms a
public `battle_coin_loss` shield (illegal while any shield is armed).

A qualifying owner Start credit emits `abilities_reset` after the income transfer and before the
Sell phase change; the player's per-`globalTurnNo` allowance is untouched. The
`ability-once-per-instance-per-lap` and `ability-once-per-player-turn` invariant checkers are
active; `evolution-keeps-cooldowns` still guards evolution.

### Disabled Ability reasons (issue #136)

Spec: §3.1, §4.5, Appendix C.3, D7, D10. `legalActions` lists, beside the enabled `activate_ability`
choices, every bound Ability on the seat's team that is not usable in its current window, as a
`disabled` entry with the same stable ID the enabled form would have and a `reasonCode` /
English `reasonText` (`abilityDisabled` in `engine/abilities.ts`). It is report-only: it lists
nothing `abilityChoices` lists, applies no rule, and a disabled entry still rejects as
`illegal_action`. Only the deciding seat gets entries, and only for its own team. The first reason
that applies wins, in this order:

| Reason | `reasonCode` | When |
|---|---|---|
| Instance used this Lap | `ABILITY_USED_THIS_LAP` | the instance's `abilityReady` is false; Start makes it ready again, evolution does not |
| Player used this turn | `ABILITY_USED_THIS_GLOBAL_TURN` | the player's allowance for this `globalTurnNo` is spent, or the active player has no `pokemonAbility` |
| Wrong timing | `ABILITY_WRONG_TIMING` | the window does not cover the effect's timing, or a battle-only effect is offered outside a battle |
| Tactical action | `ALREADY_USED_THIS_TURN` | Challenge (`forcePvP`) with no `tacticalAction`, as `pvpDisabledReason` words it |
| No valid target | `NO_VALID_TARGET` | no legal target: a slowed String Shot target (as the item rules word it), a target team with no battle-ready Pokémon, no status to heal, an armed shield, no Event card, Intimidate at a Gym |

Targeted effects (Vine Pull, String Shot, Challenge) list one disabled entry per blocked
opponent, so one blocked target never hides the others. An Ability whose content has no `effect`
is not listed; content marks it planned. `abilityCosts(effect)` reports whether activating it also
spends the tactical action (only `forcePvP` does). The visibility rules above are unchanged: as for
items, a String Shot target's pending slow already shows in which targets the engine lists (#192).

## Roll modifiers and Porygon's reroll (issue #55 S11)

Spec: §4.3, §4.4, §4.5, §6.1/6.8, §8; Appendix C.1 `rollBonus`, C.2, C.3, D2, D11, D13.

Content 1.3.0 also binds Charmander `blaze`, Eevee `adaptability`, Gyarados `intimidate`, Porygon
`calculate` and Dratini `dragon_rush`; evolved fallback forms inherit them.

- Battle-scoped terms live in the pending battle's `modifiers` (`{ abilityBonus, debuffs }` per
  PvP side, or one set at a Gym) and are frozen into the snapshot at confirmation. Blaze is
  `abilityBonus +1`, Dragon Rush `+2` plus an `afterResolution` entry, Intimidate adds `debuffs 1`
  to the opponent after `declareHostileAction` (a `hostile_ability` attempt; a Price Shield blocks
  it). Intimidate is offered only in PvP windows; Blaze and Dragon Rush only in battle windows.
- Adaptability records `player.rollEffects` `{ scope, n: 1, globalTurnNo }`; combat snapshots
  (`sideModifiers`) and `catchSnapshot` add the entries for the current `globalTurnNo`, so
  `catchOdds`, `pvpOdds` and `gymOdds` agree with the real roll. It is offered in every B window,
  with both scopes.
- `afterResolution` entries apply `status_changed` Tired (reason `dragon_rush`) when the battle
  leaves: after a tie, a Gym loss, or the reward, attacker's first.

Porygon's A window (`calculate`) opens only when the die's owner has an eligible ready Calculate:

| Die | Pending decision | Keep | Reroll die purpose |
|---|---|---|---|
| Move | `move { rolled }` | `keep-die` moves by `rolled` | `move:<seat>:<turn>:reroll` |
| Catch | `encounter { catchRoll, face }` | `keep-die` resolves `face` | `catch:<seat>:<turn>:reroll` |
| PvP | `battle.step: 'reroll'`, `side` | `keep-die` | `<battleId>:<side>_reroll` |
| Gym | `battle.step: 'reroll'`, `face` | `keep-die` | `<battleId>:challenger_reroll` |

Rerolling is `activate_ability` on the Calculate instance and spends its normal costs; the new
logged die replaces the old one, even when worse, and no Ball, catch budget or first-catch bonus is
spent again. In PvP the attacker's window comes before the defender's, both after both dice. No
outcome, reward, slow or movement applies before the decision. Start income may therefore be paid
by the keep-die command too; `forced-movement-no-start-income` treats any accepted Move-phase
command of the active seat as its own move.

## Fixed movement, slows and displacement (issue #55 S12)

Spec: §4.2 movement, §4.5, §4.6 slows, §4.7, §6.1/6.5, §8; Appendix C.1 `fixedMove`/`moveDebuff`,
C.5 D8/D9.

`engine/slows.ts` owns the slow table: `repel` (`minus` 2), `string_shot` (`minus` 1) and
`sticky_web` (`cap` 2). `player.pendingSlows` holds their IDs; `hasSlowKind` forbids a second slow
of a pending kind (items are greyed out with "Target is already slowed"; String Shot is not offered
against such a target). `slowedSteps(player, v)` returns `max(1, min(v − minus, cap))` and clears
every pending slow; only the owner's own Move calls it.

- **Sticky Web** is a hostile item like Repel: a private `hostile_item` attempt, blocked whole by an
  armed Price Shield.
- **Quick Flight** (`quick_flight`, S window) sets `turnEffects.fixedMove = 3`. Move's `roll` then
  draws no die and moves by the slowed fixed steps through the same owner-movement path, so a
  qualifying Start credit pays once, resets Abilities and opens Sell before the destination. The
  allowance for the `globalTurnNo` stays spent even when the reset makes the instance ready again.
- **Vine Pull** (`vine_pull`) and **String Shot** (`string_shot`) are hostile Abilities against any
  opponent: `declareHostileAction` records the attempt and a Price Shield blocks the effect. Vine
  Pull changes the target's `routeProgress` by −2 at once and emits public `player_displaced`
  `{ targetId, from, to }`; no income, Lap credit, Ability reset, Sell or Resolve follows, and pending
  slows stay. Progress may go below 0; recrossing an old milestone pays nothing (§6.5).

The use of a hostile Ability is public (spec §4.1, Appendix C.3, #192): every seat and a spectator
gets `ability_activated`, with `targetId` removed for any seat that is neither user nor target, and the
user's spent readiness is public as before. Its `attack_attempt` and any `protection_applied` are
visible only to the user and target, and another seat's copy of the `activate_ability` record drops
`targetSeatIndex`. A blocked String Shot or Intimidate therefore looks the same to a third seat as an
unblocked one; Vine Pull's public `player_displaced` still shows that it was not blocked, since
positions are public. The `move-debuff-until-next-move` checker is active: a
pending slow may disappear only on its owner's actual move, and that move clears all of them.
`forced-movement-no-start-income` counts a fixed-move `roll` as the owner's own move.

## gainBall, peek and the Event deck (issue #55 S13)

Spec: §4.5 primitives, §4.6 deck, §5.4 privacy, §6.1/6.8, §8; Appendix C.1 `gainBall`/`peek`.

- **Lucky Splash** (`lucky_splash`, S window; content binds Magikarp) enters phase
  `{ kind: 'chance_roll', rollId: 'ability:<public revision>', seatIndex }`. The engine owes one
  `dice_result` with purpose `<rollId>:chance`; faces 5–6 add one Great Ball and emit
  `ball_gained` (visible only to the owner), 1–4 change nothing. The die reveals the gain, so
  `eventsVisibleTo` hides its `random_result` and `actionVisibleTo` drops its `dice_result.value`
  for every seat but the owner; other seats still see the public `ability_activated`. The log
  and replay keep the full record. Either way the phase returns to
  Strategy and the activation costs stay spent. With the allowance spent, Porygon cannot reroll it.
- **Event deck:** `content.events` (IDs only; `toEngineContent` drops the text) is optional for
  historical fixtures. `createGame` still leaves the deck empty and draws no RNG. `track` (the
  `peek` adapter) is offered when the draw pile, discard pile or content has cards. With an empty
  draw pile it first shuffles the discard pile (or every content Event when there is none) through
  the logged `shuffle:events` RNG seam, whose results no seat sees. It then appends
  `{ kind: 'peek', eventId }` to the owner's `privateResults` without drawing or reordering.
  Other seats' observations, legal actions, event copies and action records never carry the card
  or the order from a peek. Event squares now use this same deck for the draws and effects below.

## Core Starter bindings and primitive coverage (issue #55 S14)

Spec: §4.4, §4.5, §6.1, §8; Appendix A core classes/Abilities/evolution; Appendix C.1/C.2.

Content 1.3.0 binds `ability.effect` for Bulbasaur `vine_pull`, Charmander `blaze`, Squirtle
`shell_guard`, Eevee `adaptability`, Magikarp `lucky_splash`, Gyarados `intimidate`, Chansey
`heal_pulse`, Caterpie `string_shot`, Porygon `calculate`, Pidgey `quick_flight` and Dratini
`dragon_rush`. Fallback forms (Ivysaur/Venusaur, Charmeleon/Charizard, Wartortle/Blastoise,
Vaporeon/Jolteon/Flareon, Metapod/Butterfree, Dragonair/Dragonite) inherit through
`effectiveForm`; Gyarados has its own definition, so Magikarp's evolution changes the Ability but
keeps the spent readiness. `challenge` (forcePvP: a forced, hostile PvP declaration that also
spends the tactical action) and `track` (peek) are executable but unbound; C4 content binds them.

`engine/starter-abilities.test.ts` is the coverage ledger: a table reaches each form's legal window
(S, B attacker, R defender or A reroll) and checks an observable effect, the effect table maps to
exactly the eight §4.5 primitives with every one exercised, authored timings equal the engine's,
and an actually caught Dratini becomes Tired after Dragon Rush (not battle-ready, ×0.8 sale) and
recovers by expiry or Potion (Nurse Joy and Chansey recovery are covered in the S03/S10 tests).

## Mixed-seat completion and Streams B/C handoff (issue #55 S15)

Spec: §4.2 social window, §4.4 attack counting, §4.8 evidence only, §5.2/5.3/5.6,
§6.1/6.4/6.9, §8.

- `decisionPoint(state)` names the pending decision: `first_player_roll`, `turn_step`, `strategy`,
  `move`, `encounter`, `sell`, `shop`, `pvp_response`, `ability_window`, `reroll`, `reward` or
  `gym_entry`; `null` while the engine owes a die or the game is over. It complements
  `pendingDecision`, which names the deciding seat.
- `socialTargets(state)` lists the opponents a human seat may talk to in its own Social phase and
  is empty for AI seats, so there is no AI↔AI conversation. Leaving Social spends no budget.
- `sim/mixed-seats.test.ts` plays one scripted human with 1, 2 and 3 AI seats to the end. At every
  new decision point an AI answer is first injected as a timeout, error, invalid or stale command
  (each leaves the state hash unchanged), then `FallbackPolicy` answers from the engine's options.
  Games end with equal own turns, the coin/badge winner rule and an exact replay. A four-seat test
  records a declined PvP and a hostile item for all 12 ordered pairs: declarations are public,
  hostile item attempts reach only user and target.

Not yet integrated (Streams B/C): the decision wire schema (`engine/contract/decision.ts`) still
accepts only `strategy`, `encounter` and `sell`; Jev Strategy and Encounter questions filter out
`declare_pvp` and `activate_ability`; the fallback policy scores both −1 in Strategy and scores
other new points evenly. The browser lists the human's choices at the new points in a generic
panel, and for an AI seat takes the engine's first listed choice, logged as a fallback with reason
`unsupported_decision_point`. The Shop still offers only Lucky Egg, Repel and Pickpocket (§4.6 C2
scope), so Battle Ticket and bought Price Shields or Sticky Webs are not yet reachable in play.

## Invariant ledger and the 2/3/4-seat gate (issue #55 S16)

Spec: §6.1/6.8/6.9, §7 CI, §8.

Every §8 checker owned by this epic is active, each with a counterexample test:
`pvp-turn-ownership` and `attack-attempt-logged` (S06; hostile items and Abilities S07–S14),
`battle-reward-coins-or-evolution`, `evolution-one-stage-same-uid`, `evolution-keeps-cooldowns`
(S04; a status change logged with the evolution is allowed), `tired-and-nurse-joy-useful` (S03),
`ability-once-per-instance-per-lap` and `ability-once-per-player-turn` (S10),
`move-debuff-until-next-move` (S12), and from S16 `resume-creates-nothing` (the RNG cursor advances
exactly by the action's logged, consecutively numbered draws, and a saved copy re-asks the same
seat) and `rescue-starter-no-coin-loop` (a Rescue Starter never sells for coins, is never resold in
the phase that created it and stays untradeable). `deals-atomic` and `promise-closes-on-own-turn`
stay pending: they belong to the conversation and deal work, not this epic.

CI runs `npm run sim -- --games 100 --seed 1` at `--seats 2`, `3` and `4`, each checking every
active invariant after every action and failing on any abort, illegal applied action or invariant
failure (job timeout 15 minutes). The sim summary's `features` counts Ability primitives, class
passives and battles; `sim/features.test.ts` requires all six core class passives, the five Ability
primitives real content reaches in random play (`fixedMove`, `moveDebuff`, `rollBonus`, `shield`,
`gainBall`) and PvP, forced PvP and Gym battles. `heal` (rare in random play), `peek` and `forcePvP`
(unbound until C4) have their trigger evidence in the engine scenario tables. Replay and resume at
pending decisions are covered per slice (S06 PvP steps, S10 defender window, S11 rerolls, S13
peek) and by the 200-game replay property test.

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

**What the engine stores.** `GameState.chats` holds the last 3 messages per unordered pair (`seats` low to high), each `{ fromSeatIndex, toSeatIndex, topic, leaderSeatIndex?, itemId?, globalTurnNo }`. The key is absent until a first message. `GameState.chatsSent` counts accepted chats (absent until a first one). An accepted chat emits one `chat_sent` event and changes nothing else.

**The hard line (§4.8).** A chat changes no coins, teams, items, Balls, RNG, dice, phase or legality: the only differences between the states before and after are `chats`, `turnBudgets.socialInteraction`, `stateRevision`, `chatsSent` and the bystanders' `unseenRecords`, and the legal set shrinks only by the chat choices. Asking about an item cannot reveal a holding: the item choices come from content, so `legalActions`, events and state do not depend on what the target holds.

**Visibility.** The recipient of a chat is private (spec owner decision, #143). `observe(state, seat).own.chats` lists only the messages that seat sent or received (oldest first; present only when the flag is on). `chat_sent` reaches only its sender and recipient. For every other seat `actionVisibleTo` returns `null`: the record is absent from its feed, not redacted. Redaction would still show the speaker and that a chat happened, and in a three-seat game "a chat happened and it was not to me" names the recipient. The seat-facing feed also renumbers: `actionSeq` and `stateRevisionBefore` count the seat's own visible records, so skipping the chat leaves no gap, and a bystander's feed is identical whether the speaker chatted to someone else or skipped. For the same reason, while the window is on, another seat's Social-window record reaches a seat without its `auto` marker, since a sole-choice Skip would show that the chat budget was spent. The full record stays in the engine's replay log and saves, which are never sent to a seat. The observed revision is seat-relative too: `observe(state, seat).public.stateRevision` is the global `stateRevision` minus the records that seat may not see (`Player.unseenRecords`, raised for every seat outside an accepted chat; absent when zero), so it always equals the length of the seat's feed and a bystander's observation is identical whether the speaker chatted elsewhere or skipped. `applyAction` checks a seat's `stateRevisionBefore` and `actionSeq` against that seat's observed revision (`actorRevision` in [engine/visibility.ts](../engine/visibility.ts)): a hidden chat between other seats does not make its answer stale, while any record it can see still does. Engine-generated records, and every seat that has missed nothing, use the global revision, so flag-off games are numbered exactly as before. Every engine ID a seat can observe that embeds a revision uses the revision without chats (`publicRevision` in [engine/revision.ts](../engine/revision.ts)), never `GameState.stateRevision`: instance IDs (`caught:`, `rescue:`, `bought:`), PvP and Gym `battleId`s (`pvp:`, `gym:`) and the dice purposes built on them, the Lucky Splash `rollId` and hostile `attackId`s (`hostile:`, `ability:`). A later catch, purchase, battle, roll or attack therefore does not reveal a chat either ([engine/hidden-chat-ids.test.ts](../engine/hidden-chat-ids.test.ts)). An `attack_attempt`'s `actionSeq` stays global and engine-internal; seats never receive it. Consumers submit exactly the revision they observed; the logged record keeps the numbers its actor submitted, and `GameState.stateRevision` still counts every accepted record, so replay, saves and determinism are unchanged. Nothing about chat reaches `ai/` until stream B's slices read `own.chats` through `observe`.

**Versioning.** This slice advanced the stamp to 0.16.0 because the action union, events, state and observation gain fields; issue #55 S05 claimed the same 0.16.0 in parallel, so the merged engine is stamped 0.17.0 and refuses saves of 0.16.0 and earlier rather than migrating them. Chats round-trip through saves and command replay. Tests: [engine/social.test.ts](../engine/social.test.ts).

## Event draw and resolution (issue #162)

Spec: §3.1, §4.1, §4.4, §4.6, §5.4, §6, §8. Event landings use the existing Resolve `skip` command, normally applied by `advanceAutomatically` as its sole enabled choice. The engine atomically draws, discards and resolves one card in that accepted record. No browser or AI decision is needed for the draw itself, and there is no new Event decision point.

The accepted record emits, in order:

1. `space_resolved { seatIndex, position }`, without the old `none_yet` effect.
2. When the draw pile is empty, counted `random_result` events with purpose `shuffle:events`, followed by `event_deck_shuffled { cardCount }`. The shuffle uses the discard pile, or all six content IDs for the first use. `cardCount` is public; shuffle choices and order are private to the engine. Track uses this same refill seam without drawing.
3. `event_drawn { seatIndex, eventId }`, public to every seat and spectator. The top ID moves from `drawPile` to `discardPile` once.
4. The effect's records listed below, then one public `event_resolved { seatIndex, eventId, result }`.
5. `phase_changed { from: 'resolve', to: 'encounter' | 'end' }`. e1 opens Encounter; all other cards enter End.

These are `EngineEvent` entries inside the accepted action record, including every shuffle and draw; they do not create additional action sequence numbers. Historical standalone `shuffle` and `event_draw` action shapes remain in the contract seam, but the browser should drive Event landings through Resolve, rather than submit those shapes.

| Card | `event_resolved.result` | Effect records and behavior |
| --- | --- | --- |
| e1 | `{ kind: 'encounter', speciesId }` | Normal counted `encounter:rarity` and `encounter:species` draws; the existing Encounter catch/release choices use the remaining `catchAttempt` and Ball pouch. Drawing grants neither a Ball nor a budget. Catching and its eventual result remain in the existing catch records. |
| e2 | `{ kind: 'coins', transfers: [{ seatIndex, amount: 6 }] }` | Bank-to-owner `coin_transfer`, amount 6, reason `event:e2`. |
| e3 | `{ kind: 'coins', transfers: [{ seatIndex, amount }] }` | Owner-to-bank `coin_transfer`, amount `min(4, coins)`, reason `event:e3`. The summary's amount is the signed coin delta, so a payment is negative (zero when broke). Event payments do not consume battle/hostile shields. |
| e4 | `{ kind: 'item' }` | With room, uniform selection over every utility item in content (in content order), one counted `event:e4:item` random result, `uid_created`, then `item_gained { ownerId, item }`. The item has secret visibility and UID `event-item:<seatIndex>:<public revision>` (excluding hidden chats). With 4 items, no selection RNG or UID is consumed; add one Poké Ball and emit `ball_gained`. The selection, item UID/identity and Ball reward are visible only to the recipient. |
| e5 | `{ kind: 'tired', instanceId: string | null }` | Highest current-form printed battle across the whole team, ascending UID for ties; `status_changed` with reason `event:e5` uses the existing apply/reapply expiry. Tired members are eligible. Empty team: null target, no status record. |
| e6 | `{ kind: 'coins', transfers: [{ seatIndex, amount }, ...] }` | Snapshot all poorest seats before any payment. Each gets `floor(5 / count)` from the bank, logged separately with reason `event:e6`, in seat order. The remainder is unawarded. |

`GameState.lastEvent` retains the public `{ seatIndex, eventId, result }` summary until the next Event and appears as `observe(...).public.lastEvent` and in the spectator's public view. e4 additionally stores `GameState.lastEventReward`: `{ kind: 'item', item: ItemInstance }` or `{ kind: 'ball', ballType: 'poke' }`. Only its recipient receives `observe(...).own.lastEventReward`; the next Event clears/replaces it. Use this owner-only field for the exact reward in the future Event card (#156). No observation includes either deck pile, seed or RNG. The AI state builder still projects its allowlist and gains no Event question.

Engine content with an explicit Event catalogue must contain e1–e6 exactly once; historical contract content that omits the catalogue uses those six core IDs. Revision zero remains RNG cursor zero. Engine version 0.19.0 rejects earlier executable logs/saves rather than replaying Event no-ops with new effects; 0.18.0 was claimed by the promise-response slice in parallel. Command-log, save, content and RNG version formats remain unchanged. Draws, effects, private rewards and pile order round-trip through save/resume and verified replay. The sim summary adds `events.drawn`, `events.resolved` (counts by card ID), and `events.shuffles`; its readable output prints the same evidence.

Tests: [engine/events.test.ts](../engine/events.test.ts) covers each rule and seat/spectator visibility; [ai/event-visibility.test.ts](../ai/event-visibility.test.ts) checks every seat’s AI state projection; [sim/events.test.ts](../sim/events.test.ts) exercises all six cards, exhaustion, zero illegal actions/invariant failures, and save/resume/replay with the same final hash. The browser Event card (#156), new cards and Jev Event questions remain follow-ups.

## Promise responses as pending decisions (issue #56 S03)

Spec: §4.2, §4.8 Promise, §6, §8. This builds on the pending-decision ownership of "Voluntary PvP and decision ownership" (issue #55 S06, shipped in #152); there is no second mechanism. Stream A's PvP and Deal Cards (S05) add their own response kinds the same way.

### How a promise response registers

`GameState.pendingResponse` is optional and absent unless a seat owes an answer to a question another seat asked. It is a discriminated union on `kind`; today there is one, `promise_offer { initiatorSeatIndex, responderSeatIndex, direction }`. `initiatorSeatIndex` is the seat whose turn it is (it stays `activeSeatIndex` throughout); `responderSeatIndex` owes the next command.

`pendingDecision(state)` ([engine/decisions.ts](../engine/decisions.ts)) is extended by one line: while `pendingResponse` exists it returns the responder instead of the active seat (it still returns `null` for a pending engine die or a finished game, and a promise question cannot coexist with a PvP phase, since it is asked only in Social). Everything #152 already routes through it follows, with no further change:

| Place | Behaviour while a promise question is pending |
| --- | --- |
| `applyAction` | Only the responder's actor is accepted. Anyone else, the active seat included, is rejected as `wrong_actor` with the state untouched. The responder's command must be in its enabled set, else `illegal_action`. |
| `legalActions(state, seat)` | The responder gets exactly `respond:accept` and `respond:reject` (command `respond`, payload `{ answer: 'accept' \| 'reject' }`). Every other seat has no enabled choice and the usual disabled `skip` (`NOT_YOUR_TURN`). |
| `advanceAutomatically` | Asks `pendingDecision`. It never answers for a responder: a response has two choices, so it is a decision, not an automatic step. |
| `resume(...).waitingFor` | `{ kind: 'decision', seatIndex, actorId, phase, legalActions }` of the responder; `phase` is still the turn's phase (`social`). A reload re-asks the same question from the saved state. |
| Invariant `game-can-finish` | "An unfinished game always has a seat with an enabled choice" checks the pending decision's seat. |
| Sim runner and `sim/legal-games.ts` | Decide, and probe foreign actors, for the pending decision's seat. |

`respond` is accepted only when a question is pending; otherwise it is `illegal_action`. The answer clears the record in the same accepted action, so a state never holds a stale one, and replay applies the same records in the same order: it is deterministic and `verifyReplay` passes mid-question.

### Adding a response kind

1. Add a variant to `pendingResponseSchema` in [engine/contract/schema.ts](../engine/contract/schema.ts) with the initiator, the responder and what the answer needs; bump `ENGINE_VERSION`.
2. Create the record in the initiating command (as `offerPromise` does) and give it a case in `responseChoices` ([engine/promises.ts](../engine/promises.ts)). Widen `respondPayloadSchema.answer` for a different answer set.
3. Resolve it in the `respond` branch of `applyAction` by `pendingResponse.kind`, deleting the record in the same action. Spend the turn's budgets only in the initiating or answering action, never both.
4. Extend visibility ([engine/visibility.ts](../engine/visibility.ts)) so only the parties see the events, and `observe` so only they see `own.pendingResponse`.
5. Phases do not change: the question lives beside the phase.

### The `no_attack` promise

**Offer.** With `socialWindow` on, the active human in Social with the interaction unspent may send `offer_promise { targetSeatIndex, direction }` to any **AI** seat, in either direction (Q2a):

- `offer`: "I won't attack you". The human is the promiser, the AI the recipient and the responder, who accepts or rejects.
- `ask`: "promise not to attack me". The AI is the promiser, the human the recipient; the AI agrees (`accept`) or refuses (`reject`).

Choice IDs are `offer-promise:seat-<n>:offer|ask`. The choices depend on seats, flags and promise history only, never on what any seat holds, so offering leaks no card (§4.8 Privacy). An AI seat is never offered one. The offer itself changes nothing but `pendingResponse` and the event; the turn's `socialInteraction` is spent by the **answer**, so either answer, `accept` or `reject`, uses up the interaction (a chat, too, spends it, so a chat and an offer are mutually exclusive in one turn) and neither spends `tacticalAction`. While the offer is pending nothing else can be sent (§4.2: the game pauses only inside this window).

**Accept** appends `{ promiserSeatIndex, recipientSeatIndex, createdGlobalTurnNo, closesOwnTurnNo }` to `GameState.promises` with `closesOwnTurnNo = promiser.ownTurnNo + 1`: the promise runs until the end of the promiser's next turn. **Reject** creates nothing. Both clear `pendingResponse` and emit one event: `promise_offered` (at the offer), then `promise_accepted { promiserSeatIndex, recipientSeatIndex, closesOwnTurnNo }` or `promise_rejected { promiserSeatIndex, recipientSeatIndex }`. Nothing else changes: coins, teams, items, Balls, RNG, dice, phase and legality of every other command are as before (§4.8 hard line, tested).

**Limits** (checked when the offer is listed, and so again by `applyAction`):

- *One active promise per directed pair.* A promise is active from confirmation until the end of the promiser's turn `closesOwnTurnNo`: while the promiser's `ownTurnNo` is below it, or equals it and the promiser is the active seat. The other direction of the same two seats is a different pair.
- *No renewal.* The promiser's closing turn still counts as active, so the same pair cannot be re-offered then. Once it has closed, a new promise is a fresh one, not a renewal; §4.8's "max +2 per pair per game" trust cap presumes more than one over a game. This is this slice's reading of "no renewal"; stream B's settlement slice (S07) may tighten it.
- *Not past game end.* Once `finalTableRound` is announced, nobody plays an own turn above `targetOwnTurnNo`, so a promise whose `closesOwnTurnNo` exceeds it would outlive the game and is not offered. Before the round is announced the game end is unknown, so an offer is allowed; such a promise is later `closed_by_game_end` (S07).

**Visibility.** `promise_offered` reaches only the initiator and responder, `promise_accepted` and `promise_rejected` only the promiser and recipient (the same two seats). `observe(state, seat).own.promises` lists only the promises that seat made or received (present with the flag on), and `own.pendingResponse` exists only for the initiator and the responder. For every other seat the two records are hidden exactly like a chat (§4.8, "Social window and chat messages" above): `actionVisibleTo` returns `null` for `offer_promise` and `respond` unless the seat is the initiator or the responder, so the records are absent from a bystander's feed, not redacted. Redaction would leave the responder's actor ID on the `respond` record, naming the conversation partner in a three-seat game. Each accepted record raises `Player.unseenRecords` for every seat outside the pair (`hideFromBystanders` in [engine/social.ts](../engine/social.ts), shared with chat) and `GameState.promiseRecords` (the counterpart of `chatsSent`), which `publicRevision` subtracts: a bystander's feed, `observe(...).public.stateRevision`, `actorRevision` and every engine ID that embeds a revision are identical whether the pair made a promise or the active seat skipped. Spectators never see either record. The full records, with their real numbers, stay in the replay log and saves.

**Not in this slice.** Settling promises at End, breaches, trust and memory (S07, which also activates the `promise-closes-on-own-turn` invariant), Deal Cards and the Deal response (S05), and the AI's Jev decisions for `respond` (the `ai/` layer). `GameState.promises` therefore keeps every promise, closed ones included, for S07.

**Sim.** `npm run sim -- --games <n> --seed <n> --social` plays seat 0 as a `human` with the random policy and `socialWindow` on; the other seats keep `--policy`. The summary gains `social { promiseOffers, promisesAccepted, promisesRejected }` only with the flag, so a run without it is byte-for-byte unchanged.

**Versioning.** The stamp advances to 0.18.0: the action union, events, state and observation gain fields. Saves of 0.17.0 and earlier are refused rather than migrated. Tests: [engine/promises.test.ts](../engine/promises.test.ts), the `--social` cases in [sim/sim.test.ts](../sim/sim.test.ts) and the social property in [sim/legal-games.property.test.ts](../sim/legal-games.property.test.ts).
