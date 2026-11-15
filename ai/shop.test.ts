import { expect, test, vi } from 'vitest';
import { fixtureSchema } from '../engine/index.ts';
import fixture from '../engine/fixtures/shop-low-coins.json';
import { createApp } from './app.ts';
import type { DecisionRecord } from './jev/decision-log.ts';

const parsed = fixtureSchema.parse(fixture);
const request = {
  gameId: 'shop-offline-game',
  seatIndex: 0,
  decisionPoint: 'shop',
  stateRevision: parsed.state.stateRevision,
  observation: parsed.observation['0'],
  enabledActions: parsed.legalActions['0']!.enabled,
  facts: {},
  difficulty: 'normal',
  personalityId: 'greedy',
  turnKey: 'shop-offline-game:7:0',
};
const post = (body: unknown, app = createApp()) =>
  app.request('/api/ai/decide', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

test('Shop uses the offline seeded fallback, never Jev, and selects only an enabled option', async () => {
  const decider = vi.fn();
  const app = createApp({ decider });
  const answers = [];
  for (let index = 0; index < 4; index++) {
    const response = await post(request, app);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(request.enabledActions.some((choice) => choice.id === body.choice)).toBe(true);
    expect(body).toMatchObject({ source: 'fallback', fallbackReason: 'auto' });
    answers.push(body.choice);
  }
  expect(new Set(answers).size).toBe(1);
  expect(decider).not.toHaveBeenCalled();
});

const apply = (answer: Record<string, unknown>, app: ReturnType<typeof createApp>) =>
  app.request('/api/ai/outcome', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      gameId: request.gameId,
      seatIndex: request.seatIndex,
      turnKey: request.turnKey,
      stateRevision: request.stateRevision,
      decisionPoint: 'shop',
      choice: answer.choice,
      source: answer.source,
      fallbackReason: answer.fallbackReason,
    }),
  });

test('a Shop decision is one decision-log row, labelled as a non-Jev decision, never a stub', async () => {
  const records: DecisionRecord[] = [];
  const app = createApp({ decisionLog: (line) => records.push(line) });
  const answer = await (await post(request, app)).json();
  // Nothing is logged until the browser reports what it applied, like every other decision.
  expect(records).toHaveLength(0);
  expect((await apply(answer, app)).status).toBe(204);
  expect(records).toHaveLength(1);
  expect(records[0]).toMatchObject({
    decisionPoint: 'shop',
    questionId: 'shop',
    choice: answer.choice,
    requestId: null,
    model: null,
    probabilities: null,
    confidence: null,
    sampled: null,
    fallbackReason: 'auto',
  });
  expect(JSON.stringify(records)).not.toContain('stub');
  // A repeat report of the same decision does not add a second row.
  await apply(answer, app);
  expect(records).toHaveLength(1);
});

test('the speculative fallback for a Shop request is never logged', async () => {
  const records: DecisionRecord[] = [];
  const app = createApp({ decisionLog: (line) => records.push(line) });
  const response = await app.request('/api/ai/fallback', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request),
  });
  await apply(await response.json(), app);
  expect(records).toHaveLength(0);
});

test('a Shop answer replaced by the browser deadline logs its own outcome', async () => {
  const records: DecisionRecord[] = [];
  const app = createApp({ decisionLog: (line) => records.push(line) });
  const answer = await (await post(request, app)).json();
  await apply({ ...answer, source: 'fallback', fallbackReason: 'timeout' }, app);
  expect(records).toHaveLength(1);
  expect(records[0]).toMatchObject({ decisionPoint: 'shop', fallbackReason: 'timeout' });
});

test.each([
  { ...request, seatIndex: 1 },
  { ...request, stateRevision: request.stateRevision + 1 },
  {
    ...request,
    observation: { ...request.observation, own: { ...request.observation!.own, rng: 'secret' } },
  },
  {
    ...request,
    observation: {
      ...request.observation,
      public: { ...request.observation!.public, phase: { kind: 'strategy' } },
    },
  },
  { ...request, enabledActions: [] },
  { ...request, enabledActions: [request.enabledActions[0], request.enabledActions[0]] },
])('Shop rejects mismatched, hidden or unusable request data', async (body) => {
  expect((await post(body)).status).toBe(400);
});
