# ai/

Server only. This is the only place `TYPESAFE_API_KEY` lives. It validates payload shape and size, builds questions from role-scoped state, calls Jev and returns only action IDs and line IDs.

No hidden information goes in: send only what that seat can see. Must not import from `web/`; lint enforces this. The browser reaches it through `/api` (port 8787; Vite proxies in dev).

Spec: §5.4, §6 item 2, §9. Skill: `skills/jev-questions`.
