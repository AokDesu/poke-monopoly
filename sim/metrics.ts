import type { Action, BallType, EngineEvent, GameState } from '../engine/index.ts';

const BALL_TYPES: readonly BallType[] = ['poke', 'great', 'ultra'];

/**
 * One row per Ball type, catch DC and Lap with at least one encounter (Appendix A's
 * `catchAttempt / encounter`). `lap` is the player's `creditedLap` (paid Laps, 0 before the first
 * Start crossing) when the encounter began.
 */
export type CatchRow = {
  ballType: BallType;
  dc: number;
  lap: number;
  encounters: number;
  attempts: number;
  catches: number;
  attemptsPerEncounter: number;
};

export type CatchingSummary = {
  encounters: number;
  attempts: number;
  catches: number;
  releases: number;
  byBallDcLap: CatchRow[];
};

/** Shop purchases by offer ID (e.g. `offer-poke`). */
export type ShopSummary = { purchases: Record<string, number> };

/**
 * Start Sell Phase sales by the seller's `creditedLap` (the n-th paid Start crossing is Lap n):
 * Pokémon sold and coins paid. Final Table Round auto-sales are not counted.
 */
export type SalesByLap = Record<string, { sold: number; coins: number }>;

export type MetricsSummary = {
  catching: CatchingSummary;
  shop: ShopSummary;
  salesByLap: SalesByLap;
};

export type MetricsCollector = {
  /** Adds one accepted step (`before` → `after` by `action`). */
  step(before: GameState, action: Action, after: GameState, events: readonly EngineEvent[]): void;
  summary(): MetricsSummary;
};

export function emptyMetricsSummary(): MetricsSummary {
  return {
    catching: { encounters: 0, attempts: 0, catches: 0, releases: 0, byBallDcLap: [] },
    shop: { purchases: {} },
    salesByLap: {},
  };
}

/** Collects the §8 and Appendix A counts over every game of a run, from accepted steps only. */
export function createMetrics(): MetricsCollector {
  const total = emptyMetricsSummary();
  const encounters = new Map<string, number>();
  const tries = new Map<string, { attempts: number; catches: number }>();
  // The DC and Lap of the encounter in progress, keyed when it began.
  let encounter: { dc: number; lap: number } | null = null;
  const sales = (lap: number) => (total.salesByLap[lap] ??= { sold: 0, coins: 0 });

  return {
    step(before, action, after, events) {
      const { catching } = total;
      if (after.phase.kind === 'encounter' && before.phase.kind !== 'encounter') {
        const { speciesId } = after.phase.pokemon;
        encounter = {
          dc: after.content.species.find((species) => species.id === speciesId)!.dc,
          lap: after.players[after.activeSeatIndex]!.creditedLap,
        };
        catching.encounters++;
        increment(encounters, `${encounter.dc}@${encounter.lap}`);
      }
      if (action.kind === 'buy') {
        const { purchases } = total.shop;
        purchases[action.payload.offerId] = (purchases[action.payload.offerId] ?? 0) + 1;
      }
      for (const event of events) {
        if (event.kind !== 'coin_transfer' || event.reason !== 'pokemon_sale') continue;
        const lap = sales(before.players[before.activeSeatIndex]!.creditedLap);
        lap.sold++;
        lap.coins += event.amount;
      }
      if (action.kind === 'release') catching.releases++;
      if (action.kind === 'catch' && encounter) {
        catching.attempts++;
        tally(tries, `${action.payload.ballType}@${encounter.dc}@${encounter.lap}`).attempts++;
      }
      if (
        action.kind === 'dice_result' &&
        action.payload.purpose.startsWith('catch:') &&
        before.phase.kind === 'encounter' &&
        before.phase.catchRoll &&
        encounter &&
        events.some((event) => event.kind === 'uid_created' && event.entity === 'pokemon')
      ) {
        catching.catches++;
        tally(tries, `${before.phase.catchRoll.ballType}@${encounter.dc}@${encounter.lap}`)
          .catches++;
      }
    },
    summary() {
      const rows: CatchRow[] = [];
      for (const ballType of BALL_TYPES) {
        const keys = [...encounters.keys()].sort(byDcThenLap);
        for (const key of keys) {
          const [dc, lap] = key.split('@').map(Number) as [number, number];
          const seen = encounters.get(key)!;
          const { attempts, catches } = tries.get(`${ballType}@${key}`) ?? {
            attempts: 0,
            catches: 0,
          };
          rows.push({
            ballType,
            dc,
            lap,
            encounters: seen,
            attempts,
            catches,
            attemptsPerEncounter: round2(attempts / seen),
          });
        }
      }
      return {
        catching: { ...total.catching, byBallDcLap: rows },
        shop: { purchases: sortedKeys(total.shop.purchases) },
        salesByLap: total.salesByLap,
      };
    },
  };
}

function sortedKeys<T>(record: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(record).sort(([a], [b]) => (a < b ? -1 : 1)));
}

function increment(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function tally(
  map: Map<string, { attempts: number; catches: number }>,
  key: string,
): { attempts: number; catches: number } {
  let entry = map.get(key);
  if (!entry) map.set(key, (entry = { attempts: 0, catches: 0 }));
  return entry;
}

function byDcThenLap(a: string, b: string): number {
  const [dcA, lapA] = a.split('@').map(Number) as [number, number];
  const [dcB, lapB] = b.split('@').map(Number) as [number, number];
  return dcA - dcB || lapA - lapB;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
