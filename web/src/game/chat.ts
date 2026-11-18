import type { ChatMessage, ChatTopic, LegalAction, LegalActions } from '../../../engine/index.ts';
import type { ChatReply, ChatReplyRequest } from '../../../engine/contract/chat-reply.ts';
import type { SeatView } from './store.ts';

export type { ChatReply, ChatReplyRequest };

/** Presentation/network budget for a reply, not a game-rule number: nothing waits for it (spec §3.1). */
export const CHAT_REPLY_MS = 3000;

/** The five topic buttons, in the order the spec lists them (§4.8). */
export const CHAT_TOPICS: readonly ChatTopic[] = [
  'truce',
  'trade',
  'point_leader',
  'use_item',
  'hold_item',
];

/** What the human may say now, read from the engine's own enabled `chat` choices. */
export type ChatChoice = Extract<LegalAction, { kind: 'chat' }>;

export const chatChoices = (legal: LegalActions): ChatChoice[] =>
  legal.enabled.filter((action): action is ChatChoice => action.kind === 'chat');

/** A message's identity within a game: one human message per turn, so the turn names it. */
export const messageKey = (
  message: Pick<ChatMessage, 'fromSeatIndex' | 'toSeatIndex' | 'globalTurnNo'>,
) => `${message.fromSeatIndex}:${message.toSeatIndex}:${message.globalTurnNo}`;

/** Why a reply did not arrive. The conversation itself is already committed either way. */
export type ChatReplyFailure = 'network' | 'timeout' | 'invalid' | 'stale';

export class ChatReplyError extends Error {
  readonly reason: ChatReplyFailure;
  constructor(reason: ChatReplyFailure) {
    super(`Chat reply failed: ${reason}`);
    this.reason = reason;
  }
}

const isSeat = (value: unknown): value is number =>
  Number.isInteger(value) && (value as number) >= 0;

/**
 * Reads the server's answer as a reply record, or null when it is not one. Mirrors the shared
 * contract (`chatReplySchema`): a line ID, never text, visible to its two seats only; a fallback
 * names its reason and a Jev answer has none.
 */
export function readChatReply(value: unknown): ChatReply | null {
  if (typeof value !== 'object' || value === null) return null;
  const reply = value as Record<string, unknown>;
  const seats = reply.visibleToSeats;
  const source = reply.source;
  const reason = reply.fallbackReason;
  const valid =
    isSeat(reply.fromSeatIndex) &&
    isSeat(reply.toSeatIndex) &&
    Array.isArray(seats) &&
    seats.length === 2 &&
    seats.every(isSeat) &&
    CHAT_TOPICS.includes(reply.topic as ChatTopic) &&
    (reply.situation === 'chat_reply' || reply.situation === 'manipulation_refused') &&
    typeof reply.lineId === 'string' &&
    reply.lineId !== '' &&
    typeof reply.refused === 'boolean' &&
    (source === 'jev' || source === 'fallback') &&
    (source === 'fallback') === (reason !== undefined) &&
    (reason === undefined || typeof reason === 'string') &&
    typeof reply.requestId === 'string' &&
    isSeat(reply.latencyMs);
  return valid ? (value as ChatReply) : null;
}

/**
 * Asks the local server for the recipient's reply to the topic message (`POST /api/ai/chat`). The
 * answer must be a record for exactly this conversation: from the human to the same recipient, on the
 * same topic, visible to those two seats only. Anything else, or an answer after the deadline or an
 * abort, is discarded and never read as a reply to another message (spec §4.8, §5.3).
 */
export async function requestChatReply(
  request: ChatReplyRequest,
  message: ChatMessage,
  signal: AbortSignal,
  ms = CHAT_REPLY_MS,
): Promise<ChatReply> {
  const deadline = AbortSignal.timeout(ms);
  let value: unknown;
  try {
    const response = await fetch('/api/ai/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: AbortSignal.any([signal, deadline]),
      body: JSON.stringify(request),
    });
    if (!response.ok) throw new ChatReplyError('network');
    value = await response.json();
  } catch (error) {
    if (error instanceof ChatReplyError) throw error;
    if (signal.aborted) throw new ChatReplyError('stale');
    throw new ChatReplyError(deadline.aborted ? 'timeout' : 'network');
  }
  if (signal.aborted) throw new ChatReplyError('stale');
  const reply = readChatReply(value);
  if (!reply) throw new ChatReplyError('invalid');
  const [first, second] = reply.visibleToSeats;
  if (
    reply.fromSeatIndex !== message.fromSeatIndex ||
    reply.toSeatIndex !== message.toSeatIndex ||
    reply.topic !== message.topic ||
    first !== message.fromSeatIndex ||
    second !== message.toSeatIndex
  ) {
    throw new ChatReplyError('stale');
  }
  return reply;
}

/**
 * Whether it is the human's own Social window (spec §4.2), the only place the game pauses for talk.
 * The engine adds `own.chats` only when the window is on for the game.
 */
export function inSocialWindow(view: Pick<SeatView, 'observation' | 'seatIndex'>): boolean {
  const { public: game } = view.observation;
  return (
    view.observation.own.chats !== undefined &&
    game.phase.kind === 'social' &&
    game.activeSeatIndex === view.seatIndex
  );
}

/** The message the human already sent in this turn's window, which spent it (spec §4.8). */
export function sentThisTurn(view: Pick<SeatView, 'observation' | 'seatIndex'>) {
  if (!inSocialWindow(view)) return undefined;
  const { globalTurnNo } = view.observation.public;
  return view.observation.own.chats?.findLast(
    (message) => message.fromSeatIndex === view.seatIndex && message.globalTurnNo === globalTurnNo,
  );
}
