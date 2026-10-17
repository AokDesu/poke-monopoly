import { int } from './rng.ts';
import type { Action, EngineEvent, GameState } from './contract/schema.ts';

// This cycle's utility-item pool (§4.6); item effects arrive with item use.
const UTILITY_POOL = ['lucky-egg', 'repel', 'pickpocket'];

/** Offer every Ball plus 2 distinct utility items drawn with the logged RNG (§4.6). */
export function openShop(next: GameState): EngineEvent[] {
  const pool = next.content.items.filter(
    (item) => item.kind === 'utility' && UTILITY_POOL.includes(item.id),
  );
  if (pool.length < 2) throw new RangeError('Shop needs 2 utility items in content');
  const first = int(next.rng, pool.length, 'shop:item');
  const [picked] = pool.splice(first.value, 1);
  const second = int(first.rng, pool.length, 'shop:item');
  next.rng = second.rng;
  const balls = next.content.items.flatMap((item) =>
    item.kind === 'ball'
      ? [
          {
            id: `offer-${item.ballType}`,
            itemId: item.id,
            kind: 'ball' as const,
            ballType: item.ballType,
            price: item.price,
          },
        ]
      : [],
  );
  next.phase = {
    kind: 'shop',
    offers: [
      ...balls,
      ...[picked!, pool[second.value]!].map((item) => ({
        id: `offer-${item.id}`,
        itemId: item.id,
        kind: 'utility' as const,
        price: item.price,
      })),
    ],
  };
  return [...first.events, ...second.events];
}

/** One validated purchase or skip closes the Shop; there is no refresh (§4.6). */
export function confirmShop(next: GameState, action: Action): EngineEvent[] {
  if (next.phase.kind !== 'shop') return [];
  const events: EngineEvent[] = [];
  if (action.kind === 'buy') {
    const offerId = action.payload.offerId;
    const offer = next.phase.offers.find((entry) => entry.id === offerId)!;
    const player = next.players.find((entry) => entry.seatIndex === next.activeSeatIndex)!;
    player.coins -= offer.price;
    events.push({
      kind: 'coin_transfer',
      source: { kind: 'player', actorId: player.actorId },
      destination: { kind: 'bank' },
      amount: offer.price,
      reason: 'shop_purchase',
    });
    if (offer.kind === 'ball') {
      player.balls[offer.ballType]++;
    } else {
      // The accepted revision is unique, so this cannot collide with an existing UID.
      const instanceId = `bought:${player.seatIndex}:${next.stateRevision}`;
      const item = next.content.items.find((entry) => entry.id === offer.itemId)!;
      // Utility items gained after setup are secret (§4.1).
      player.items.push({ instanceId, itemId: item.id, name: item.name, visibility: 'secret' });
      events.push({ kind: 'uid_created', instanceId, entity: 'item', ownerId: player.actorId });
    }
  }
  next.phase = { kind: 'end' };
  return [...events, { kind: 'phase_changed', from: 'shop', to: 'end' }];
}
