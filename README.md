# poke-monopoly

Poke Monopoly: single-player web board game against AI opponents (coursework prototype)

New to the team? Start with [docs/team-setup.md](docs/team-setup.md): tools, agent skills and the PR workflow.

The specification is [docs/SPEC-v1.0-PokeMonopoly.md](docs/SPEC-v1.0-PokeMonopoly.md). House rules for people and coding agents are in [AGENTS.md](AGENTS.md).

## Prerequisites

- Node.js 24 (`.node-version`; `engines` is `^24.15.0`). Other versions print an npm engine warning but are not blocked.
- npm, the one that ships with Node 24.

Install with `npm ci`. Optionally copy `.env.example` to `.env`; the Jev key is only ever read by `ai/` on the server, and no command here needs it.

## Commands

| Command                                            | What it does                                                           |
| -------------------------------------------------- | ---------------------------------------------------------------------- |
| `npm run dev`                                      | API on port 8787 and web app on port 5173 together; `/api` is proxied  |
| `npm run dev:api` / `npm run dev:web`              | Each one alone                                                         |
| `npm run build`                                    | Build the web app into `web/dist`                                      |
| `npm start`                                        | Serve the API and the built web app on port 8787                       |
| `npm run typecheck`                                | TypeScript, strict                                                     |
| `npm run lint`                                     | ESLint, including the folder import and no-IO rules                    |
| `npm run format` / `npm run format:check`          | Prettier, write or check                                               |
| `npm test`                                         | Vitest                                                                 |
| `npm run sim -- --games 100 --seed 1`              | Simulation CLI; prints one JSON line (`npm run -s` hides npm's banner) |
| `npm run eval:jev -- --offline`                    | Jev eval on recorded fixtures; no network, no key                      |
| `npm run playtest:row -- <log.json> --code <code>` | Draft a playtest sheet row from an exported game log                   |
| `npm run playtest:check -- <sheet.csv> [...]`      | Check playtest sheets against the template and the privacy rules       |
| `npm run playtest:report -- <sheet.csv> [...]`     | Write result tables and charts with n from playtest sheets             |

CI (job `ci`) runs typecheck, lint, format check, tests, the sim and the offline eval on every pull request.

## AI turn playback

Spec: §3, §3.1, §5.7. The board shows each rival's accepted action in the field log.
The default speed is readable: every rival action pauses two seconds, the board
spotlights the acting rival's square and pawn in its seat colour, and a "Now" strip
under the board names the current action in the same words as the field-log row, so
the board and the text always point to the same move (#123). Turn speed (Normal,
Fast, Instant) changes presentation pauses only; Skip line closes the speech bubble
without changing a decision. Line IDs resolve through the English catalog from
`content/lines/en/`; no server-supplied prose is rendered.

The browser requests only the local API. It prepares `POST /api/ai/fallback`
alongside `POST /api/ai/decide`, then uses that server-selected fallback if the
decision exceeds 1.5 seconds. Late replies are discarded. If the local server
cannot supply either result, the board shows an error and Retry opponent turn;
it does not invent an action.

`GET /api/ai/status` supplies backup-only mode and its reason; decision `source`
supplies per-rival backup status. When every rival is using backup, one combined
banner stays visible and the game continues. To try this without a key, run
`JEV_ENABLED=false npm start` after `npm run build`.

The decision JSON contract is unchanged. Additive response headers carry
`X-AI-Decision-Ms`, `X-AI-Line-Id` and `X-AI-Dialogue-Events`. Dialogue annotations
are saved separately from commands and never advance gameplay RNG or command
replay. The existing HTTP decider and Shop policy are unchanged; connecting the
orchestrator to the HTTP decider is separate work.

## Demo mode

Spec: §3 (Demo mode, Prepared scenarios), §11. The demo needs two switches that are independent of each other:

- **Prepared scenarios** (§11 steps 2, 4, 5 and 6) need only the page address `?demo` (bare, `?demo=1` or `?demo=true`), for example `http://127.0.0.1:8787/?demo`. Home then lists the scenarios. With a saved game on the browser Home first asks "Continue this game?"; choose New game, then Back, to reach the list.
- **The "What Jev chose" panel** (§11 step 3) needs `?demo` and the server variable `DEMO_MODE=1` (or `true`), and Jev must actually decide. Without a Jev key the server reports `missing_key`, the backup bot decides, and the panel shows only that reason and no probabilities. With `JEV_ENABLED=false` it says "Jev is switched off".

```bash
npm ci
npm run build
DEMO_MODE=1 npm start     # then open http://127.0.0.1:8787/?demo
```

In PowerShell the variable is set on its own line first:

```powershell
$env:DEMO_MODE='1'; npm start     # then open http://127.0.0.1:8787/?demo
Remove-Item Env:DEMO_MODE         # after stopping the server
```

Clear it afterwards rather than put it in `.env`, so a later real-play server does not start in demo mode.

Leave `DEMO_MODE` unset on any server used for real play. The kill switch (§11 step 7) is `JEV_ENABLED=false`; it fails closed, so only an unset, empty or `true` value leaves Jev on and `0`, `off` or a typo turns it off. The server reads it on every call, but a running process cannot have its environment changed from outside, so stop the server and start it again with the variable set. `GET /api/ai/status` shows the result (`"jevEnabled":false,"reason":"disabled"`). `docs/pr-evidence/64-demo-rehearsal/` holds the last walk of steps 1 to 8 with what each one needs.

## Folders

| Folder      | What it is                                |
| ----------- | ----------------------------------------- |
| `engine/`   | Pure rules, no IO                         |
| `content/`  | Game data and text                        |
| `ai/`       | Server only; holds the Jev key (Hono API) |
| `web/`      | Browser UI (Vite, React, Tailwind CSS)    |
| `sim/`      | Simulation CLI                            |
| `eval/`     | Jev evaluation (`eval/jev/`)              |
| `playtest/` | Playtest sheet tools (files only)         |
| `docs/`     | The spec and team guides                  |
| `skills/`   | Project skills for coding agents          |

## Install scripts

npm 11 blocks dependency install scripts that are not approved. Two dependencies have one, and both are approved in `"allowScripts"` in `package.json`:

- esbuild (`postinstall: node install.js`, pulled in by `tsx` and `vite`) checks and finalises the platform binary. We approved it with `npm install-scripts approve esbuild`, which records `"esbuild@0.28.2": true`.
- fsevents (`install: node-gyp rebuild`, an optional dependency of `tsx` and `vite`) builds the macOS file-watching binding. It is installed on macOS only, so Linux, Windows and CI never run it. Approved as `"fsevents@2.3.3": true`.

Each entry is pinned to the version, so an upgrade of either package asks for review again.
