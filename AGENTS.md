# AGENTS.md

Poke Monopoly: single-player web board game against AI opponents. The specification is `docs/SPEC-v1.0-PokeMonopoly.md`; §7 is the development harness. Tools and the PR workflow: [docs/team-setup.md](docs/team-setup.md).

## House rules (spec §7)

1. The engine has no IO.
2. Numbers live only in the engine.
3. No hidden information goes into `ai/`.
4. A rule change updates the spec and tests in the same PR.
5. Never commit keys.

## Agent boundaries (spec §7)

1. Work on a branch.
2. Keep a step or time limit per task.
3. No `TYPESAFE_API_KEY` in the sandbox.
4. A PR must cite a spec section and pass CI.
5. One teammate reviews before merge.

## Verify

```bash
npm test
npm run sim -- --games 100 --seed <n>
npm run eval:jev -- --offline
```

## Folders

| Folder     | Rule                                                    |
| ---------- | ------------------------------------------------------- |
| `engine/`  | Pure rules, no IO. The only place numbers are computed. |
| `content/` | Game data and text. No logic.                           |
| `ai/`      | Server only. Holds the Jev key. Never imports `web/`.   |
| `web/`     | Browser UI. Never imports `ai/`.                        |
| `sim/`     | Simulation CLI.                                         |
| `eval/`    | Jev evaluation (`eval/jev/`).                           |
| `docs/`    | The spec and team guides.                               |
| `skills/`  | Project skills, listed below.                           |

## Skills

Read the matching skill before doing that kind of work.

| Work on                                       | Read                                |
| --------------------------------------------- | ----------------------------------- |
| Game rules, engine behaviour, invariants      | `skills/game-rules/SKILL.md`        |
| Screens, UI states, UI copy                   | `skills/ui-rules/SKILL.md`          |
| Jev state, questions, options (`ai/`)         | `skills/jev-questions/SKILL.md`     |
| Species, lines, personalities, content schema | `skills/content-authoring/SKILL.md` |

## Reviewer rota

| Stream | Pull requests of | Reviewed by |
| ------ | ---------------- | ----------- |
| A      | punkharb         | Mrmo0p      |
| B      | Mrmo0p           | AokDesu     |
| C      | AokDesu          | punkharb    |

## Agent folders

`.claude/` and `.agents/` are git-ignored, not tracked (as are `.codex/`, `.impeccable/` and `.lavish/`). They hold per-person agent settings and skill installs. Shared rules live in this file and in `skills/`.
