# web/

Browser UI: one Vite + React + Tailwind CSS single-page app. Must not import from `ai/` (or the Jev SDK); it only calls `/api` over HTTP. Every number on screen comes from the engine.

Run with `npm run dev:web` (port 5173). Spec: §3, §3.1, §6.1. Skill: `skills/ui-rules`.

| Path                    | What it holds                                                                                                                                   |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/screens.ts`        | The screen state: `home`, `setup` (mode, class, AI rival, review, first roll), `play`, `results`, `credits`. A plain value in `App`, no router. |
| `src/setup/`            | The setup screens, spec §3: Home to the first-player roll.                                                                                      |
| `src/ui/three/`         | Three.js scenes (lazy chunk); `public/models/` holds the licensed GLB models.                                                                   |
| `src/i18n/en.ts`        | Every player-facing string (English, spec §3), read with `t(key)`. `src/i18n/inline-text.test.ts` fails on UI text typed elsewhere.             |
| `src/game/store.ts`     | The engine adapter: holds the state and action log. The only file that calls engine functions, and only from `engine/index.ts`.                 |
| `src/ErrorBoundary.tsx` | No blank screens: a render error shows what to do next and a retry button.                                                                      |
| `src/ui/`               | Shared controls.                                                                                                                                |

Fredoka (display) and Nunito (body) are self-hosted through `@fontsource`; the page loads nothing from another host. The Home board and class art use Three.js (`@react-three/fiber`, lazily loaded where WebGL exists); the 3D models and their licences are in `public/models/CREDITS.md`. Lint enforces the import rules: no `ai/`, and engine values only through the adapter (type imports from the engine are allowed in `web/` except in the adapter, which may import only `engine/index.ts`; test files may import the engine directly).

Component tests run in the Vitest `web` project (jsdom, Testing Library); `npm test` runs them with the rest.
