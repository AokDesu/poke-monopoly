import { access, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { format, resolveConfig } from 'prettier';
import { createSdkJevClient, decisionDeadline, type JevClient } from '../../ai/jev/client.ts';
import type { OrchestratorFallbackReason } from '../../ai/orchestrator.ts';
import {
  FixtureJevClient,
  fixtureSchema,
  scenarioSchema,
  validateFixture,
  validateScenario,
  requestHash,
  type Fixture,
} from './fixture.ts';
import {
  expectedFallback,
  placeholderResult,
  runScenario,
  scenarioFixture,
  scenarioRequest,
} from './replay.ts';
import { SCENARIOS, type EvalScenario } from './scenarios.ts';

export const DEFAULT_FIXTURES = join(import.meta.dirname, 'fixtures');
export const RECORD_COMMAND = 'npm run eval:jev -- --record';
export const PLACEHOLDER_COMMAND = 'npm run eval:jev -- --placeholders';
export const readJson = async (path: string): Promise<unknown> => {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as unknown;
  } catch (error) {
    throw new Error(`${path}: schema error: cannot read JSON`, { cause: error });
  }
};
export const parseFixture = (data: unknown, source: string): Fixture => {
  const parsed = fixtureSchema.safeParse(data);
  if (!parsed.success) throw new Error(`${source}: schema error: ${parsed.error.message}`);
  validateFixture(parsed.data);
  return parsed.data;
};
export interface EvalRow {
  fixture: string;
  synthetic: boolean;
  question: string;
  answer: string;
  confidence: number | undefined;
  correct: boolean;
  /** Scenario fixtures only: the action the orchestrator applied and why it fell back. */
  applied?: string;
  fallbackReason?: OrchestratorFallbackReason | null;
}
/** Score: most probable rubric ID, first ID wins ties. Noul: >= 0.5 means true. */
const answerId = (answer: Fixture['recorded']['answers'][string]): string =>
  answer.type === 'choice'
    ? answer.choice
    : answer.type === 'noul'
      ? String(answer.noul >= 0.5)
      : Object.entries(answer.probabilities).reduce((best, next) =>
          next[1] > best[1] ? next : best,
        )[0];
const rowsFor = (fixture: Fixture, extra: Partial<EvalRow> = {}): EvalRow[] =>
  Object.entries(fixture.recorded.answers).map(([name, answer]) => {
    const id = answerId(answer);
    return {
      fixture: fixture.id,
      synthetic: fixture.synthetic,
      question: name,
      answer: id,
      confidence: answer.type === 'noul' ? undefined : answer.confidence,
      correct: fixture.acceptable[name]!.includes(id),
      ...extra,
    };
  });
const sameSets = (a: Record<string, string[]>, b: Record<string, string[]>) =>
  JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());
/**
 * Spec §10 C2: replays a scenario's recorded answer through the orchestrator. Returns false when
 * the request the orchestrator builds now no longer matches the recording.
 */
async function replayScenario(fixture: Fixture, scenario: EvalScenario, rows: EvalRow[]) {
  const client = new FixtureJevClient(fixture);
  const run = await runScenario(scenario, client);
  if (client.error) return false;
  const [result] = run.results;
  if (run.requests.length !== 1 || !result?.ok)
    throw new Error(`${fixture.id}: replay failed (${run.decision.fallbackReason})`);
  if (!sameSets(fixture.acceptable, run.acceptable))
    throw new Error(
      `${fixture.id}: acceptable set differs from eval/jev/scenarios.ts; run ${PLACEHOLDER_COMMAND}`,
    );
  if (run.illegalApplied > 0)
    throw new Error(
      `${fixture.id}: illegal applied action (${JSON.stringify(run.decision.choice)})`,
    );
  const expected = expectedFallback(run, result);
  if (run.decision.fallbackReason !== expected)
    throw new Error(
      `${fixture.id}: fallback reason ${run.decision.fallbackReason}, expected ${expected}`,
    );
  const { choice } = run.decision;
  const applied = typeof choice === 'string' ? choice : `sell:${choice.sellUids.join('+')}`;
  rows.push(...rowsFor(fixture, { applied, fallbackReason: run.decision.fallbackReason }));
  return true;
}
/**
 * Replays every JSON fixture without a key or network. A fixture named after a scenario goes
 * through the orchestrator; any other is answered directly. Every scenario needs a fixture.
 */
export const runOffline = async (
  directory = DEFAULT_FIXTURES,
  scenarios: readonly EvalScenario[] = SCENARIOS,
): Promise<EvalRow[]> => {
  const files = (await readdir(directory)).filter((name) => name.endsWith('.json')).sort();
  if (!files.length) throw new Error(`${directory}: schema error: no fixtures`);
  const rows: EvalRow[] = [];
  const seen = new Set<string>();
  const stale: string[] = [];
  for (const file of files) {
    const path = join(directory, file);
    const fixture = parseFixture(await readJson(path), path);
    if (seen.has(fixture.id)) throw new Error(`${path}: schema error: duplicate fixture id`);
    seen.add(fixture.id);
    const scenario = scenarios.find((entry) => entry.id === fixture.id);
    if (scenario) {
      if (!(await replayScenario(fixture, scenario, rows))) stale.push(fixture.id);
      continue;
    }
    const client = new FixtureJevClient(fixture);
    const result = await client.ask(fixture.request, { decisionSignal: decisionDeadline() });
    if (!result.ok)
      throw new Error(client.error ?? `${fixture.id}: replay failed (${result.fallbackReason})`);
    rows.push(...rowsFor({ ...fixture, recorded: result }));
  }
  if (stale.length)
    throw new Error(
      `request changed, re-record: ${stale.join(', ')}. A person with the key runs ${RECORD_COMMAND}.`,
    );
  const missing = scenarios.filter((scenario) => !seen.has(scenario.id)).map(({ id }) => id);
  if (missing.length)
    throw new Error(
      `no fixture for scenario: ${missing.join(', ')}. Run ${PLACEHOLDER_COMMAND}, then ${RECORD_COMMAND}.`,
    );
  return rows;
};
const mean = (values: number[]) =>
  values.length
    ? `${(values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(3)} (n=${values.length})`
    : 'n/a (n=0)';
export const formatReport = (rows: EvalRow[]): string => {
  const correct = rows.filter((row) => row.correct).length;
  const confidence = (right: boolean) =>
    mean(
      rows.flatMap((row) =>
        row.correct === right && row.confidence !== undefined ? [row.confidence] : [],
      ),
    );
  const fixtures = new Map(rows.map((row) => [row.fixture, row.synthetic]));
  const synthetic = [...fixtures.values()].filter(Boolean).length;
  const fallbacks = new Map<string, number>();
  for (const row of new Map(rows.map((row) => [row.fixture, row])).values()) {
    if (row.fallbackReason)
      fallbacks.set(row.fallbackReason, (fallbacks.get(row.fallbackReason) ?? 0) + 1);
  }
  const orchestrated = new Set(rows.flatMap((row) => (row.applied ? [row.fixture] : []))).size;
  return [
    `Accuracy: ${correct}/${rows.length} (${((100 * correct) / rows.length).toFixed(1)}%) against the acceptable sets`,
    `Mean confidence: correct ${confidence(true)}, incorrect ${confidence(false)}; Noul answers have none. Not a calibration claim.`,
    `Fixtures: ${fixtures.size} (${fixtures.size - synthetic} recorded, ${synthetic} synthetic). Synthetic samples prove the harness; they are not evidence of Jev quality.`,
    `Orchestrator replays: ${orchestrated}, illegalAppliedActionCount 0, fallbacks: ${[...fallbacks].map(([reason, n]) => `${reason} ${n}`).join(', ') || 'none'}`,
    'Fixture | Question | Answer | Confidence | Correct | Applied | Fallback | Synthetic',
    ...rows.map(
      (row) =>
        `${row.fixture} | ${row.question} | ${row.answer} | ${row.confidence?.toFixed(3) ?? 'n/a'} | ${row.correct ? 'yes' : 'no'} | ${row.applied ?? 'n/a'} | ${row.fallbackReason ?? (row.applied ? 'none' : 'n/a')} | ${row.synthetic ? 'yes' : 'no'}`,
    ),
  ].join('\n');
};
/** Human-only entry point; tests inject a fake instead of making a live call. */
export const recordFixture = async (
  input: string,
  output: string,
  createClient: () => JevClient = createSdkJevClient,
): Promise<void> => {
  if (process.env.CI !== undefined) throw new Error('--record refuses to run when CI is set.');
  const client = createClient(); // Key handling belongs exclusively to ai/.
  const parsed = scenarioSchema.safeParse(await readJson(input));
  if (!parsed.success) throw new Error(`${input}: schema error: ${parsed.error.message}`);
  validateScenario(parsed.data);
  const result = await client.ask(parsed.data.request, { decisionSignal: decisionDeadline() });
  if (!result.ok)
    throw new Error(`Recording failed (${result.fallbackReason}); no fixture written.`);
  const fixture = parseFixture(
    { ...parsed.data, requestHash: requestHash(parsed.data.request), recorded: result },
    input,
  );
  await writeFile(output, await serialize(fixture), { flag: 'wx' });
};
const fixturePath = (directory: string, id: string) => join(directory, `${id}.json`);
/** The scenario's fixture when it exists; a file that fails to parse is reported, never replaced. */
async function existing(directory: string, id: string): Promise<Fixture | undefined> {
  const path = fixturePath(directory, id);
  if (
    !(await access(path).then(
      () => true,
      () => false,
    ))
  )
    return undefined;
  return parseFixture(await readJson(path), path);
}
/** The fixture as `npm run format:check` expects it, so a recording can be committed as written. */
const serialize = async (fixture: Fixture): Promise<string> =>
  format(JSON.stringify(fixture), {
    ...(await resolveConfig(fixturePath(DEFAULT_FIXTURES, fixture.id))),
    parser: 'json',
  });
const write = async (directory: string, fixture: Fixture) =>
  writeFile(fixturePath(directory, fixture.id), await serialize(fixture));
/**
 * Human-only: records live every scenario whose fixture is missing, synthetic or stale, through
 * the orchestrator with the `ai/` client, and writes it with `synthetic: false`. A current
 * recording is kept. One request per scenario, within the spec §9 budget.
 */
export const recordScenarios = async (
  directory = DEFAULT_FIXTURES,
  createClient: () => JevClient = createSdkJevClient,
  scenarios: readonly EvalScenario[] = SCENARIOS,
): Promise<{ recorded: string[]; current: string[] }> => {
  if (process.env.CI !== undefined) throw new Error('--record refuses to run when CI is set.');
  const client = createClient(); // Key handling belongs exclusively to ai/.
  const recorded: string[] = [];
  const current: string[] = [];
  const failed: string[] = [];
  for (const scenario of scenarios) {
    const saved = await existing(directory, scenario.id);
    if (
      saved &&
      !saved.synthetic &&
      saved.requestHash === requestHash(await scenarioRequest(scenario))
    ) {
      current.push(scenario.id);
      continue;
    }
    const run = await runScenario(scenario, client);
    const [result] = run.results;
    if (run.requests.length !== 1 || !result?.ok) {
      failed.push(
        `${scenario.id} (${result && !result.ok ? result.fallbackReason : 'no request'})`,
      );
      continue;
    }
    await write(directory, scenarioFixture(scenario, run, result, false));
    recorded.push(scenario.id);
  }
  if (failed.length)
    throw new Error(
      `Recording failed for ${failed.join(', ')}; no fixture written for them. Recorded: ${recorded.join(', ') || 'none'}.`,
    );
  return { recorded, current };
};
/**
 * Offline: writes a synthetic placeholder for every scenario with no fixture, or with a stale
 * synthetic one, so CI replays it until a person records it. A current fixture, recorded or not,
 * only takes the scenario's description and acceptable set; a recording is never replaced.
 */
export const writePlaceholders = async (
  directory = DEFAULT_FIXTURES,
  scenarios: readonly EvalScenario[] = SCENARIOS,
): Promise<string[]> => {
  const written: string[] = [];
  for (const scenario of scenarios) {
    const saved = await existing(directory, scenario.id);
    const request = await scenarioRequest(scenario);
    const current = saved?.requestHash === requestHash(request);
    if (saved && !saved.synthetic && !current) continue;
    const answer = current
      ? { ...saved!.recorded, requestId: saved!.recorded.requestId }
      : placeholderResult(scenario.id, request);
    const run = await runScenario(scenario, { ask: async () => answer });
    const fixture = scenarioFixture(
      scenario,
      run,
      answer,
      saved && current ? saved.synthetic : true,
    );
    if (JSON.stringify(fixture) === JSON.stringify(saved)) continue;
    await write(directory, fixture);
    written.push(scenario.id);
  }
  return written;
};
