/**
 * Spec §9, #64: server-wide operational limits on paid requests, one window per provider. They are
 * not game limits and change no §9 number (3 requests per AI turn, 600k input tokens per game,
 * Haiku's 150 calls and 200,000 tokens per game, the THB caps). Per-game and per-turn counts are
 * keyed on IDs the browser chooses, so a client that invents a new ID gets a fresh count there;
 * this window is the bound it cannot dodge. A normal game sends far fewer: about 140 Jev requests
 * over several minutes, and at most 20 Haiku calls a minute (one in flight, a 3 s deadline).
 */
export const SERVER_LIMITS = Object.freeze({
  windowMs: 60_000,
  /** Jev requests (decisions, chat replies and manipulation-gate checks) per window, all games. */
  jevRequestsPerWindow: 300,
  /** Haiku calls per window, all games. */
  haikuCallsPerWindow: 60,
});

/** At most `max` requests in any `windowMs`, counted when they are taken; a refusal counts nothing. */
export class RequestWindow {
  readonly #times: number[] = [];
  readonly #max: number;
  readonly #windowMs: number;
  readonly #now: () => number;
  readonly #label: string;
  #refusing = false;

  constructor(
    max: number,
    windowMs: number = SERVER_LIMITS.windowMs,
    now = Date.now,
    label = 'server',
  ) {
    this.#max = max;
    this.#windowMs = windowMs;
    this.#now = now;
    this.#label = label;
  }

  /** Counts one request now; `false` (and nothing counted) when the window already holds `max`. */
  take(): boolean {
    const now = this.#now();
    while (this.#times.length > 0 && this.#times[0]! <= now - this.#windowMs) this.#times.shift();
    if (this.#times.length >= this.#max) {
      // Once per episode, so an operator can tell a window that filled from a stream of refusals;
      // no ID, state or request text, and never counted.
      if (!this.#refusing) {
        this.#refusing = true;
        console.warn(
          `The ${this.#label} request window is full; requests fall back until it clears.`,
        );
      }
      return false;
    }
    this.#refusing = false;
    this.#times.push(now);
    return true;
  }
}
