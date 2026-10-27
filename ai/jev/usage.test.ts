import { describe, expect, test } from 'vitest';
import type { JevResult } from './client.ts';
import { SPEND_CONFIG } from './spend.ts';
import { billedUsage, UsageMeter } from './usage.ts';

const success = (inputTokens: number, outputTokens: number): JevResult => ({
  ok: true,
  answers: {},
  requestId: 'req_1',
  model: 'jev-1.13.0',
  latencyMs: 120,
  usage: { inputTokens, outputTokens },
});

test('the timeout estimate is the #5 spike’s measured average, from the config', () => {
  expect(SPEND_CONFIG.estimatedInputTokensPerRequest).toBe(3240);
});

test('adds up calls and tokens for one game, a timeout at the estimate', () => {
  const meter = new UsageMeter();
  expect(meter.totals()).toEqual({ calls: 0, inputTokens: 0, outputTokens: 0 });
  meter.record(success(600, 20));
  meter.record(success(400, 4));
  meter.record({ ok: false, fallbackReason: 'timeout' });
  meter.record({ ok: false, fallbackReason: 'rate_limited', status: 429, retryAfterMs: 1000 });
  expect(meter.totals()).toEqual({ calls: 4, inputTokens: 4240, outputTokens: 24 });
});

describe('billedUsage (spec §9)', () => {
  test('an answer that failed validation counts the tokens it reported', () => {
    const failed: JevResult = {
      ok: false,
      fallbackReason: 'schema_mismatch',
      usage: { inputTokens: 2900, outputTokens: 3 },
    };
    expect(billedUsage(failed)).toEqual({ inputTokens: 2900, outputTokens: 3, estimated: false });
    const meter = new UsageMeter();
    meter.record(failed);
    expect(meter.totals()).toEqual({ calls: 1, inputTokens: 2900, outputTokens: 3 });
  });

  test('a timeout with no reported usage counts the configured estimate, marked estimated', () => {
    expect(billedUsage({ ok: false, fallbackReason: 'timeout' })).toEqual({
      inputTokens: 3240,
      outputTokens: 0,
      estimated: true,
    });
    const config = { ...SPEND_CONFIG, estimatedInputTokensPerRequest: 5000 };
    expect(billedUsage({ ok: false, fallbackReason: 'timeout' }, config)?.inputTokens).toBe(5000);
  });

  test('a late answer that reported usage counts what it reported', () => {
    const late: JevResult = {
      ok: false,
      fallbackReason: 'timeout',
      usage: { inputTokens: 3100, outputTokens: 0 },
    };
    expect(billedUsage(late)).toEqual({ inputTokens: 3100, outputTokens: 0, estimated: false });
  });

  test('other failures count no tokens, and a request that never went out is not billed', () => {
    expect(billedUsage({ ok: false, fallbackReason: 'network' })).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      estimated: false,
    });
    expect(
      billedUsage({ ok: false, fallbackReason: 'timeout', requestSent: false }),
    ).toBeUndefined();
    expect(billedUsage({ ok: false, fallbackReason: 'disabled' })).toBeUndefined();
  });
});

test('a disabled result is not a call', () => {
  const meter = new UsageMeter();
  meter.record({ ok: false, fallbackReason: 'disabled' });
  expect(meter.totals().calls).toBe(0);
});

test('a failure that sent no request is not a call', () => {
  const meter = new UsageMeter();
  meter.record({ ok: false, fallbackReason: 'timeout', requestSent: false });
  meter.record({ ok: false, fallbackReason: 'schema_mismatch', requestSent: false });
  meter.record({ ok: false, fallbackReason: 'schema_mismatch', status: 422 });
  expect(meter.totals().calls).toBe(1);
});

test('each game has its own meter', () => {
  const first = new UsageMeter();
  const second = new UsageMeter();
  first.record(success(10, 1));
  expect(second.totals()).toEqual({ calls: 0, inputTokens: 0, outputTokens: 0 });
  first.totals().calls = 99;
  expect(first.totals().calls).toBe(1);
});
