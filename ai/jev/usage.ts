import type { JevResult } from './client.ts';

export interface UsageTotals {
  calls: number;
  inputTokens: number;
  outputTokens: number;
}

/** A disabled client, or a failure before sending, made no request and spent nothing. */
export const requestWentOut = (result: JevResult): boolean =>
  result.ok || (result.fallbackReason !== 'disabled' && result.requestSent !== false);

/** Adds up Jev usage for one game (spec §9); create one per game. */
export class UsageMeter {
  #totals: UsageTotals = { calls: 0, inputTokens: 0, outputTokens: 0 };

  /** Only requests that went out count as calls; only successes report tokens. */
  record(result: JevResult): void {
    if (!requestWentOut(result)) return;
    this.#totals.calls += 1;
    if (!result.ok) return;
    this.#totals.inputTokens += result.usage.inputTokens;
    this.#totals.outputTokens += result.usage.outputTokens;
  }

  totals(): UsageTotals {
    return { ...this.#totals };
  }
}
