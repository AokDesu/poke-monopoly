import { afterEach, describe, expect, test, vi } from 'vitest';
import { createDuelRun, createDuelSeat, jevRunMode, tallyingRecorder } from './jev-policy.ts';
import { costUsd, SPEND_CONFIG, SpendLedger, type UsageLine } from './jev/spend.ts';

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

  describe('the live spend tally of one game', () => {
    const line = (inputTokens: number, extra: Partial<UsageLine> = {}): UsageLine => ({
      time: '2026-11-24T00:00:00.000Z',
      gameId: 'g2/test',
      requestId: 'r',
      model: 'jev-1.13.0',
      inputTokens,
      outputTokens: 20,
      latencyMs: 200,
      status: 'ok',
      turnKey: '1',
      decision: 1,
      decisionMs: 200,
      ...extra,
    });

    test('counts requests, tokens, estimated requests and THB from the lines it records, and forwards each line', () => {
      const appended: UsageLine[] = [];
      const ledger = new SpendLedger({ append: (l) => appended.push(l) });
      const { recorder, usage } = tallyingRecorder(ledger);
      expect(usage()).toEqual({ requests: 0, inputTokens: 0, estimatedRequests: 0, thb: 0 });
      const a = line(3000);
      const b = line(3500, { estimated: true, status: 'timeout' });
      recorder.record(a);
      recorder.record(b);
      expect(usage()).toMatchObject({ requests: 2, inputTokens: 6500, estimatedRequests: 1 });
      expect(usage().thb).toBeCloseTo((costUsd(a) + costUsd(b)) * SPEND_CONFIG.thbPerUsd, 12);
      expect(appended).toEqual([a, b]);
      // The tally is this game's; the ledger's total is the process's, and they agree here.
      expect(ledger.spentThb('jev')).toBeCloseTo(usage().thb, 12);
    });

    test('keeps the ledger as the spend guard: the budget answer and the reservation are its own', () => {
      const ledger = new SpendLedger({ config: { ...SPEND_CONFIG, totalCapThb: 0.0001 } });
      const { recorder, usage } = tallyingRecorder(ledger);
      expect(recorder.budgetExceeded()).toBe(false);
      const release = recorder.reserve?.();
      // Held in the ledger, not in the game's tally: a reservation is not spend.
      expect(release).toBeTypeOf('function');
      expect(ledger.reservedThb('jev')).toBeGreaterThan(0);
      expect(usage().thb).toBe(0);
      release!();
      expect(ledger.reservedThb('jev')).toBe(0);
      recorder.record(line(3000));
      expect(recorder.budgetExceeded()).toBe(true);
      expect(recorder.reserve?.()).toBeNull();
    });
  });
});
