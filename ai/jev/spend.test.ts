import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  costUsd,
  dailyBudgetFromEnv,
  openUsageLedger,
  readUsageLog,
  SPEND_CONFIG,
  SpendLedger,
  type UsageLine,
} from './spend.ts';

afterEach(() => {
  vi.unstubAllEnvs();
});

const NOW = new Date('2026-10-27T12:00:00.000Z');

/** Input tokens that cost `thb` at the configured price and exchange rate. */
const tokensFor = (thb: number) =>
  Math.ceil((thb / SPEND_CONFIG.thbPerUsd / SPEND_CONFIG.inputUsdPerMillionTokens) * 1_000_000);

const line = (inputTokens: number, time = NOW.toISOString()): UsageLine => ({
  time,
  gameId: 'game-1',
  requestId: 'req_1',
  model: 'jev-1.13.0',
  inputTokens,
  outputTokens: 0,
  latencyMs: 200,
  status: 'ok',
  turnKey: '1',
  decision: 0,
  decisionMs: 210,
});

describe('spend config (spec §1, §5.1, §9)', () => {
  test('input costs $0.042 per million tokens and output is free', () => {
    expect(costUsd({ inputTokens: 1_000_000, outputTokens: 1_000_000 })).toBeCloseTo(0.042, 12);
  });

  test('the #5 spike’s ~3,240 tokens per request cost about THB 0.0045', () => {
    expect(costUsd({ inputTokens: 3240, outputTokens: 0 }) * SPEND_CONFIG.thbPerUsd).toBeCloseTo(
      0.00449064,
      10,
    );
  });

  test('the cap is THB 1,500 at 33 THB/USD', () => {
    expect(SPEND_CONFIG).toMatchObject({ totalCapThb: 1500, thbPerUsd: 33 });
  });
});

describe('SpendLedger (spec §9)', () => {
  test('earlier log lines count toward the cap', () => {
    const ledger = new SpendLedger({ lines: [line(tokensFor(1500))], warn: () => {} });
    expect(ledger.spentThb()).toBeGreaterThanOrEqual(1500);
    expect(ledger.budgetExceeded()).toBe(true);
  });

  test('just under the cap is not exceeded; reaching it is', () => {
    const ledger = new SpendLedger({ lines: [line(tokensFor(1499))], warn: () => {} });
    expect(ledger.budgetExceeded()).toBe(false);
    ledger.record(line(tokensFor(1)));
    expect(ledger.budgetExceeded()).toBe(true);
  });

  test('warns once when spend reaches 80% of the cap', () => {
    const warn = vi.fn();
    const ledger = new SpendLedger({ lines: [line(tokensFor(1190))], warn });
    expect(warn).not.toHaveBeenCalled();
    ledger.record(line(tokensFor(10)));
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]![0]).toMatch(/80% or more of the THB 1500 cap/);
    ledger.record(line(tokensFor(100)));
    ledger.budgetExceeded();
    expect(warn).toHaveBeenCalledOnce();
  });

  test('a log already past 80% warns once on opening', () => {
    const warn = vi.fn();
    new SpendLedger({ lines: [line(tokensFor(1300))], warn });
    expect(warn).toHaveBeenCalledOnce();
  });

  test('the daily budget counts only today’s UTC spend', () => {
    const yesterday = '2026-10-26T23:59:59.000Z';
    const ledger = new SpendLedger({
      lines: [line(tokensFor(30), yesterday)],
      dailyBudgetThb: 20,
      now: () => NOW,
    });
    expect(ledger.spentTodayThb()).toBe(0);
    expect(ledger.budgetExceeded()).toBe(false);
    ledger.record(line(tokensFor(20)));
    expect(ledger.budgetExceeded()).toBe(true);
  });

  test('no daily budget unless one is set', () => {
    const ledger = new SpendLedger({ lines: [line(tokensFor(100))], now: () => NOW });
    expect(ledger.budgetExceeded()).toBe(false);
  });

  test('counts a line even when writing it fails', () => {
    const ledger = new SpendLedger({
      append: () => {
        throw new Error('disk full');
      },
      warn: () => {},
    });
    expect(() => ledger.record(line(tokensFor(1500)))).toThrow('disk full');
    expect(ledger.budgetExceeded()).toBe(true);
  });
});

describe('JEV_DAILY_BUDGET_THB', () => {
  test.each([
    [undefined, undefined],
    ['', undefined],
    ['  ', undefined],
    ['50', 50],
    [' 12.5 ', 12.5],
  ])('%j is %j', (raw, expected) => {
    expect(dailyBudgetFromEnv(raw)).toBe(expected);
  });

  test.each(['0', '-5', 'fifty', 'Infinity'])('%j is rejected', (raw) => {
    expect(() => dailyBudgetFromEnv(raw)).toThrow(/JEV_DAILY_BUDGET_THB/);
  });
});

describe('the usage log file', () => {
  test('a missing log is empty', () => {
    expect(readUsageLog(join(mkdtempSync(join(tmpdir(), 'jev-usage-')), 'none.jsonl'))).toEqual({
      lines: [],
      invalid: [],
    });
  });

  test('a ledger appends one JSON line per request and reads them back', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'jev-usage-')), 'logs', 'jev-usage.jsonl');
    const first = openUsageLedger(file, { dailyBudgetThb: undefined });
    first.record(line(3240));
    first.record(line(3000));
    expect(readFileSync(file, 'utf8').trim().split('\n')).toHaveLength(2);
    const reopened = openUsageLedger(file, { dailyBudgetThb: undefined });
    expect(reopened.spentThb()).toBeCloseTo(first.spentThb(), 12);
  });

  test('an over-cap log blocks a ledger opened on it', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'jev-usage-')), 'jev-usage.jsonl');
    writeFileSync(file, `${JSON.stringify(line(tokensFor(1500)))}\n`);
    expect(openUsageLedger(file, { warn: () => {} }).budgetExceeded()).toBe(true);
  });

  test('the daily budget is read from the environment', () => {
    vi.stubEnv('JEV_DAILY_BUDGET_THB', '1');
    const file = join(mkdtempSync(join(tmpdir(), 'jev-usage-')), 'jev-usage.jsonl');
    writeFileSync(file, `${JSON.stringify(line(tokensFor(1)))}\n`);
    expect(openUsageLedger(file, { now: () => NOW }).budgetExceeded()).toBe(true);
  });
});
