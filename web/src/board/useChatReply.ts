import { useEffect, useState } from 'react';
import {
  ChatReplyError,
  chatWordsBody,
  decisionOf,
  messageKey,
  requestChatReply,
  requestChatWords,
  sentThisTurn,
  type ChatReply,
  type ChatReplyFailure,
} from '../game/chat.ts';
import type { GameStore, SeatView } from '../game/store.ts';
import type { VoiceReason } from '../game/tableTalk.ts';

/** The reply to this turn's topic message, as the Social window shows it. */
export type ChatReplyState =
  | { status: 'none' }
  | { status: 'waiting' }
  | {
      status: 'ready';
      reply: ChatReply;
      /** The rival's own words (AI-written), when the speech route gave a line in time; else the bank reply stands. */
      words: string | null;
      /** Why generated speech is off, when the speech route said so and gave no line. */
      voiceOff: VoiceReason | null;
    }
  | { status: 'failed'; reason: ChatReplyFailure };

export interface ChatReplyControls {
  state: ChatReplyState;
  /** Asks the same recipient again about the same message. It never sends a second message. */
  retry(): void;
}

/**
 * Asks for the recipient's reply once the human's message is committed: the line-bank reply and the
 * decision it carries, then the rival's own words for that decision from the speech route (spec
 * §4.8, §5.7). The window shows one reply, after both have settled: the words when they came in
 * time, else the bank line, with the player free to continue meanwhile. The words are kept with the
 * game, so a reload (spec §3.1 "resume from the last committed action") shows the same line and
 * never asks for another. A reply belongs to one message of one game: leaving the window, a new game or a retry
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
    const { signal } = controller;
    const answer = async (): Promise<Extract<ChatReplyState, { status: 'ready' }>> => {
      const reply = await requestChatReply(request, message, signal);
      const decision = decisionOf(reply);
      const saved = store.getChatWords().find((entry) => messageKey(entry) === messageKey(message));
      if (saved) return { status: 'ready', reply, words: saved.text, voiceOff: null };
      const outcome = await requestChatWords(
        chatWordsBody({ gameId: store.getGameId(), request, message, decision }),
        signal,
      );
      if (signal.aborted) throw new ChatReplyError('stale');
      if (outcome.status === 'none')
        return { status: 'ready', reply, words: null, voiceOff: outcome.voiceOff };
      store.recordChatWords({
        fromSeatIndex: message.fromSeatIndex,
        toSeatIndex: message.toSeatIndex,
        globalTurnNo: message.globalTurnNo,
        decision,
        text: outcome.text,
      });
      return { status: 'ready', reply, words: outcome.text, voiceOff: null };
    };
    answer().then(
      (outcome) => {
        if (!signal.aborted) setResult({ key, attempt, outcome });
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
