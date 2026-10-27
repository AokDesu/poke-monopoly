import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';

/** Prices, the exchange rate and the spend cap: the only place spend numbers live (spec §1, §5.1, §9). */
export const SPEND_CONFIG = Object.freeze({
  /** §5.1: $0.042 per million input tokens. */
  inputUsdPerMillionTokens: 0.042,
  /** §5.1: output is free. */
  outputUsdPerMillionTokens: 0,
  /** §9: the assumed exchange rate. */
  thbPerUsd: 33,
  /** §1, §9: the total cap on AI spend, tracked from the usage log. */
  totalCapThb: 1500,
  /** Issue #48: warn once when spend reaches this share of the cap. */
  warnAtShareOfCap: 0.8,
  /**
   * Issue #48: input tokens counted for a timed-out request whose usage never arrived, the #5
   * spike's measured average, so the cap and the per-game budget err on the safe side.
   */
  estimatedInputTokensPerRequest: 3240,
});

export type SpendConfig = {
  inputUsdPerMillionTokens: number;
  outputUsdPerMillionTokens: number;
  thbPerUsd: number;
  totalCapThb: number;
  warnAtShareOfCap: number;
  estimatedInputTokensPerRequest: number;
};

/** Git-ignored (`logs/`): one JSON line per Jev request. */
export const USAGE_LOG_PATH = 'logs/jev-usage.jsonl';

const count = z.int().nonnegative();

/**
 * One Jev request (spec §9): IDs, token counts and timings only, never a state body or the key.
 * `status` is `ok` or the client's fallback reason. `decision` numbers the decision within the
 * game, so a decision that sent several requests counts its `decisionMs` once per turn.
 * `estimated` marks a timed-out request whose tokens are the configured estimate, not measured.
 */
export const usageLineSchema = z.strictObject({
  time: z.iso.datetime(),
  gameId: z.string(),
  requestId: z.string().nullable(),
  model: z.string(),
  inputTokens: count,
  outputTokens: count,
  latencyMs: count,
  status: z.string(),
  turnKey: z.string(),
  decision: count,
  decisionMs: count,
  estimated: z.literal(true).optional(),
});

export type UsageLine = z.infer<typeof usageLineSchema>;

/** What the orchestrator needs: log each request and ask whether the budget is spent. */
export interface UsageRecorder {
  record(line: UsageLine): void;
  /** The total cap or the daily budget has been reached; later decisions use the fallback. */
  budgetExceeded(): boolean;
}

export const costUsd = (
  line: Pick<UsageLine, 'inputTokens' | 'outputTokens'>,
  config: SpendConfig = SPEND_CONFIG,
): number =>
  (line.inputTokens * config.inputUsdPerMillionTokens +
    line.outputTokens * config.outputUsdPerMillionTokens) /
  1_000_000;

/** The UTC day of a line's `time`, which the daily budget counts by. */
const dayOf = (time: string): string => time.slice(0, 10);

export interface SpendLedgerOptions {
  /** Lines already in the usage log, so the cap counts every earlier run. */
  lines?: readonly UsageLine[];
  /** Writes each new line; defaults to keeping it in memory only. */
  append?: (line: UsageLine) => void;
  /** `JEV_DAILY_BUDGET_THB`: spend per UTC day on the development key. None when unset. */
  dailyBudgetThb?: number;
  config?: SpendConfig;
  warn?: (message: string) => void;
  now?: () => Date;
}

/**
 * Spec §9 spend guard over the usage log: adds up THB spent in total and per UTC day, warns once
 * at `warnAtShareOfCap` of the cap, and reports the budget exceeded at the cap or the daily budget.
 */
export class SpendLedger implements UsageRecorder {
  readonly #append: (line: UsageLine) => void;
  readonly #dailyBudgetThb: number | undefined;
  readonly #config: SpendConfig;
  readonly #warn: (message: string) => void;
  readonly #now: () => Date;
  readonly #byDay = new Map<string, number>();
  #totalThb = 0;
  #warned = false;

  constructor({
    lines = [],
    append = () => {},
    dailyBudgetThb,
    config = SPEND_CONFIG,
    warn = (message) => console.warn(message),
    now = () => new Date(),
  }: SpendLedgerOptions = {}) {
    this.#append = append;
    this.#dailyBudgetThb = dailyBudgetThb;
    this.#config = config;
    this.#warn = warn;
    this.#now = now;
    for (const line of lines) this.#add(line);
    this.#checkWarning();
  }

  /** Counts the line before writing it, so a failed write never hides spend from the guard. */
  record(line: UsageLine): void {
    this.#add(line);
    this.#checkWarning();
    this.#append(line);
  }

  budgetExceeded(): boolean {
    if (this.#totalThb >= this.#config.totalCapThb) return true;
    if (this.#dailyBudgetThb === undefined) return false;
    return this.spentTodayThb() >= this.#dailyBudgetThb;
  }

  spentThb(): number {
    return this.#totalThb;
  }

  spentTodayThb(): number {
    return this.#byDay.get(dayOf(this.#now().toISOString())) ?? 0;
  }

  #add(line: UsageLine): void {
    const thb = costUsd(line, this.#config) * this.#config.thbPerUsd;
    this.#totalThb += thb;
    const day = dayOf(line.time);
    this.#byDay.set(day, (this.#byDay.get(day) ?? 0) + thb);
  }

  #checkWarning(): void {
    const { totalCapThb, warnAtShareOfCap } = this.#config;
    if (this.#warned || this.#totalThb < totalCapThb * warnAtShareOfCap) return;
    this.#warned = true;
    this.#warn(
      `Jev spend is THB ${this.#totalThb.toFixed(2)}, ${Math.round(warnAtShareOfCap * 100)}% or more ` +
        `of the THB ${totalCapThb} cap; at the cap every AI uses the fallback (spec §9).`,
    );
  }
}

export interface ParsedUsageLog {
  lines: UsageLine[];
  /** Lines that are not valid usage lines, by 1-based line number. */
  invalid: number[];
}

export const parseUsageLog = (text: string): ParsedUsageLog => {
  const lines: UsageLine[] = [];
  const invalid: number[] = [];
  text.split('\n').forEach((raw, index) => {
    if (raw.trim() === '') return;
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      invalid.push(index + 1);
      return;
    }
    const parsed = usageLineSchema.safeParse(json);
    if (parsed.success) lines.push(parsed.data);
    else invalid.push(index + 1);
  });
  return { lines, invalid };
};

export const readUsageLog = (path: string = USAGE_LOG_PATH): ParsedUsageLog =>
  existsSync(path) ? parseUsageLog(readFileSync(path, 'utf8')) : { lines: [], invalid: [] };

/** `JEV_DAILY_BUDGET_THB`: unset or empty means no daily budget; anything else must be a positive number. */
export const dailyBudgetFromEnv = (
  raw: string | undefined = process.env.JEV_DAILY_BUDGET_THB,
): number | undefined => {
  const value = raw?.trim();
  if (!value) return undefined;
  const budget = Number(value);
  if (!Number.isFinite(budget) || budget <= 0) {
    throw new Error(`JEV_DAILY_BUDGET_THB must be a positive number of baht; got "${value}".`);
  }
  return budget;
};

/** A ledger over the usage log file: it reads every earlier line and appends each new one. */
export const openUsageLedger = (
  path: string = USAGE_LOG_PATH,
  options: Omit<SpendLedgerOptions, 'lines' | 'append'> = {},
): SpendLedger =>
  new SpendLedger({
    dailyBudgetThb: dailyBudgetFromEnv(),
    ...options,
    lines: readUsageLog(path).lines,
    append: (line) => {
      mkdirSync(dirname(path), { recursive: true });
      appendFileSync(path, `${JSON.stringify(line)}\n`);
    },
  });

let processLedger: SpendLedger | undefined;

/** The server's and the sim's one ledger over `logs/jev-usage.jsonl`, opened on first use. */
export const defaultUsageLedger = (): SpendLedger => (processLedger ??= openUsageLedger());
