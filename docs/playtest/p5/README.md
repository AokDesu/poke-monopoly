# Cycle 5 playtest round (`P5`)

Spec: §8 (Human layer), §9 (no personal data), §10 C5.

The protocol is [`../PROTOCOL.md`](../PROTOCOL.md). This folder holds only what the round produces: the filled sheets and the build record below. The round code, seed range and fixed setup are written in the protocol (sections 2 and 3), not here, so there is one place to change them.

| Item | Value |
|---|---|
| Round code | `P5`, so codes read `P5-A01` (protocol section 2) |
| Seeds | `5000 + 100 × host + session`: 5101 to 5399; dry runs use 5001 (protocol section 3, step 2) |
| Setup | One human, Greedy and Cautious rivals, Quick, Normal (protocol section 3, step 4; needs issue #226 merged) |
| Sheets | `session-sheet-A.csv`, `session-sheet-B.csv`, `session-sheet-C.csv`, one per facilitator |

## Sheets

Each facilitator makes their own copy of the empty template on their first session, and adds one row per session the same day (protocol section 7):

```bash
mkdir -p docs/playtest/p5
cp docs/playtest/session-sheet.csv docs/playtest/p5/session-sheet-A.csv
```

Use your own stream letter in the file name. The template `docs/playtest/session-sheet.csv` is never filled in place, and its header is never changed. No sheet is committed before its first real row, and no row is committed from a dry run.

## Build record

Fill this in at the build check, before the first session, and change it only with a new commit and a new row. It says what the participants could meet, so every sheet's `build_commit` can be read against it. Write what is merged, not what is planned. No names.

| Date | Commit (7 characters) | Social window | Presets | Abilities | PvP and Gym | Event cards | Deal Cards | Promises | Greedy and Cautious both playable | Voice (AI-written speech) offered |
|---|---|---|---|---|---|---|---|---|---|---|
| | | | | | | | | | | |

Use `yes` or `no` in each cell. "Social window" is the topic buttons (pull request #212), "Presets" is pull request #213, "Abilities" is #209, "PvP and Gym" is #210, "Event cards" is #211, and "Greedy and Cautious both playable" is issue #226. "Voice" is yes only if the machine that serves the sessions has AI-written speech on (protocol section 3, step 6).
