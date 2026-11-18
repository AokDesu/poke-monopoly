import { afterEach, expect, test, vi } from 'vitest';
import type { ChatMessage } from '../../../engine/index.ts';
import { fakeServer, replyFor, socialGame, toHumanSocial } from '../test/socialGame.ts';
import {
  ChatReplyError,
  CHAT_TOPICS,
  readChatReply,
  requestChatReply,
  type ChatReplyRequest,
} from './chat.ts';

afterEach(() => vi.unstubAllGlobals());

const message: ChatMessage = { fromSeatIndex: 0, toSeatIndex: 1, topic: 'truce', globalTurnNo: 1 };
const request = { seatIndex: 1 } as ChatReplyRequest;
const reply = (extra: Record<string, unknown> = {}) => ({
  fromSeatIndex: 0,
  toSeatIndex: 1,
  visibleToSeats: [0, 1],
  topic: 'truce',
  situation: 'chat_reply',
  lineId: 'chat-reply-greedy-neutral-1',
  refused: false,
  source: 'jev',
  requestId: 'r1',
  latencyMs: 4,
  ...extra,
});
const answer = (body: unknown, status = 200) =>
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(body), { status })),
  );
const failure = async (promise: Promise<unknown>) =>
  promise.then(
    () => undefined,
    (error: unknown) => (error instanceof ChatReplyError ? error.reason : 'other'),
  );

test('the reply reader accepts a bank reply and refuses every record the shared contract refuses', () => {
  expect(readChatReply(reply())).not.toBeNull();
  expect(readChatReply(reply({ source: 'fallback', fallbackReason: 'timeout' }))).not.toBeNull();
  for (const bad of [
    null,
    'text',
    reply({ lineId: '' }),
    reply({ lineId: 7 }),
    reply({ topic: 'threat' }),
    reply({ visibleToSeats: [0] }),
    reply({ visibleToSeats: [0, 1, 2] }),
    reply({ fromSeatIndex: -1 }),
    reply({ situation: 'deal_accept' }),
    reply({ source: 'fallback' }),
    reply({ source: 'jev', fallbackReason: 'timeout' }),
    reply({ refused: 'no' }),
  ]) {
    expect(readChatReply(bad), JSON.stringify(bad)).toBeNull();
  }
  // The five topic buttons are exactly the contract's topics.
  expect(CHAT_TOPICS).toEqual(['truce', 'trade', 'point_leader', 'use_item', 'hold_item']);
});

test('a reply is read only for the conversation it answers', async () => {
  answer(reply());
  expect((await requestChatReply(request, message, new AbortController().signal)).lineId).toBe(
    'chat-reply-greedy-neutral-1',
  );
  for (const other of [
    { toSeatIndex: 2, visibleToSeats: [0, 2] },
    { topic: 'trade' },
    { fromSeatIndex: 2, visibleToSeats: [2, 1] },
    { visibleToSeats: [1, 0] },
  ]) {
    answer(reply(other));
    expect(
      await failure(requestChatReply(request, message, new AbortController().signal)),
      JSON.stringify(other),
    ).toBe('stale');
  }
});

test('a failed, unreadable, slow or abandoned answer is a named failure, never a reply', async () => {
  const signal = () => new AbortController().signal;
  answer({}, 503);
  expect(await failure(requestChatReply(request, message, signal()))).toBe('network');
  answer({ lineId: 'x' });
  expect(await failure(requestChatReply(request, message, signal()))).toBe('invalid');
  vi.stubGlobal('fetch', (_url: RequestInfo | URL, init?: RequestInit) => {
    const { promise, reject } = Promise.withResolvers<Response>();
    init?.signal?.addEventListener('abort', () => reject(new DOMException('', 'AbortError')));
    return promise;
  });
  expect(await failure(requestChatReply(request, message, signal(), 20))).toBe('timeout');
  // An answer that lands after the player left the window is dropped even when it is valid.
  const left = new AbortController();
  vi.stubGlobal('fetch', async () => {
    left.abort();
    return new Response(JSON.stringify(reply()));
  });
  expect(await failure(requestChatReply(request, message, left.signal))).toBe('stale');
});

test('the request asks the recipient, from its own observation, and only once a message is sent', async () => {
  fakeServer();
  const store = socialGame(2);
  expect(await toHumanSocial(store)).toBe(true);
  expect(store.chatReplyRequest()).toBeNull();
  expect('rejected' in store.choose('chat:seat-2:trade')).toBe(false);
  const asked = store.chatReplyRequest()!;
  const { state } = store.getSession()!;
  expect(asked).toMatchObject({ seatIndex: 2, turnKey: `${state.globalTurnNo}:2` });
  expect(asked.gameId).toBe(store.getGameId());
  expect(asked.observation.own.seatIndex).toBe(2);
  expect(asked.observation.own.chats).toEqual([
    { fromSeatIndex: 0, toSeatIndex: 2, topic: 'trade', globalTurnNo: state.globalTurnNo },
  ]);
  expect(asked.stateRevision).toBe(asked.observation.public.stateRevision);
  // Seat 1 sits outside this chat: its own projection holds no trace of it (spec §4.8, #143).
  expect(store.getSession()!.state.players.find((p) => p.seatIndex === 1)!.unseenRecords).toBe(1);
  // The human's own pouch is not in the recipient's projection.
  expect(JSON.stringify(asked.observation.own.balls)).toBe(
    JSON.stringify(state.players.find((p) => p.seatIndex === 2)!.balls),
  );
  expect(replyFor(asked as never).toSeatIndex).toBe(2);
  // Moving on leaves nothing to ask about.
  store.choose('skip');
  expect(store.chatReplyRequest()).toBeNull();
});
