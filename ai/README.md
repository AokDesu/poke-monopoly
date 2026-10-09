# ai/

Server only. This is the only place `TYPESAFE_API_KEY` lives. It validates payload shape and size, builds questions from role-scoped state, calls Jev and returns only action IDs and line IDs.

`jev/client.ts` is the only code that touches the SDK. The rest of `ai/` depends on its `JevClient` interface, which pins `jev-1.13.0`, enforces the §5.6 deadlines, never retries and turns every unusable answer into a `fallbackReason`. Tests use `jev/fake.ts` or the real wrapper with a placeholder key and a fake `fetch`; `JEV_ENABLED=false` needs no key at all.

No hidden information goes in: send only what that seat can see. Must not import from `web/`; lint enforces this. The browser reaches it through `/api` (port 8787; Vite proxies in dev).

Spec: §5.4, §6 item 2, §9. Skill: `skills/jev-questions`.
