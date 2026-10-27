import { costUsd, SPEND_CONFIG, type SpendConfig, type UsageLine } from './spend.ts';

export interface UsageReport {
  requests: number;
  /** Requests whose status is `ok`. */
  answered: number;
  inputTokens: number;
  /** Timed-out requests whose input tokens are the configured estimate, not measured. */
  estimated: number;
  outputTokens: number;
  usd: number;
  thb: number;
  /** THB spent as a percentage of the total cap (spec §1, §9). */
  capPercent: number;
  /** THB spent on the UTC day of `today`, which the daily budget counts. */
  todayThb: number;
  /** AI decision time per turn (spec §1 target: p95 ≤ 2 s); `null` with no lines. */
  turnMs: { turns: number; p50: number; p95: number } | null;
}

/** Nearest-rank percentile of ascending `sorted`. */
const percentile = (sorted: readonly number[], p: number): number =>
  sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)]!;

/**
 * Totals over usage lines. A turn's decision time adds each of its decisions once, however many
 * requests that decision sent.
 */
export function usageReport(
  lines: readonly UsageLine[],
  today: Date = new Date(),
  config: SpendConfig = SPEND_CONFIG,
): UsageReport {
  const day = today.toISOString().slice(0, 10);
  let inputTokens = 0;
  let outputTokens = 0;
  let answered = 0;
  let estimated = 0;
  let todayUsd = 0;
  const turns = new Map<string, Map<number, number>>();
  for (const line of lines) {
    inputTokens += line.inputTokens;
    outputTokens += line.outputTokens;
    if (line.status === 'ok') answered++;
    if (line.estimated) estimated++;
    if (line.time.startsWith(day)) todayUsd += costUsd(line, config);
    const key = JSON.stringify([line.gameId, line.turnKey]);
    const decisions = turns.get(key) ?? new Map<number, number>();
    decisions.set(line.decision, line.decisionMs);
    turns.set(key, decisions);
  }
  const usd = costUsd({ inputTokens, outputTokens }, config);
  const thb = usd * config.thbPerUsd;
  const perTurn = [...turns.values()]
    .map((decisions) => [...decisions.values()].reduce((sum, ms) => sum + ms, 0))
    .sort((a, b) => a - b);
  return {
    requests: lines.length,
    answered,
    inputTokens,
    estimated,
    outputTokens,
    usd,
    thb,
    capPercent: (thb / config.totalCapThb) * 100,
    todayThb: todayUsd * config.thbPerUsd,
    turnMs:
      perTurn.length === 0
        ? null
        : { turns: perTurn.length, p50: percentile(perTurn, 0.5), p95: percentile(perTurn, 0.95) },
  };
}

export interface FormatOptions {
  path: string;
  /** Line numbers the log could not parse; their spend is missing from the totals. */
  invalid?: readonly number[];
  dailyBudgetThb?: number;
  config?: SpendConfig;
}

const number = (n: number) => n.toLocaleString('en-US');
/** Four decimals below 1, so early spend does not print as zero. */
const amount = (n: number) => n.toFixed(n < 1 ? 4 : 2);

/** The `npm run usage` lines. */
export function formatUsageReport(
  report: UsageReport,
  { path, invalid = [], dailyBudgetThb, config = SPEND_CONFIG }: FormatOptions,
): string[] {
  const row = (label: string, value: string) => `  ${label.padEnd(22)}${value}`;
  const failed = report.requests - report.answered;
  const lines = [
    `Jev usage: ${path}`,
    row('Requests', `${number(report.requests)} (ok ${report.answered}, failed ${failed})`),
    row(
      'Input tokens',
      number(report.inputTokens) +
        (report.estimated > 0
          ? ` (${number(report.estimated)} timed-out request(s) estimated)`
          : ''),
    ),
    row('Output tokens', number(report.outputTokens)),
    row('Spend', `USD ${report.usd.toFixed(4)}, THB ${amount(report.thb)}`),
    row('Cap', `${amount(report.capPercent)}% of THB ${number(config.totalCapThb)}`),
    row(
      'Today (UTC)',
      `THB ${amount(report.todayThb)}` +
        (dailyBudgetThb === undefined
          ? ' (no JEV_DAILY_BUDGET_THB set)'
          : ` of THB ${number(dailyBudgetThb)} daily budget`),
    ),
    row(
      'Decision time / turn',
      report.turnMs
        ? `p50 ${number(report.turnMs.p50)} ms, p95 ${number(report.turnMs.p95)} ms ` +
            `over ${number(report.turnMs.turns)} turns`
        : 'no turns logged',
    ),
  ];
  if (invalid.length > 0) {
    lines.push(
      `  Warning: ${invalid.length} invalid line(s) skipped (line ${invalid.join(', ')}); ` +
        'their spend is not in these totals.',
    );
  }
  return lines;
}
