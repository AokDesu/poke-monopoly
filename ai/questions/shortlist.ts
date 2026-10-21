import type { LegalAction, Observation } from '../../engine/index.ts';

export type PersonalityWeight = 'risk' | 'aggression' | 'liquidity' | 'loyalty';

/** The parts of a `content/personalities/<name>.json` file the question builders read (spec §5.5). */
export interface Personality {
  /** Display name, such as "Greedy". */
  name: string;
  /** English description inserted into the state as `you.personality`. */
  description: string;
  weights: Readonly<Record<PersonalityWeight, number>>;
}

// Spec §5.3: a Strategy Choice offers at most 12 legal action IDs, `skip` included.
export const SHORTLIST_LIMIT = 12;

/**
 * Which weights pull towards (+1) or away from (−1) each action kind. Unlisted kinds are neutral.
 * Hostile items cost loyalty; a throw spends a Ball, so it trades liquidity for risk.
 */
const TRAITS: Readonly<Record<string, Partial<Record<PersonalityWeight, number>>>> = {
  'use_item:pickpocket': { aggression: 1, liquidity: 1, loyalty: -1 },
  'use_item:repel': { aggression: 1, loyalty: -1 },
  'use_item:lucky-egg': { risk: 1 },
  catch: { risk: 1, liquidity: -1 },
};

/** Item uses split by item, so a personality cannot drop every Repel by disliking Pickpocket. */
export function actionKind(action: LegalAction, observation: Observation): string {
  if (action.kind !== 'use_item') return action.kind;
  const item = observation.own.items.find(
    (entry) => entry.instanceId === action.payload.itemInstanceId,
  );
  return `use_item:${item?.itemId ?? 'unknown'}`;
}

const targetOf = (action: LegalAction) =>
  action.kind === 'use_item' ? action.payload.targetSeatIndex : undefined;

export function affinity(kind: string, personality: Personality): number {
  const traits = TRAITS[kind] ?? {};
  return Object.entries(traits).reduce(
    (sum, [weight, sign]) => sum + sign * personality.weights[weight as PersonalityWeight],
    0,
  );
}

/**
 * Spec §3.1 and §5.3: the personality filter drops actions it leans away from, but every legal
 * action kind keeps its best-ranked action, and `skip` is always kept when it is legal. Uses of
 * the same item kind on the same target are interchangeable (two Repels on one seat), so only
 * the first is offered. Over the limit, `skip` and one action per kind come first, then the
 * best-ranked rest. The result keeps the engine's order.
 */
export function shortlistActions(
  actions: readonly LegalAction[],
  personality: Personality,
  observation: Observation,
  limit = SHORTLIST_LIMIT,
): LegalAction[] {
  const coins = (seat: number | undefined) =>
    observation.public.players.find((player) => player.seatIndex === seat)?.coins ?? 0;
  const seen = new Set<string>();
  const candidates = actions
    .map((action, index) => {
      const kind = actionKind(action, observation);
      return { action, index, kind, score: affinity(kind, personality) };
    })
    .filter(({ action, kind }) => {
      const key = action.kind === 'use_item' ? `${kind}|${targetOf(action) ?? 'self'}` : action.id;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  const skip = candidates.filter(({ action }) => action.kind === 'skip');
  // Best first: liked kinds, then the richer target (the leader), then the engine's order.
  const ranked = candidates
    .filter(({ action }) => action.kind !== 'skip')
    .sort(
      (a, b) =>
        b.score - a.score ||
        coins(targetOf(b.action)) - coins(targetOf(a.action)) ||
        a.index - b.index,
    );
  const kept = ranked.filter(({ score }) => score >= 0);
  const bestOfKind = ranked.filter(
    (entry, at) => ranked.findIndex(({ kind }) => kind === entry.kind) === at,
  );
  const chosen = new Set([...skip, ...bestOfKind]);
  for (const entry of kept) {
    if (chosen.size >= limit) break;
    chosen.add(entry);
  }
  return [...chosen]
    .slice(0, limit)
    .sort((a, b) => a.index - b.index)
    .map(({ action }) => action);
}
