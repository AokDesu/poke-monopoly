import type { ChatMessage, ChatTopic, LegalAction, LegalActions } from '../../../engine/index.ts';
import type { ChatReply, ChatReplyRequest } from '../../../engine/contract/chat-reply.ts';
import type { ChatDecision } from '../../../engine/contract/speech.ts';
import type { SeatView } from './store.ts';
import type { VoiceReason } from './tableTalk.ts';

export type { ChatDecision, ChatReply, ChatReplyRequest };

/** Presentation/network budget for a reply, not a game-rule number: nothing waits for it (spec §3.1). */
export const CHAT_REPLY_MS = 3000;

/**
 * How long the rival's own words may take after its reply: above the server's 1,200 ms Haiku deadline,
 * so a line the server delivers in time arrives in time. Presentation, not a game rule: nothing
 * waits for it, and past it the line-bank reply stands (spec §5.7).
 */
export const CHAT_WORDS_MS = 1800;

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
  constructor(reason: ChatReplyFailure, detail?: string) {
    super(detail ?? `Chat reply failed: ${reason}`);
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

/** What the rival decided about the message, as its reply says: the words match it and never choose it. */
export const decisionOf = (reply: Pick<ChatReply, 'refused'>): ChatDecision =>
  reply.refused ? 'refused' : 'noncommittal';

/** The rival's words for one message, as kept with the game (spec §5.7: never regenerated). */
export interface SavedChatWords {
  readonly fromSeatIndex: number;
  readonly toSeatIndex: number;
  readonly globalTurnNo: number;
  readonly decision: ChatDecision;
  readonly text: string;
}

/** Reads saved words from storage text: rows that are not whole are dropped, never repaired. */
export function readSavedChatWords(value: unknown): SavedChatWords[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry: unknown): SavedChatWords[] => {
    if (typeof entry !== 'object' || entry === null) return [];
    const row = entry as Record<string, unknown>;
    return isSeat(row.fromSeatIndex) &&
      isSeat(row.toSeatIndex) &&
      isSeat(row.globalTurnNo) &&
      (row.decision === 'noncommittal' || row.decision === 'refused') &&
      typeof row.text === 'string' &&
      row.text.length > 0 &&
      row.text.length <= 280
      ? [
          {
            fromSeatIndex: row.fromSeatIndex,
            toSeatIndex: row.toSeatIndex,
            globalTurnNo: row.globalTurnNo,
            decision: row.decision,
            text: row.text,
          },
        ]
      : [];
  });
}

/**
 * `POST /api/ai/speak`'s body for the rival's own words (`kind: 'chat_reply'`): the topic and the
 * decision, the rival's seat and personality, and the public game. Like table talk, the rival's own
 * hand, Balls, peek results and chats are never sent: `own` is empty, and neither the human's
 * message details (a leader, an item) nor any other seat's view goes with it (spec §4.1, §4.8, §5.4).
 */
export function chatWordsBody(args: {
  gameId: string;
  /** The chat route's request for this message: the recipient's own observation and personality. */
  request: Pick<ChatReplyRequest, 'observation' | 'personalityId'>;
  message: ChatMessage;
  decision: ChatDecision;
}): unknown {
  const { gameId, request, message, decision } = args;
  // The recipient's own public view: its revision counts only what it saw, and its attack history
  // is its own, not the human's (spec §4.8). Nothing else of the request goes with it.
  const game = request.observation.public;
  return {
    kind: 'chat_reply',
    gameId,
    seatIndex: message.toSeatIndex,
    stateRevision: game.stateRevision,
    observation: {
      public: game,
      own: {
        seatIndex: message.toSeatIndex,
        items: [],
        balls: { poke: 0, great: 0, ultra: 0 },
        privateResults: [],
      },
    },
    personalityId: request.personalityId,
    turnKey: `chat:${message.globalTurnNo}:${message.toSeatIndex}`,
    addressedSeat: message.fromSeatIndex,
    topic: message.topic,
    decision,
  };
}

/** The rival's own line, or why there is none; a missing line is never an error (the bank reply stands). */
export type ChatWords =
  | { readonly status: 'words'; readonly text: string }
  | { readonly status: 'none'; readonly voiceOff: VoiceReason | null };

const VOICE_REASONS: readonly string[] = ['disabled', 'missing_key', 'budget_exceeded'];

/**
 * Asks the speech route for the rival's own words. Never throws: a slow, failed, unreadable or
 * aborted answer is `none`, and a line that arrives after `ms` is never used (spec §5.7). The route
 * names why speech is off, which is the only thing a "Voice off" badge may say.
 */
export async function requestChatWords(
  body: unknown,
  signal: AbortSignal,
  ms = CHAT_WORDS_MS,
): Promise<ChatWords> {
  const none = (voiceOff: VoiceReason | null = null): ChatWords => ({ status: 'none', voiceOff });
  try {
    const response = await fetch('/api/ai/speak', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: AbortSignal.any([signal, AbortSignal.timeout(ms)]),
      body: JSON.stringify(body),
    });
    if (!response.ok) return none();
    const value = (await response.json()) as Record<string, unknown> | null;
    if (signal.aborted || typeof value !== 'object' || value === null) return none();
    if (value.source === 'haiku' && typeof value.text === 'string') {
      const text = value.text.trim();
      return text.length > 0 && text.length <= 280 ? { status: 'words', text } : none();
    }
    const reason = value.fallbackReason;
    return value.source === 'none' && typeof reason === 'string' && VOICE_REASONS.includes(reason)
      ? none(reason as VoiceReason)
      : none();
  } catch {
    return none();
  }
}
