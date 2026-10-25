import { expect, test, vi } from 'vitest';
import { fixtureSchema } from '../engine/index.ts';
import fixture from '../engine/fixtures/shop-low-coins.json';
import { createApp } from './app.ts';

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
    expect(body).toMatchObject({ source: 'fallback', fallbackReason: 'stub' });
    answers.push(body.choice);
  }
  expect(new Set(answers).size).toBe(1);
  expect(decider).not.toHaveBeenCalled();
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
