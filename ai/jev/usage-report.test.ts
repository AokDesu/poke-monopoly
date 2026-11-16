import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { parseUsageLog, SPEND_CONFIG } from './spend.ts';
import { formatUsageReport, usageReport } from './usage-report.ts';

const FIXTURE = join(import.meta.dirname, 'fixtures', 'usage-sample.jsonl');
const TODAY = new Date('2026-10-27T12:00:00.000Z');
const { lines, invalid } = parseUsageLog(readFileSync(FIXTURE, 'utf8'));
const report = usageReport(lines, TODAY);

// The fixture: game-a turn 1 holds decisions 0 (230 ms) and 1 (400 ms, two requests), turn 2 a
// timeout (1,500 ms), turn 3 180 ms; game-b turn 1 260 ms and turn 2 a 429 (20 ms), on the 27th.
// Input 3,240 + 3,000 + 2,760 + 3,240 + 3,240 = 15,480 tokens at $0.042 per million and 33 THB/USD.
describe('the usage report over a fixture log (spec §1, §9)', () => {
  test('parses every fixture line', () => {
    expect(invalid).toEqual([]);
    expect(lines).toHaveLength(7);
  });

  test.each([
    ['requests', 7],
    ['answered', 5],
    ['inputTokens', 15_480],
    ['outputTokens', 0],
    ['usd', 0.00065016],
    ['thb', 0.02145528],
    ['capPercent', 0.00143035],
    ['todayThb', 0.00449064],
  ] as const)('%s is %d', (field, expected) => {
    expect(report[field]).toBeCloseTo(expected, 8);
  });

  test('decision time per turn adds each decision once: p50 260 ms, p95 1,500 ms', () => {
    // Turns: 230 + 400 = 630, 1,500, 180, 260 and 20 ms.
    expect(report.turnMs).toEqual({ turns: 5, p50: 260, p95: 1500 });
  });

  test('prices, the exchange rate and the cap come from the config', () => {
    const doubled = { ...SPEND_CONFIG, thbPerUsd: 66, totalCapThb: 3000 };
    const again = usageReport(lines, TODAY, doubled);
    expect(again.thb).toBeCloseTo(report.thb * 2, 10);
    expect(again.capPercent).toBeCloseTo(report.capPercent, 10);
  });

  test('an empty log reports zero and no turns', () => {
    expect(usageReport([], TODAY)).toMatchObject({ requests: 0, thb: 0, turnMs: null });
  });

  test('prints Jev and Haiku apart, each with its share of its cap, and the total', () => {
    expect(formatUsageReport(report, { path: 'sample.jsonl', dailyBudgetThb: 50 })).toEqual([
      'AI usage: sample.jsonl',
      '  Jev requests          7 (ok 5, failed 2)',
      '  Jev input tokens      15,480',
      '  Jev output tokens     0',
      '  Jev spend             USD 0.0007, THB 0.0215',
      '  Jev cap               0.0014% of THB 1,500',
      '  Jev today (UTC)       THB 0.0045 of THB 50 daily budget',
      '  Jev time / turn       p50 260 ms, p95 1,500 ms over 5 turns',
      '  Haiku requests        0 (ok 0, failed 0)',
      '  Haiku input tokens    0',
      '  Haiku output tokens   0',
      '  Haiku spend           USD 0.0000, THB 0.0000',
      '  Haiku cap             0.0000% of THB 150',
      '  Total spend           THB 0.0215, 0.0014% of THB 1,500',
    ]);
  });

  test('Haiku lines add to Haiku and the total, never to Jev’s figures or decision time', () => {
    const haiku = {
      ...lines[0]!,
      provider: 'haiku' as const,
      model: 'claude-haiku-5-5',
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      decisionMs: 9_999,
    };
    const both = usageReport([...lines, haiku], TODAY);
    expect(both).toMatchObject({ requests: 7, inputTokens: 15_480, turnMs: report.turnMs });
    expect(both.haiku).toMatchObject({ requests: 1, answered: 1, inputTokens: 1_000_000 });
    // $0.10 in + $0.50 out = $0.60 = THB 19.8: 13.2% of THB 150.
    expect(both.haiku.thb).toBeCloseTo(19.8, 10);
    expect(both.haiku.capPercent).toBeCloseTo(13.2, 10);
    expect(both.totalThb).toBeCloseTo(report.thb + 19.8, 10);
    expect(both.totalCapPercent).toBeCloseTo(((report.thb + 19.8) / 1500) * 100, 10);
  });

  test('counts and prints requests whose tokens are the timeout estimate', () => {
    const late = { ...lines[3]!, inputTokens: 3240, estimated: true as const };
    const estimated = usageReport([...lines.slice(0, 3), late], TODAY);
    expect(estimated).toMatchObject({ estimated: 1, inputTokens: 12_240 });
    expect(report.estimated).toBe(0);
    expect(formatUsageReport(estimated, { path: 'late.jsonl' })[2]).toBe(
      '  Jev input tokens      12,240 (1 timed-out or unreadable request(s) estimated)',
    );
  });

  test('warns about lines it could not read', () => {
    const parsed = parseUsageLog('{"time":"x"}\nnot json\n\n');
    expect(parsed).toEqual({ lines: [], invalid: [1, 2] });
    const printed = formatUsageReport(usageReport(parsed.lines, TODAY), {
      path: 'bad.jsonl',
      invalid: parsed.invalid,
    });
    expect(printed.at(-1)).toMatch(/2 invalid line\(s\) skipped \(line 1, 2\)/);
  });

  test('`npm run usage` reads the log it is given', () => {
    const out = execFileSync(
      join('node_modules', '.bin', 'tsx'),
      [join('ai', 'jev', 'usage-cli.ts'), '--log', FIXTURE],
      { encoding: 'utf8', env: { ...process.env, JEV_DAILY_BUDGET_THB: '' } },
    );
    expect(out).toContain('7 (ok 5, failed 2)');
    expect(out).toContain('p50 260 ms, p95 1,500 ms over 5 turns');
  }, 20_000);
});
