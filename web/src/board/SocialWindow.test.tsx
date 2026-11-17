import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { engineContent } from '../game/content.ts';
import { CHAT_TOPICS } from '../game/chat.ts';
import { createGameStore, type GameSession, type GameStore } from '../game/store.ts';
import { t } from '../i18n/en.ts';
import { className, itemName } from '../i18n/names.ts';
import { fakeServer, replyFor, socialGame, toHumanSocial } from '../test/socialGame.ts';
import { BoardScreen } from './BoardScreen.tsx';
import { seatLabel } from './labels.ts';
import { SocialPanel } from './SocialPanel.tsx';

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
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const rival = (seatIndex: number, classId: string) =>
  t('social.rival', { seat: seatLabel(seatIndex, 0), class: className(classId) });
const rivalOne = rival(1, 'main-character');
const rivalTwo = rival(2, 'rival');
const line = t('ai.line.chat-reply-greedy-neutral-1', { target: className('researcher') });

const settle = (ms = 10) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
const panel = () => screen.getByRole('group', { name: t('social.panel') });
const press = (name: string) => fireEvent.click(within(panel()).getByRole('button', { name }));
const phaseOf = (store: GameStore) => store.getView()!.observation.public.phase.kind;
const chatsIn = (store: GameStore) =>
  store.getSession()!.log.actions.filter((record) => record.action.kind === 'chat');

/** Everything a message must never move (spec §4.8): coins, items, Balls and teams of every seat. */
const holdings = (store: GameStore) =>
  JSON.stringify(
    store
      .getSession()!
      .state.players.map(({ seatIndex, coins, items, balls, team, routeProgress }) => ({
        seatIndex,
        coins,
        items,
        balls,
        team,
        routeProgress,
      })),
  );

async function openWindow(rivals: 1 | 2, chat?: Parameters<typeof fakeServer>[0]) {
  const server = fakeServer(chat);
  const store = socialGame(rivals);
  expect(await toHumanSocial(store)).toBe(true);
  render(<BoardScreen store={store} />);
  return { server, store };
}

test('all five topics are reachable without typing; one message and its reply use the window up and change nothing else', async () => {
  const { server, store } = await openWindow(2);
  for (const topic of CHAT_TOPICS) {
    const button = within(panel()).getByRole('button', { name: t(`social.topic.${topic}`) });
    expect(button.hasAttribute('disabled'), topic).toBe(false);
  }
  expect(within(panel()).queryByRole('textbox')).toBeNull();
  // Nothing is sent until the player chooses one rival, one topic and presses Send, whose reason shows.
  const send = within(panel()).getByRole('button', { name: t('social.sendNone') });
  expect(send.hasAttribute('disabled')).toBe(true);
  expect(document.getElementById(send.getAttribute('aria-describedby')!)!.textContent).toBe(
    t('social.reason.chooseRival'),
  );
  press(rivalTwo);
  press(t('social.topic.point_leader'));
  // Only a third seat can be pointed at: not the speaker and not the one spoken to.
  const leaders = within(panel()).getByRole('group', { name: t('social.leaders') });
  expect(
    within(leaders)
      .getAllByRole('button')
      .map((b) => b.textContent),
  ).toEqual([rivalOne]);
  fireEvent.click(within(leaders).getByRole('button', { name: rivalOne }));
  expect(panel().textContent).toContain(
    t('social.preview', {
      rival: rivalTwo,
      summary: t('social.summary.point_leader', { leader: t('board.rivalLabel', { seat: 1 }) }),
    }),
  );
  const before = holdings(store);
  expect(chatsIn(store)).toHaveLength(0);
  press(t('social.send', { rival: rivalTwo }));
  await settle();

  expect(chatsIn(store)).toHaveLength(1);
  expect(chatsIn(store)[0]!.action).toMatchObject({
    kind: 'chat',
    payload: { targetSeatIndex: 2, topic: 'point_leader', leaderSeatIndex: 1 },
  });
  expect(server.calls.chat).toHaveLength(1);
  expect(server.calls.chat[0]).toMatchObject({
    seatIndex: 2,
    observation: { own: { seatIndex: 2 } },
  });
  // The reply is a bank line, labelled, and the window is used up: no second topic, only Continue.
  expect(panel().textContent).toContain(line);
  expect(panel().textContent).toContain(t('talk.bank'));
  expect(panel().textContent).toContain(t('social.spent'));
  expect(panel().textContent).toContain(t('social.onlyWords'));
  for (const topic of CHAT_TOPICS) {
    expect(within(panel()).queryByRole('button', { name: t(`social.topic.${topic}`) })).toBeNull();
  }
  // The game waits for the player here and only here.
  await settle(10_000);
  expect(phaseOf(store)).toBe('social');
  fireEvent.click(within(panel()).getByRole('button', { name: t('social.continue') }));
  expect(phaseOf(store)).toBe('strategy');
  const { state } = store.getSession()!;
  expect(holdings(store)).toBe(before);
  expect(state.turnBudgets.tacticalAction).toBe(1);
  expect(state.promises ?? []).toEqual([]);
  expect(state.pendingResponse).toBeUndefined();
  expect(chatsIn(store)).toHaveLength(1);
});

test('every topic can be sent to a rival and shows the only-words notice; a trade or truce is never a contract', async () => {
  const notice = {
    truce: t('social.noticeTruce'),
    trade: t('social.noticeTrade'),
  } as const;
  const item = engineContent.items.find((entry) => entry.kind === 'utility')!;
  for (const topic of CHAT_TOPICS) {
    const { store } = await openWindow(2);
    press(rivalOne);
    press(t(`social.topic.${topic}`));
    expect(panel().textContent).toContain(t('social.onlyWords'));
    if (topic === 'truce' || topic === 'trade')
      expect(panel().textContent).toContain(notice[topic]);
    if (topic === 'point_leader') {
      fireEvent.click(
        within(within(panel()).getByRole('group', { name: t('social.leaders') })).getByRole(
          'button',
          { name: rivalTwo },
        ),
      );
    }
    if (topic === 'use_item' || topic === 'hold_item') press(itemName(item.id));
    press(t('social.send', { rival: rivalOne }));
    await settle();
    expect(chatsIn(store), topic).toHaveLength(1);
    expect(panel().textContent).toContain(t('social.onlyWords'));
    // The only choice left is Continue: no deal, promise or second message is on offer.
    expect(store.getView()!.legalActions.enabled.map((action) => action.kind)).toEqual(['skip']);
    expect(store.getSession()!.state.promises ?? []).toEqual([]);
    cleanup();
  }
});

test('with two seats there is nobody to point at: the topic is greyed out and says why', async () => {
  await openWindow(1);
  const button = within(panel()).getByRole('button', { name: t('social.topic.point_leader') });
  expect(button.hasAttribute('disabled')).toBe(true);
  expect(document.getElementById(button.getAttribute('aria-describedby')!)!.textContent).toBe(
    t('social.reason.noThirdSeat'),
  );
  // One rival is the recipient without choosing; the other four topics are open.
  expect(within(panel()).queryByRole('group', { name: t('social.recipients') })).toBeNull();
  expect(panel().textContent).toContain(rivalOne);
  press(t('social.topic.truce'));
  expect(
    within(panel())
      .getByRole('button', { name: t('social.send', { rival: rivalOne }) })
      .hasAttribute('disabled'),
  ).toBe(false);
});

test('skipping never needs a message: the window closes, the turn goes on and nothing is sent', async () => {
  const { server, store } = await openWindow(1);
  expect(screen.getByRole('region', { name: t('turn.actions') }).textContent).toContain(
    t('turn.socialBody'),
  );
  await settle(10_000);
  expect(phaseOf(store)).toBe('social');
  press(t('social.skip'));
  expect(phaseOf(store)).toBe('strategy');
  expect(chatsIn(store)).toHaveLength(0);
  expect(server.calls.chat).toHaveLength(0);
  expect(store.getSession()!.state.turnBudgets.tacticalAction).toBe(1);
});

test('a failed reply keeps the message, offers Ask again and Continue, and never sends a second message', async () => {
  let calls = 0;
  const { store } = await openWindow(1, (request) =>
    ++calls === 1
      ? new Response('', { status: 503 })
      : new Response(JSON.stringify(replyFor(request))),
  );
  press(t('social.topic.trade'));
  press(t('social.send', { rival: rivalOne }));
  await settle();
  expect(panel().textContent).toContain(t('social.failed.network', { rival: rivalOne }));
  expect(within(panel()).getByRole('button', { name: t('social.continue') })).toBeTruthy();
  fireEvent.click(
    within(panel()).getByRole('button', { name: t('social.retry', { rival: rivalOne }) }),
  );
  await settle();
  expect(calls).toBe(2);
  expect(panel().textContent).toContain(line);
  expect(chatsIn(store)).toHaveLength(1);
});

test('a reply that arrives after the player moved on is dropped and spends nothing', async () => {
  const gate = Promise.withResolvers<void>();
  const { store } = await openWindow(1, async (request) => {
    await gate.promise;
    return new Response(JSON.stringify(replyFor(request)));
  });
  press(t('social.topic.truce'));
  press(t('social.send', { rival: rivalOne }));
  await settle();
  expect(panel().textContent).toContain(t('social.waiting', { rival: rivalOne }));
  // Continue is reachable while the answer is still out.
  fireEvent.click(within(panel()).getByRole('button', { name: t('social.continue') }));
  expect(phaseOf(store)).toBe('strategy');
  gate.resolve();
  await settle();
  expect(screen.queryByText(line)).toBeNull();
  expect(phaseOf(store)).toBe('strategy');
  expect(chatsIn(store)).toHaveLength(1);
  expect(store.getView()!.legalActions.enabled.some((action) => action.kind === 'chat')).toBe(
    false,
  );
});

test('a reload in the window resumes from the committed message: the answer is asked for again', async () => {
  const { server, store } = await openWindow(2);
  press(rivalTwo);
  press(t('social.topic.use_item'));
  press(itemName(engineContent.items.find((entry) => entry.kind === 'utility')!.id));
  press(t('social.send', { rival: rivalTwo }));
  await settle();
  expect(server.calls.chat).toHaveLength(1);
  cleanup();

  const reloaded = createGameStore();
  reloaded.restore(store.getSession()!, store.getOpponents());
  render(<BoardScreen store={reloaded} />);
  await settle();
  expect(server.calls.chat).toHaveLength(2);
  expect(panel().textContent).toContain(t('social.spent'));
  expect(panel().textContent).toContain(line);
  expect(within(panel()).queryByRole('button', { name: t('social.topic.truce') })).toBeNull();
  expect(chatsIn(reloaded)).toHaveLength(1);
  fireEvent.click(within(panel()).getByRole('button', { name: t('social.continue') }));
  expect(phaseOf(reloaded)).toBe('strategy');
});

test('a refused or unknown reply line keeps a clear message and Continue', async () => {
  const { store } = await openWindow(
    1,
    (request) =>
      new Response(JSON.stringify(replyFor(request, { lineId: 'not-a-line', refused: true }))),
  );
  press(t('social.topic.truce'));
  press(t('social.send', { rival: rivalOne }));
  await settle();
  expect(panel().textContent).toContain(t('social.replyNoLine', { rival: rivalOne }));
  expect(panel().textContent).toContain(t('social.refused', { rival: rivalOne }));
  fireEvent.click(within(panel()).getByRole('button', { name: t('social.continue') }));
  expect(phaseOf(store)).toBe('strategy');
});

test('a seat outside the chat gets no trace of it in its decision requests', async () => {
  const { server, store } = await openWindow(2);
  press(rivalOne);
  press(t('social.topic.truce'));
  press(t('social.send', { rival: rivalOne }));
  await settle();
  fireEvent.click(within(panel()).getByRole('button', { name: t('social.continue') }));
  cleanup();
  expect(await toHumanSocial(store)).toBe(true);
  const bodies = server.calls.decide as {
    observation: { own: { seatIndex: number; chats?: unknown[] } };
  }[];
  const bySeat = (seat: number) => bodies.filter((body) => body.observation.own.seatIndex === seat);
  expect(bySeat(2).length).toBeGreaterThan(0);
  for (const body of bySeat(2)) expect(body.observation.own.chats).toEqual([]);
});

test('asking for an item looks the same whatever a rival holds, and lists content items only', async () => {
  fakeServer();
  const store = socialGame(1);
  expect(await toHumanSocial(store)).toBe(true);
  const holding = structuredClone(store.getSession()!);
  holding.state.players[1]!.items = [
    { instanceId: 'secret-sentinel', itemId: 'pickpocket', name: 'SENTINEL', visibility: 'secret' },
  ];
  const html = (session: GameSession, topic: 'use_item' | 'hold_item') => {
    const game = createGameStore();
    game.restore(session);
    const view = game.getView()!;
    const { container, unmount } = render(
      <SocialPanel
        observation={view.observation}
        legalActions={view.legalActions}
        sent={undefined}
        reply={{ state: { status: 'none' }, retry: () => {} }}
        onChoose={() => {}}
      />,
    );
    fireEvent.click(within(container).getByRole('button', { name: t(`social.topic.${topic}`) }));
    // useId numbers differ between renders; nothing else may.
    const markup = container.innerHTML.replace(/ (id|aria-describedby)="[^"]*"/g, '');
    unmount();
    return markup;
  };
  for (const topic of ['use_item', 'hold_item'] as const) {
    const empty = html(store.getSession()!, topic);
    expect(html(holding, topic), topic).toBe(empty);
    expect(empty).not.toContain('SENTINEL');
    for (const entry of engineContent.items.filter((candidate) => candidate.kind === 'utility')) {
      expect(empty, `${topic} ${entry.id}`).toContain(itemName(entry.id));
    }
  }
});
