# eval/

Spec: v1.0 §7, §8 (Eval set), §10 C2 (recorded fixtures in CI).

Run `npm run eval:jev -- --offline` to replay every JSON fixture in `eval/jev/fixtures/`
without a key or network. The report prints accuracy against the acceptable sets, the mean
confidence of correct versus incorrect answers (no calibration claim yet) and a per-question
table. A legal answer outside its acceptable set lowers accuracy; malformed fixtures, illegal
answers and changed requests fail the command.

## Scenarios (spec §10 C2)

`eval/jev/scenarios.ts` holds 20 decision scenarios: 8 Strategy, 6 Encounter and 6 Sell, all
Greedy (the one personality so far). Each builds a live engine state with seat 0, the AI, to act.
The engine supplies every number: catch odds come from `oddsForAllBalls`, and sale prices and
class bonuses from `saleQuote`. Keep values have no engine source yet, so each Sell scenario
supplies them as engine inputs. A scenario's `acceptable` set is chosen by a teammate: engine
action IDs for Strategy and Encounter, and per Pokémon instance ID the acceptable Noul answers
for Sell.

A fixture whose `id` names a scenario is replayed through the real `Orchestrator`
(`ai/orchestrator.ts`). The offline run checks that:

- the orchestrator builds the same request today as the one recorded;
- it asks exactly one request and applies an action among the legal options, so
  `illegalAppliedActionCount` stays 0;
- its fallback reason is the expected one: `low_confidence` when a Choice answer is below the
  confidence floor, otherwise none;
- the fixture's acceptable labels match the scenario.

When question wording changes, for example Strategy criteria text, the run fails with
`request changed, re-record: <fixture IDs>`. That is the signal to record those fixtures again.
Every scenario needs a fixture. Replay ignores `JEV_ENABLED`, because fixtures never reach the
network.

The 20 committed scenario fixtures are `synthetic: true` placeholders until a person with the
key records them. Their answers are seeded from the fixture ID and come from no model. They
prove the harness, not Jev quality. `npm run eval:jev -- --placeholders` (offline, no key)
writes a placeholder for a new or stale unrecorded scenario. It also copies a changed
description or acceptable set into a current fixture. It never replaces a recording.

### Recording (a person with the key, never CI or a coding agent)

From the repository root, with `TYPESAFE_API_KEY` and `JEV_ENABLED=true` in your git-ignored
`.env` (see `docs/team-setup.md`):

```sh
node --env-file=.env --import tsx eval/jev/cli.ts --record
```

`npm run eval:jev -- --record` runs the same command when the key is already in your
environment; the CLI does not load `.env` itself. The recorder sends each scenario whose
fixture is missing, synthetic or stale through the orchestrator, using `createSdkJevClient`
from `ai/`. It writes the full response with `synthetic: false`. A current recording is kept and
not sent again. That is one request of roughly 3k input tokens per scenario: 20 requests cost
well under a cent of the spec §9 budget. It refuses when `CI` is set or the key is missing, and
it never serializes credentials. A scenario whose call fails is reported and keeps its old
fixture. Review the diff, then commit the fixtures.

## Fixture format

`eval/jev/samples/synthetic-strategy.json` is a generic harness sample for the tests; the
offline command does not read it.

Each fixture has:

- `id`, `description`, `tags: { decisionPoint, personality }`, and `synthetic`.
- `request: { state, questions }`, in the `JevRequest` shape from `ai/jev/client.ts`.
- `recorded`: the full successful `JevClient` result (answers, model, request ID,
  latency and usage). This is the wrapper response, not an SDK HTTP response.
- `acceptable`: one nonempty array of acceptable answer IDs for every question.
- `requestHash`: a SHA-256 fingerprint saved when recording. Object key order is
  ignored; state, instructions, criteria and array order are significant. Editing
  a request without recording again fails with `request changed, re-record`.

Choice IDs are the offered criteria keys. Score IDs are the zero-based rubric
indices: accuracy uses the most probable level (first level wins a tie), while
keeping the full expected score in the recording. Noul IDs are `true`/`false`,
with `noul >= 0.5` counting as true; Noul has no confidence, so the table says `n/a`.
These are eval reporting conventions and do not change game decision thresholds.

A fixture that names no scenario is replayed directly, without the orchestrator. A person
with the server key may capture one from a hand-written request:

```bash
npm run eval:jev -- --record --input /path/to/scenario.json --output eval/jev/fixtures/new-scenario.json
```

The input has the fixture fields above except `recorded` and `requestHash`.
Prepare role-scoped state, English questions and acceptable sets first; mark a real
recording `synthetic: false`. The command uses `createSdkJevClient` from `ai/`, not
the SDK directly, refuses when `CI` is set or the key is missing, never serializes
credentials, and creates a new output file without overwriting an existing fixture.
To re-record, use a new output path, review it, and replace the old fixture manually.
Agents only replay offline fixtures or inject the existing fake client in tests. Live
recording remains manual and subject to the spec §9 budget.
