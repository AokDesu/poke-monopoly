import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { observe, type ChatTopic } from '../../../engine/index.ts';
import { CHAT_TOPICS, CHAT_WORDS_MS, chatChoices } from '../game/chat.ts';
import { readMeta, writeSave, type SaveStorage } from '../game/save.ts';
import { createGameStore, type GameStore } from '../game/store.ts';
import { t } from '../i18n/en.ts';
import { className } from '../i18n/names.ts';
import {
  fakeServer,
  replyFor,
  socialGame,
  speechLine,
  speechOff,
  toHumanSocial,
  type ChatRequestBody,
} from '../test/socialGame.ts';
import { BoardScreen } from './BoardScreen.tsx';
import { seatLabel } from './labels.ts';

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
});
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const rival = (seatIndex: number, classId: string) =>
  t('social.rival', { seat: seatLabel(seatIndex, 0), class: className(classId) });
const rivalOne = rival(1, 'main-character');
const bankLine = t('ai.line.chat-reply-greedy-neutral-1', { target: className('researcher') });
const WORDS = 'That is plain enough for me, friend. I will watch the road first.';
const SENTINEL_HAND = 'RIVAL-HAND-SENTINEL-4471';

const settle = (ms = 10) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
const panel = () => screen.getByRole('group', { name: t('social.panel') });
const phaseOf = (store: GameStore) => store.getView()!.observation.public.phase.kind;
const refusedReply = (request: ChatRequestBody) =>
  new Response(
    JSON.stringify(
      replyFor(request, {
        situation: 'manipulation_refused',
        lineId: 'manipulation-refused-greedy-neutral-2',
        refused: true,
        source: 'jev',
        fallbackReason: undefined,
      }),
    ),
  );

/** Sends one topic to one rival through the engine's own enabled choice, as pressing Send does. */
function send(store: GameStore, topic: ChatTopic, toSeat: number) {
  const choice = chatChoices(store.getView()!.legalActions).find(
    (entry) => entry.payload.topic === topic && entry.payload.targetSeatIndex === toSeat,
  );
  expect(choice, `${topic} to seat ${toSeat}`).toBeDefined();
  expect('rejected' in store.choose(choice!.id)).toBe(false);
}

async function open(rivals: 1 | 2, ...routes: Parameters<typeof fakeServer>) {
  const server = fakeServer(...routes);
  const store = socialGame(rivals);
  expect(await toHumanSocial(store)).toBe(true);
  return { server, store };
}

test.each(
  CHAT_TOPICS.flatMap((topic) =>
    (['noncommittal', 'refused'] as const).map((decision) => [topic, decision] as const),
  ),
)(
  '%s, %s: the rival answers in its own words, labelled AI-written, for the decision it made',
  async (topic, decision) => {
    const { server, store } = await open(2, decision === 'refused' ? refusedReply : undefined, () =>
      speechLine(WORDS),
    );
    send(store, topic, 1);
    render(<BoardScreen store={store} />);
    await settle();

    expect(server.calls.speak).toHaveLength(1);
    expect(server.calls.speak[0]).toMatchObject({
      kind: 'chat_reply',
      seatIndex: 1,
      addressedSeat: 0,
      topic,
      decision,
      personalityId: 'greedy',
    });
    expect(panel().textContent).toContain(WORDS);
    expect(panel().textContent).toContain(t('talk.aiWritten'));
    // The bank line is the fallback only: the window shows one answer.
    expect(panel().textContent).not.toContain(bankLine);
    expect(panel().textContent).not.toContain(t('talk.bank'));
    expect(panel().textContent).toContain(rivalOne);
    expect(panel().textContent).toContain(t('social.onlyWords'));
    expect(panel().textContent).toContain(t('social.spent'));
    // The decision is the chat route's: a refusal says so in the notice, and words never undo it.
    expect(panel().textContent?.includes(t('social.refused', { rival: rivalOne }))).toBe(
      decision === 'refused',
    );
    expect(within(panel()).getByRole('button', { name: t('social.continue') })).toBeTruthy();
  },
);

test('the speech request carries no hand, no message detail and no other seat; only the recipient is asked', async () => {
  const { server, store } = await open(2, undefined, () => speechLine(WORDS));
  const state = store.getSession()!.state;
  state.players[1]!.items.push({
    instanceId: SENTINEL_HAND,
    itemId: 'pickpocket',
    name: SENTINEL_HAND,
    visibility: 'secret',
  });
  state.players[2]!.items.push({
    instanceId: 'BYSTANDER-SENTINEL',
    itemId: 'pickpocket',
    name: 'BYSTANDER-SENTINEL',
    visibility: 'secret',
  });
  const item = store
    .getView()!
    .legalActions.enabled.find(
      (action) => action.kind === 'chat' && action.payload.topic === 'use_item',
    )!;
  expect('rejected' in store.choose(item.id)).toBe(false);
  render(<BoardScreen store={store} />);
  await settle();

  // Seat 2 is outside the chat: nothing is asked of it, and nothing of it is a trace of the chat.
  expect(server.calls.speak).toHaveLength(1);
  const body = server.calls.speak[0]!;
  expect(body.seatIndex).toBe(1);
  expect(body.observation.own).toEqual({
    seatIndex: 1,
    items: [],
    balls: { poke: 0, great: 0, ultra: 0 },
    privateResults: [],
  });
  const text = JSON.stringify(body);
  for (const secret of [
    SENTINEL_HAND,
    'BYSTANDER-SENTINEL',
    'chats',
    'unseenRecords',
    'targetSeatIndex',
    'leaderSeatIndex',
  ]) {
    expect(text, secret).not.toContain(secret);
  }
  // Whatever the human asked about is not in it either: the topic names the kind of message only.
  expect(body.topic).toBe('use_item');
  expect(panel().textContent).toContain(WORDS);
  expect(panel().textContent).not.toContain(SENTINEL_HAND);
});

test('words on or off, the game is the same: state, log, budget, legality and every seat view', async () => {
  const run = async (speak: Parameters<typeof fakeServer>[1]) => {
    const { store } = await open(2, undefined, speak);
    send(store, 'trade', 1);
    render(<BoardScreen store={store} />);
    await settle();
    const snapshot = () => {
      const { state, log } = store.getSession()!;
      return JSON.stringify({
        state,
        actions: log.actions,
        dialogue: log.dialogueEvents ?? [],
        views: state.players.map((player) => observe(state, player.seatIndex)),
        legal: store.getView()!.legalActions,
      });
    };
    const inWindow = snapshot();
    fireEvent.click(within(panel()).getByRole('button', { name: t('social.continue') }));
    await settle();
    const afterContinue = snapshot();
    const words = panel;
    cleanup();
    return { inWindow, afterContinue, words, store };
  };
  const on = await run(() => speechLine(WORDS));
  const off = await run(() => speechOff());
  const down = await run(() => new Response('', { status: 503 }));
  expect(on.inWindow).toBe(off.inWindow);
  expect(on.inWindow).toBe(down.inWindow);
  expect(on.afterContinue).toBe(off.afterContinue);
  expect(on.afterContinue).toBe(down.afterContinue);
  // The words are kept with the game for a reload, and nowhere in the engine's own record.
  expect(on.store.getChatWords()).toHaveLength(1);
  expect(off.store.getChatWords()).toHaveLength(0);
  expect(on.store.getSession()!.log.dialogueEvents).toBeUndefined();
});

test('with generated speech off the bank line stands and the badge says why; the chat still works', async () => {
  const { store } = await open(1, undefined, () => speechOff());
  send(store, 'truce', 1);
  render(<BoardScreen store={store} />);
  await settle();
  expect(panel().textContent).toContain(bankLine);
  expect(panel().textContent).toContain(t('talk.bank'));
  expect(panel().textContent).not.toContain(t('talk.aiWritten'));
  expect(panel().textContent).toContain(t('talk.voiceOff'));
  expect(panel().textContent).toContain(t('talk.reason.disabled'));
  expect(panel().textContent).toContain(t('social.onlyWords'));
  fireEvent.click(within(panel()).getByRole('button', { name: t('social.continue') }));
  expect(phaseOf(store)).toBe('strategy');
});

test.each([
  ['a server error', () => new Response('', { status: 500 })],
  ['an unreadable answer', () => new Response('not json')],
  [
    'an answer with no line and a rejection reason',
    () =>
      new Response(
        JSON.stringify({ source: 'none', fallbackReason: 'digit', requestId: 'r', latencyMs: 1 }),
      ),
  ],
  [
    'a bank answer, which this route never gives',
    () =>
      new Response(
        JSON.stringify({
          source: 'bank',
          text: 'Hello {target}',
          lineId: 'x',
          requestId: 'r',
          latencyMs: 1,
        }),
      ),
  ],
  ['an empty line', () => speechLine('   ')],
  ['a line past the size limit', () => speechLine('x'.repeat(281))],
])('%s: the bank line stands, with no badge and no AI-written label', async (_name, speak) => {
  const { store } = await open(1, undefined, speak);
  send(store, 'trade', 1);
  render(<BoardScreen store={store} />);
  await settle();
  expect(panel().textContent).toContain(bankLine);
  expect(panel().textContent).toContain(t('talk.bank'));
  expect(panel().textContent).not.toContain(t('talk.aiWritten'));
  expect(panel().textContent).not.toContain(t('talk.voiceOff'));
  expect(store.getChatWords()).toEqual([]);
  expect(within(panel()).getByRole('button', { name: t('social.continue') })).toBeTruthy();
});

test('a slow speech route is dropped at the deadline and the bank line stands', async () => {
  const real = AbortSignal.timeout.bind(AbortSignal);
  // Only the words' own deadline fires at once; the chat route keeps its real one.
  vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms) =>
    ms === CHAT_WORDS_MS ? AbortSignal.abort() : real(ms),
  );
  const { server, store } = await open(1, undefined, (_body, init) =>
    init?.signal?.aborted
      ? Promise.reject(new DOMException('', 'AbortError'))
      : new Promise<Response>(() => {}),
  );
  send(store, 'truce', 1);
  render(<BoardScreen store={store} />);
  await settle();
  expect(server.calls.speak).toHaveLength(1);
  expect(panel().textContent).toContain(bankLine);
  expect(store.getChatWords()).toEqual([]);
});

test('words that arrive after the player moved on are dropped, not shown, not kept, not asked again', async () => {
  const gate = Promise.withResolvers<void>();
  const { server, store } = await open(1, undefined, async () => {
    await gate.promise;
    return speechLine(WORDS);
  });
  send(store, 'truce', 1);
  render(<BoardScreen store={store} />);
  await settle();
  // The answer is still out: the window says so, and Continue is reachable.
  expect(panel().textContent).toContain(t('social.waiting', { rival: rivalOne }));
  fireEvent.click(within(panel()).getByRole('button', { name: t('social.continue') }));
  expect(phaseOf(store)).toBe('strategy');
  gate.resolve();
  await settle();
  expect(screen.queryByText(WORDS)).toBeNull();
  expect(store.getChatWords()).toEqual([]);
  expect(server.calls.speak).toHaveLength(1);
});

test('a reload after the reply keeps the same words and asks for no new ones', async () => {
  const { server, store } = await open(2, undefined, () => speechLine(WORDS));
  send(store, 'point_leader', 2);
  render(<BoardScreen store={store} />);
  await settle();
  expect(panel().textContent).toContain(WORDS);
  expect(server.calls.speak).toHaveLength(1);
  cleanup();

  // Through the browser's own save: the engine log and the meta beside it.
  const saved = new Map<string, string>();
  const storage: SaveStorage = {
    getItem: (key) => saved.get(key) ?? null,
    setItem: (key, value) => void saved.set(key, value),
    removeItem: (key) => void saved.delete(key),
  };
  writeSave(storage, store.getSession()!, {
    opponents: store.getOpponents(),
    chatWords: store.getChatWords(),
  });
  const meta = readMeta(storage);
  const reloaded = createGameStore();
  reloaded.restore(store.getSession()!, meta.opponents, meta.watch, meta.chatWords);
  render(<BoardScreen store={reloaded} />);
  await settle();

  expect(panel().textContent).toContain(WORDS);
  expect(panel().textContent).toContain(t('talk.aiWritten'));
  expect(panel().textContent).toContain(t('social.spent'));
  // The decision is asked of the chat route again, as before; the words are not.
  expect(server.calls.chat).toHaveLength(2);
  expect(server.calls.speak).toHaveLength(1);
  expect(reloaded.getChatWords()).toEqual(store.getChatWords());
  expect(within(panel()).queryByRole('button', { name: t('social.topic.truce') })).toBeNull();
});

test('saved words are used only for the decision they were written for', async () => {
  const { server, store } = await open(1, undefined, () => speechLine(WORDS));
  send(store, 'trade', 1);
  render(<BoardScreen store={store} />);
  await settle();
  cleanup();
  expect(store.getChatWords()[0]).toMatchObject({ decision: 'noncommittal', text: WORDS });

  // After the reload the chat route decides a refusal: the saved noncommittal words are not shown.
  fakeServer(refusedReply, () => speechLine('I keep to my own road, friend.'));
  const reloaded = createGameStore();
  reloaded.restore(store.getSession()!, store.getOpponents(), undefined, store.getChatWords());
  render(<BoardScreen store={reloaded} />);
  await settle();
  expect(panel().textContent).not.toContain(WORDS);
  expect(panel().textContent).toContain('I keep to my own road, friend.');
  expect(server.calls.speak).toHaveLength(1);
});

test('saved words that do not belong to the game are never lent to it', async () => {
  const { store } = await open(1, undefined, () => speechLine(WORDS));
  send(store, 'trade', 1);
  const turn = store.getSession()!.state.globalTurnNo;
  const row = {
    fromSeatIndex: 0,
    toSeatIndex: 1,
    globalTurnNo: turn,
    decision: 'noncommittal' as const,
  };
  const other = createGameStore();
  other.restore(store.getSession()!, store.getOpponents(), undefined, [
    { ...row, text: WORDS },
    { ...row, globalTurnNo: turn + 1, text: 'A message that was never sent.' },
    { ...row, toSeatIndex: 0, text: 'To the human, from the human.' },
    { ...row, fromSeatIndex: 1, toSeatIndex: 0, text: 'From a rival.' },
    { ...row, toSeatIndex: 5, text: 'To a seat that is not there.' },
    { ...row, text: '' },
    { ...row, text: 'x'.repeat(281) },
  ]);
  expect(other.getChatWords().map((entry) => entry.text)).toEqual([WORDS]);
  expect(other.recordChatWords({ ...row, text: '' })).toBe(false);
  expect(other.recordChatWords({ ...row, globalTurnNo: turn + 1, text: 'Never sent.' })).toBe(
    false,
  );
  // A fresh game starts with none.
  other.start(store.getSession()!.state.config, store.getSession()!.state.content);
  expect(other.getChatWords()).toEqual([]);
});

test('a save read back keeps whole rows only', () => {
  const saved = new Map<string, string>();
  const storage: SaveStorage = {
    getItem: (key) => saved.get(key) ?? null,
    setItem: (key, value) => void saved.set(key, value),
    removeItem: (key) => void saved.delete(key),
  };
  saved.set(
    'poke-monopoly.save-meta',
    JSON.stringify({
      opponents: [],
      chatWords: [
        {
          fromSeatIndex: 0,
          toSeatIndex: 1,
          globalTurnNo: 4,
          decision: 'refused',
          text: 'No, friend.',
        },
        { fromSeatIndex: 0, toSeatIndex: 1, globalTurnNo: 4, decision: 'accepted', text: 'Yes.' },
        {
          fromSeatIndex: 0,
          toSeatIndex: -1,
          globalTurnNo: 4,
          decision: 'refused',
          text: 'Bad seat.',
        },
        { fromSeatIndex: 0, toSeatIndex: 1, globalTurnNo: 4, decision: 'refused' },
        'junk',
        null,
      ],
    }),
  );
  expect(readMeta(storage).chatWords).toEqual([
    { fromSeatIndex: 0, toSeatIndex: 1, globalTurnNo: 4, decision: 'refused', text: 'No, friend.' },
  ]);
  saved.set('poke-monopoly.save-meta', JSON.stringify({ opponents: [], chatWords: 'nope' }));
  expect(readMeta(storage).chatWords).toEqual([]);
  saved.set('poke-monopoly.save-meta', JSON.stringify({ opponents: [] }));
  expect(readMeta(storage).chatWords).toBeUndefined();
});
