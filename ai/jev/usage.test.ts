import { expect, test } from 'vitest';
import type { JevResult } from './client.ts';
import { UsageMeter } from './usage.ts';

const success = (inputTokens: number, outputTokens: number): JevResult => ({
  ok: true,
  answers: {},
  requestId: 'req_1',
  model: 'jev-1.13.0',
  latencyMs: 120,
  usage: { inputTokens, outputTokens },
});

test('adds up calls and tokens for one game', () => {
  const meter = new UsageMeter();
  expect(meter.totals()).toEqual({ calls: 0, inputTokens: 0, outputTokens: 0 });
  meter.record(success(600, 20));
  meter.record(success(400, 4));
  meter.record({ ok: false, fallbackReason: 'timeout' });
  meter.record({ ok: false, fallbackReason: 'rate_limited', status: 429, retryAfterMs: 1000 });
  expect(meter.totals()).toEqual({ calls: 4, inputTokens: 1000, outputTokens: 24 });
});

test('a disabled result is not a call', () => {
  const meter = new UsageMeter();
  meter.record({ ok: false, fallbackReason: 'disabled' });
  expect(meter.totals().calls).toBe(0);
});

test('each game has its own meter', () => {
  const first = new UsageMeter();
  const second = new UsageMeter();
  first.record(success(10, 1));
  expect(second.totals()).toEqual({ calls: 0, inputTokens: 0, outputTokens: 0 });
  first.totals().calls = 99;
  expect(first.totals().calls).toBe(1);
});
