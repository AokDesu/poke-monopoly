# ai/

Server only. This is the only place `TYPESAFE_API_KEY` lives. It validates payload shape and size, builds questions from role-scoped state, calls Jev and returns only action IDs and line IDs.

`jev/client.ts` is the only code that touches the SDK. The rest of `ai/` depends on its `JevClient` interface, which pins `jev-1.13.0`, enforces the §5.6 deadlines, never retries and turns every unusable answer into a `fallbackReason`. Tests use `jev/fake.ts` or the real wrapper with a placeholder key and a fake `fetch`; `JEV_ENABLED=false` needs no key at all.

Routes (`app.ts`): `POST /api/ai/decide` takes a `DecisionRequest` (at most 32 KB, strict zod: unknown fields, including any in the observation, are a 400) and returns a `DecisionResponse` with only an action ID (or `sellUids` at the Sell Phase) and telemetry. `GET /api/ai/status` returns `{ jevEnabled, backupOnly, reason }` for the backup-bot badge. Both shapes live in `engine/contract/decision.ts`, so `web/` imports them without importing `ai/`. `decide` calls a pluggable `Decider` (`decider.ts`); until the orchestrator lands, the stub returns the first enabled action with `source: 'fallback'`, and any answer that is not among the enabled options is replaced the same way (spec §3.1).

`questions/` builds each decision point's Jev questions from role-scoped state (Strategy, Encounter and the Sell Phase Nouls); see `skills/jev-questions`.

`fallback/` is the §5.2 fallback policy: personality-weighted utility over the enabled actions, from the seat's `Observation` plus engine `PolicyFacts` only. `FallbackPolicy` implements the sim's `Policy` (`npm run sim -- --policy fallback`), and `decideWithFallback` applies Jev's choice at or above the confidence floor and otherwise picks between Jev's top two by personality weight (§5.6). Personalities load from `content/personalities/*.json` through `content/personality-schema.ts`.

No hidden information goes in: send only what that seat can see. Must not import from `web/`; lint enforces this. The browser reaches it through `/api` (port 8787; Vite proxies in dev).

Spec: §3.1, §5.2, §5.4, §5.5, §5.6, §6 item 2, §9. Skill: `skills/jev-questions`.
