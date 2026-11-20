import { access, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { format, resolveConfig } from 'prettier';
import {
  createSdkJevClient,
  decisionDeadline,
  resolveJevModel,
  type JevClient,
} from '../../ai/jev/client.ts';
import { PERSONALITIES } from '../../ai/fallback/index.ts';
import { defaultUsageLedger, type UsageRecorder } from '../../ai/jev/spend.ts';
import { billedUsage } from '../../ai/jev/usage.ts';
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
import { DEAL_SCENARIOS } from './deal-scenarios.ts';
import { SCENARIOS, type EvalScenario } from './scenarios.ts';

/** Every scenario Jev answers: the decision-point scenarios (§8) and the Deal Card ones (#164 D3). */
export const ALL_SCENARIOS: readonly EvalScenario[] = [...SCENARIOS, ...DEAL_SCENARIOS];

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
  /** The scenario's personality name, from the fixture's tags. */
  personality: string;
  synthetic: boolean;
  question: string;
  answer: string;
  confidence: number | undefined;
  correct: boolean;
  /** Scenario fixtures only: the action the orchestrator applied and why it fell back. */
  applied?: string;
  fallbackReason?: OrchestratorFallbackReason | null;
}
/**
 * A Sell Phase Noul counts as `true` only at the seat's own sell threshold (spec §5.3: sell when
 * `noul >= threshold(personality)`), because that is the decision the game makes. Any other
 * Noul keeps the 0.5 cut-off.
 */
const noulCutoff = (fixture: Fixture): number => {
  if (fixture.tags.decisionPoint !== 'sell') return 0.5;
  const personality = Object.values(PERSONALITIES).find(
    ({ name }) => name === fixture.tags.personality,
  );
  if (!personality) throw new Error(`${fixture.id}: no personality "${fixture.tags.personality}"`);
  return personality.sellThreshold;
};
/** Score: most probable rubric ID, first ID wins ties. Noul: true at or above `cutoff`. */
const answerId = (answer: Fixture['recorded']['answers'][string], cutoff: number): string =>
  answer.type === 'choice'
    ? answer.choice
    : answer.type === 'noul'
      ? String(answer.noul >= cutoff)
      : Object.entries(answer.probabilities).reduce((best, next) =>
          next[1] > best[1] ? next : best,
        )[0];
const rowsFor = (fixture: Fixture, extra: Partial<EvalRow> = {}): EvalRow[] =>
  Object.entries(fixture.recorded.answers).map(([name, answer]) => {
    const id = answerId(answer, noulCutoff(fixture));
    return {
      fixture: fixture.id,
      personality: fixture.tags.personality,
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
  scenarios: readonly EvalScenario[] = ALL_SCENARIOS,
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
/** Spec §8: the eval set holds at least 60 decision scenarios, at least 15 per personality. */
export const SCENARIO_TARGET = Object.freeze({ total: 60, perPersonality: 15 });

/** One line per personality: how many scenarios it has, and how many are recorded or synthetic. */
const personalityCounts = (rows: EvalRow[]): string => {
  const fixtures = new Map(rows.map((row) => [row.fixture, row]));
  const counts = new Map<string, { recorded: number; synthetic: number }>();
  for (const { personality, synthetic } of fixtures.values()) {
    const count = counts.get(personality) ?? { recorded: 0, synthetic: 0 };
    count[synthetic ? 'synthetic' : 'recorded']++;
    counts.set(personality, count);
  }
  const short = [...counts]
    .filter(([, { recorded, synthetic }]) => recorded + synthetic < SCENARIO_TARGET.perPersonality)
    .map(([name]) => name);
  const met = fixtures.size >= SCENARIO_TARGET.total && short.length === 0;
  return [
    `Scenarios by personality: ${[...counts]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(
        ([name, { recorded, synthetic }]) =>
          `${name} ${recorded + synthetic} (${recorded} recorded, ${synthetic} synthetic)`,
      )
      .join(', ')}`,
    `Spec §8 scenario set (at least ${SCENARIO_TARGET.total}, ${SCENARIO_TARGET.perPersonality} per personality): ${met ? 'met' : `NOT met${short.length ? `, short: ${short.join(', ')}` : ''}`}. Counts include synthetic placeholders until a person records them.`,
  ].join('\n');
};

/**
 * Accuracy and confidence cover recorded fixtures only. A synthetic placeholder answers from a
 * seed, not from Jev, so scoring it would pass off a stand-in as evidence of Jev quality.
 */
export const formatReport = (rows: EvalRow[]): string => {
  const recorded = rows.filter((row) => !row.synthetic);
  const correct = recorded.filter((row) => row.correct).length;
  const confidence = (right: boolean) =>
    mean(
      recorded.flatMap((row) =>
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
    `Accuracy: ${correct}/${recorded.length} (${recorded.length ? ((100 * correct) / recorded.length).toFixed(1) : '0.0'}%) against the acceptable sets, recorded fixtures only`,
    `Mean confidence: correct ${confidence(true)}, incorrect ${confidence(false)}; Noul answers have none. Recorded fixtures only. Not a calibration claim.`,
    `Fixtures: ${fixtures.size} (${fixtures.size - synthetic} recorded, ${synthetic} synthetic). Synthetic placeholders prove the harness; they are seeded stand-ins, not Jev answers, and are left out of the accuracy and confidence above. A person with the key replaces them (${RECORD_COMMAND}).`,
    personalityCounts(rows),
    `Orchestrator replays: ${orchestrated}, illegalAppliedActionCount 0, fallbacks: ${[...fallbacks].map(([reason, n]) => `${reason} ${n}`).join(', ') || 'none'}`,
    'Fixture | Question | Answer | Confidence | Correct | Applied | Fallback | Synthetic',
    ...rows.map(
      (row) =>
        `${row.fixture} | ${row.question} | ${row.answer} | ${row.confidence?.toFixed(3) ?? 'n/a'} | ${row.synthetic ? 'n/a (synthetic)' : row.correct ? 'yes' : 'no'} | ${row.applied ?? 'n/a'} | ${row.fallbackReason ?? (row.applied ? 'none' : 'n/a')} | ${row.synthetic ? 'yes' : 'no'}`,
    ),
  ].join('\n');
};
const BUDGET_EXCEEDED =
  'Recording refused: the Jev spend cap or daily budget is reached (spec §9).';
/**
 * Human-only entry point; the request is logged to and guarded by the usage ledger (spec §9).
 * Tests inject a fake client and ledger instead of making a live call.
 */
export const recordFixture = async (
  input: string,
  output: string,
  createClient: () => JevClient = createSdkJevClient,
  createUsage: () => UsageRecorder = defaultUsageLedger,
): Promise<void> => {
  if (process.env.CI !== undefined) throw new Error('--record refuses to run when CI is set.');
  const client = createClient(); // Key handling belongs exclusively to ai/.
  const usage = createUsage();
  const parsed = scenarioSchema.safeParse(await readJson(input));
  if (!parsed.success) throw new Error(`${input}: schema error: ${parsed.error.message}`);
  validateScenario(parsed.data);
  if (usage.budgetExceeded()) throw new Error(BUDGET_EXCEEDED);
  const time = new Date().toISOString();
  const sent = performance.now();
  const result = await client.ask(parsed.data.request, { decisionSignal: decisionDeadline() });
  const latencyMs = Math.round(performance.now() - sent);
  const billed = billedUsage(result);
  if (billed) {
    usage.record({
      time,
      gameId: `record:${parsed.data.id}`,
      requestId: result.ok ? (result.requestId ?? null) : null,
      model: result.ok ? result.model : resolveJevModel(),
      inputTokens: billed.inputTokens,
      outputTokens: billed.outputTokens,
      latencyMs,
      status: result.ok ? 'ok' : result.fallbackReason,
      turnKey: 'record',
      decision: 0,
      decisionMs: latencyMs,
      ...(billed.estimated && { estimated: true }),
    });
  }
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
 * recording is kept. One request per scenario, logged to and guarded by the usage ledger (§9).
 */
export const recordScenarios = async (
  directory = DEFAULT_FIXTURES,
  createClient: () => JevClient = createSdkJevClient,
  scenarios: readonly EvalScenario[] = ALL_SCENARIOS,
  createUsage: () => UsageRecorder = defaultUsageLedger,
): Promise<{ recorded: string[]; current: string[] }> => {
  if (process.env.CI !== undefined) throw new Error('--record refuses to run when CI is set.');
  const client = createClient(); // Key handling belongs exclusively to ai/.
  const usage = createUsage();
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
    const run = await runScenario(scenario, client, usage);
    const [result] = run.results;
    if (run.requests.length !== 1 || !result?.ok) {
      failed.push(
        `${scenario.id} (${result && !result.ok ? result.fallbackReason : (run.decision.fallbackReason ?? 'no request')})`,
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
  scenarios: readonly EvalScenario[] = ALL_SCENARIOS,
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
