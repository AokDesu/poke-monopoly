import type { Hono } from 'hono';
import { afterEach, expect, test, vi } from 'vitest';
import fixture from '../engine/fixtures/encounter-with-balls.json';
import { fixtureSchema, oddsForAllBalls } from '../engine/index.ts';
import { createApp } from './app.ts';
import { DECISION_DEADLINE_MS } from './jev/client.ts';
import { LINES } from './lines.ts';

const parsed = fixtureSchema.parse(fixture);
const seatIndex = parsed.state.activeSeatIndex;
const request = {
  gameId: 'presentation-game',
  seatIndex,
  decisionPoint: 'encounter',
  stateRevision: parsed.state.stateRevision,
  observation: parsed.observation[String(seatIndex)],
  enabledActions: parsed.legalActions[String(seatIndex)]!.enabled,
  facts: { catchOdds: oddsForAllBalls(parsed.state, seatIndex) },
  difficulty: 'normal',
  personalityId: 'greedy',
  turnKey: 'turn-one',
};
const post = (app: Hono, path: string, body: unknown = request) =>
  app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
afterEach(() => vi.unstubAllEnvs());

test('the prepared fallback uses the existing server policy without calling the decider, and returns a resolvable notice', async () => {
  vi.stubEnv('JEV_ENABLED', 'false');
  const decider = vi.fn(async () => ({ choice: 'release', source: 'jev' as const }));
  const app = createApp({ decider });
  const fallback = await post(app, '/api/ai/fallback');
  expect(fallback.status).toBe(200);
  expect(await fallback.json()).toMatchObject({ choice: 'catch:great', source: 'fallback' });
  expect(decider).not.toHaveBeenCalled();
  expect(fallback.headers.get('x-ai-decision-ms')).toBe(String(DECISION_DEADLINE_MS));
  expect(
    LINES.fallback_notice.some((line) => line.id === fallback.headers.get('x-ai-line-id')),
  ).toBe(true);
  const again = await post(app, '/api/ai/fallback');
  expect(again.headers.get('x-ai-line-id')).toBe(fallback.headers.get('x-ai-line-id'));
});

test('fallback preparation validates role-scoped request revisions before making a choice', async () => {
  const response = await post(createApp(), '/api/ai/fallback', { ...request, stateRevision: 999 });
  expect(response.status).toBe(400);
});

test('decide adds a bank notice only to fallback responses and leaves its decision body unchanged', async () => {
  vi.stubEnv('JEV_ENABLED', 'false');
  const fallback = await post(createApp(), '/api/ai/decide');
  expect(fallback.headers.get('x-ai-line-id')).toMatch(/^fallback-notice-greedy-neutral-/);
  const jev = await post(
    createApp({ decider: async () => ({ choice: 'release', source: 'jev' }) }),
    '/api/ai/decide',
  );
  expect(await jev.json()).toMatchObject({ choice: 'release', source: 'jev' });
  expect(jev.headers.get('x-ai-line-id')).toBeNull();
});

test('normal-play fallbacks (auto, invalid choice, low confidence, missing facts, shop stub) carry no backup-bot notice', async () => {
  for (const fallbackReason of [
    'auto',
    'invalid_choice',
    'low_confidence',
    'missing_facts',
    'stub',
  ] as const) {
    const app = createApp({
      decider: async () => ({ choice: 'release', source: 'fallback', fallbackReason }),
    });
    const response = await post(app, '/api/ai/decide');
    expect(await response.json()).toMatchObject({ choice: 'release', fallbackReason });
    expect(response.headers.get('x-ai-line-id')).toBeNull();
    expect(response.headers.get('x-ai-dialogue-events')).toBeNull();
  }
});
