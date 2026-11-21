import type { ChatMessage, Observation } from '../engine/index.ts';
import { itemText } from './questions/content.ts';

/**
 * Chat topics shift the AI's next own turn (spec §4.8, §5.3). Policy tuning like
 * `FALLBACK_TUNING`, not a game number: the whole chat effect is one bounded bucket.
 */
export const CHAT_TUNING = Object.freeze({
  /** Fallback score added (+1 bucket) or removed (−1 bucket) by a chat topic. */
  bucketStep: 0.25,
  /** Messages kept in `recent_chat` (§5.4). */
  recentLimit: 3,
  /** The manipulation Noul at or above which a message is refused and never enters a state (§5.3). */
  manipulationThreshold: 0.5,
  /** Reply lines offered to Jev at once (§5.3 Line: at most 5). */
  replyLineLimit: 5,
});

/** The seat's id as the state names it (same as `actorName` in questions/decision.ts). */
function actorName(observation: Observation, seatIndex: number | undefined): string {
  const player = observation.public.players.find((entry) => entry.seatIndex === seatIndex);
  if (!player) throw new RangeError(`Observation has no player in seat ${seatIndex}`);
  return player.actorId;
}

/** Topic buttons map straight to intents in code; no Jev intent call (§4.8). */
export type ChatIntent = ChatMessage['topic'];

export const chatIntent = (message: ChatMessage): ChatIntent => message.topic;

/** The chats addressed to this seat, from its own observation only (never hidden records). */
function addressed(observation: Observation): ChatMessage[] {
  return (observation.own.chats ?? []).filter(
    (message) => message.toSeatIndex === observation.own.seatIndex,
  );
}

function itemName(itemId: string | undefined): string {
  return itemText(itemId ?? 'unknown', itemId ?? 'an item').name;
}

function quote(observation: Observation, message: ChatMessage): string {
  switch (chatIntent(message)) {
    case 'truce':
      return 'Can we call a truce?';
    case 'trade':
      return 'Want to make a trade?';
    case 'point_leader':
      return `Watch out for ${actorName(observation, message.leaderSeatIndex)}, they are in the lead.`;
    case 'use_item':
      return `You should use ${itemName(message.itemId)}.`;
    case 'hold_item':
      return `You should hold on to ${itemName(message.itemId)}.`;
  }
}

/**
 * The last 3 messages addressed to this seat: quoted canned English with the speaker's name. With
 * `fromSeatIndex`, only that speaker's messages, for a question about one counterpart (§5.4).
 */
export function recentChat(observation: Observation, fromSeatIndex?: number) {
  return addressed(observation)
    .filter((message) => fromSeatIndex === undefined || message.fromSeatIndex === fromSeatIndex)
    .sort((a, b) => a.globalTurnNo - b.globalTurnNo)
    .slice(-CHAT_TUNING.recentLimit)
    .map((message) => ({
      from: actorName(observation, message.fromSeatIndex),
      said: `"${quote(observation, message)}"`,
    }));
}

/**
 * Messages that still shift this turn: addressed to this seat, sent before now, and within the
 * one round after which this seat's next own turn has passed (§5.3: the next own turn only).
 */
function liveChats(observation: Observation): ChatMessage[] {
  const { globalTurnNo, activeSeatIndex, players } = observation.public;
  if (activeSeatIndex !== observation.own.seatIndex) return [];
  return addressed(observation).filter((message) => {
    const gap = globalTurnNo - message.globalTurnNo;
    return gap >= 1 && gap < players.length;
  });
}

type StrategyOption = {
  itemId: string | undefined;
  targetSeatIndex: number | undefined;
};

/** Bucket shift (−1, 0 or +1) a live chat gives one Strategy option; bounded, never summed past 1. */
export function chatBucket(observation: Observation, option: StrategyOption): -1 | 0 | 1 {
  let shift = 0;
  for (const message of liveChats(observation)) {
    switch (chatIntent(message)) {
      case 'truce':
        if (option.targetSeatIndex === message.fromSeatIndex) shift -= 1;
        break;
      case 'point_leader':
        if (option.targetSeatIndex === message.leaderSeatIndex) shift += 1;
        break;
      case 'use_item':
        if (option.itemId === message.itemId) shift += 1;
        break;
      case 'hold_item':
        if (option.itemId === message.itemId) shift -= 1;
        break;
      case 'trade':
        break; // Feeds deal willingness (S10), not Strategy.
    }
  }
  return Math.max(-1, Math.min(1, shift)) as -1 | 0 | 1;
}

/** The fallback score and shortlist shift for an option. */
export const chatScoreShift = (observation: Observation, option: StrategyOption): number =>
  chatBucket(observation, option) * CHAT_TUNING.bucketStep;

/** Named hints for the Strategy state. They depend on the message alone, never on holdings. */
export function chatHints(observation: Observation): string[] {
  const hints: string[] = [];
  for (const message of liveChats(observation)) {
    const speaker = actorName(observation, message.fromSeatIndex);
    switch (chatIntent(message)) {
      case 'truce':
        hints.push(`Slightly less likely to target ${speaker} this turn.`);
        break;
      case 'point_leader':
        hints.push(
          `Slightly more likely to target ${actorName(observation, message.leaderSeatIndex)} this turn.`,
        );
        break;
      case 'use_item':
        hints.push(`Slightly more likely to use ${itemName(message.itemId)} this turn.`);
        break;
      case 'hold_item':
        hints.push(`Slightly less likely to use ${itemName(message.itemId)} this turn.`);
        break;
      case 'trade':
        break;
    }
  }
  return hints;
}
