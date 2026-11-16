import {
  costUsd,
  providerOf,
  SPEND_CONFIG,
  type SpendConfig,
  type UsageLine,
  type UsageProvider,
} from './spend.ts';

/** One provider's requests, tokens and spend in the usage log. */
export interface ProviderUsage {
  requests: number;
  /** Requests whose status is `ok`. */
  answered: number;
  inputTokens: number;
  /** Requests whose tokens are the configured estimate (a timeout), not measured. */
  estimated: number;
  outputTokens: number;
  usd: number;
  thb: number;
}

export interface UsageReport extends ProviderUsage {
  /** THB spent by Jev as a percentage of the total cap (spec §1, §9). */
  capPercent: number;
  /** THB Jev spent on the UTC day of `today`, which the daily budget counts. */
  todayThb: number;
  /** AI decision time per turn (spec §1 target: p95 ≤ 2 s); `null` with no Jev lines. */
  turnMs: { turns: number; p50: number; p95: number } | null;
  haiku: ProviderUsage & {
    /** THB spent by Haiku as a percentage of its own cap (spec §9). */
    capPercent: number;
  };
  /** Jev and Haiku together, against the one total cap. */
  totalThb: number;
  totalCapPercent: number;
}

/** Nearest-rank percentile of ascending `sorted`. */
const percentile = (sorted: readonly number[], p: number): number =>
  sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)]!;

const providerUsage = (
  lines: readonly UsageLine[],
  provider: UsageProvider,
  config: SpendConfig,
): ProviderUsage => {
  const own = lines.filter((line) => providerOf(line) === provider);
  const inputTokens = own.reduce((sum, line) => sum + line.inputTokens, 0);
  const outputTokens = own.reduce((sum, line) => sum + line.outputTokens, 0);
  const usd = own.reduce((sum, line) => sum + costUsd(line, config), 0);
  return {
    requests: own.length,
    answered: own.filter((line) => line.status === 'ok').length,
    inputTokens,
    estimated: own.filter((line) => line.estimated).length,
    outputTokens,
    usd,
    thb: usd * config.thbPerUsd,
  };
};

/**
 * Totals over usage lines, Jev and Haiku apart. A Jev turn's decision time adds each of its
 * decisions once, however many requests that decision sent; Haiku lines have no decision.
 */
export function usageReport(
  lines: readonly UsageLine[],
  today: Date = new Date(),
  config: SpendConfig = SPEND_CONFIG,
): UsageReport {
  const day = today.toISOString().slice(0, 10);
  const jevLines = lines.filter((line) => providerOf(line) === 'jev');
  const jev = providerUsage(lines, 'jev', config);
  const haiku = providerUsage(lines, 'haiku', config);
  const turns = new Map<string, Map<number, number>>();
  let todayUsd = 0;
  for (const line of jevLines) {
    if (line.time.startsWith(day)) todayUsd += costUsd(line, config);
    const key = JSON.stringify([line.gameId, line.turnKey]);
    const decisions = turns.get(key) ?? new Map<number, number>();
    decisions.set(line.decision, line.decisionMs);
    turns.set(key, decisions);
  }
  const perTurn = [...turns.values()]
    .map((decisions) => [...decisions.values()].reduce((sum, ms) => sum + ms, 0))
    .sort((a, b) => a - b);
  const totalThb = jev.thb + haiku.thb;
  return {
    ...jev,
    capPercent: (jev.thb / config.totalCapThb) * 100,
    todayThb: todayUsd * config.thbPerUsd,
    turnMs:
      perTurn.length === 0
        ? null
        : { turns: perTurn.length, p50: percentile(perTurn, 0.5), p95: percentile(perTurn, 0.95) },
    haiku: { ...haiku, capPercent: (haiku.thb / config.haikuCapThb) * 100 },
    totalThb,
    totalCapPercent: (totalThb / config.totalCapThb) * 100,
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

const estimatedNote = (estimated: number) =>
  estimated > 0 ? ` (${number(estimated)} timed-out or unreadable request(s) estimated)` : '';

/** The `npm run usage` lines. */
export function formatUsageReport(
  report: UsageReport,
  { path, invalid = [], dailyBudgetThb, config = SPEND_CONFIG }: FormatOptions,
): string[] {
  const row = (label: string, value: string) => `  ${label.padEnd(22)}${value}`;
  const { haiku } = report;
  const lines = [
    `AI usage: ${path}`,
    row(
      'Jev requests',
      `${number(report.requests)} (ok ${report.answered}, failed ${report.requests - report.answered})`,
    ),
    row('Jev input tokens', number(report.inputTokens) + estimatedNote(report.estimated)),
    row('Jev output tokens', number(report.outputTokens)),
    row('Jev spend', `USD ${report.usd.toFixed(4)}, THB ${amount(report.thb)}`),
    row('Jev cap', `${amount(report.capPercent)}% of THB ${number(config.totalCapThb)}`),
    row(
      'Jev today (UTC)',
      `THB ${amount(report.todayThb)}` +
        (dailyBudgetThb === undefined
          ? ' (no JEV_DAILY_BUDGET_THB set)'
          : ` of THB ${number(dailyBudgetThb)} daily budget`),
    ),
    row(
      'Jev time / turn',
      report.turnMs
        ? `p50 ${number(report.turnMs.p50)} ms, p95 ${number(report.turnMs.p95)} ms ` +
            `over ${number(report.turnMs.turns)} turns`
        : 'no turns logged',
    ),
    row(
      'Haiku requests',
      `${number(haiku.requests)} (ok ${haiku.answered}, failed ${haiku.requests - haiku.answered})`,
    ),
    row('Haiku input tokens', number(haiku.inputTokens) + estimatedNote(haiku.estimated)),
    row('Haiku output tokens', number(haiku.outputTokens)),
    row('Haiku spend', `USD ${haiku.usd.toFixed(4)}, THB ${amount(haiku.thb)}`),
    row('Haiku cap', `${amount(haiku.capPercent)}% of THB ${number(config.haikuCapThb)}`),
    row(
      'Total spend',
      `THB ${amount(report.totalThb)}, ${amount(report.totalCapPercent)}% of THB ${number(config.totalCapThb)}`,
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
