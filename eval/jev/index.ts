import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createSdkJevClient, decisionDeadline, type JevClient } from '../../ai/jev/client.ts';
import {
  FixtureJevClient,
  fixtureSchema,
  scenarioSchema,
  validateFixture,
  validateScenario,
  requestHash,
  type Fixture,
} from './fixture.ts';

export const DEFAULT_FIXTURES = join(import.meta.dirname, 'fixtures');
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
}
export const runOffline = async (directory = DEFAULT_FIXTURES): Promise<EvalRow[]> => {
  const files = (await readdir(directory)).filter((name) => name.endsWith('.json')).sort();
  if (!files.length) throw new Error(`${directory}: schema error: no fixtures`);
  const rows: EvalRow[] = [];
  const seen = new Set<string>();
  for (const file of files) {
    const path = join(directory, file);
    const fixture = parseFixture(await readJson(path), path);
    if (seen.has(fixture.id)) throw new Error(`${path}: schema error: duplicate fixture id`);
    seen.add(fixture.id);
    const client = new FixtureJevClient(fixture);
    const result = await client.ask(fixture.request, { decisionSignal: decisionDeadline() });
    if (!result.ok)
      throw new Error(client.error ?? `${fixture.id}: replay failed (${result.fallbackReason})`);
    for (const [name, answer] of Object.entries(result.answers)) {
      // Score: most probable rubric ID, first ID wins ties. Noul: >= 0.5 means true.
      const id =
        answer.type === 'choice'
          ? answer.choice
          : answer.type === 'noul'
            ? String(answer.noul >= 0.5)
            : Object.entries(answer.probabilities).reduce((best, next) =>
                next[1] > best[1] ? next : best,
              )[0];
      rows.push({
        fixture: fixture.id,
        synthetic: fixture.synthetic,
        question: name,
        answer: id,
        confidence: answer.type === 'noul' ? undefined : answer.confidence,
        correct: fixture.acceptable[name]!.includes(id),
      });
    }
  }
  return rows;
};
export const formatReport = (rows: EvalRow[]): string => {
  const correct = rows.filter((row) => row.correct).length;
  return [
    `Accuracy: ${correct}/${rows.length} (${((100 * correct) / rows.length).toFixed(1)}%)`,
    'Synthetic samples prove the harness; they are not evidence of Jev quality.',
    'Fixture | Question | Answer | Confidence | Correct | Synthetic',
    ...rows.map(
      (row) =>
        `${row.fixture} | ${row.question} | ${row.answer} | ${row.confidence?.toFixed(3) ?? 'n/a'} | ${row.correct ? 'yes' : 'no'} | ${row.synthetic ? 'yes' : 'no'}`,
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
  await writeFile(output, `${JSON.stringify(fixture, null, 2)}\n`, { flag: 'wx' });
};
