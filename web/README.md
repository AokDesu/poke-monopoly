# web/

Browser UI: one Vite + React + Tailwind CSS single-page app. Must not import from `ai/` (or the Jev SDK); it only calls `/api` over HTTP. Every number on screen comes from the engine.

Run with `npm run dev:web` (port 5173). Spec: §3, §3.1, §6.1. Skill: `skills/ui-rules`.

| Path                    | What it holds                                                                                                                                   |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/screens.ts`        | The screen state: `home`, `setup` (mode, class, AI rival, review, first roll), `play`, `results`, `credits`. A plain value in `App`, no router. |
| `src/setup/`            | The setup screens, spec §3: Home to the first-player roll.                                                                                      |
| `src/board/`            | Observation-only Board, human turn controls, native Encounter dialog and seat-filtered field log (§3, §3.1, §4.2, §4.3).                        |
| `src/gallery/`          | Developer-only gallery of every spec §3.1 row that has a screen (below). Absent from the production build.                                      |
| `src/ui/three/`         | Three.js scenes (lazy chunk); `public/models/` holds the licensed GLB models.                                                                   |
| `src/i18n/en.ts`        | Every player-facing string (English, spec §3), read with `t(key)`. `src/i18n/inline-text.test.ts` fails on UI text typed elsewhere.             |
| `src/game/store.ts`     | Rules adapter: state and action log. Calls engine functions only from `engine/index.ts`.                                                        |
| `src/game/save.ts`      | Browser storage adapter: engine `serialize` / `deserialize`, Continue, and log export.                                                          |
| `src/ErrorBoundary.tsx` | No blank screens: a render error shows what to do next and a retry button.                                                                      |
| `src/ui/`               | Shared controls.                                                                                                                                |

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

Opponent single-action steps use the same engine automation. At a multi-choice step,
`store.playOpponent(signal)` sends only that AI seat's `Observation`, enabled actions and
engine catch odds to `/api/ai/decide`, then submits the returned choice or Sell batch through
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

Tokens use the `position` already projected by `observe()` (including negative and multi-Lap
progress). Lap counts are paid Laps completed, not a UI-computed current-Lap number. Square
labels and icons remain DOM content even without WebGL; the static meadow reuses the
credited Starter models. The read-only fixture route retains its preview note and has no
live turn driver.

The player's panel shows their own Ball pouch and items. Opponents show coins, square, completed
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

Run `npm run dev` for API plus Vite, or `npm run build` and `npm start` for the built app.
Review at 1440×900 and 1024×768; the board is height-bounded at desktop sizes so the whole
loop remains visible without horizontal scrolling. Long panels and the event log remain
available by vertical scrolling.

## UI states gallery (dev only)

Run `npm run dev:web` and open `/?gallery` (for example `http://localhost:5173/?gallery`). The
page lists every spec §3.1 row that has a screen in this build (plus §3's Backup bot mode badge),
each labelled `Spec §3.1, row N` under the spec's own wording, and each example rendered by the
real component: `TurnPanel` (turn copy, Shop, AI badge and banners), `EncounterDialog`,
`SellPanel` and `SavePrompt`. A closing list names the rows with no screen yet (chat, deals,
engine-only cases) so every row of the table is accounted for.

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
