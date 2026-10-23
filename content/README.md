# content/

Game data and text: the Appendix A baseline as JSON (`board`, `classes`, `species`, `evolutions`, `items`, `events`, `config`), personality files (`content/personalities/<name>.json`) and the Thai line bank (`content/lines/th/<situation>.json`).

Data only. The code files are `schema.ts` (zod schemas, a pure `parseContent(files)` that validates and returns typed content plus `contentVersion`, and `toEngineContent` for the engine's strict `Content`) and `personality-schema.ts` (a pure `parsePersonality(id, json)` for `content/personalities/<name>.json`). Nothing here reads files: `sim/content.ts` loads the JSON in Node, and a browser app can import the JSON files directly.

Change a rule number here only together with the engine, the spec and the tests, in one pull request. Bump `CONTENT_VERSION` in `index.ts` when any JSON changes.

Spec: §4.1, §4.5, §4.6, §5.5, §5.7, §6, Appendix A. Skill: `skills/content-authoring`.
