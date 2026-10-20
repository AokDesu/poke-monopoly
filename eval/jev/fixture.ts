import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { AskOptions, JevClient, JevRequest, JevResult } from '../../ai/jev/client.ts';
import { createFakeJevClient } from '../../ai/jev/fake.ts';

const entry = z.union([z.string(), z.record(z.string(), z.json()), z.array(z.json()), z.null()]);
const instructions = entry.optional();
const question = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('choice'),
    instructions,
    criteria: z
      .record(z.string(), entry)
      .refine((v) => Object.keys(v).length > 0 && Object.keys(v).length <= 255),
  }),
  z.strictObject({
    type: z.literal('score'),
    instructions,
    criteria: z.tuple([entry, entry], entry).refine((v) => v.length <= 10),
  }),
  z.strictObject({
    type: z.literal('noul'),
    instructions,
    criteria: z
      .strictObject({ true: entry.optional(), false: entry.optional() })
      .nullable()
      .optional(),
  }),
]);
const probability = z.number().min(0).max(1);
const probabilities = z.record(z.string(), probability);
const answer = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('choice'),
    choice: z.string(),
    confidence: probability,
    probabilities,
  }),
  z.strictObject({
    type: z.literal('score'),
    score: z.number(),
    confidence: probability,
    probabilities,
  }),
  z.strictObject({ type: z.literal('noul'), noul: probability }),
]);
export const scenarioSchema = z.strictObject({
  id: z.string().regex(/^[a-zA-Z0-9_-]+$/),
  description: z.string().min(1),
  tags: z.strictObject({ decisionPoint: z.string().min(1), personality: z.string().min(1) }),
  request: z.strictObject({
    state: entry,
    questions: z.record(z.string(), question).refine((v) => Object.keys(v).length > 0),
  }),
  acceptable: z.record(z.string(), z.array(z.string().min(1)).min(1)),
  synthetic: z.boolean(),
});
// The full JevClient success includes replay metadata, never SDK headers.
export const fixtureSchema = scenarioSchema.extend({
  requestHash: z.string().regex(/^[a-f0-9]{64}$/),
  recorded: z.strictObject({
    ok: z.literal(true),
    answers: z.record(z.string(), answer),
    requestId: z.string().optional(),
    model: z.string().min(1),
    latencyMs: z.number().nonnegative(),
    usage: z.strictObject({
      inputTokens: z.int().nonnegative(),
      outputTokens: z.int().nonnegative(),
    }),
  }),
});
export type Scenario = z.infer<typeof scenarioSchema>;
export type Fixture = z.infer<typeof fixtureSchema>;
const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, item]) => [key, canonical(item)]),
    );
  }
  return value;
};
export const requestHash = (request: JevRequest): string =>
  createHash('sha256')
    .update(JSON.stringify(canonical(request)))
    .digest('hex');
const offered = (request: JevRequest, name: string): string[] => {
  const q = request.questions[name];
  if (!q) return [];
  return q.type === 'noul' ? ['true', 'false'] : Object.keys(q.criteria);
};
export const validateScenario = (scenario: Scenario): void => {
  const names = Object.keys(scenario.request.questions);
  if (
    Object.keys(scenario.acceptable).length !== names.length ||
    !names.every(
      (name) =>
        Object.hasOwn(scenario.acceptable, name) &&
        scenario.acceptable[name]!.every((id) => offered(scenario.request, name).includes(id)),
    )
  ) {
    throw new Error(
      `${scenario.id}: schema error: acceptable must contain offered answer IDs for every question`,
    );
  }
};
export const validateFixture = (fixture: Fixture): void => {
  validateScenario(fixture);
  if (requestHash(fixture.request) !== fixture.requestHash)
    throw new Error(`${fixture.id}: request changed, re-record`);
  const names = Object.keys(fixture.request.questions);
  if (Object.keys(fixture.recorded.answers).length !== names.length)
    throw new Error(`${fixture.id}: illegal answer: question names do not match`);
  for (const name of names) {
    const q = fixture.request.questions[name]!;
    const a = fixture.recorded.answers[name];
    const ids = offered(fixture.request, name);
    if (
      !a ||
      a.type !== q.type ||
      (a.type !== 'noul' && !Object.keys(a.probabilities).every((id) => ids.includes(id))) ||
      (a.type === 'choice' && !ids.includes(a.choice)) ||
      (a.type === 'score' && (a.score < 0 || a.score > ids.length - 1))
    ) {
      throw new Error(`${fixture.id}/${name}: illegal answer: not among the offered options`);
    }
    if (a.type !== 'noul' && !ids.every((id) => Object.hasOwn(a.probabilities, id)))
      throw new Error(`${fixture.id}/${name}: schema error: probabilities must cover every option`);
  }
};
/** Replay uses the existing fake and preserves JevClient's no-throw contract. */
export class FixtureJevClient implements JevClient {
  error: string | undefined;
  private readonly fake: JevClient;
  constructor(fixture: Fixture) {
    validateFixture(fixture);
    const saved = structuredClone(fixture);
    this.fake = createFakeJevClient((request) => {
      this.error = undefined;
      if (requestHash(request) !== saved.requestHash) {
        this.error = `${saved.id}: request changed, re-record`;
        return { ok: false, fallbackReason: 'schema_mismatch', requestSent: false };
      }
      return structuredClone({ ...saved.recorded, requestId: saved.recorded.requestId });
    });
  }
  ask(request: JevRequest, options: AskOptions): Promise<JevResult> {
    return this.fake.ask(request, options);
  }
}
