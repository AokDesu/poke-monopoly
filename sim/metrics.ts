import {
  ABILITY_EFFECTS,
  type Action,
  type BallType,
  type EngineEvent,
  type GameState,
} from '../engine/index.ts';
import {
  createInteractionMetrics,
  emptyHostilitySummary,
  emptyDealSummary,
  emptyPromiseSummary,
  type DealSummary,
  type DecisionEvidence,
  type HostilitySummary,
  type PromiseSummary,
} from './interactions.ts';

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

/**
 * Trigger evidence (§8: every bonus must have a real chance to trigger): Ability activations by
 * effect primitive, class passives that changed a number, and battles by kind.
 */
export type FeatureSummary = {
  primitives: Record<string, number>;
  classPassives: Record<string, number>;
  battles: { pvp: number; forced: number; gym: number };
};

export type MetricsSummary = {
  events: { drawn: Record<string, number>; resolved: Record<string, number>; shuffles: number };
  hostility: HostilitySummary;
  promises: PromiseSummary;
  deals: DealSummary;
  catching: CatchingSummary;
  shop: ShopSummary;
  salesByLap: SalesByLap;
  features: FeatureSummary;
};

export type MetricsCollector = {
  startGame(): void;
  /** Adds one accepted step (`before` → `after` by `action`). */
  step(
    before: GameState,
    action: Action,
    after: GameState,
    events: readonly EngineEvent[],
    decision?: DecisionEvidence,
  ): void;
  summary(): MetricsSummary;
};

export function emptyMetricsSummary(): MetricsSummary {
  return {
    events: { drawn: {}, resolved: {}, shuffles: 0 },
    hostility: emptyHostilitySummary(),
    promises: emptyPromiseSummary(),
    deals: emptyDealSummary(),
    catching: { encounters: 0, attempts: 0, catches: 0, releases: 0, byBallDcLap: [] },
    shop: { purchases: {} },
    salesByLap: {},
    features: { primitives: {}, classPassives: {}, battles: { pvp: 0, forced: 0, gym: 0 } },
  };
}

/** Collects the §8 and Appendix A counts over every game of a run, from accepted steps only. */
export function createMetrics(): MetricsCollector {
  const interactions = createInteractionMetrics();
  const total = emptyMetricsSummary();
  const encounters = new Map<string, number>();
  const tries = new Map<string, { attempts: number; catches: number }>();
  // The DC and Lap of the encounter in progress, keyed when it began.
  let encounter: { dc: number; lap: number } | null = null;
  const sales = (lap: number) => (total.salesByLap[lap] ??= { sold: 0, coins: 0 });

  return {
    startGame() {
      interactions.startGame();
    },
    step(before, action, after, events, decision) {
      interactions.step(before, after, events, decision);
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
        if (event.kind === 'event_drawn') {
          total.events.drawn[event.eventId] = (total.events.drawn[event.eventId] ?? 0) + 1;
        }
        if (event.kind === 'event_resolved') {
          total.events.resolved[event.eventId] = (total.events.resolved[event.eventId] ?? 0) + 1;
        }
        if (event.kind === 'event_deck_shuffled') total.events.shuffles++;
        if (event.kind !== 'coin_transfer' || event.reason !== 'pokemon_sale') continue;
        const lap = sales(before.players[before.activeSeatIndex]!.creditedLap);
        lap.sold++;
        lap.coins += event.amount;
      }
      countFeatures(total.features, before, action, after, events);
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
        events: {
          drawn: sortedKeys(total.events.drawn),
          resolved: sortedKeys(total.events.resolved),
          shuffles: total.events.shuffles,
        },
        ...interactions.summary(),
        catching: { ...total.catching, byBallDcLap: rows },
        shop: { purchases: sortedKeys(total.shop.purchases) },
        salesByLap: total.salesByLap,
        features: {
          primitives: sortedKeys(total.features.primitives),
          classPassives: sortedKeys(total.features.classPassives),
          battles: total.features.battles,
        },
      };
    },
  };
}

function countFeatures(
  features: FeatureSummary,
  before: GameState,
  action: Action,
  after: GameState,
  events: readonly EngineEvent[],
): void {
  const passiveOf = (actorId: string) => {
    const classId = before.players.find((player) => player.actorId === actorId)?.classId;
    return before.content.classes.find((entry) => entry.id === classId)?.passive;
  };
  const passive = (id: string | undefined) => {
    if (id) features.classPassives[id] = (features.classPassives[id] ?? 0) + 1;
  };
  for (const event of events) {
    if (event.kind === 'ability_activated') {
      const { primitive } = ABILITY_EFFECTS[event.effect];
      features.primitives[primitive] = (features.primitives[primitive] ?? 0) + 1;
    }
    if (event.kind === 'pvp_confirmed') {
      features.battles.pvp++;
      if (after.phase.kind === 'pvp' && after.phase.battle.forced) features.battles.forced++;
      for (const side of [event.snapshot.attacker, event.snapshot.defender]) {
        if (side.classBonus > 0) passive(passiveOf(before.players[side.seatIndex]!.actorId));
      }
    }
    if (event.kind === 'gym_confirmed') features.battles.gym++;
    // A sale's class bonus is paid by the bank to the seller (§4.7).
    if (event.kind === 'coin_transfer' && event.sale && event.sale.classBonus > 0) {
      if (event.destination.kind === 'player') passive(passiveOf(event.destination.actorId));
    }
    if (event.kind === 'status_changed' && event.reason === 'nurse_joy')
      passive(passiveOf(event.ownerId));
    if (event.kind === 'protection_applied' && event.protection === 'nurse_joy') {
      passive(passiveOf(event.targetId));
    }
  }
  if (action.kind === 'catch' && after.phase.kind === 'encounter' && after.phase.catchRoll) {
    if (after.phase.catchRoll.classBonus > 0) passive(passiveOf(action.actorId));
  }
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
