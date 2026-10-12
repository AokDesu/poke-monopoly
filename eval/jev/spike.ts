/**
 * Jev spike (issue #5; spec §5.1, §5.6, §9, §12): time live calls to the pinned model and
 * re-estimate the cost per game. Live only and never run in CI: a person with the key in a
 * git-ignored `.env` runs `npx tsx eval/jev/spike.ts --calls 100` from the repository root.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import {
  APIError,
  RateLimitError,
  TypeSafeClient,
  VERSION,
  choice,
  type Fetch,
  type JsonValue,
  type Questions,
} from '@typesafe-ai/sdk';
import { PINNED_JEV_MODEL, REQUEST_TIMEOUT_MS, jevEnabled } from '../../ai/jev/client.ts';

// Spec §9: the price and the per-game estimate this spike re-measures.
export const USD_PER_MILLION_INPUT_TOKENS = 0.042;
export const THB_PER_USD = 33;
export const REQUESTS_PER_GAME = 140;
export const GAME_COUNTS = [1, 300, 1000] as const;

// Issue #5: a strategy Choice of 4 to 12 options and a line Choice, in 600 to 2,500 input tokens.
const MIN_STRATEGY_OPTIONS = 4;
const MAX_STRATEGY_OPTIONS = 12;
const MIN_LINE_OPTIONS = 3;
const MAX_LINE_OPTIONS = 5;
export const MIN_INPUT_TOKENS = 600;
export const MAX_INPUT_TOKENS = 2500;
const SIZE_STEPS = 20;
// A rough estimate for English JSON; the real count comes back in `usage`.
const CHARS_PER_TOKEN = 4;
// Spec §12: honour retry-after between calls after a 429, within reason.
const DEFAULT_RETRY_AFTER_MS = 1000;
const MAX_RETRY_AFTER_MS = 60_000;

/** What the results file keeps of a request: its shape, never its state body. */
export interface RequestShape {
  strategyOptions: number;
  lineOptions: number;
  targetInputTokens: number;
  estimatedInputTokens: number;
}

export interface SpikeRequest {
  model: string;
  state: { [key: string]: JsonValue };
  questions: Questions;
  shape: RequestShape;
}

export interface CallRecord {
  index: number;
  /** Client wall-clock time from sending the request to the parsed body or the error. */
  latencyMs: number;
  status: number | null;
  requestId: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  /** `null` on a usable answer; otherwise the SDK error class or `InvalidResponse`. */
  errorClass: string | null;
  retryAfterMs: number | null;
  responseModel: string | null;
  shape: RequestShape;
}

export interface LatencyStats {
  p50: number;
  p95: number;
  max: number;
}

export interface CostEstimate {
  games: number;
  inputTokens: number;
  usd: number;
  thb: number;
}

export interface SpikeSummary {
  calls: number;
  okCalls: number;
  /** Every call, with timeouts counted at their elapsed time, so p95 is comparable to §5.6. */
  latencyMs: LatencyStats | null;
  okLatencyMs: LatencyStats | null;
  meanInputTokens: number | null;
  meanOutputTokens: number | null;
  statuses: Record<string, number>;
  errorClasses: Record<string, number>;
  rateLimited: number;
  serverErrors: number;
  retryAfterMs: number[];
  p95AboveRequestDeadline: boolean;
  /** Spec §9 formula with the measured mean input tokens; `null` without a usable answer. */
  cost: CostEstimate[] | null;
}

export interface ModelCheck {
  pinnedModelListed: boolean;
  models: string[];
  errorClass: string | null;
}

export interface SpikeResult {
  model: string;
  sdkVersion: string;
  network: string | null;
  city: string | null;
  startedAt: string;
  finishedAt: string;
  settings: { calls: number; timeoutMs: number; maxRetries: number };
  modelCheck: ModelCheck;
  summary: SpikeSummary;
  calls: CallRecord[];
}

const PERSONALITIES = [
  'Greedy: values cash now over long-term team building; avoids fights it may lose.',
  'Aggressive: attacks the leader whenever the win chance is at least even.',
  'Cautious: keeps coins and items in reserve; avoids risky battles and broken promises.',
  'Opportunist: takes whichever action hurts the leader most this turn.',
];

const ACTIONS = [
  'Use Pickpocket on P1: take up to 5 coins. Whether P1 holds a Price Shield is unknown.',
  'Challenge P3 to a battle. Your win chance: low. This breaks your promise to P3.',
  'Use Repel on P1: P1 moves 2 fewer squares on their next move.',
  'Challenge P4 to a battle. Your win chance: even. P4 has no promise with you.',
  'Use Great Ball on the wild Pokémon here. Catch chance: high. Balls left after this: few.',
  'Challenge the Gym leader. Your win chance: low. A win gives a badge, not coins.',
  'Use Swap on P1: trade places with P1 on the board.',
  'Offer P3 a truce until the end of your next turn.',
  'Use Potion on your Tired Pokémon so it can battle this turn.',
  'Use Peek on the Event deck: see the next Event card. Only you learn it.',
  'Challenge P1 to a battle. Your win chance: high. P1 trusts you: low.',
];

const LINES = [
  'Distrustful: reminds P1 they broke a promise.',
  'Neutral acknowledgement.',
  'Friendly agreement.',
  'Taunt aimed at the coin leader.',
  'Short reminder of your promise to P3.',
];

const SQUARE_KINDS = ['grass', 'gym', 'event', 'shop', 'start', 'water', 'cave'];
const OWNERS = ['none', 'P1', 'P2 (you)', 'P3', 'P4'];
const EVIDENCE = [
  'broke no_attack on turn 5',
  'kept a truce with you for two turns',
  'accepted your deal on turn 7',
  'refused a trade on turn 9',
  'challenged the leader on turn 11',
];

const estimateTokens = (value: unknown): number =>
  Math.ceil(JSON.stringify(value).length / CHARS_PER_TOKEN);

/** Request `index` of a run: option counts and sizes vary across the run, the model never does. */
export const buildSpikeRequest = (index: number): SpikeRequest => {
  const strategyOptions =
    MIN_STRATEGY_OPTIONS + (index % (MAX_STRATEGY_OPTIONS - MIN_STRATEGY_OPTIONS + 1));
  const lineOptions = MIN_LINE_OPTIONS + (index % (MAX_LINE_OPTIONS - MIN_LINE_OPTIONS + 1));
  // Stride 7 over 20 sizes, so large and small requests interleave through the run.
  const step = (index * 7) % SIZE_STEPS;
  const targetInputTokens = Math.round(
    MIN_INPUT_TOKENS + (step * (MAX_INPUT_TOKENS - MIN_INPUT_TOKENS)) / (SIZE_STEPS - 1),
  );

  const strategyCriteria: Record<string, string> = {};
  for (let i = 0; i < strategyOptions - 1; i++) {
    strategyCriteria[`a${i + 1}`] = ACTIONS[(index + i) % ACTIONS.length] ?? '';
  }
  strategyCriteria.skip = 'Do nothing this phase and keep your items.';
  const lineCriteria: Record<string, string> = {};
  for (let i = 0; i < lineOptions; i++) lineCriteria[`l${i + 1}`] = LINES[i] ?? '';

  const questions: Questions = {
    strategy: choice(
      'Pick the ONE action that best fits `you.personality` right now. Only the listed actions are allowed.',
      strategyCriteria,
    ),
    line: choice(
      'Which line should `you` say to P1 after this turn, given `recent_chat` and `opponents[0].trust`?',
      lineCriteria,
    ),
  };

  const board: JsonValue[] = [];
  const memory: JsonValue[] = [];
  const state = {
    you: {
      id: 'P2',
      personality: PERSONALITIES[index % PERSONALITIES.length] ?? '',
      coins_rank: '2nd of 4',
      lap: '2 of 3',
      squares_to_start: 'near',
      hand: ['Pickpocket', 'Repel', 'Potion'],
      balls: 'few',
    },
    opponents: [
      { id: 'P1', coins_vs_you: 'far ahead', trust: 'low', promise_with_you: 'none' },
      {
        id: 'P3',
        coins_vs_you: 'behind',
        trust: 'neutral',
        promise_with_you: 'you promised no_attack until the end of your next turn',
      },
      { id: 'P4', coins_vs_you: 'about even', trust: 'high', promise_with_you: 'none' },
    ],
    recent_chat: [
      { from: 'P1', text: 'P3 is about to win, hit them not me' },
      { from: 'P3', text: 'Remember our deal.' },
    ],
    board,
    memory,
  };

  // Pad with board squares and event evidence until the request reaches its target size.
  const estimate = () => estimateTokens({ model: PINNED_JEV_MODEL, state, questions });
  for (let i = 0; estimate() < targetInputTokens; i++) {
    if (i % 2 === 0) {
      const square = i / 2;
      board.push({
        square: `S${square + 1}`,
        kind: SQUARE_KINDS[square % SQUARE_KINDS.length] ?? 'grass',
        owner: OWNERS[square % OWNERS.length] ?? 'none',
        wild_pokemon: square % 3 === 0 ? 'present' : 'none',
      });
    } else {
      const who = ['P1', 'P3', 'P4'][i % 3] ?? 'P1';
      memory.push(`${who} ${EVIDENCE[i % EVIDENCE.length] ?? ''}`);
    }
  }

  return {
    model: PINNED_JEV_MODEL,
    state,
    questions,
    shape: { strategyOptions, lineOptions, targetInputTokens, estimatedInputTokens: estimate() },
  };
};

export interface SpikeClientOptions {
  /** For offline tests only; live runs let the SDK read the key from the environment. */
  apiKey?: string;
  fetch?: Fetch;
}

/** Spec §5.6 settings: 1,000 ms per attempt, no retries, and never debug logging. */
export const createSpikeClient = (options: SpikeClientOptions = {}): TypeSafeClient =>
  new TypeSafeClient({
    ...(options.apiKey && { apiKey: options.apiKey }),
    defaultModel: PINNED_JEV_MODEL,
    timeout: REQUEST_TIMEOUT_MS,
    retry: { maxRetries: 0 },
    logLevel: 'warn',
    dangerouslyAllowBrowser: false,
    ...(options.fetch && { fetch: options.fetch }),
  });

const errorName = (error: unknown): string =>
  error instanceof Error ? error.name : 'UnknownError';

const tokenCount = (value: unknown): number | null =>
  Number.isInteger(value) && (value as number) >= 0 ? (value as number) : null;

export const timeCall = async (
  client: TypeSafeClient,
  request: SpikeRequest,
  index: number,
): Promise<CallRecord> => {
  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);
  const empty = { inputTokens: null, outputTokens: null, retryAfterMs: null, responseModel: null };
  try {
    const { data, response, requestId } = await client
      .systemOne({ model: request.model, state: request.state, questions: request.questions })
      .withResponse();
    const latencyMs = elapsed();
    // The SDK does not validate the body, so read it defensively.
    const body: { model?: unknown; usage?: { input_tokens?: unknown; output_tokens?: unknown } } =
      typeof data === 'object' && data !== null ? data : {};
    const inputTokens = tokenCount(body.usage?.input_tokens);
    const outputTokens = tokenCount(body.usage?.output_tokens);
    return {
      index,
      latencyMs,
      status: response.status,
      requestId: requestId ?? null,
      inputTokens,
      outputTokens,
      errorClass: inputTokens === null || outputTokens === null ? 'InvalidResponse' : null,
      retryAfterMs: null,
      responseModel: typeof body.model === 'string' ? body.model : null,
      shape: request.shape,
    };
  } catch (error) {
    return {
      ...empty,
      index,
      latencyMs: elapsed(),
      status: error instanceof APIError ? error.status : null,
      requestId: error instanceof APIError ? (error.requestId ?? null) : null,
      errorClass: errorName(error),
      retryAfterMs: error instanceof RateLimitError ? (error.retryAfterMs ?? null) : null,
      shape: request.shape,
    };
  }
};

/** Nearest-rank percentile of an ascending list. */
const percentile = (sorted: number[], p: number): number =>
  sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)] ?? 0;

const latencyStats = (values: number[]): LatencyStats | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return {
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    max: sorted[sorted.length - 1] ?? 0,
  };
};

const mean = (values: number[]): number | null =>
  values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;

const round = (value: number, digits: number) => Number(value.toFixed(digits));

/** Spec §9: requests per game × input tokens × $0.042 per million, at 33 THB per USD. */
export const estimateCost = (meanInputTokens: number): CostEstimate[] =>
  GAME_COUNTS.map((games) => {
    const inputTokens = Math.round(games * REQUESTS_PER_GAME * meanInputTokens);
    const usd = (inputTokens * USD_PER_MILLION_INPUT_TOKENS) / 1_000_000;
    return { games, inputTokens, usd: round(usd, 6), thb: round(usd * THB_PER_USD, 4) };
  });

const tally = (keys: string[]): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const key of keys) counts[key] = (counts[key] ?? 0) + 1;
  return counts;
};

export const summarize = (records: CallRecord[]): SpikeSummary => {
  const ok = records.filter((record) => record.errorClass === null);
  const latencyMs = latencyStats(records.map((record) => record.latencyMs));
  const meanInputTokens = mean(ok.map((record) => record.inputTokens ?? 0));
  const meanOutputTokens = mean(ok.map((record) => record.outputTokens ?? 0));
  return {
    calls: records.length,
    okCalls: ok.length,
    latencyMs,
    okLatencyMs: latencyStats(ok.map((record) => record.latencyMs)),
    meanInputTokens: meanInputTokens === null ? null : round(meanInputTokens, 1),
    meanOutputTokens: meanOutputTokens === null ? null : round(meanOutputTokens, 1),
    statuses: tally(records.map((record) => String(record.status ?? 'none'))),
    errorClasses: tally(records.map((record) => record.errorClass ?? 'none')),
    rateLimited: records.filter((record) => record.status === 429).length,
    serverErrors: records.filter((record) => (record.status ?? 0) >= 500).length,
    retryAfterMs: records.flatMap((record) =>
      record.retryAfterMs === null ? [] : [record.retryAfterMs],
    ),
    p95AboveRequestDeadline: (latencyMs?.p95 ?? 0) > REQUEST_TIMEOUT_MS,
    cost: meanInputTokens === null ? null : estimateCost(meanInputTokens),
  };
};

export const checkModels = async (client: TypeSafeClient): Promise<ModelCheck> => {
  try {
    const models = (await client.models.list()).map((model) => model.name);
    return { pinnedModelListed: models.includes(PINNED_JEV_MODEL), models, errorClass: null };
  } catch (error) {
    return { pinnedModelListed: false, models: [], errorClass: errorName(error) };
  }
};

const delay = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

export interface RunSpikeOptions {
  client: TypeSafeClient;
  calls: number;
  network?: string;
  city?: string;
  sleep?: (ms: number) => Promise<void>;
}

/** Runs the calls one at a time, so the spike never adds its own load to the latency. */
export const runSpike = async ({
  client,
  calls,
  network,
  city,
  sleep = delay,
}: RunSpikeOptions): Promise<SpikeResult> => {
  const startedAt = new Date().toISOString();
  const modelCheck = await checkModels(client);
  const records: CallRecord[] = [];
  for (let index = 0; index < calls; index++) {
    const record = await timeCall(client, buildSpikeRequest(index), index);
    records.push(record);
    if (record.status === 429 && index < calls - 1) {
      await sleep(Math.min(record.retryAfterMs ?? DEFAULT_RETRY_AFTER_MS, MAX_RETRY_AFTER_MS));
    }
  }
  return {
    model: PINNED_JEV_MODEL,
    sdkVersion: VERSION,
    network: network ?? null,
    city: city ?? null,
    startedAt,
    finishedAt: new Date().toISOString(),
    settings: { calls, timeoutMs: REQUEST_TIMEOUT_MS, maxRetries: 0 },
    modelCheck,
    summary: summarize(records),
    calls: records,
  };
};

/** `spike-<date>.json`, or `spike-<date>-<n>.json` so a second run the same day never overwrites. */
export const resultsPath = (dir: string, date: string, exists = existsSync): string => {
  for (let n = 1; ; n++) {
    const path = join(dir, n === 1 ? `spike-${date}.json` : `spike-${date}-${n}.json`);
    if (!exists(path)) return path;
  }
};

export const parseCalls = (value: string): number => {
  const calls = Number(value);
  if (!Number.isSafeInteger(calls) || calls < 1) {
    throw new Error(`--calls must be a positive whole number, got "${value}".`);
  }
  return calls;
};

const ms = (stats: LatencyStats | null) =>
  stats ? `p50 ${stats.p50} ms, p95 ${stats.p95} ms, max ${stats.max} ms` : 'none';

export const formatSummary = ({ modelCheck, summary }: SpikeResult): string =>
  [
    `models.list() includes ${PINNED_JEV_MODEL}: ${modelCheck.pinnedModelListed ? 'yes' : 'no'}${
      modelCheck.errorClass ? ` (${modelCheck.errorClass})` : ''
    }`,
    `calls: ${summary.calls}, usable: ${summary.okCalls}`,
    `latency, all calls: ${ms(summary.latencyMs)}`,
    `latency, usable calls: ${ms(summary.okLatencyMs)}`,
    `p95 above the ${REQUEST_TIMEOUT_MS} ms request deadline: ${
      summary.p95AboveRequestDeadline ? 'yes' : 'no'
    }`,
    `mean tokens: input ${summary.meanInputTokens ?? 'n/a'}, output ${summary.meanOutputTokens ?? 'n/a'}`,
    `statuses: ${JSON.stringify(summary.statuses)}`,
    `error classes: ${JSON.stringify(summary.errorClasses)}`,
    `429s: ${summary.rateLimited}, 5xx: ${summary.serverErrors}, retry-after ms: ${JSON.stringify(
      summary.retryAfterMs,
    )}`,
    ...(summary.cost ?? []).map(
      (cost) =>
        `cost for ${cost.games} game(s): $${cost.usd} = THB ${cost.thb} (${cost.inputTokens} input tokens)`,
    ),
  ].join('\n');

const main = async (): Promise<void> => {
  const { values } = parseArgs({
    options: {
      calls: { type: 'string', default: '100' },
      network: { type: 'string' },
      city: { type: 'string' },
    },
  });
  const calls = parseCalls(values.calls);
  // The key stays in the git-ignored `.env`; the SDK reads it from the environment.
  if (existsSync('.env')) process.loadEnvFile('.env');
  if (!jevEnabled()) {
    throw new Error('JEV_ENABLED=false: the spike makes live calls, so it does not run.');
  }
  const result = await runSpike({
    client: createSpikeClient(),
    calls,
    network: values.network,
    city: values.city,
  });
  const dir = join(import.meta.dirname, 'results');
  mkdirSync(dir, { recursive: true });
  const path = resultsPath(dir, result.startedAt.slice(0, 10));
  writeFileSync(path, `${JSON.stringify(result, null, 2)}\n`);
  console.log(formatSummary(result));
  console.log(`Wrote ${path}`);
};

export const isEntryPoint = (moduleUrl: string, scriptPath: string | undefined): boolean =>
  scriptPath !== undefined && moduleUrl === pathToFileURL(resolve(scriptPath)).href;

if (isEntryPoint(import.meta.url, process.argv[1])) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
