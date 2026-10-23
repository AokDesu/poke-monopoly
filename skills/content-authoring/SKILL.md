---
name: content-authoring
description: 'Where game content lives, its schema, and how to add a species, an evolution line, a dialogue line or a personality, with the checks that run. Read before adding or editing anything under content/.'
---

# Content authoring

Content is data. Appendix A of `docs/SPEC-v1.0-PokeMonopoly.md` is the baseline and the source of truth: copy it exactly and do not tune a number. A change to a rule number updates the engine, the spec and the tests in the same pull request (spec §7), and the pull request cites the spec section (`Spec: §4.5, Appendix A`).

## Where things live

| File                                | Holds                                                                  | Spec             |
| ----------------------------------- | ---------------------------------------------------------------------- | ---------------- |
| `content/board.json`                | The 24 squares                                                         | §4.1, Appendix A |
| `content/classes.json`              | 6 core classes and 2 `stretch: true` classes                           | Appendix A       |
| `content/species.json`              | The 19 species: stats, tags, Ability                                   | §4.5, Appendix A |
| `content/evolutions.json`           | Evolved forms with no species definition, and the evolution lines      | §4.5, Appendix A |
| `content/items.json`                | 3 Balls and 7 utility items                                            | §4.6, Appendix A |
| `content/events.json`               | Events e1 to e6 as text                                                | §4.6             |
| `content/config.json`               | Starting kit, Start income, Lap targets, rarity weights                | §1, §4.1, §4.5   |
| `content/schema.ts`                 | zod schemas, `parseContent`, `toEngineContent`                         | §6               |
| `content/index.ts`                  | `CONTENT_VERSION`, stamped into every game config and log              | §6.8             |
| `content/personalities/<name>.json` | One file per personality, validated by `content/personality-schema.ts` | §5.5             |
| `content/lines/th/<situation>.json` | Thai line bank (no schema yet)                                         | §5.7             |

Ids are lowercase kebab-case (`poke-ball`, `main-character`). The engine's `Content` type is inferred from `contentSchema` in `engine/contract/schema.ts`; the schema rows in `content/schema.ts` extend those rows, so every engine field is validated exactly as the engine does. Authoring-only fields (`ability`, `passiveText`, `inEncounterPool`, `bonus`, `effect`, `stretch`) are not in the engine's `Content`. `ParsedContent` is assignable to `Content`, but the engine's `createGame` parses strictly and rejects those extra fields: pass it `toEngineContent(parsed)`, never the parsed object.

## Loading

- `parseContent(files)` is pure. `files` is an object keyed by file name without `.json` (`board`, `classes`, `species`, `evolutions`, `items`, `events`, `config`). It throws one `Error` listing every problem with its path (`→ at species[3].dc`) and returns the typed content plus `contentVersion`.
- A browser app can import the JSON files directly and call `parseContent` (the web app does not use content yet). The Node loader is `loadContent()` in `sim/content.ts`; the sim runner uses it in `sim/engine.ts`. Nothing under `engine/` reads files. Every top-level `content/*.json` must be one of the seven files: a stray one fails with an unrecognised key.

## Add a species

1. Add the row to the Appendix A table in the spec first. `content/content.test.ts` reads that table and compares it with `species.json` cell by cell, so the two cannot drift.
2. Add the object to `species.json`: `id`, `name`, `rarity` (`common`, `uncommon`, `rare`), `dc`, `battle`, `base`, `tags`, `inEncounterPool`, and `ability: { name, text, timing }`. Copy the Ability text exactly. `timing` is `OWN_STRATEGY` (S), `CHALLENGE_DECLARE` (C), `BEFORE_OWN_ROLL` (B), `AFTER_OWN_ROLL` (A) or `REACTION` (R).
3. `inEncounterPool` is `false` only for the 3 starters and Porygon (§4.5). Rarity is the only thing that sets the draw weight.
4. If the species evolves, add a line (below). If it is a class Starter, put its id in that class's `starterSpeciesIds` in `classes.json`.
5. Update the counts the test pins (19 species, 15 in the pool) in the same pull request, and bump `CONTENT_VERSION`.

## Add a class passive

A class row keeps its Appendix A prose in `passiveText`. If the engine implements the passive, `classes.json` also names it in `passive`, one of the values in `contentSchema` (`engine/contract/schema.ts`, for example `lap_first_catch_bonus`). The name is all content says: the amount and timing live in the engine (`engine/classes.ts`), so never copy a number into `passive`. Set `passive` only when the engine enum has the value; `parseContent` rejects any other string. A class whose passive is not implemented yet leaves `passive` out.

## Add an evolution line

In `evolutions.json`, add `{ "speciesId": "<base>", "stages": [{ "forms": ["<form-id>"] }, ...] }` and the Appendix A bullet.

- `speciesId` must be a species. One line per species.
- Every form id is either a species id (Magikarp to Gyarados) or declared once in `evolutions.forms` as `{ id, name }`. A form with no species definition uses the evolution fallback in §4.5.
- A stage with several forms is the player's choice and needs `"choice": "player"` (Eevee). A stage with one form must not have it.
- Final forms (Scyther, Chansey, Gyarados, Snorlax, Porygon) have no line.

## Add a dialogue line

Spec §5.7: lines live in `content/lines/th/<situation>.json` (for example `deal_accept`, `promise_broken`). Each situation needs at least 3 lines per personality per trust bucket; slots such as `{target}` and `{turn}` are filled by the engine. Jev picks a line id and never writes text. There is no schema or check for the line bank yet: the issue that adds Thai text adds its schema to `content/schema.ts` and updates this section.

## Add a personality

Spec §5.5: create `content/personalities/<name>.json` with `name`, an English `description` (inserted into instructions), `weights` (`risk`, `aggression`, `liquidity`, `loyalty`, each 0 to 1) and `lineStyle` (a kebab-case line-bank style id). Decide it once in the file; do not tie it to a betrayal rate. Keep hidden information out of it (house rule 3).

`parsePersonality(id, json)` in `content/personality-schema.ts` is pure: it validates the file with the zod `personalitySchema` (unknown keys are refused), throws one readable `Error` naming each bad path, and adds the Sell Phase `sellThreshold`, derived from `liquidity` alone so a more liquid personality never sells less eagerly. Register the file in `PERSONALITIES` in `ai/fallback/index.ts`; `ai/fallback/fallback.test.ts` validates every file in the folder and pins which ones exist. Only Greedy (Appendix B) ships this cycle.

## Checks that run

Run from the repository root on Node 24.

```bash
npm test                                   # content/content.test.ts and sim/sim.test.ts among the rest
npm run typecheck && npm run lint && npm run format:check
npm run sim -- --games 100 --seed 1
```

- **Appendix A match:** the tests read the spec and compare the board square by square, the species, class, item and evolution tables, the events, and the 15-species encounter pool.
- **Rejected data:** one broken copy per schema rule (missing field, unknown key, duplicate id, board counts and Gym squares, unknown species in a line or Starter, unknown class item, unknown class passive, repeated Ball type, missing player choice, empty rarity pool) must be refused with a readable message.
- **Engine fit:** `ParsedContent` must stay assignable to the engine's `Content` (a type-level test, checked by `npm run typecheck`); every `engine/fixtures/*.json` still passes with the real content swapped in; `createGame` builds every class's starting kit from it; the engine's `classBonus` reads the Main Character and Researcher passives from it.
- **Format:** JSON is formatted by Prettier (`npm run format`).
