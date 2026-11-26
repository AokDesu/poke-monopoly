import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { observe, serialize } from '../../../engine/index.ts';
import { memoryEntries, promiseRows } from '../game/promises.ts';
import { loadSave } from '../game/save.ts';
import { createGameStore, type GameStore } from '../game/store.ts';
import { t } from '../i18n/en.ts';
import { openRecord } from '../test/record.ts';
import { className } from '../i18n/names.ts';
import {
  atHumanSocial,
  chooseAs,
  socialGameWith,
  makePromise,
  playUntil,
  promiseSettled,
} from '../test/promiseGame.ts';
import {
  fakeServer,
  socialGame,
  toHumanSocial,
  type DecideRequestBody,
} from '../test/socialGame.ts';
import { BoardScreen } from './BoardScreen.tsx';
import { seatLabel } from './labels.ts';
import { PromisePanel } from './PromisePanel.tsx';

// Named per-test budgets (ET-05): these take 2 to 8 s at full parallelism, so the 5 s default is too tight on a loaded machine.
const SLOW_TEST_MS = 30_000;

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
  vi.unstubAllGlobals();
});

const you = seatLabel(0, 0);
const rivalSeat = seatLabel(1, 0);
const rivalOne = t('social.rival', { seat: rivalSeat, class: className('main-character') });

/** Advances the clock in short steps, each its own `act`, so a step's state update runs its effect before the next. */
async function settle(ms = 10, step = 250) {
  for (let spent = 0; spent < ms; spent += step) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(Math.min(step, ms - spent));
    });
  }
}
/** The Social card in the decision slot: its window and its Skip or Continue footer. */
const panel = () => document.querySelector<HTMLElement>('[data-card="social"]')!;
/** The Promises and memory panel, in the Game record. */
const memory = () =>
  screen.queryByTestId('promise-panel') ?? within(openRecord()).getByTestId('promise-panel');
const rivalGroup = () => within(panel()).getByRole('group', { name: rivalOne });
const press = (root: HTMLElement, name: string) =>
  fireEvent.click(within(root).getByRole('button', { name }));
const reasonOf = (button: HTMLElement) =>
  document.getElementById(button.getAttribute('aria-describedby')!)!.textContent;
const offerLabel = t('promise.direction.offer');
const askLabel = t('promise.direction.ask');

const reply = (choice: string) =>
  new Response(JSON.stringify({ choice, source: 'fallback', fallbackReason: 'stub' }));
/** The rival's decision routes answer a promise question with `id`; every other question takes the default. */
const answering = (id: string) => (_path: string, body: DecideRequestBody) =>
  body.decisionPoint === 'promise_response' ? reply(id) : undefined;
const accept = answering('respond:accept');
const reject = answering('respond:reject');

const promisesOf = (store: GameStore) => store.getSession()!.state.promises ?? [];
const attemptsOf = (store: GameStore) => store.getSession()!.state.attackHistory ?? [];
const rawEvents = (store: GameStore) => store.getSession()!.log.actions.flatMap((r) => r.events);

/** The save a browser would write, read back and restored into a fresh store. */
function reload(store: GameStore): GameStore {
  const loaded = loadSave(serialize(store.getSession()!));
  if (!loaded.ok) throw new Error(loaded.message);
  const next = createGameStore();
  next.restore(loaded.game, store.getOpponents());
  return next;
}

async function openWindow(decide: Parameters<typeof fakeServer>[2] = accept, rivals: 1 | 2 = 1) {
  const server = fakeServer(undefined, undefined, decide);
  const store = socialGame(rivals);
  expect(await toHumanSocial(store)).toBe(true);
  return { server, store };
}

test(
  'an offer is only a question: nothing is active until the rival accepts, and acceptance makes the exact directed promise without spending the move',
  async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { server, store } = await openWindow((path, body) =>
      path === '/api/ai/decide' && body.decisionPoint === 'promise_response'
        ? gate.then(() => reply('respond:accept'))
        : accept(path, body),
    );
    const tactical = store.getSession()!.state.turnBudgets.tacticalAction;
    render(<BoardScreen store={store} />);
    // The engine lists the offers; nothing is sent until one is chosen and confirmed.
    expect(
      within(panel())
        .getByRole('button', { name: t('promise.sendNone') })
        .hasAttribute('disabled'),
    ).toBe(true);
    press(rivalGroup(), offerLabel);
    expect(panel().textContent).toContain(t('promise.preview.offer', { rival: rivalOne }));
    press(panel(), t('promise.send', { rival: rivalOne }));
    await settle(1000);

    // Offered, not active: the window waits, nothing is recorded, and there is no way to skip past it.
    expect(promisesOf(store)).toEqual([]);
    expect(store.getSession()!.state.pendingResponse).toBeDefined();
    expect(panel().querySelector('[data-promise]')!.getAttribute('data-promise')).toBe('pending');
    expect(panel().textContent).toContain(t('promise.pending.offer', { rival: rivalOne }));
    expect(within(panel()).queryByRole('button')).toBeNull();
    expect(memory().textContent).toContain(t('promise.offeredRow', { rival: rivalSeat }));
    expect(memory().querySelector('[data-promise-status="active"]')).toBeNull();
    expect(memory().textContent).toContain(t('promise.memory.empty'));
    const questions = server.calls.decide.filter(
      (call) => call.decisionPoint === 'promise_response',
    );
    expect(questions).toHaveLength(1);
    const asked = questions[0]!;
    expect(asked).toMatchObject({ decisionPoint: 'promise_response', seatIndex: 1 });
    expect(asked.enabledActions.map((a) => a.id)).toEqual(['respond:accept', 'respond:reject']);
    expect(asked.observation.own.seatIndex).toBe(1);

    release();
    await settle(1000);
    const [made] = promisesOf(store);
    expect(made).toMatchObject({ promiserSeatIndex: 0, recipientSeatIndex: 1 });
    expect(store.getSession()!.state.pendingResponse).toBeUndefined();
    expect(store.getSession()!.state.turnBudgets.tacticalAction).toBe(tactical);
    expect(panel().querySelector('[data-promise-answer="accepted"]')).not.toBeNull();
    expect(panel().textContent).toContain(t('promise.answer.accepted', { rival: rivalOne }));
    expect(panel().textContent).toContain(
      t('promise.expires', { whose: t('promise.possessive.you'), turn: made!.closesOwnTurnNo }),
    );
    expect(within(panel()).getByRole('button', { name: t('social.continue') })).toBeTruthy();
    const row = memory().querySelector('[data-promise-status="active"]')!;
    expect(row.textContent).toContain(t('promise.row', { promiser: you, recipient: rivalSeat }));
    expect(row.textContent).toContain(
      t('promise.row.active', {
        created: made!.createdGlobalTurnNo,
        whose: t('promise.possessive.you'),
        turn: made!.closesOwnTurnNo,
      }),
    );
    expect(memory().querySelector('[data-memory="accepted"]')).not.toBeNull();
  },
  SLOW_TEST_MS,
);

test('asking a rival to promise records the rival as the promiser and the player as the recipient', async () => {
  const { store } = await openWindow();
  render(<BoardScreen store={store} />);
  press(rivalGroup(), askLabel);
  expect(panel().textContent).toContain(t('promise.preview.ask', { rival: rivalOne }));
  press(panel(), t('promise.send', { rival: rivalOne }));
  await settle(1000);
  const [made] = promisesOf(store);
  expect(made).toMatchObject({ promiserSeatIndex: 1, recipientSeatIndex: 0 });
  expect(panel().textContent).toContain(
    t('promise.expires', {
      whose: t('promise.possessive.rival', { rival: rivalSeat }),
      turn: made!.closesOwnTurnNo,
    }),
  );
  expect(memory().textContent).toContain(t('promise.row', { promiser: rivalSeat, recipient: you }));
});

test('a refusal is explicit, records nothing and leaves no memory of a promise', async () => {
  const { store } = await openWindow(reject);
  render(<BoardScreen store={store} />);
  press(rivalGroup(), offerLabel);
  press(panel(), t('promise.send', { rival: rivalOne }));
  await settle(1000);
  expect(promisesOf(store)).toEqual([]);
  expect(panel().querySelector('[data-promise-answer="refused"]')).not.toBeNull();
  expect(panel().textContent).toContain(t('promise.answer.refused', { rival: rivalOne }));
  expect(memory().textContent).toContain(t('promise.none'));
  expect(memory().querySelector('[data-promise-status]')).toBeNull();
  const refused = memory().querySelector('[data-memory="refused"]')!;
  expect(refused.textContent).toContain(
    t('promise.memory.refused', {
      promiser: you,
      recipient: rivalSeat,
      turn: store.getSession()!.state.globalTurnNo,
    }),
  );
  expect(memory().querySelector('[data-memory="accepted"]')).toBeNull();
});

test('words alone are never evidence: a truce asked for in chat leaves the memory empty', async () => {
  const { store } = await openWindow();
  render(<BoardScreen store={store} />);
  expect(memory().textContent).toContain(t('promise.memory.empty'));
  fireEvent.click(within(panel()).getByRole('button', { name: t('social.topic.truce') }));
  press(panel(), t('social.send', { rival: rivalOne }));
  await settle(1000);
  expect(store.getSession()!.state.promises ?? []).toEqual([]);
  expect(memory().textContent).toContain(t('promise.none'));
  expect(memory().textContent).toContain(t('promise.memory.empty'));
  expect(memory().querySelector('[data-memory]')).toBeNull();
});

test('a failed answer neither activates a promise nor invents a memory; retrying activates exactly one', async () => {
  let healthy = false;
  const { store } = await openWindow((_path, body) =>
    body.decisionPoint !== 'promise_response'
      ? undefined
      : healthy
        ? reply('respond:accept')
        : new Response('', { status: 500 }),
  );
  render(<BoardScreen store={store} />);
  press(rivalGroup(), offerLabel);
  press(panel(), t('promise.send', { rival: rivalOne }));
  await settle(4000);
  expect(screen.getByRole('alert').textContent).toBe(t('turn.opponentError'));
  expect(promisesOf(store)).toEqual([]);
  expect(store.getSession()!.state.pendingResponse).toBeDefined();
  expect(memory().querySelector('[data-promise-status="active"]')).toBeNull();
  expect(memory().querySelector('[data-memory]')).toBeNull();
  healthy = true;
  fireEvent.click(screen.getByRole('button', { name: t('turn.retry') }));
  await settle(1000);
  expect(promisesOf(store)).toHaveLength(1);
  expect(memory().querySelectorAll('[data-memory="accepted"]')).toHaveLength(1);
});

test('a cancelled, late or stale answer changes nothing; a reload asks again and one promise results', async () => {
  let release: (response: Response) => void = () => {};
  const held = () => new Promise<Response>((resolve) => (release = resolve));
  let route: Parameters<typeof fakeServer>[2] = (path, body) =>
    body.decisionPoint !== 'promise_response'
      ? undefined
      : path === '/api/ai/decide'
        ? held()
        : accept(path, body);
  fakeServer(undefined, undefined, (path, body, init) => route!(path, body, init));
  const store = socialGame(1);
  expect(await toHumanSocial(store)).toBe(true);
  chooseAs(store, 0, 'offer-promise:seat-1:offer');

  // Cancelled: the screen leaves while the answer is out.
  const cancel = new AbortController();
  const cancelled = store.playOpponent(cancel.signal);
  cancel.abort();
  expect(await cancelled).toBe(false);
  expect(promisesOf(store)).toEqual([]);

  // Late: the game was reloaded from its save before the answer came.
  const late = store.playOpponent(new AbortController().signal);
  const loaded = loadSave(serialize(store.getSession()!));
  if (!loaded.ok) throw new Error(loaded.message);
  store.restore(loaded.game, store.getOpponents());
  release(reply('respond:accept'));
  expect(await late).toBe(false);
  expect(promisesOf(store)).toEqual([]);
  expect(store.getSession()!.state.pendingResponse).toBeDefined();
  expect(memoryEntries(store.getView()!.observation, store.getView()!.feed)).toEqual([]);

  // The reload asks the same question again and takes the answer once.
  route = accept;
  expect(await store.playOpponent(new AbortController().signal)).toBe(true);
  expect(promisesOf(store)).toHaveLength(1);

  // Stale: a second acceptance of the answered offer is refused and adds nothing.
  const second = store.submit({ actorId: 'ai-1', kind: 'respond', payload: { answer: 'accept' } });
  expect('rejected' in second).toBe(true);
  expect(promisesOf(store)).toHaveLength(1);
  expect(memoryEntries(store.getView()!.observation, store.getView()!.feed)).toHaveLength(1);
});

test('the promise closes at the end of the promiser’s next turn from engine events, and the same after a reload', async () => {
  fakeServer(undefined, undefined, accept);
  const store = socialGame(1);
  expect(await toHumanSocial(store)).toBe(true);
  await makePromise(store, 1, 'offer');
  const [made] = promisesOf(store);
  expect(promiseRows(store.getView()!.observation)).toMatchObject([{ status: 'active' }]);

  // Saved mid-window, the promise is still open with the engine's own expiry.
  const midway = reload(store);
  expect(promiseRows(midway.getView()!.observation)).toEqual(
    promiseRows(store.getView()!.observation),
  );

  expect(await playUntil(store, promiseSettled)).toBe(true);
  const settled = promisesOf(store)[0]!.settled!;
  const state = store.getSession()!.state;
  // Closed at the end of the promiser's own turn `closesOwnTurnNo`, by the engine and not by a clock.
  expect(state.players[0]!.ownTurnNo).toBe(made!.closesOwnTurnNo);
  const closed = store
    .getView()!
    .feed.flatMap((entry) => entry.record.events)
    .filter((event) => event.kind === 'promise_closed');
  expect(closed).toEqual([
    {
      kind: 'promise_closed',
      promiserSeatIndex: 0,
      recipientSeatIndex: 1,
      outcome: 'kept',
      globalTurnNo: settled.globalTurnNo,
    },
  ]);
  const view = store.getView()!;
  expect(promiseRows(view.observation)).toMatchObject([
    { status: 'kept', closedTurn: settled.globalTurnNo },
  ]);

  // The reload rebuilds the same rows and the same memory from the log.
  const again = reload(store).getView()!;
  expect(promiseRows(again.observation)).toEqual(promiseRows(view.observation));
  expect(memoryEntries(again.observation, again.feed)).toEqual(
    memoryEntries(view.observation, view.feed),
  );
  // Playing the mid-window save on reaches the same close.
  expect(await playUntil(midway, promiseSettled)).toBe(true);
  expect(promisesOf(midway)[0]!.settled).toEqual(settled);

  render(<BoardScreen store={reload(store)} />);
  expect(memory().textContent).toContain(
    t('promise.memory.kept', { promiser: you, recipient: rivalSeat, turn: settled.globalTurnNo }),
  );
  expect(memory().textContent).toContain(t('promise.status.kept'));
});

test('no clock settles a promise: the panel keeps showing it active however long the page stays open', async () => {
  fakeServer(undefined, undefined, accept);
  const store = socialGame(1);
  expect(await toHumanSocial(store)).toBe(true);
  await makePromise(store, 1, 'offer');
  const view = store.getView()!;
  render(<PromisePanel observation={view.observation} feed={view.feed} />);
  await settle(6 * 60 * 60 * 1000, 60 * 60 * 1000);
  expect(memory().querySelector('[data-promise-status="active"]')).not.toBeNull();
  expect(memory().querySelector('[data-memory="kept"]')).toBeNull();
});

test('an active promise makes the same pair visibly unavailable, with the reason, and the engine agrees', async () => {
  fakeServer(undefined, undefined, accept);
  const store = socialGame(1);
  expect(await toHumanSocial(store)).toBe(true);
  await makePromise(store, 1, 'offer');
  chooseAs(store, 0, 'skip');
  expect(await playUntil(store, atHumanSocial)).toBe(true);
  // Still inside the promise: this is the promiser's closing turn, so there is no renewal.
  expect(promisesOf(store)[0]!.settled).toBeUndefined();
  const ids = store.getView()!.legalActions.enabled.map((action) => action.id);
  expect(ids).not.toContain('offer-promise:seat-1:offer');
  expect(ids).toContain('offer-promise:seat-1:ask');
  render(<BoardScreen store={store} />);
  const blocked = within(rivalGroup()).getByRole('button', { name: offerLabel });
  expect(blocked.hasAttribute('disabled')).toBe(true);
  expect(reasonOf(blocked)).toBe(t('promise.reason.active'));
  expect(
    within(rivalGroup()).getByRole('button', { name: askLabel }).hasAttribute('disabled'),
  ).toBe(false);
});

test('no promise that would run past the end of the game is offered, and the window says why', () => {
  fakeServer(undefined, undefined, accept);
  const store = socialGameWith(1, (state) => {
    state.players[1]!.ownTurnNo = 1;
    state.finalTableRound = { triggerSeatIndex: 1, targetOwnTurnNo: 1 };
  });
  expect(store.getView()!.legalActions.enabled.filter((a) => a.kind === 'offer_promise')).toEqual(
    [],
  );
  render(<BoardScreen store={store} />);
  for (const label of [offerLabel, askLabel]) {
    const button = within(rivalGroup()).getByRole('button', { name: label });
    expect(button.hasAttribute('disabled')).toBe(true);
    expect(reasonOf(button)).toBe(t('promise.reason.gameEnd'));
  }
});

test('a promise the game closes with the game is neither kept nor broken', async () => {
  fakeServer(undefined, undefined, accept);
  // A promise still open when the final round ends the game: its closing turn will never be played.
  const store = socialGameWith(1, (state) => {
    state.finalTableRound = { triggerSeatIndex: 1, targetOwnTurnNo: 1 };
    state.promises = [
      {
        promiserSeatIndex: 0,
        recipientSeatIndex: 1,
        createdGlobalTurnNo: 1,
        closesOwnTurnNo: 5,
        acceptedActionSeq: 0,
      },
    ];
  });
  chooseAs(store, 0, 'skip');
  expect(await playUntil(store, (state) => state.phase.kind === 'finished')).toBe(true);
  expect(promisesOf(store)[0]!.settled!.outcome).toBe('closed_by_game_end');
  render(<BoardScreen store={store} />);
  expect(memory().querySelector('[data-memory="closed_by_game_end"]')).not.toBeNull();
  expect(memory().textContent).toContain(t('promise.status.closed_by_game_end'));
  expect(memory().textContent).not.toContain(t('promise.status.kept'));
  expect(memory().textContent).not.toContain(t('promise.status.broken'));
  expect(memory().querySelector('.promise-trust')).toBeNull();
});

const EVENT_OF = {
  accepted: 'promise_accepted',
  refused: 'promise_rejected',
  kept: 'promise_closed',
  broken: 'promise_closed',
  closed_by_game_end: 'promise_closed',
} as const;

/** Every memory entry and every piece of evidence is an event the seat's own feed holds, and the engine's. */
function expectTraced(store: GameStore): void {
  const view = store.getView()!;
  const { state } = store.getSession()!;
  const seatOf = (actorId: string) => state.players.find((p) => p.actorId === actorId)!.seatIndex;
  for (const entry of memoryEntries(view.observation, view.feed)) {
    const carrier = view.feed.find((item) => item.record.action.actionSeq === entry.record);
    expect(carrier, `${entry.kind} record ${entry.record}`).toBeDefined();
    expect(
      carrier!.record.events.some(
        (event) =>
          event.kind === EVENT_OF[entry.kind] &&
          event.promiserSeatIndex === entry.promiserSeatIndex &&
          event.recipientSeatIndex === entry.recipientSeatIndex,
      ),
    ).toBe(true);
    if (entry.kind !== 'broken') continue;
    expect(entry.evidence.length).toBeGreaterThan(0);
    for (const attack of entry.evidence) {
      const source = view.feed.find((item) => item.record.action.actionSeq === attack.record)!;
      expect(source.record.events).toContainEqual(
        expect.objectContaining({ kind: 'attack_attempt', attackId: attack.attackId }),
      );
      const real = (state.attackHistory ?? []).find((entry) => entry.attackId === attack.attackId)!;
      expect({
        actor: seatOf(real.actorId),
        target: seatOf(real.targetId),
        turn: real.globalTurnNo,
        source: real.source,
      }).toEqual({
        actor: attack.actorSeatIndex,
        target: attack.targetSeatIndex,
        turn: attack.turn,
        source: attack.source,
      });
      expect(attack.actorSeatIndex).toBe(entry.promiserSeatIndex);
      expect(attack.targetSeatIndex).toBe(entry.recipientSeatIndex);
    }
  }
}

/** The rival keeps to Skip in Strategy and accepts every promise, so a rival's promise is kept. */
const quiet = (_path: string, body: DecideRequestBody) =>
  body.decisionPoint === 'promise_response'
    ? reply('respond:accept')
    : body.decisionPoint === 'strategy'
      ? reply('skip')
      : undefined;
const publicRepel = {
  instanceId: 'item-human-repel',
  itemId: 'repel',
  name: 'Repel',
  visibility: 'public' as const,
};

test('a declined battle declaration still breaks the promise, and the entry names the real actor, target and turn', async () => {
  fakeServer(undefined, undefined, accept);
  const store = socialGameWith(1);
  await makePromise(store, 1, 'offer');
  chooseAs(store, 0, 'skip');
  chooseAs(store, 0, 'declare-pvp:1');
  chooseAs(store, 1, 'decline-pvp');
  expect(await playUntil(store, promiseSettled)).toBe(true);
  expect(promisesOf(store)[0]!.settled!.outcome).toBe('broken');
  expect(rawEvents(store)).toContainEqual(
    expect.objectContaining({ kind: 'pvp_response', accepted: false }),
  );
  const [attempt, ...others] = attemptsOf(store).filter(
    (a) => a.actorId === 'human' && a.targetId === 'ai-1',
  );
  expect(others).toEqual([]);
  expect(attempt).toMatchObject({ source: 'pvp_declaration' });
  expectTraced(store);

  render(<BoardScreen store={store} />);
  const broken = memory().querySelector('[data-memory="broken"]')!;
  expect(broken.textContent).toContain(
    t('promise.memory.broken', {
      promiser: you,
      recipient: rivalSeat,
      turn: attempt!.globalTurnNo,
    }),
  );
  const evidence = broken.querySelector(`[data-attack="${attempt!.attackId}"]`)!;
  expect(evidence.textContent).toContain(
    t('promise.evidence.pvp_declaration', {
      actor: you,
      target: rivalSeat,
      turn: attempt!.globalTurnNo,
    }),
  );
  expect(evidence.textContent).toContain(attempt!.attackId);
  expect(memory().querySelector('[data-promise-status="broken"]')).not.toBeNull();
  expect(memory().textContent).toContain(t('promise.status.broken'));
  // Breaking one's own promise moves the rival's trust, which no seat can see: none is shown.
  expect(memory().querySelector('.promise-trust')).toBeNull();
});

test('an attempt a Price Shield blocked still breaks the promise and is shown as the hostile item it was', async () => {
  fakeServer(undefined, undefined, accept);
  const store = socialGameWith(1, (state) => {
    state.players[0]!.items.push(publicRepel);
    state.players[1]!.armedShield = { scope: 'price', visibility: 'public' };
  });
  await makePromise(store, 1, 'offer');
  chooseAs(store, 0, 'skip');
  const use = store
    .getView()!
    .legalActions.enabled.find(
      (action) => action.kind === 'use_item' && action.payload.targetSeatIndex === 1,
    )!;
  chooseAs(store, 0, use.id);
  expect(rawEvents(store)).toContainEqual(expect.objectContaining({ kind: 'protection_applied' }));
  expect(await playUntil(store, promiseSettled)).toBe(true);
  expect(promisesOf(store)[0]!.settled!.outcome).toBe('broken');
  expectTraced(store);
  const [attempt] = attemptsOf(store).filter((a) => a.actorId === 'human' && a.targetId === 'ai-1');
  render(<BoardScreen store={store} />);
  const evidence = memory().querySelector(`[data-attack="${attempt!.attackId}"]`)!;
  expect(evidence.textContent).toContain(
    t('promise.evidence.hostile_item', {
      actor: you,
      target: rivalSeat,
      turn: attempt!.globalTurnNo,
    }),
  );
});

test('a rival that attacks the player after promising breaks it; an attack from before the promise is no evidence', async () => {
  // The rival's own first turn is a hostile Ability on the player, which the player's seat saw.
  fakeServer(undefined, undefined, accept);
  const store = socialGame(1);
  expect(await toHumanSocial(store)).toBe(true);
  const earlier = attemptsOf(store).filter((a) => a.actorId === 'ai-1' && a.targetId === 'human');
  expect(earlier).toHaveLength(1);
  await makePromise(store, 1, 'ask');
  expect(promisesOf(store)[0]).toMatchObject({ promiserSeatIndex: 1, recipientSeatIndex: 0 });
  expect(await playUntil(store, promiseSettled)).toBe(true);
  expect(promisesOf(store)[0]!.settled!.outcome).toBe('broken');
  expectTraced(store);
  const view = store.getView()!;
  const [entry] = memoryEntries(view.observation, view.feed).filter(
    (item) => item.kind === 'broken',
  );
  if (entry?.kind !== 'broken') throw new Error('no broken entry');
  expect(entry.evidence.map((attack) => attack.attackId)).not.toContain(earlier[0]!.attackId);
  expect(
    entry.evidence.every((attack) => attack.turn >= promisesOf(store)[0]!.createdGlobalTurnNo),
  ).toBe(true);
  render(<BoardScreen store={store} />);
  expect(memory().textContent).toContain(
    t('promise.memory.broken', { promiser: rivalSeat, recipient: you, turn: entry.turn }),
  );
  expect(memory().textContent).toContain(
    t('promise.evidence.hostile_ability', { actor: rivalSeat, target: you, turn: entry.turn }),
  );
  // The player's trust in the rival is the engine's number, never worked out here.
  const trust = observe(store.getSession()!.state, 0).own.trust!.find(
    (row) => row.seatIndex === 1,
  )!;
  expect(memory().querySelector('[data-trust-seat="1"]')!.textContent).toBe(
    t('promise.trust', { rival: rivalSeat, value: trust.value }),
  );
  expect(trust.value).toBeLessThan(0);
});

test('a broken promise whose attack the seat never saw is still shown as broken, with no evidence made up', async () => {
  fakeServer(undefined, undefined, accept);
  const store = socialGame(1);
  expect(await toHumanSocial(store)).toBe(true);
  await makePromise(store, 1, 'ask');
  expect(await playUntil(store, promiseSettled)).toBe(true);
  expect(promisesOf(store)[0]!.settled!.outcome).toBe('broken');
  const view = store.getView()!;
  // The same feed, as a seat would hold it had the engine not shown it the attack itself.
  const unseen = view.feed.map((item) => ({
    ...item,
    record: {
      ...item.record,
      events: item.record.events.filter((event) => event.kind !== 'attack_attempt'),
    },
  }));
  const broken = memoryEntries(view.observation, unseen).filter((entry) => entry.kind === 'broken');
  expect(broken).toHaveLength(1);
  const [entry] = broken;
  if (entry?.kind !== 'broken') throw new Error('no broken entry');
  expect(entry.evidence).toEqual([]);
  expect(entry.turn).toBe(entry.settledTurn);

  render(<PromisePanel observation={view.observation} feed={unseen} />);
  const item = memory().querySelector('[data-memory="broken"]')!;
  expect(item.textContent).toContain(
    t('promise.memory.broken', { promiser: rivalSeat, recipient: you, turn: entry.settledTurn }),
  );
  expect(item.textContent).toContain(t('promise.memory.settled', { turn: entry.settledTurn }));
  expect(item.querySelector('[data-attack]')).toBeNull();
  expect(item.querySelector('.promise-evidence')).toBeNull();
});

/** A rival's kept promise to the player, with or without a public chance for it to attack. */
async function keptByRival(withChance: boolean) {
  fakeServer(undefined, undefined, quiet);
  const store = socialGameWith(1, (state) => {
    for (const member of state.players[1]!.team) member.abilityReady = withChance;
  });
  await makePromise(store, 1, 'ask');
  expect(await playUntil(store, promiseSettled)).toBe(true);
  render(<BoardScreen store={store} />);
  const trust = memory().querySelector('.promise-trust')!.textContent;
  const body = memory().cloneNode(true) as HTMLElement;
  body.querySelector('.promise-trust')?.remove();
  const { outcome } = promisesOf(store)[0]!.settled!;
  cleanup();
  return { store, outcome, trust, text: body.textContent };
}

test('kept with and without a chance to attack read the same; only the engine’s trust number differs, and the test of the chance never shows', async () => {
  const withChance = await keptByRival(true);
  const without = await keptByRival(false);
  expect(withChance.outcome).toBe('kept_with_chance');
  expect(without.outcome).toBe('kept_without_chance');
  expect(withChance.text).toBe(without.text);
  expect(withChance.text).toContain(t('promise.status.kept'));
  expect(withChance.text).toContain(
    t('promise.memory.kept', {
      promiser: rivalSeat,
      recipient: you,
      turn: promisesOf(withChance.store)[0]!.settled!.globalTurnNo,
    }),
  );
  expect(withChance.trust).toBe(t('promise.trust', { rival: rivalSeat, value: 1 }));
  expect(without.trust).toBe(t('promise.trust', { rival: rivalSeat, value: 0 }));
  for (const text of [withChance.text, without.text]) {
    expect(text.toLowerCase()).not.toMatch(/chance|opportunit/);
  }
});

test('a rival’s secret items and private results never reach the offers or the memory view, and never change what may be offered', async () => {
  const SENTINEL = 'SENTINEL-private-7f3a9c';
  fakeServer(undefined, undefined, quiet);
  const plain = socialGameWith(1);
  const secret = socialGameWith(1, (state) => {
    state.players[1]!.items.push(
      {
        instanceId: `${SENTINEL}-item`,
        itemId: 'pickpocket',
        name: `${SENTINEL}-name`,
        visibility: 'secret',
      },
      {
        instanceId: `${SENTINEL}-repel`,
        itemId: 'repel',
        name: `${SENTINEL}-name`,
        visibility: 'secret',
      },
    );
    state.players[1]!.privateResults = [{ kind: 'peek', eventId: `${SENTINEL}-peek` }];
  });
  const offers = (store: GameStore) =>
    store.getView()!.legalActions.enabled.filter((action) => action.kind === 'offer_promise');
  expect(offers(secret)).toEqual(offers(plain));
  expect(offers(secret).map((action) => action.id)).toEqual([
    'offer-promise:seat-1:offer',
    'offer-promise:seat-1:ask',
  ]);

  render(<BoardScreen store={secret} />);
  for (const label of [offerLabel, askLabel]) {
    expect(within(rivalGroup()).getByRole('button', { name: label }).hasAttribute('disabled')).toBe(
      false,
    );
  }
  cleanup();
  await makePromise(secret, 1, 'ask');
  expect(await playUntil(secret, promiseSettled)).toBe(true);
  render(<BoardScreen store={secret} />);
  expect(memory().querySelector('[data-memory="kept"]')).not.toBeNull();
  expect(document.body.innerHTML).not.toContain(SENTINEL);
  expect(JSON.stringify(secret.getView())).not.toContain(SENTINEL);
});
