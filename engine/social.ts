import type {
  ChatMessage,
  ChatPayload,
  ChatTopic,
  EngineEvent,
  GameState,
  LegalAction,
  LegalActions,
} from './contract/schema.ts';
import { ENGINE_VERSION } from './versions.ts';

/** Messages kept per pair (§4.8 and §5.4: at most the last 3 relevant messages reach Jev). */
export const CHAT_HISTORY_PER_PAIR = 3;

/**
 * Whether the active human may start a conversation now (§4.2): the flag is on, it is the Social
 * window, and this turn's one social interaction is unspent. AI seats never start conversations.
 */
export function socialOpen(state: GameState, seatIndex: number): boolean {
  if (state.config.socialWindow !== true) return false;
  if (state.config.engineVersion !== ENGINE_VERSION) return false;
  if (state.pendingResponse) return false;
  if (state.phase.kind !== 'social' || state.activeSeatIndex !== seatIndex) return false;
  if ((state.turnBudgets.socialInteraction ?? 0) <= 0) return false;
  return state.config.seats.find((seat) => seat.seatIndex === seatIndex)?.controller === 'human';
}

/**
 * Every chat message the seat may send. It depends on public facts only: seats and the content
 * item list, never on what any player holds, so asking cannot reveal a hidden item (§4.8).
 */
function chatPayloads(state: GameState, seatIndex: number): ChatPayload[] {
  if (!socialOpen(state, seatIndex)) return [];
  const utilityItems = state.content.items.filter((item) => item.kind === 'utility');
  const seats = state.players.map((player) => player.seatIndex);
  const payloads: ChatPayload[] = [];
  for (const targetSeatIndex of seats.filter((seat) => seat !== seatIndex)) {
    payloads.push({ targetSeatIndex, topic: 'truce' }, { targetSeatIndex, topic: 'trade' });
    // Pointing at the leader names a third seat; words only, so it is not checked against the lead.
    for (const leaderSeatIndex of seats) {
      if (leaderSeatIndex === seatIndex || leaderSeatIndex === targetSeatIndex) continue;
      payloads.push({ targetSeatIndex, topic: 'point_leader', leaderSeatIndex });
    }
    for (const topic of ['use_item', 'hold_item'] as const) {
      for (const item of utilityItems) payloads.push({ targetSeatIndex, topic, itemId: item.id });
    }
  }
  return payloads;
}

function chatId(payload: ChatPayload): string {
  const parts = [`chat:seat-${payload.targetSeatIndex}:${payload.topic}`];
  if (payload.leaderSeatIndex !== undefined) parts.push(`seat-${payload.leaderSeatIndex}`);
  if (payload.itemId !== undefined) parts.push(payload.itemId);
  return parts.join(':');
}

/** Adds the Social window's chat choices; Skip itself stays with the turn skeleton. */
export function chatChoices(state: GameState, seatIndex: number, result: LegalActions): void {
  for (const payload of chatPayloads(state, seatIndex)) {
    const action: LegalAction = { id: chatId(payload), kind: 'chat', payload };
    result.enabled.push(action);
  }
}

/** Validates one message as a whole, so no payload is ever checked by string comparison. */
export function validChat(state: GameState, seatIndex: number, payload: ChatPayload): boolean {
  return chatPayloads(state, seatIndex).some(
    (allowed) =>
      allowed.targetSeatIndex === payload.targetSeatIndex &&
      allowed.topic === payload.topic &&
      allowed.leaderSeatIndex === payload.leaderSeatIndex &&
      allowed.itemId === payload.itemId,
  );
}

/** Spends the social interaction and keeps the message. Changes nothing else (§4.8 hard line). */
export function recordChat(next: GameState, payload: ChatPayload): EngineEvent[] {
  const fromSeatIndex = next.activeSeatIndex;
  next.turnBudgets.socialInteraction = (next.turnBudgets.socialInteraction ?? 0) - 1;
  const message: ChatMessage = {
    fromSeatIndex,
    toSeatIndex: payload.targetSeatIndex,
    topic: payload.topic,
    ...(payload.leaderSeatIndex !== undefined && { leaderSeatIndex: payload.leaderSeatIndex }),
    ...(payload.itemId !== undefined && { itemId: payload.itemId }),
    globalTurnNo: next.globalTurnNo,
  };
  const seats: [number, number] = [
    Math.min(fromSeatIndex, payload.targetSeatIndex),
    Math.max(fromSeatIndex, payload.targetSeatIndex),
  ];
  const chats = (next.chats ??= []);
  let pair = chats.find((entry) => entry.seats[0] === seats[0] && entry.seats[1] === seats[1]);
  if (!pair) {
    pair = { seats, messages: [] };
    chats.push(pair);
  }
  pair.messages = [...pair.messages, message].slice(-CHAT_HISTORY_PER_PAIR);
  return [
    {
      kind: 'chat_sent',
      fromSeatIndex,
      toSeatIndex: payload.targetSeatIndex,
      topic: payload.topic,
      ...(payload.leaderSeatIndex !== undefined && { leaderSeatIndex: payload.leaderSeatIndex }),
      ...(payload.itemId !== undefined && { itemId: payload.itemId }),
    },
  ];
}

/** The messages a seat sent or received, oldest first; no other seat's conversation (§4.8, §5.4). */
export function chatsOf(state: GameState, seatIndex: number): ChatMessage[] {
  return (state.chats ?? [])
    .filter((pair) => pair.seats.includes(seatIndex))
    .flatMap((pair) => pair.messages)
    .sort((a, b) => a.globalTurnNo - b.globalTurnNo);
}

export type { ChatTopic };
