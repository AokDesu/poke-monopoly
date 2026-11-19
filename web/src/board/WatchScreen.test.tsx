import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { t } from '../i18n/en.ts';
import type { GameStore, SpectatorView } from '../game/store.ts';
import { fakeServer, playOut, watchStore } from '../test/watchGame.ts';
import { BoardScreen } from './BoardScreen.tsx';
import { STEP_MS } from './useTurnPlayback.ts';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const logLength = (store: GameStore) => store.getSession()!.log.actions.length;
const phase = (store: GameStore) => store.getSession()!.state.phase.kind;
const tick = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
const press = (name: string) => fireEvent.click(screen.getByRole('button', { name }));
const control = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;

/** Runs at the normal pace until the first AI decision request has been made. */
async function reachFirstDecision(store: GameStore, calls: { decide: number }) {
  for (let step = 0; step < 40 && calls.decide === 0; step++) await tick(STEP_MS.normal);
  expect(calls.decide, `a decision after ${logLength(store)} actions`).toBeGreaterThan(0);
}

/** Lets a game at the Instant pace play to its end: its steps chain on zero-length timers. */
async function finish(store: GameStore) {
  for (let round = 0; round < 400 && phase(store) !== 'finished'; round++) await tick(10_000);
  expect(phase(store)).toBe('finished');
}

test('every seat is a public panel with its class, personality and difficulty; nobody is "You" (§3, §4.1)', () => {
  fakeServer();
  const store = watchStore(4);
  render(<BoardScreen store={store} />);
  for (const seat of [0, 1, 2, 3]) {
    const panel = screen.getByTestId(`player-${seat}`);
    expect(within(panel).getByRole('heading', { level: 2 }).textContent).toBe(
      t('board.rivalLabel', { seat }),
    );
    expect(panel.textContent).toContain(
      t('watch.setup', {
        personality: t(seat % 2 ? 'personality.cautious' : 'personality.greedy'),
        difficulty: t('difficulty.normal'),
      }),
    );
    expect(within(panel).getByLabelText(t('board.itemCount'))).toBeTruthy();
  }
  expect(document.body.textContent).not.toMatch(/\bYou\b|\bYour\b/);
  expect(screen.queryByText(t('board.balls'))).toBeNull();
  expect(document.querySelector('.ball-pouch')).toBeNull();
  expect(document.querySelector('.own-panel')).toBeNull();
});

test('a sentinel secret handed to the spectator view never reaches the screen (§4.1)', () => {
  fakeServer();
  const real = watchStore(3);
  const view = real.getSpectatorView()!;
  const secret = 'SENTINEL-SECRET-do-not-show';
  const poisoned = {
    ...view,
    // The seat half of an observation, which a spectator never has.
    observation: {
      ...view.observation,
      own: {
        seatIndex: 0,
        balls: { poke: 7771, great: 7772, ultra: 7773 },
        items: [{ instanceId: secret, itemId: 'sentinel-item', name: secret }],
        peek: secret,
      },
      public: {
        ...view.observation.public,
        players: view.observation.public.players.map((player) => ({
          ...player,
          balls: { poke: 7774, great: 7775, ultra: 7776 },
          secretItems: [{ itemId: 'sentinel-item', name: secret }],
          peekResult: secret,
        })),
      },
    },
    feed: [
      {
        before: {
          phase: { kind: 'strategy' },
          activeSeatIndex: 1,
          globalTurnNo: 1,
          pokemon: [],
        },
        record: {
          action: {
            actorId: 'ai-1',
            kind: 'use_item',
            actionSeq: 1,
            stateRevisionBefore: 0,
            payload: { itemInstanceId: secret, targetSeatIndex: 2 },
          },
          events: [
            { kind: 'random_result', purpose: `peek:${secret}`, result: secret },
            { kind: 'uid_created', entity: 'item', ownerId: secret, instanceId: secret },
          ],
        },
      },
    ],
  } as unknown as SpectatorView;
  const store = { ...real, getSpectatorView: () => poisoned } as GameStore;
  render(<BoardScreen store={store} />);
  const text = document.body.textContent!;
  for (const leaked of [secret, '7771', '7772', '7773', '7774', '7775', '7776', 'peek']) {
    expect(text, leaked).not.toContain(leaked);
  }
  expect(text).not.toMatch(/\bYou\b|\bYour\b/);
  expect(screen.queryByText(t('board.balls'))).toBeNull();
  expect(screen.queryByText(t('board.items'))).toBeNull();
  expect(document.querySelector('.ball-pouch, .item-list')).toBeNull();
});

test('the active seat is announced politely and the spotlight follows it (§3)', async () => {
  fakeServer();
  const store = watchStore(3);
  render(<BoardScreen store={store} />);
  const active = screen.getByTestId('active-seat');
  expect(active.getAttribute('role')).toBe('status');
  const seen = new Set<string>();
  for (let step = 0; step < 60 && seen.size < 2; step++) {
    await tick(STEP_MS.normal);
    const seat = Number(active.getAttribute('data-seat'));
    seen.add(String(seat));
    expect(active.textContent).toContain(
      t('board.turn', { name: t('board.rivalLabel', { seat }) }),
    );
    const pawn = screen.getByTestId(`token-${seat}`);
    if (phase(store) !== 'finished') expect(pawn.getAttribute('data-focus')).toBe('ai');
  }
  expect(seen.size, 'the turn moved to another seat').toBeGreaterThan(1);
});

test('Step is disabled with its reason while running (§3.1)', () => {
  fakeServer();
  render(<BoardScreen store={watchStore(2)} />);
  expect(control(t('watch.step')).disabled).toBe(true);
  expect(screen.getByText(t('watch.stepWhileRunning'))).toBeTruthy();
  expect(control(t('watch.step')).getAttribute('aria-describedby')).toBeTruthy();
});

test('Pause stops the next AI request from starting; Resume continues from the same action (§3)', async () => {
  const calls = fakeServer();
  const store = watchStore(2);
  render(<BoardScreen store={store} />);
  await reachFirstDecision(store, calls);

  press(t('watch.pause'));
  expect(screen.getByText(t('watch.paused'))).toBeTruthy();
  const held = { actions: logLength(store), requests: calls.decide };
  await tick(120_000);
  expect({ actions: logLength(store), requests: calls.decide }).toEqual(held);

  press(t('watch.resume'));
  await tick(STEP_MS.normal * 4);
  expect(logLength(store)).toBeGreaterThan(held.actions);
  // Continues from where it stopped: the log only grew.
  expect(store.getSession()!.log.actions.map((record) => record.action.actionSeq)).toEqual(
    store.getSession()!.log.actions.map((_, index) => index + 1),
  );
});

test('Step while paused applies exactly one action and pauses again, AI decisions included (§3)', async () => {
  const calls = fakeServer();
  const store = watchStore(2);
  render(<BoardScreen store={store} />);
  press(t('watch.pause'));
  expect(control(t('watch.step')).disabled).toBe(false);

  let decisions = 0;
  for (let step = 0; step < 60 && decisions < 2; step++) {
    const before = { actions: logLength(store), requests: calls.decide };
    fireEvent.click(control(t('watch.step')));
    await tick(50);
    expect(logLength(store), `step ${step}`).toBe(before.actions + 1);
    decisions += calls.decide - before.requests;
    // Held again: nothing more happens however long we wait, and Resume is still on offer.
    await tick(60_000);
    expect(logLength(store), `step ${step} holds`).toBe(before.actions + 1);
    expect(control(t('watch.resume'))).toBeTruthy();
  }
  expect(decisions, 'stepped through AI decisions').toBeGreaterThanOrEqual(2);
});

test('a slow AI shows Thinking, and Step says why it must wait (§3.1)', async () => {
  const { promise, resolve } = Promise.withResolvers<void>();
  const calls = fakeServer('jev', promise);
  const store = watchStore(2);
  render(<BoardScreen store={store} />);
  for (let step = 0; step < 40 && calls.decide === 0; step++) await tick(STEP_MS.normal);
  expect(calls.decide).toBeGreaterThan(0);
  expect(screen.getByText(t('ai.thinking'))).toBeTruthy();
  press(t('watch.pause'));
  expect(control(t('watch.step')).disabled).toBe(true);
  expect(screen.getByText(t('watch.stepBusy'))).toBeTruthy();
  const waiting = logLength(store);
  resolve();
  await tick(50);
  expect(logLength(store)).toBe(waiting + 1);
});

test('a failed AI shows the existing error and Retry, and Step says to retry first (§3.1)', async () => {
  fakeServer();
  const store = watchStore(2);
  store.playOpponent = () => Promise.reject(new Error('server down'));
  render(<BoardScreen store={store} />);
  for (let step = 0; step < 40 && !screen.queryByRole('alert'); step++) await tick(STEP_MS.normal);
  expect(screen.getByRole('alert').textContent).toBe(t('turn.opponentError'));
  press(t('watch.pause'));
  expect(control(t('watch.step')).disabled).toBe(true);
  expect(screen.getByText(t('watch.stepFailed'))).toBeTruthy();
  expect(control(t('turn.retry'))).toBeTruthy();
});

test('Skip to results asks once, and Keep watching changes nothing (§3)', async () => {
  fakeServer();
  const store = watchStore(2);
  render(<BoardScreen store={store} />);
  press(t('watch.skip'));
  const ask = screen.getByRole('group', { name: t('watch.skipAsk') });
  fireEvent.click(within(ask).getByRole('button', { name: t('watch.keepWatching') }));
  expect(screen.queryByRole('group', { name: t('watch.skipAsk') })).toBeNull();
  expect((screen.getByLabelText(t('ai.speed')) as HTMLSelectElement).value).toBe('normal');
  await tick(STEP_MS.normal * 3);
  expect(phase(store)).not.toBe('finished');

  press(t('watch.skip'));
  fireEvent.click(
    within(screen.getByRole('group', { name: t('watch.skipAsk') })).getByRole('button', {
      name: t('watch.skip'),
    }),
  );
  await finish(store);
}, 60_000);

test('Instant on a 4-AI game reaches the results (§3)', async () => {
  fakeServer();
  const store = watchStore(4);
  const finished = vi.fn();
  render(<BoardScreen store={store} onFinished={finished} />);
  fireEvent.change(screen.getByLabelText(t('ai.speed')), { target: { value: 'instant' } });
  await finish(store);
  expect(store.getResults()).not.toBeNull();
  expect(screen.getByText(t('turn.finished'))).toBeTruthy();
  fireEvent.click(control(t('nav.results')));
  expect(finished).toHaveBeenCalledOnce();
  // A finished game has nothing to pause, step or skip, and each control says so.
  for (const name of [t('watch.pause'), t('watch.step'), t('watch.skip')]) {
    expect(control(name).disabled, name).toBe(true);
  }
  expect(screen.getAllByText(t('watch.stepFinished')).length).toBeGreaterThanOrEqual(3);
}, 60_000);

test('with Jev down every AI shows the backup bot and the one banner (§3.1 rows 9 and 18)', async () => {
  fakeServer('down');
  const store = watchStore(3);
  render(<BoardScreen store={store} />);
  fireEvent.change(screen.getByLabelText(t('ai.speed')), { target: { value: 'instant' } });
  await finish(store);
  expect(screen.getAllByText(t('ai.allBackupBanner'))).toHaveLength(1);
}, 60_000);

test('Leave offers Save and continue later, or End, and says why Save is off (§3)', () => {
  fakeServer();
  const leave = vi.fn();
  const { rerender } = render(<BoardScreen store={watchStore(2)} onLeave={leave} savingOff />);
  press(t('watch.leave'));
  const ask = screen.getByRole('group', { name: t('watch.leaveAsk') });
  const save = within(ask).getByRole('button', { name: t('watch.leaveSave') }) as HTMLButtonElement;
  expect(save.disabled).toBe(true);
  expect(within(ask).getByText(t('watch.leaveSaveOff'))).toBeTruthy();
  fireEvent.click(within(ask).getByRole('button', { name: t('watch.leaveEnd') }));
  expect(leave).toHaveBeenCalledExactlyOnceWith('end');

  leave.mockClear();
  rerender(<BoardScreen store={watchStore(2)} onLeave={leave} savingOff={false} />);
  fireEvent.keyDown(screen.getByRole('group', { name: t('watch.leaveAsk') }), { key: 'Escape' });
  expect(screen.queryByRole('group', { name: t('watch.leaveAsk') })).toBeNull();
  press(t('watch.leave'));
  fireEvent.click(screen.getByRole('button', { name: t('watch.leaveSave') }));
  expect(leave).toHaveBeenCalledExactlyOnceWith('save');
});

test('Leave during an AI request keeps only committed actions (§3.1)', async () => {
  const { promise, resolve } = Promise.withResolvers<void>();
  const calls = fakeServer('jev', promise);
  const store = watchStore(2);
  const view = render(<BoardScreen store={store} onLeave={() => {}} />);
  for (let step = 0; step < 40 && calls.decide === 0; step++) await tick(STEP_MS.normal);
  const committed = logLength(store);
  view.unmount();
  resolve();
  await tick(1_000);
  expect(logLength(store)).toBe(committed);
});

test('a fully played watched game is unchanged by anything the screen did', async () => {
  fakeServer();
  const store = watchStore(2);
  await playOut(store);
  const reference = store.getSession()!.log.actions.length;
  fakeServer();
  const watched = watchStore(2);
  render(<BoardScreen store={watched} />);
  fireEvent.change(screen.getByLabelText(t('ai.speed')), { target: { value: 'instant' } });
  await finish(watched);
  expect(logLength(watched)).toBe(reference);
}, 60_000);
