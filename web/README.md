# web/

Browser UI: one Vite + React + Tailwind CSS single-page app. Must not import from `ai/` (or the Jev SDK); it only calls `/api` over HTTP. Every number on screen comes from the engine.

Run with `npm run dev:web` (port 5173). Spec: §3, §3.1. Skill: `skills/ui-rules`.
