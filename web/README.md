# web/

Browser UI: one Vite + React + Tailwind CSS single-page app. Must not import from `ai/` (or the Jev SDK); it only calls `/api` over HTTP. Every number on screen comes from the engine.

Run with `npm run dev:web` (port 5173). Spec: §3, §3.1, §6.1. Skill: `skills/ui-rules`.

| Path                    | What it holds                                                                                                                                                                               |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/screens.ts`        | The screen state: `home`, `setup` (mode, class, AI rivals, review, first roll), `play`, `results`, `credits`. A plain value in `App`, no router.                                            |
| `src/setup/`            | The setup screens, spec §3: Home to the first-player roll.                                                                                                                                  |
| `src/board/`            | The one-screen play layout: top bar, Board with the hand under it, seat rows and the decision card router (`TurnPanel`); seat-filtered field log in the Game record (§3, §3.1, §4.2, §4.3). |
| `src/gallery/`          | Developer-only gallery of every spec §3.1 row that has a screen (below). Absent from the production build.                                                                                  |
| `src/ui/three/`         | Three.js scenes (lazy chunk); `public/models/` holds the licensed GLB models.                                                                                                               |
| `src/i18n/en.ts`        | Every player-facing string (English, spec §3), read with `t(key)`. `src/i18n/inline-text.test.ts` fails on UI text typed elsewhere.                                                         |
| `src/game/store.ts`     | Rules adapter: state and action log. Calls engine functions only from `engine/index.ts`.                                                                                                    |
| `src/game/save.ts`      | Browser storage adapter: engine `serialize` / `deserialize`, Continue, and log export.                                                                                                      |
| `src/ErrorBoundary.tsx` | No blank screens: a render error shows what to do next and a retry button.                                                                                                                  |
| `src/ui/`               | Shared controls.                                                                                                                                                                            |

Fredoka (display) and Nunito (body) are self-hosted through `@fontsource`; the page loads nothing from another host. The Home board and class art use Three.js (`@react-three/fiber`, lazily loaded where WebGL exists); the 3D models and their licences are in `public/models/CREDITS.md`. Lint enforces the import rules: no `ai/`, and engine values only through the adapters `src/game/store.ts`, `src/game/save.ts` and `src/game/content.ts` (type imports from the engine are allowed elsewhere in `web/`; adapters use only `engine/index.ts`, and test files may import the engine directly).

Component tests run in the Vitest `web` project (jsdom, Testing Library); `npm test` runs them with the rest.

## Turn flow and review fixtures

After the first-player roll, **Go to the board** starts the turn driver. The store's
`advance({ human: true })` asks the engine to apply one pending result or sole legal action;
it never chooses between multiple human actions. A brief presentation pause keeps automatic
steps readable, and their `auto` records appear as short banners and field-log entries.
First-player setup uses the same `advance({ human: true })`, so the first roll and any tied
re-rolls are applied automatically and logged with `auto: true` (spec §3.1).

The Encounter dialog shows each held Ball with the percentage returned by `oddsForAllBalls`
through the adapter, plus Release. With no Balls it shows a disabled Catch, the catalog
reason **No Ball**, and Release; the sole release also runs automatically. Native modal
focus stays inside the decision. Caught, escaped and released outcomes come from accepted
seat-filtered records, not a UI roll or success calculation.

Start income and movement come from the engine. A qualifying crossing opens **Sell Phase**:
select any number of Pokémon and confirm one atomic batch, or **Keep the whole team**.
The adapter calls `saleQuote` again on every selection change. Selected rows show their
actual batch price parts; unchecked rows explicitly show **If sold alone**, since a class
bonus can move between Pokémon as the batch changes. Tired prices and the running total
come from that engine quote, never browser arithmetic. A full-team sale previews the
zero-value Rescue Starter; after confirmation the new team comes from the next Observation.

Team cards and Sell rows resolve the current form with the engine's `effectiveForm`,
including inherited stats, tags and Ability descriptions. **Inspect [name]** opens an inline,
keyboard-operable disclosure with the public Team ID, Ability, authored next-form choices
or a final-form message. It is read-only: no evolution, Ability activation or game action
is submitted. Each UID retains its own Tired and Rescue markers. Tired members explain
that they cannot battle; Rescue details explain trading and sale-bonus restrictions.
Sale amounts remain the engine's selected-batch or solo quote. Opponent inspection uses
only the human seat's public team projection, never an opponent's inventory or private results.

**Shop** displays every engine offer and price, the engine's exact disabled reasons, and
**Leave the Shop**. Buying one unit or skipping ends the visit. **Strategy** lists the
engine's item choices, including disabled Potions; hostile targets come only from those
choices, never the user's seat. Potion lists the engine-offered own-team Pokémon by species
and full instance identity, so even duplicate species can be selected independently. No
Potion target is preselected: choose a member, inspect the healing preview, then confirm.
Refreshing the legal-action list clears the selection; engine rejections show the current
choices without spending a replacement item. Disabled items and targets retain the engine's
visible reason. Other items keep their content `effect` preview and observed target information;
the browser does not predict a Pickpocket transfer or roll outcome. All commands cross the
store adapter and `applyAction`; item and target selection alone do not spend anything.

These panels replace the earlier turn-flow placeholders without changing board rules or
opponent behavior. Previous roll/result banners stay in the field log while a decision is
open so the current choices and their confirmation remain prominent. End-of-turn steps
hand off automatically. A finished game opens the results screen: coins per player, the
engine's winner and tie reason, Play again, and Export log. A local save is written after
each accepted action. Continue restores that save and asks again for a pending AI decision;
it does not re-roll a die or start a new turn. If storage is unavailable, play continues
with a one-line notice.

Opponent single-action steps use the same engine automation. At a multi-choice step whose
engine `pendingDecision` seat is an AI (also during the human's turn, for example a PvP
defender's window or reward), `store.playOpponent(signal)` sends only that AI seat's `Observation`, enabled actions and
engine catch odds (Encounter) or engine sale prices from `saleFacts` (Sell) to `/api/ai/decide`, then reports the applied outcome, the Shop's included, to `/api/ai/outcome` and submits the returned choice or Sell batch through
`applyAction`. No opponent projection is exposed by `getView()`. Abort, replaced-game and
revision checks discard late responses; failed or invalid responses leave the decision
unchanged and show a notice with Retry.

Each accepted rival action is announced: the acting rival's square and pawn are
spotlighted in its seat colour on the board, and a "Now" strip under the board loop spells
out the current action in the same words as the field-log row (#123). Rival actions pause
for the readable AI pace; the human's own automatic steps keep a short pause of their own.
Speed (Normal, Fast, Instant) and Skip line only change presentation pauses; they never
cancel or reissue a decision, and Instant reaches the same final state as Normal for the
same seed.

Demo mode (`?demo`, issue #220) adds a "What Jev chose" panel (`board/JevChoicePanel.tsx`) under a
rival's decision in a one-human game, with a banner that says it shows the rival's private
options. Only `createGameStore({ demo: true })` keeps anything for it: the store labels the
options it sent, copies Jev's numbers from the answer's optional `detail` and puts them on the
in-memory feed entry (`game/demoChoice.ts`). With demo off, and in a watched game, the detail is
never read, so no panel, banner or probability text exists and saves, exported logs and the
requests are unchanged. `game/jevDetailAdapter.ts` is the one place that knows the field's
name and shape (`decisionDetailSchema`); the server sends it only when its `DEMO_MODE` is on and
Jev decided, so otherwise only backup-bot decisions show. `game/fakeJevAnswer.ts` is a typed fake of that answer for tests and the dev
gallery.

Prepared scenarios (`?demo`, issue #222; `?demo=0` and `?demo=false` are off) add a "Prepared scenarios"
entry to Home. `game/demoScenes.ts` lists each scene as a seed plus a short script of legal engine
actions (`{ engine: n }` applies pending dice or sole choices, `{ seat, choose }` takes an enabled
action by its ID) that `buildScene` applies through the normal store after the first-player roll;
nothing is hand-edited and no rule lives in the script. A scene opens only if its setup passes the
setup screens' own check (`openScenes`), and a build that fails, a step the engine no longer allows
or a game that ends away from its moment, shows the reason with a way back instead of a game. The
scene's name is saved in the browser beside the game (`SaveMeta.scene`), never in the exported log,
so every screen and a reload show the "Prepared scenario" banner (`DemoBanner.tsx`); without `?demo`
a saved scene game is not offered. To add a scene, search seeds with a throwaway driver until the
moment is reached in a few steps, then add its test row in `game/demoScenes.test.ts`.

Tokens use the `position` already projected by `observe()` (including negative and multi-Lap
progress). Lap counts are paid Laps completed, not a UI-computed current-Lap number. Square
labels and icons remain DOM content even without WebGL; the static meadow reuses the
credited Starter models. The read-only fixture route retains its preview note and has no
live turn driver.

The player's own row opens on their Ball pouch and items. Opponents show coins, square, completed
Laps, team and **item count only**—never item names or Ball counts. The field log accepts only
seat-filtered engine events from the store's redacted feed, not raw actions or logs. Its rows
carry stable `data-message-key` catalog keys, and never dump internal UIDs or random-draw IDs.

Open `?fixture=<filename-without-json>` in dev or the production preview, for example:

- `?fixture=start-of-game-2p`
- `?fixture=sell-phase-three-pokemon`
- `?fixture=log-short`

Every `engine/fixtures/*.json` is available; unknown names show an explanatory message.
`board-fixtures.ts` is a Vite build/dev plugin: it reads fixtures in Node and calls the store's
`projectBoardFixture` adapter. Only seat 0's observation and filtered events enter the lazy
browser module, never the fixture state, raw log, opponent pouch or secret items. Historical
fixture logs are illustrative, so events are filtered against their supplied fixture snapshot
rather than replayed. The route is not linked from the player UI.

`Board.test.tsx` checks every shipped fixture, token wrapping/shared squares, content battle
values and tags, plus sentinel secret-item and opponent Ball-count non-disclosure.
`EncounterDialog.test.tsx` covers both encounter fixtures and engine odds. `BoardScreen.test.tsx`
clicks through 20 human turns in a seeded longer game (a larger engine Lap target keeps the
scenario running), with deterministic HTTP answers, visible disabled reasons, automatic
steps, all encounter outcomes, replay verification, the Sell-before-destination event order
and a failed-service retry. Adapter tests cover role-scoped opponent requests, invalid
responses and late answers after a game is cleared.

`TeamCards.test.tsx` covers base, fallback evolved, branching and authored next forms;
zero battle; final forms; duplicate UID/status separation after reordering; Tired/Rescue
sale quotes; expanded opponent privacy; and unchanged accepted actions, revision,
cooldowns and statuses when board/Sell disclosures open and close.

## PvP and Gym

Spec §3, §3.1, §4.4, §4.5, Appendix C.3. Every decision is the engine's: the store exposes
`decision` (the engine's pending seat and decision point, which differ from the active seat for a
PvP response, window, reroll or reward), `battle` (`battlePreview`: snapshot terms and exact odds,
and what each open Ability choice would do) and, in Strategy, `challenges` (`challengeOdds` per
opponent). `TurnPanel` routes on them, so a human defender answers while the opponent keeps the turn.

- **Strategy** shows `ChallengePanel`: one voluntary challenge per opponent and Rival's once-per-Lap
  forced challenge, each with the engine's disabled reason ("Both teams need a battle-ready
  Pokémon"). Choosing a target previews the chances; the tactical action is spent on Confirm.
- **`BattlePanel`** covers the response (accept or decline, with what a decline costs), the
  Ability windows (each choice with its effect on the chances; passing spends nothing), the Gym
  entry (challenge greyed out with the engine reason when no Pokémon is battle-ready, in which case
  the engine skips it and the board says so), the reroll review and the reward. `BattleTerms` is the
  terms table: every figure is copied from the snapshot, never added up in the browser. A forced
  challenge has no accept or decline and names who forced it from the records this seat may see
  (`forcedSource`): a Battle Ticket or Ability aimed at another seat shows only "a forcing effect".
- **Reward**: coins, or one authored one-stage evolution of one Pokémon, never both. Choosing only
  selects; Confirm commits. A selection from an older list of choices is dropped and the player
  is asked to review the refreshed rewards. The engine rejects a late confirmation either way.
- **Result**: `BattleResult` keeps the latest battle's rows (challenge, answer, both dice, result,
  badge, the amount that actually moved, protection, evolution) beside the board until the seat's
  own next turn. The field log announces the same events through `battleMessages.ts`.
- AI seats still answer these points with the engine's first listed choice, logged as a fallback
  with reason `unsupported_decision_point`; no service is called, so an unavailable one changes
  nothing. Rival is now an open class: its forced challenge has its control.

Run `npm run dev` for API plus Vite, or `npm run build` and `npm start` for the built app.
Review at 1440×900 and 1024×768; the board is height-bounded at desktop sizes so the whole
loop remains visible without horizontal scrolling. Long panels and the event log remain
available by vertical scrolling.

## Seat rows and pace

The right-hand column lists every seat as one row (`board/SeatRows.tsx`): name (You, or the
rival's class) with its seat disc, coins, square, and the seat's last turn told as short beats
(`board/beats.ts`, built from the seat-filtered feed only). A rival's row writes itself beat by
beat while it plays, folds to one line 1.5 s after its turn ends and stays until the seat plays
again; a long turn shows its last four beats and "+N more", which opens that turn in place and
keeps focus on the same control, and the seat's next turn starts folded to four again. Speech
shows only at Step or Readable. A row that touched the viewing seat is lit, and at the start of
that seat's turn the touching beats are listed first above the rows. The rows take the viewing
seat as a value (`viewerSeat`), never the store's human seat. The toggle on a
row opens the old panel body in place: Lap, items held, badges, team (and, for your own seat
only, the Ball pouch and items), the Backup bot reason and, for a rival, your promises with it.
One seat is open at a time, Enter or Space toggles it and Escape closes it; opening is a local view
choice that never reaches the game. A watched game adds each AI's personality and difficulty.

`board/useTurnPlayback.ts` is the pace engine: Step, Readable (default), Fast or Instant, saved
with every game. It holds each beat for `holdMs` (`board/pace.ts`: at Readable 1.2 s + 0.3 s per
word, 2.5-5 s; the player's own results at least 2.5 s; a step that tells nothing 250 ms) before
the next automatic step or AI request starts. Only Next (Space) ends a hold early (a choice the
player makes meanwhile is told after it), Pause (P) holds the game, Skip to my turn runs at
Instant until the player's turn and a watcher's Skip to results until the results; choosing a pace
ends either skip. Timing never cancels or repeats an AI decision. `beats.test.ts`, `pace.test.ts`,
`PaceEngine.test.tsx` and `PlayersArea.test.tsx` cover the beats' privacy, the hold formula, the
controls and the rows.

## UI states gallery (dev only)

Run `npm run dev:web` and open `/?gallery` (for example `http://localhost:5173/?gallery`). The
page lists every spec §3.1 row that has a screen in this build (plus §3's Backup bot mode badge),
each labelled `Spec §3.1, row N` under the spec's own wording, and each example rendered by the
real component: `TurnPanel` (turn copy, Shop, AI badge and banners, the Social window of §4.8),
`EncounterDialog`, `SellPanel` and `SavePrompt`; one extra row, "PvP and Gym" (spec §4.4), shows the
challenge, defender, forced, Ability-window, Gym and reward screens, and one more, "Promises and
memory" (spec §4.8), shows the promise offers, an offer waiting for the rival, an accepted and a
refused one, and the memory a kept, broken or game-ended promise leaves. A closing list names the rows
with no screen yet (free-text chat, deals, engine-only cases) so every row of the table is accounted
for.

The states are engine fixtures moved on only through the store's own commands
(`createFixtureStore` in `src/game/store.ts`, scenes in `src/gallery/scenes.ts`), so the screens
read real observations, legal actions, quotes and accepted records. Nothing runs on a clock and
nothing the page offers changes a game. `EncounterDialog` and `SellPanel` take an `inline` prop
so their dialogs open in the page flow instead of as modals.

It is not reachable from the player flow. `Root.tsx` opens it only when `__UI_GALLERY__` is true.
`vite.config.ts` sets that to true for the dev server only (the command decides, not `NODE_ENV`),
so every build folds it to `false` and drops the route, its styles and the fixtures. The plugin's
`virtual:gallery-fixtures` module also throws if a build ever imports it.
`gallery-build.test.ts` builds the app and checks that nothing of the gallery is emitted,
`Root.test.tsx` that `?gallery` opens the game when the build is not dev, and `App.test.tsx`
that no screen of the flow links to it. `GalleryPage.test.tsx` fails if a catalog key of a
listed row is not on screen, or if a row of the spec's §3.1 table is neither shown nor listed.
When a screen gains a state for a pending row, move it into `src/gallery/catalog.tsx` and add its
keys to `SHOWN` in the test.
