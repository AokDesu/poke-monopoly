# poke-monopoly

Poke Monopoly: single-player web board game against AI opponents (coursework prototype)

New to the team? Start with [docs/team-setup.md](docs/team-setup.md): tools, agent skills and the PR workflow.

The specification is [docs/SPEC-v1.0-PokeMonopoly.md](docs/SPEC-v1.0-PokeMonopoly.md). House rules for people and coding agents are in [AGENTS.md](AGENTS.md).

## Prerequisites

- Node.js 24 (`.node-version`; `engines` is `^24.15.0`). Other versions print an npm engine warning but are not blocked.
- npm, the one that ships with Node 24.

Install with `npm ci`. Optionally copy `.env.example` to `.env`; the Jev key is only ever read by `ai/` on the server, and no command here needs it.

## Commands

| Command                                   | What it does                                                           |
| ----------------------------------------- | ---------------------------------------------------------------------- |
| `npm run dev`                             | API on port 8787 and web app on port 5173 together; `/api` is proxied  |
| `npm run dev:api` / `npm run dev:web`     | Each one alone                                                         |
| `npm run build`                           | Build the web app into `web/dist`                                      |
| `npm start`                               | Serve the API and the built web app on port 8787                       |
| `npm run typecheck`                       | TypeScript, strict                                                     |
| `npm run lint`                            | ESLint, including the folder import and no-IO rules                    |
| `npm run format` / `npm run format:check` | Prettier, write or check                                               |
| `npm test`                                | Vitest                                                                 |
| `npm run sim -- --games 100 --seed 1`     | Simulation CLI; prints one JSON line (`npm run -s` hides npm's banner) |
| `npm run eval:jev -- --offline`           | Jev eval on recorded fixtures; no network, no key                      |

`sim` is a stub until issue #13 replaces it. CI (job `ci`) runs typecheck, lint, format check, tests, the sim and the offline eval on every pull request.

## Folders

| Folder     | What it is                                |
| ---------- | ----------------------------------------- |
| `engine/`  | Pure rules, no IO                         |
| `content/` | Game data and text                        |
| `ai/`      | Server only; holds the Jev key (Hono API) |
| `web/`     | Browser UI (Vite, React, Tailwind CSS)    |
| `sim/`     | Simulation CLI                            |
| `eval/`    | Jev evaluation (`eval/jev/`)              |
| `docs/`    | The spec and team guides                  |
| `skills/`  | Project skills for coding agents          |

## Install scripts

npm 11 blocks dependency install scripts that are not approved. Two dependencies have one, and both are approved in `"allowScripts"` in `package.json`:

- esbuild (`postinstall: node install.js`, pulled in by `tsx` and `vite`) checks and finalises the platform binary. We approved it with `npm install-scripts approve esbuild`, which records `"esbuild@0.28.2": true`.
- fsevents (`install: node-gyp rebuild`, an optional dependency of `tsx` and `vite`) builds the macOS file-watching binding. It is installed on macOS only, so Linux, Windows and CI never run it. Approved as `"fsevents@2.3.3": true`.

Each entry is pinned to the version, so an upgrade of either package asks for review again.
