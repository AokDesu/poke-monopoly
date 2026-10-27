import type { JevResult, JevUsage } from './client.ts';
import { SPEND_CONFIG, type SpendConfig } from './spend.ts';

export interface UsageTotals {
  calls: number;
  inputTokens: number;
  outputTokens: number;
}

/** A disabled client, or a failure before sending, made no request and spent nothing. */
export const requestWentOut = (result: JevResult): boolean =>
  result.ok || (result.fallbackReason !== 'disabled' && result.requestSent !== false);

export interface BilledUsage extends JevUsage {
  /** The input tokens are the configured estimate for a timeout, not a measured count. */
  estimated: boolean;
}

/**
 * The tokens a request that went out counts toward the spend cap and the game's budget (spec §9):
 * the usage an answer reported, even an unusable or late one; for a timeout with no reported
 * usage, the configured estimate; otherwise none. `undefined` when no request went out.
 */
export const billedUsage = (
  result: JevResult,
  config: SpendConfig = SPEND_CONFIG,
): BilledUsage | undefined => {
  if (!requestWentOut(result)) return undefined;
  const reported = result.usage;
  if (reported) return { ...reported, estimated: false };
  if (!result.ok && result.fallbackReason === 'timeout') {
    return {
      inputTokens: config.estimatedInputTokensPerRequest,
      outputTokens: 0,
      estimated: true,
    };
  }
  return { inputTokens: 0, outputTokens: 0, estimated: false };
};

/** Adds up Jev usage for one game (spec §9); create one per game. */
export class UsageMeter {
  #totals: UsageTotals = { calls: 0, inputTokens: 0, outputTokens: 0 };

  /** Only requests that went out count as calls; each adds its `billedUsage`. */
  record(result: JevResult): void {
    const usage = billedUsage(result);
    if (!usage) return;
    this.#totals.calls += 1;
    this.#totals.inputTokens += usage.inputTokens;
    this.#totals.outputTokens += usage.outputTokens;
  }

  totals(): UsageTotals {
    return { ...this.#totals };
  }
}
