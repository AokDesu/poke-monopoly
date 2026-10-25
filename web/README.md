# web/

Browser UI: one Vite + React + Tailwind CSS single-page app. Must not import from `ai/` (or the Jev SDK); it only calls `/api` over HTTP. Every number on screen comes from the engine.

Run with `npm run dev:web` (port 5173). Spec: §3, §3.1, §6.1. Skill: `skills/ui-rules`.

| Path                    | What it holds                                                                                                                                   |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/screens.ts`        | The screen state: `home`, `setup` (mode, class, AI rival, review, first roll), `play`, `results`, `credits`. A plain value in `App`, no router. |
| `src/setup/`            | The setup screens, spec §3: Home to the first-player roll.                                                                                      |
| `src/board/`            | Observation-only Board, human turn controls, native Encounter dialog and seat-filtered field log (§3, §3.1, §4.2, §4.3).                        |
| `src/ui/three/`         | Three.js scenes (lazy chunk); `public/models/` holds the licensed GLB models.                                                                   |
| `src/i18n/en.ts`        | Every player-facing string (English, spec §3), read with `t(key)`. `src/i18n/inline-text.test.ts` fails on UI text typed elsewhere.             |
| `src/game/store.ts`     | The engine adapter: holds the state and action log. The only file that calls engine functions, and only from `engine/index.ts`.                 |
| `src/ErrorBoundary.tsx` | No blank screens: a render error shows what to do next and a retry button.                                                                      |
| `src/ui/`               | Shared controls.                                                                                                                                |

Fredoka (display) and Nunito (body) are self-hosted through `@fontsource`; the page loads nothing from another host. The Home board and class art use Three.js (`@react-three/fiber`, lazily loaded where WebGL exists); the 3D models and their licences are in `public/models/CREDITS.md`. Lint enforces the import rules: no `ai/`, and engine values only through the adapter (type imports from the engine are allowed in `web/` except in the adapter, which may import only `engine/index.ts`; test files may import the engine directly).

Component tests run in the Vitest `web` project (jsdom, Testing Library); `npm test` runs them with the rest.

## Turn flow and review fixtures

After the first-player roll, **Go to the board** starts the turn driver. The store's
`advance({ human: true })` asks the engine to apply one pending result or sole legal action;
it never chooses between multiple human actions. A brief presentation pause keeps automatic
steps readable, and their `auto` records appear as short banners and field-log entries.
First-player setup still calls `advance()` without opting human rolls in, preserving the
explicit tie re-roll screen.

The Encounter dialog shows each held Ball with the percentage returned by `oddsForAllBalls`
through the adapter, plus Release. With no Balls it shows a disabled Catch, the catalog
reason **No Ball**, and Release; the sole release also runs automatically. Native modal
focus stays inside the decision. Caught, escaped and released outcomes come from accepted
seat-filtered records, not a UI roll or success calculation.

Start income and movement come from the engine. A qualifying crossing opens the minimal
**Sell Phase** step; Continue submits the empty Sell batch, keeping the team, before the
engine resolves the destination. Item controls, shopping and selling selections belong to
the next issue: Strategy and Shop offer explicit pass/continue controls, never automatic
choices over the engine's multiple legal actions. End-of-turn steps hand off automatically.
A finished game offers a return Home; saving and the results screen remain the next issue.

Opponent single-action steps use the same engine automation. At a multi-choice step,
`store.playOpponent(signal)` sends only that AI seat's `Observation`, enabled actions and
engine catch odds to `/api/ai/decide`, then submits the returned choice or Sell batch through
`applyAction`. No opponent projection is exposed by `getView()`. Abort, replaced-game and
revision checks discard late responses; failed or invalid responses leave the decision
unchanged and show a notice with Retry. This is interim plumbing, not AI turn presentation:
the board says **Opponent turn**, with no dialogue, speed controls or backup-mode badge.

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

Run `npm run dev` for API plus Vite, or `npm run build` and `npm start` for the built app.
Review at 1440×900 and 1024×768; the board is height-bounded at desktop sizes so the whole
loop remains visible without horizontal scrolling. Long panels and the event log remain
available by vertical scrolling.
