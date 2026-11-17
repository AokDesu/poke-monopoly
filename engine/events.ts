import type { EngineEvent, GameState } from './contract/schema.ts';
import { drawEncounter } from './catching.ts';
import { effectiveForm } from './forms.ts';
import { applyStatus } from './status.ts';
import { int, shuffle } from './rng.ts';
import { publicRevision } from './revision.ts';

export const EVENT_IDS = ['e1', 'e2', 'e3', 'e4', 'e5', 'e6'];

/** Shared by draws and Track: setup retains cursor zero; the first use logs the shuffle. */
export function ensureEventDeck(next: GameState): EngineEvent[] {
  const deck = next.eventDeck;
  if (deck.drawPile.length) return [];
  const cards = deck.discardPile.length
    ? deck.discardPile
    : (next.content.events ?? EVENT_IDS.map((id) => ({ id }))).map((event) => event.id);
  const shuffled = shuffle(next.rng, cards, 'shuffle:events');
  next.rng = shuffled.rng;
  deck.drawPile = shuffled.value;
  deck.discardPile = [];
  return [...shuffled.events, { kind: 'event_deck_shuffled', cardCount: cards.length }];
}

/** Resolve one destination Event on the executor's detached snapshot (§4.6). */
export function drawAndResolveEvent(next: GameState): EngineEvent[] {
  delete next.lastEventReward;
  const events = ensureEventDeck(next);
  const eventId = next.eventDeck.drawPile.shift()!;
  if (!EVENT_IDS.includes(eventId)) throw new RangeError(`Unknown Event: ${eventId}`);
  next.eventDeck.discardPile.push(eventId);
  const player = next.players.find((entry) => entry.seatIndex === next.activeSeatIndex)!;
  events.push({ kind: 'event_drawn', seatIndex: player.seatIndex, eventId });
  if (eventId === 'e1') {
    events.push(...drawEncounter(next));
    if (next.phase.kind !== 'encounter') throw new RangeError('Event encounter missing');
    next.lastEvent = {
      seatIndex: player.seatIndex,
      eventId,
      result: { kind: 'encounter', speciesId: next.phase.pokemon.speciesId },
    };
    events.push({ kind: 'event_resolved', ...next.lastEvent });
  }
  if (eventId === 'e2' || eventId === 'e3') {
    const amount = eventId === 'e2' ? 6 : -Math.min(4, player.coins);
    player.coins += amount;
    events.push({
      kind: 'coin_transfer',
      source: eventId === 'e2' ? { kind: 'bank' } : { kind: 'player', actorId: player.actorId },
      destination:
        eventId === 'e2' ? { kind: 'player', actorId: player.actorId } : { kind: 'bank' },
      amount: Math.abs(amount),
      reason: `event:${eventId}`,
    });
    next.lastEvent = {
      seatIndex: player.seatIndex,
      eventId,
      result: { kind: 'coins', transfers: [{ seatIndex: player.seatIndex, amount }] },
    };
    events.push({ kind: 'event_resolved', ...next.lastEvent });
  }
  if (eventId === 'e6') {
    const poorest = Math.min(...next.players.map((entry) => entry.coins));
    const recipients = next.players.filter((entry) => entry.coins === poorest);
    const amount = Math.floor(5 / recipients.length);
    for (const recipient of recipients) {
      recipient.coins += amount;
      events.push({
        kind: 'coin_transfer',
        source: { kind: 'bank' },
        destination: { kind: 'player', actorId: recipient.actorId },
        amount,
        reason: 'event:e6',
      });
    }
    next.lastEvent = {
      seatIndex: player.seatIndex,
      eventId,
      result: {
        kind: 'coins',
        transfers: recipients.map((entry) => ({ seatIndex: entry.seatIndex, amount })),
      },
    };
    events.push({ kind: 'event_resolved', ...next.lastEvent });
  }
  if (eventId === 'e5') {
    const target = [...player.team].sort(
      (a, b) =>
        effectiveForm(next.content, b.speciesId).battle -
          effectiveForm(next.content, a.speciesId).battle ||
        (a.instanceId < b.instanceId ? -1 : a.instanceId > b.instanceId ? 1 : 0),
    )[0];
    if (target) events.push(...applyStatus(player, target.instanceId, 'tired', 'event:e5'));
    next.lastEvent = {
      seatIndex: player.seatIndex,
      eventId,
      result: { kind: 'tired', instanceId: target?.instanceId ?? null },
    };
    events.push({ kind: 'event_resolved', ...next.lastEvent });
  }
  if (eventId === 'e4') {
    if (player.items.length >= 4) {
      player.balls.poke++;
      next.lastEventReward = { kind: 'ball', ballType: 'poke' };
      events.push({ kind: 'ball_gained', ownerId: player.actorId, ballType: 'poke' });
    } else {
      const pool = next.content.items.filter((item) => item.kind === 'utility');
      const picked = int(next.rng, pool.length, 'event:e4:item');
      next.rng = picked.rng;
      const definition = pool[picked.value]!;
      const item = {
        instanceId: `event-item:${player.seatIndex}:${publicRevision(next)}`,
        itemId: definition.id,
        name: definition.name,
        visibility: 'secret' as const,
      };
      player.items.push(item);
      next.lastEventReward = { kind: 'item', item };
      events.push(
        ...picked.events,
        {
          kind: 'uid_created',
          instanceId: item.instanceId,
          entity: 'item',
          ownerId: player.actorId,
        },
        { kind: 'item_gained', ownerId: player.actorId, item },
      );
    }
    next.lastEvent = { seatIndex: player.seatIndex, eventId, result: { kind: 'item' } };
    events.push({ kind: 'event_resolved', ...next.lastEvent });
  }
  return events;
}
