import { afterEach, describe, expect, test, vi } from 'vitest';
import { createDuelRun, createDuelSeat, jevRunMode } from './jev-policy.ts';

afterEach(() => vi.unstubAllEnvs());

describe('the G2 duel wiring (spec §5.6, §9)', () => {
  test('mode: disabled by the kill switch, live only with a key, offline never live', () => {
    vi.stubEnv('TYPESAFE_API_KEY', '');
    vi.stubEnv('JEV_ENABLED', '');
    expect(jevRunMode()).toBe('fake');
    vi.stubEnv('TYPESAFE_API_KEY', 'not-a-real-key');
    expect(jevRunMode()).toBe('live');
    expect(jevRunMode(true)).toBe('fake');
    vi.stubEnv('JEV_ENABLED', 'false');
    expect(jevRunMode()).toBe('disabled');
    expect(jevRunMode(true)).toBe('disabled');
  });

  test('the offline run has no usage log, no rollout limit and Greedy seats on the chosen difficulty', () => {
    vi.stubEnv('JEV_ENABLED', '');
    const run = createDuelRun('g2/test/f0/treatment', 1, true);
    expect(run).toMatchObject({ mode: 'fake', rolloutMs: null });
    expect(run.usage()).toBeNull();
    expect(createDuelSeat(run, 'hard').difficulty).toBe('hard');
    expect(createDuelSeat(run, 'normal').personality.id).toBe('greedy');
    expect(createDuelSeat(run, 'normal').orchestrator).toBe(run.orchestrator);
  });

  test('a live run uses the server limits: Hard rollouts capped at 400 ms, a usage tally per game', () => {
    vi.stubEnv('JEV_ENABLED', '');
    vi.stubEnv('TYPESAFE_API_KEY', 'not-a-real-key');
    // Built, never asked: no request leaves the process in this test.
    const run = createDuelRun('g2/test/f0/treatment', 1);
    expect(run).toMatchObject({ mode: 'live', rolloutMs: 400 });
    expect(run.usage()).toEqual({ requests: 0, inputTokens: 0, estimatedRequests: 0, thb: 0 });
  });
});
