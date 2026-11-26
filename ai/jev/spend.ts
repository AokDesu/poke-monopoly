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
  /** The repository owner's 15 Nov 2026 board answer: Haiku's own hard stop, inside the total cap. */
  haikuCapThb: 150,
  /**
   * The same answer, per game (spec §9): past either limit that game speaks from the line bank. Raised
   * from 60 calls and 80,000 tokens on 18 Nov 2026 (issue #214), the same share of tokens per call, so
   * every round can have table talk; the THB 150 cap above is unchanged.
   */
  haikuMaxCallsPerGame: 150,
  haikuMaxInputTokensPerGame: 200_000,
  /** Published Haiku prices, per model; the Jev prices above apply to every `jev-1.*` release. */
  haikuModelPrices: {
    'claude-haiku-5-5': { inputUsdPerMillionTokens: 0.1, outputUsdPerMillionTokens: 0.5 },
  },
  /** Tokens counted for a timed-out Haiku request or an unreadable reply: a speech brief and a capped line. */
  estimatedHaikuInputTokensPerRequest: 1500,
  estimatedHaikuOutputTokensPerRequest: 80,
});

export type SpendConfig = {
  inputUsdPerMillionTokens: number;
  outputUsdPerMillionTokens: number;
  thbPerUsd: number;
  totalCapThb: number;
  warnAtShareOfCap: number;
  estimatedInputTokensPerRequest: number;
  haikuCapThb: number;
  haikuMaxCallsPerGame: number;
  haikuMaxInputTokensPerGame: number;
  haikuModelPrices: Readonly<Record<string, ModelPrice>>;
  estimatedHaikuInputTokensPerRequest: number;
  estimatedHaikuOutputTokensPerRequest: number;
};

export interface ModelPrice {
  inputUsdPerMillionTokens: number;
  outputUsdPerMillionTokens: number;
}

export const USAGE_PROVIDERS = ['jev', 'haiku'] as const;
export type UsageProvider = (typeof USAGE_PROVIDERS)[number];

/** Git-ignored (`logs/`): one JSON line per Jev or Haiku request. */
export const USAGE_LOG_PATH = 'logs/jev-usage.jsonl';

const count = z.int().nonnegative();

/**
 * One Jev or Haiku request (spec §9): IDs, token counts and timings only, never a state body, a
 * line of speech or a key. `provider` is absent on a Jev line, so every older line still parses.
 * `status` is `ok` or the client's fallback reason. `decision` numbers the decision within the
 * game, so a decision that sent several requests counts its `decisionMs` once per turn.
 * `estimated` marks a timed-out request whose tokens are the configured estimate, not measured.
 */
export const usageLineSchema = z.strictObject({
  time: z.iso.datetime(),
  provider: z.enum(USAGE_PROVIDERS).optional(),
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

/** What a client needs: log each request and ask whether its provider's budget is spent. */
export interface UsageRecorder {
  record(line: UsageLine): void;
  /**
   * The total cap, or for Jev the daily budget, or for Haiku its own cap, has been reached: later
   * requests of that provider are not sent. Jev when no provider is named.
   */
  budgetExceeded(provider?: UsageProvider): boolean;
  /**
   * Holds back the estimated cost of one request about to go out, so concurrent requests cannot
   * all pass `budgetExceeded` before any of them is recorded (spec §9). Returns the function that
   * releases the hold once the request's usage line is recorded (or the request never went out),
   * or `null` when the request would pass the cap or budget: it is then not sent. A recorder
   * without it only checks `budgetExceeded`.
   */
  reserve?(provider?: UsageProvider): (() => void) | null;
}

/**
 * An error's class name, never its message: a message could carry a path, a request or a key
 * (spec §9). The only way a failure of the ledger, the log or a request reaches the server log.
 */
export const errorClass = (error: unknown): string =>
  error instanceof Error ? error.constructor.name || error.name : typeof error;

/** Logs that the usage log or the spend guard failed, by class only. */
export const warnLedgerFailed = (what: string, error: unknown): void => {
  console.warn(`${what} (${errorClass(error)}).`);
};

export const providerOf = (line: Pick<UsageLine, 'provider'>): UsageProvider =>
  line.provider ?? 'jev';

/** A Haiku model with no listed price counts at the dearest listed one, so spend is never understated. */
const priceOf = (
  line: Partial<Pick<UsageLine, 'provider' | 'model'>>,
  config: SpendConfig,
): ModelPrice => {
  if (providerOf(line) === 'jev') return config;
  const prices = Object.values(config.haikuModelPrices);
  return (
    config.haikuModelPrices[line.model ?? ''] ??
    prices.reduce((dear, price) =>
      price.inputUsdPerMillionTokens + price.outputUsdPerMillionTokens >
      dear.inputUsdPerMillionTokens + dear.outputUsdPerMillionTokens
        ? price
        : dear,
    )
  );
};

export const costUsd = (
  line: Pick<UsageLine, 'inputTokens' | 'outputTokens'> &
    Partial<Pick<UsageLine, 'provider' | 'model'>>,
  config: SpendConfig = SPEND_CONFIG,
): number => {
  const price = priceOf(line, config);
  return (
    (line.inputTokens * price.inputUsdPerMillionTokens +
      line.outputTokens * price.outputUsdPerMillionTokens) /
    1_000_000
  );
};

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
 * Spec §9 spend guard over the usage log: adds up THB spent in total (Jev and Haiku together),
 * per provider and, for Jev, per UTC day. It warns once at `warnAtShareOfCap` of the total cap and
 * once of Haiku's own cap, and reports the budget exceeded at either cap or the daily budget.
 */
export class SpendLedger implements UsageRecorder {
  readonly #append: (line: UsageLine) => void;
  readonly #dailyBudgetThb: number | undefined;
  readonly #config: SpendConfig;
  readonly #warn: (message: string) => void;
  readonly #now: () => Date;
  readonly #byDay = new Map<string, number>();
  readonly #thb: Record<UsageProvider, number> = { jev: 0, haiku: 0 };
  /** THB held for requests that are out but not yet recorded; counted by the guard, never reported as spend. */
  readonly #reserved: Record<UsageProvider, number> = { jev: 0, haiku: 0 };
  readonly #warned = { total: false, haiku: false };

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
    this.#checkWarnings();
  }

  /** Counts the line before writing it, so a failed write never hides spend from the guard. */
  record(line: UsageLine): void {
    this.#add(line);
    this.#checkWarnings();
    this.#append(line);
  }

  /** Counts what is held for requests still in flight, so it never reports "fine" for money already promised. */
  budgetExceeded(provider: UsageProvider = 'jev'): boolean {
    if (this.#committedThb() >= this.#config.totalCapThb) return true;
    if (provider === 'haiku')
      return this.#thb.haiku + this.#reserved.haiku >= this.#config.haikuCapThb;
    if (this.#dailyBudgetThb === undefined) return false;
    return this.spentTodayThb() + this.#reserved.jev >= this.#dailyBudgetThb;
  }

  /**
   * Spec §9: reserves the configured estimate for one request, in the same synchronous step that
   * checks the guard, so N concurrent decisions cannot all pass it. Requests are let through as
   * they would be one at a time: while what is spent plus what is held is under a cap or budget,
   * so the request that reaches it is the last. `null` when the guard is already tripped. The
   * returned release is idempotent; call it once the request's real line is recorded, which
   * replaces the estimate.
   */
  reserve(provider: UsageProvider = 'jev'): (() => void) | null {
    if (this.budgetExceeded(provider)) return null;
    const estimate = this.#estimateThb(provider);
    this.#reserved[provider] += estimate;
    let held = true;
    return () => {
      if (!held) return;
      held = false;
      this.#reserved[provider] = Math.max(0, this.#reserved[provider] - estimate);
    };
  }

  /** THB held for requests in flight, by one provider or both. */
  reservedThb(provider?: UsageProvider): number {
    return provider ? this.#reserved[provider] : this.#reserved.jev + this.#reserved.haiku;
  }

  /** THB spent by one provider, or by both when none is named. */
  spentThb(provider?: UsageProvider): number {
    return provider ? this.#thb[provider] : this.#thb.jev + this.#thb.haiku;
  }

  /** THB Jev spent on the current UTC day, which `JEV_DAILY_BUDGET_THB` counts. */
  spentTodayThb(): number {
    return this.#byDay.get(dayOf(this.#now().toISOString())) ?? 0;
  }

  /** Spent plus held, over both providers: what the total cap is checked against. */
  #committedThb(): number {
    return this.spentThb() + this.reservedThb();
  }

  /** The configured token estimate for one request, as a timed-out request is counted (§9). */
  #estimateThb(provider: UsageProvider): number {
    const inputTokens =
      provider === 'jev'
        ? this.#config.estimatedInputTokensPerRequest
        : this.#config.estimatedHaikuInputTokensPerRequest;
    const outputTokens = provider === 'jev' ? 0 : this.#config.estimatedHaikuOutputTokensPerRequest;
    return costUsd({ provider, inputTokens, outputTokens }, this.#config) * this.#config.thbPerUsd;
  }

  #add(line: UsageLine): void {
    const provider = providerOf(line);
    const thb = costUsd(line, this.#config) * this.#config.thbPerUsd;
    this.#thb[provider] += thb;
    if (provider !== 'jev') return;
    const day = dayOf(line.time);
    this.#byDay.set(day, (this.#byDay.get(day) ?? 0) + thb);
  }

  #checkWarnings(): void {
    const { totalCapThb, haikuCapThb, warnAtShareOfCap } = this.#config;
    const share = `${Math.round(warnAtShareOfCap * 100)}% or more`;
    if (!this.#warned.total && this.spentThb() >= totalCapThb * warnAtShareOfCap) {
      this.#warned.total = true;
      this.#warn(
        `AI spend is THB ${this.spentThb().toFixed(2)}, ${share} of the THB ${totalCapThb} cap; ` +
          'at the cap every AI uses the fallback (spec §9).',
      );
    }
    if (!this.#warned.haiku && this.#thb.haiku >= haikuCapThb * warnAtShareOfCap) {
      this.#warned.haiku = true;
      this.#warn(
        `Haiku spend is THB ${this.#thb.haiku.toFixed(2)}, ${share} of its THB ${haikuCapThb} cap; ` +
          'at the cap every AI speaks from the line bank (spec §9).',
      );
    }
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

const salvaged = (raw: string, key: string): number | undefined => {
  const found = new RegExp(`"${key}"\\s*:\\s*(\\d{1,12})`).exec(raw)?.[1];
  return found === undefined ? undefined : Number(found);
};

/**
 * Spec §9: lines the log holds that are not valid usage lines (a write cut short by a crash, a line
 * damaged by hand, a field this version does not know) were still spend, so they are counted, never
 * dropped. Each counts as a request at least the size of the configured estimate, or the tokens it
 * still shows when that is more; one that does not say it is Haiku's is counted at the dearer of
 * the two providers. `now` dates them, so the daily budget counts them too.
 */
export const unreadableLines = (
  text: string,
  invalid: readonly number[],
  now: Date = new Date(),
  config: SpendConfig = SPEND_CONFIG,
): UsageLine[] => {
  const rows = text.split('\n');
  const make = (provider: UsageProvider, raw: string): UsageLine => {
    const estimate =
      provider === 'jev'
        ? config.estimatedInputTokensPerRequest
        : config.estimatedHaikuInputTokensPerRequest;
    return {
      time: now.toISOString(),
      ...(provider === 'haiku' && { provider }),
      gameId: 'unreadable',
      requestId: null,
      model: '',
      inputTokens: Math.max(estimate, salvaged(raw, 'inputTokens') ?? 0),
      outputTokens: Math.max(
        provider === 'jev' ? 0 : config.estimatedHaikuOutputTokensPerRequest,
        salvaged(raw, 'outputTokens') ?? 0,
      ),
      latencyMs: 0,
      status: 'unreadable',
      turnKey: '',
      decision: 0,
      decisionMs: 0,
      estimated: true,
    };
  };
  return invalid.map((number) => {
    const raw = rows[number - 1] ?? '';
    if (/"provider"\s*:\s*"haiku"/.test(raw)) return make('haiku', raw);
    // `provider` is the second key, ahead of `gameId`: a line past it with no provider is Jev's.
    if (/"gameId"/.test(raw) && !/"provider"/.test(raw)) return make('jev', raw);
    const [jev, haiku] = [make('jev', raw), make('haiku', raw)];
    return costUsd(haiku, config) > costUsd(jev, config) ? haiku : jev;
  });
};

/**
 * A ledger over the usage log file: it reads every earlier line and appends each new one. A line it
 * cannot read is counted as spend (`unreadableLines`) and warned about by number, never by content.
 * A log whose last line was cut short gets a newline before the next line, so that one is not
 * joined to the debris and lost with it.
 */
export const openUsageLedger = (
  path: string = USAGE_LOG_PATH,
  options: Omit<SpendLedgerOptions, 'lines' | 'append'> = {},
): SpendLedger => {
  const text = existsSync(path) ? readFileSync(path, 'utf8') : '';
  const { lines, invalid } = parseUsageLog(text);
  const warn = options.warn ?? ((message: string) => console.warn(message));
  if (invalid.length > 0) {
    warn(
      `The usage log has ${invalid.length} line(s) that cannot be read (line ${invalid.slice(0, 5).join(', ')}` +
        `${invalid.length > 5 ? ', ...' : ''}); each is counted as spend (spec §9).`,
    );
  }
  let mend = text !== '' && !text.endsWith('\n');
  return new SpendLedger({
    dailyBudgetThb: dailyBudgetFromEnv(),
    ...options,
    lines: [...lines, ...unreadableLines(text, invalid, options.now?.(), options.config)],
    append: (line) => {
      mkdirSync(dirname(path), { recursive: true });
      appendFileSync(path, `${mend ? '\n' : ''}${JSON.stringify(line)}\n`);
      mend = false;
    },
  });
};

let processLedger: SpendLedger | undefined;

/** The server's and the sim's one ledger over `logs/jev-usage.jsonl`, opened on first use. */
export const defaultUsageLedger = (): SpendLedger => (processLedger ??= openUsageLedger());
