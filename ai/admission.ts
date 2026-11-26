import { GameQuota, ORCHESTRATOR_CONFIG, type OrchestratorConfig } from './orchestrator.ts';
import { warnLedgerFailed, type UsageRecorder } from './jev/spend.ts';
import type { RequestWindow } from './jev/window.ts';

/**
 * How many games the book tracks. A game past it is refused (never shared with another game, never
 * given a fresh budget) until the server restarts. A tracked game costs a few hundred bytes until
 * a request for it is admitted, and admissions are bounded by the server-wide window, so the book
 * only reaches this in a long run of invented IDs; no honest session comes near it (spec §9, #64).
 */
export const MAX_TRACKED_GAMES = 10_000;

/** The quota of a game the book has no room for: every turn is at its limit, so the request falls back. */
class ClosedQuota extends GameQuota {
  override requests(): number {
    return Infinity;
  }
  override reserve(): void {}
}

/**
 * The games' lifetime accounting (§9): one `GameQuota` per game ID, kept for as long as the server
 * runs and never evicted, so a game cannot reset its own limits, and no game shares another's
 * (turn keys such as `5:1` are the same in every game). The IDs are the browser's to choose, so the
 * memory is bounded by the server-wide `RequestWindow` and the spend cap, which bound how many
 * requests, and so how many turn counts, any client can add; and by `max` games, past which a new
 * ID gets a closed quota instead of a fresh or a shared one.
 */
export class QuotaBook {
  readonly #games = new Map<string, GameQuota>();
  readonly #closed = new ClosedQuota();
  readonly #max: number;

  constructor(max: number = MAX_TRACKED_GAMES) {
    this.#max = max;
  }

  for(gameId: string): GameQuota {
    const found = this.#games.get(gameId);
    if (found) return found;
    if (this.#games.size >= this.#max) return this.#closed;
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
