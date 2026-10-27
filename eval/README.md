# eval/

Spec: v1.0 §7, §8 (Eval set).

Run `npm run eval:jev -- --offline` to replay every JSON fixture in `eval/jev/fixtures/`
without a key or network. The report prints per-question accuracy and a
confidence-versus-correctness table. A legal answer outside its acceptable set lowers accuracy; malformed fixtures,
illegal answers and changed requests fail the command. The three C1 samples are
marked `synthetic: true`: invented answers that prove the harness, not Jev quality.
Real scenarios and personality separation/calibration curves arrive in later cycles.

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

A person with the server key may capture a fixture using:

```bash
npm run eval:jev -- --record --input /path/to/scenario.json --output eval/jev/fixtures/new-scenario.json
```

The input has the fixture fields above except `recorded` and `requestHash`.
Prepare role-scoped state, English questions and acceptable sets first; mark a real
recording `synthetic: false`. The command uses `createSdkJevClient` from `ai/`, not
the SDK directly. Key setup belongs on the person's machine, as described in
`docs/team-setup.md`; this CLI does not load `.env` automatically. It refuses when
`CI` is set or the key is missing, never serializes credentials, and creates a new
output file without overwriting an existing fixture. To re-record, use a new output
path, review it, and replace the old fixture manually. Agents only replay offline
fixtures or inject the existing fake client in tests. Live recording remains
manual and subject to the spec §9 budget.

## Thai chat trial (issue #12)

Spec: v1.0 §3.1, §5.1, §5.3, §12. `eval/jev/thai-trial.json` holds 20 Thai chat
messages, each with an expected intent, an expected manipulation flag and an English
gloss for reviewers (the gloss is never sent). `eval/jev/thai-trial.ts` sends each
message once through `createSdkJevClient` (pinned `jev-1.13.0`, 1,000 ms timeout, no
retries) with the chat-intent Choice and the manipulation Noul from spec §5.3, then
writes the chosen intent, probabilities, Choice confidence and Noul probability back
into the same file and prints a summary. It is a trial, not a measurement.

A person with the key in the git-ignored `.env` runs it from the repository root:

```bash
npx tsx eval/jev/thai-trial.ts
```

It refuses when `CI` is set, when `JEV_ENABLED` is false, when `JEV_MODEL` is not
`jev-1.13.0`, and when the file already holds a recorded run (restore it with
`git checkout -- eval/jev/thai-trial.json` to run again). Tests use a fake client
or a fake `fetch` only.
