import { useEffect, useState } from 'react';
import {
  ChatReplyError,
  messageKey,
  requestChatReply,
  sentThisTurn,
  type ChatReply,
  type ChatReplyFailure,
} from '../game/chat.ts';
import type { GameStore, SeatView } from '../game/store.ts';

/** The reply to this turn's topic message, as the Social window shows it. */
export type ChatReplyState =
  | { status: 'none' }
  | { status: 'waiting' }
  | { status: 'ready'; reply: ChatReply }
  | { status: 'failed'; reason: ChatReplyFailure };

export interface ChatReplyControls {
  state: ChatReplyState;
  /** Asks the same recipient again about the same message. It never sends a second message. */
  retry(): void;
}

/**
 * Asks for the recipient's reply once the human's message is committed, and again after a reload
 * (the reply is words, kept nowhere but on screen; spec §3.1 "resume from the last committed
 * action"). A reply belongs to one message of one game: leaving the window, a new game or a retry
 * discards an answer that arrives for an older request, so a late reply never reaches another
 * window or recipient. Nothing here submits an action.
 */
export function useChatReply(store: GameStore, view: SeatView | null): ChatReplyControls {
  const message = view ? sentThisTurn(view) : undefined;
  const key = message ? `${store.getGameId()}:${messageKey(message)}` : null;
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{
    key: string;
    attempt: number;
    outcome: Exclude<ChatReplyState, { status: 'none' | 'waiting' }>;
  } | null>(null);

  useEffect(() => {
    const request = key ? store.chatReplyRequest() : null;
    if (!key || !message || !request) return;
    const controller = new AbortController();
    requestChatReply(request, message, controller.signal).then(
      (reply) => {
        if (!controller.signal.aborted)
          setResult({ key, attempt, outcome: { status: 'ready', reply } });
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        const reason = error instanceof ChatReplyError ? error.reason : 'network';
        setResult({ key, attempt, outcome: { status: 'failed', reason } });
      },
    );
    return () => controller.abort();
    // `message` is named by `key`; a new view of the same message must not ask again.
  }, [store, key, attempt]);

  const state: ChatReplyState = !key
    ? { status: 'none' }
    : result?.key === key && result.attempt === attempt
      ? result.outcome
      : { status: 'waiting' };
  return { state, retry: () => setAttempt((value) => value + 1) };
}
