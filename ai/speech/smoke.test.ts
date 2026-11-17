import { describe, expect, test } from 'vitest';
import { createFakeHaikuClient } from '../haiku/fake.ts';
import { PINNED_HAIKU_MODEL, type HaikuResult } from '../haiku/client.ts';
import { percentile, runSmoke, SMOKE_BRIEFS, summarize } from './smoke.ts';

const env = { HAIKU_ENABLED: 'true', ANTHROPIC_API_KEY: 'placeholder-smoke-key-not-real' };
const usage = () => ({ record: () => {}, budgetExceeded: () => false });
const line = (inputTokens: number): HaikuResult => ({
  ok: true,
  text: 'That went well for me, and the grass looks friendly today.',
  model: PINNED_HAIKU_MODEL,
  latencyMs: 5,
  usage: { inputTokens, outputTokens: 10 },
});

describe('speech smoke check (spec §9)', () => {
  test('percentiles are nearest-rank, and none for no calls', () => {
    const tenCalls = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1];
    expect(percentile(tenCalls, 50)).toBe(5);
    expect(percentile(tenCalls, 95)).toBe(10);
    expect(percentile([], 50)).toBeNull();
  });

  test('every fixed brief is sent once per round and each call reports its line, tokens, baht and latency', async () => {
    const client = createFakeHaikuClient(() => line(100));
    const calls = await runSmoke({ client, env, usage }, 4);
    expect(calls).toHaveLength(4 * SMOKE_BRIEFS.length);
    expect(client.requests).toHaveLength(calls.length);
    expect(calls.slice(0, 3).map((call) => call.situation)).toEqual(
      SMOKE_BRIEFS.map((brief) => brief.situation),
    );
    // 100 input tokens at $0.10 and 10 output at $0.50 per million, at 33 THB/USD.
    expect(calls[0]).toMatchObject({
      source: 'haiku',
      inputTokens: 100,
      outputTokens: 10,
      fallbackReason: null,
    });
    expect(calls[0]!.thb).toBeCloseTo(0.000495, 9);
    expect(summarize(calls)).toMatchObject({
      calls: 12,
      sent: 12,
      haikuLines: 12,
      inputTokensPerCall: 100,
    });
  });

  test('a call that never went out has no tokens and stays out of the latency and cost averages', async () => {
    const results: HaikuResult[] = [
      line(300),
      { ok: false, fallbackReason: 'disabled', requestSent: false },
      { ok: false, fallbackReason: 'timeout', usage: { inputTokens: 1500, outputTokens: 80 } },
    ];
    let next = 0;
    const client = createFakeHaikuClient(() => results[next++]!);
    const calls = await runSmoke({ client, env, usage }, 1);
    expect(calls.map((call) => call.inputTokens)).toEqual([300, null, 1500]);
    expect(calls[1]).toMatchObject({ source: 'bank', fallbackReason: 'disabled', thb: null });
    expect(summarize(calls)).toMatchObject({
      calls: 3,
      sent: 2,
      haikuLines: 1,
      inputTokensPerCall: 900,
    });
  });
});
