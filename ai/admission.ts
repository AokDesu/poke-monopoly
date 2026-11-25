import { GameQuota, ORCHESTRATOR_CONFIG, type OrchestratorConfig } from './orchestrator.ts';
import { warnLedgerFailed, type UsageRecorder } from './jev/spend.ts';
import type { RequestWindow } from './jev/window.ts';

/** How many games keep their own quota; the same bound as the orchestrator cache (spec §9, #64). */
export const MAX_TRACKED_GAMES = 64;

/**
 * The games' lifetime accounting (§9), bounded and never evicted, so a game cannot reset its own
 * limits. The IDs are the browser's to choose: a game past `max` is given no fresh quota but
 * shares one overflow quota, so inventing IDs buys no more than that one game's limits.
 */
export class QuotaBook {
  readonly #games = new Map<string, GameQuota>();
  readonly #overflow = new GameQuota();
  readonly #max: number;

  constructor(max: number = MAX_TRACKED_GAMES) {
    this.#max = max;
  }

  for(gameId: string): GameQuota {
    const found = this.#games.get(gameId);
    if (found) return found;
    if (this.#games.size >= this.#max) return this.#overflow;
    const quota = new GameQuota();
    this.#games.set(gameId, quota);
    return quota;
  }
}

/** Why a Jev request may not go out, in the orchestrator's own words. */
export type AdmissionRefusal = 'budget_exceeded' | 'request_limit' | 'token_budget';

export type Admitted = { quota: GameQuota; release: () => void };

export interface AdmissionOptions {
  usage: () => UsageRecorder | undefined;
  quotas?: QuotaBook;
  /** The server-wide Jev window; none means no window (the sim, fakes). */
  window?: RequestWindow;
  config?: OrchestratorConfig;
}

/**
 * Spec §9: the caps a Jev decision has, for the requests the orchestrator does not make (a chat
 * reply, a table-talk gate check): the turn's request limit, the game's token budget, the spend
 * guard with its estimate held until the usage line is written, and the server-wide window. A
 * spend guard that throws refuses the request (class logged, never the message).
 */
export class JevAdmission {
  readonly #usage: () => UsageRecorder | undefined;
  readonly #quotas: QuotaBook;
  readonly #window: RequestWindow | undefined;
  readonly #config: OrchestratorConfig;

  constructor({
    usage,
    quotas = new QuotaBook(),
    window,
    config = ORCHESTRATOR_CONFIG,
  }: AdmissionOptions) {
    this.#usage = usage;
    this.#quotas = quotas;
    this.#window = window;
    this.#config = config;
  }

  /** Reserves one request for this game's turn, or says why not; call `release` once its usage line is written. */
  admit(gameId: string, turnKey: string): Admitted | { reason: AdmissionRefusal } {
    const quota = this.#quotas.for(gameId);
    if (quota.requests(turnKey) >= this.#config.requestsPerTurn) return { reason: 'request_limit' };
    if (quota.meter.totals().inputTokens >= this.#config.inputTokensPerGame) {
      return { reason: 'token_budget' };
    }
    let release: (() => void) | null | undefined;
    try {
      const usage = this.#usage();
      release = usage?.reserve ? usage.reserve() : usage?.budgetExceeded() ? null : undefined;
    } catch (error) {
      warnLedgerFailed('The spend guard failed; the fallback decides', error);
      release = null;
    }
    if (release === null) return { reason: 'budget_exceeded' };
    if (this.#window && !this.#window.take()) {
      release?.();
      return { reason: 'request_limit' };
    }
    quota.reserve(turnKey);
    return { quota, release: release ?? (() => {}) };
  }
}
