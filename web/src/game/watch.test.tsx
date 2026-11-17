import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useSyncExternalStore } from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { createGameConfig, stateHash, verifyReplay, winner } from '../../../engine/index.ts';
import { App } from '../App.tsx';
import { useTurnPlayback } from '../board/useTurnPlayback.ts';
import { t } from '../i18n/en.ts';
import {
  fakeServer,
  playOut,
  SEATS,
  settingsFor,
  watchConfig,
  watchStore,
} from '../test/watchGame.ts';
import { engineContent } from './content.ts';
import { loadSave, saveText, summarize, type SaveStorage } from './save.ts';
import { createGameStore, type GameStore } from './store.ts';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const finalHash = (store: GameStore) => stateHash(store.getSession()!.state);
const logLength = (store: GameStore) => store.getSession()!.log.actions.length;

test.each([2, 3, 4] as const)(
  '%i AI seats play themselves to the engine winner, and the log replays (§3, §6.9)',
  async (seats) => {
    fakeServer();
    const store = watchStore(seats);
    await playOut(store);
    const session = store.getSession()!;
    expect(store.getView()).toBeNull();
    expect(store.getResults()).toMatchObject({ winners: winner(session.state).winners });
    expect(store.getResults()).not.toHaveProperty('humanSeat');
    expect(verifyReplay(session)).toMatchObject({ pass: true });
  },
);

test('an unreachable decision service finishes the game on the backup bot (§3.1)', async () => {
  const calls = fakeServer('down');
  const store = watchStore(3);
  await playOut(store);
  expect(calls.decide).toBeGreaterThan(0);
  const sources = store.getSpectatorView()!.feed.flatMap((entry) => entry.decision ?? []);
  expect(sources.length).toBeGreaterThan(0);
  expect(sources.every((decision) => decision.source === 'fallback')).toBe(true);
  expect(sources.some((decision) => decision.fallbackReason === 'network')).toBe(true);
  for (const entry of store.getSpectatorView()!.feed) {
    if (!entry.decision) continue;
    if (entry.decision.fallbackReason === 'unsupported_decision_point') {
      // S15's local battle/Ability fallback does not call the decision service.
      expect(['pvp', 'gym', 'move', 'encounter']).toContain(entry.before.phase.kind);
    } else {
      expect(entry.decision.fallbackReason).toBe('network');
    }
  }
  expect(store.getResults()).not.toBeNull();
});

test('the watcher view holds the public half only: no seat, pouch, chat, seed or RNG (§4.1)', async () => {
  fakeServer();
  const seed = 'sentinel-seed-do-not-show';
  const store = watchStore(4, seed);
  const rng = store.getSession()!.state.rng.state;
  await playOut(store, () => {
    const view = store.getSpectatorView()!;
    const text = JSON.stringify(view);
    expect(Object.keys(view.observation)).toEqual(['public']);
    expect(view.seatIndex).toBeUndefined();
    expect(text).not.toContain(seed);
    expect(text).not.toContain(rng);
    expect(text).not.toMatch(/"(own|balls|chats|rng|eventDeck|initialState)"/);
    expect(view.feed.map((entry) => entry.record.action.actionSeq)).toEqual(
      view.feed.map((_, index) => index + 1),
    );
    return false;
  });
  // A watcher submits nothing and quotes nothing.
  expect(store.choose('roll')).toMatchObject({ rejected: true });
  expect(() => store.quoteSale([])).toThrow();
});

test('a game with a human seat keeps its seat view and has no spectator view', () => {
  const store = createGameStore();
  store.start(
    createGameConfig({
      seats: SEATS.slice(0, 2).map((seat, seatIndex) => ({
        actorId: `player-${seatIndex}`,
        seatIndex,
        ...seat,
        controller: seatIndex === 0 ? ('human' as const) : ('ai' as const),
      })),
      seed: 3,
      lapTarget: 2,
    }),
    engineContent,
  );
  expect(store.getView()).not.toBeNull();
  expect(store.getSpectatorView()).toBeNull();
});

test('a game saved at any step and resumed reaches the uninterrupted final state (§3.1, §6.9)', async () => {
  fakeServer();
  const whole = watchStore(3);
  const total = await playOut(whole);
  const expected = finalHash(whole);
  expect(total).toBeGreaterThan(100);

  for (const cut of [0, 1, 3, 21, 130, Math.floor(total / 2), total - 1]) {
    const first = watchStore(3);
    await playOut(first, (steps) => steps === cut);
    const text = saveText(first.getSession()!);
    const loaded = loadSave(text);
    if (!loaded.ok) throw new Error(loaded.message);

    const second = createGameStore();
    second.restore(loaded.game, settingsFor(3));
    // Nothing is applied by resuming: same state, same log, same words the watcher saw.
    expect(finalHash(second), `cut ${cut}`).toBe(finalHash(first));
    expect(logLength(second)).toBe(logLength(first));
    expect(second.getSpectatorView()!.feed.map((entry) => entry.record)).toEqual(
      first.getSpectatorView()!.feed.map((entry) => entry.record),
    );
    await playOut(second);
    expect(finalHash(second), `cut ${cut}`).toBe(expected);
    expect(verifyReplay(second.getSession()!)).toMatchObject({ pass: true });
  }
}, 120_000);

test('a watched save summarizes without a human seat (§3.1)', async () => {
  fakeServer();
  const store = watchStore(2);
  await playOut(store, (steps) => steps === 6);
  const loaded = loadSave(saveText(store.getSession()!));
  if (!loaded.ok) throw new Error(loaded.message);
  const summary = summarize(loaded.game, loaded.resumed);
  expect(summary).not.toHaveProperty('humanSeat');
  expect(summary.turn).toBe(store.getSession()!.state.globalTurnNo);
});

test('Continue offers a watched game and resumes it with its AI settings (§3.1)', async () => {
  fakeServer();
  const data = new Map<string, string>();
  const storage: SaveStorage = {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
  const first = createGameStore();
  render(<App store={first} storage={storage} />);
  act(() => first.start(watchConfig(3), engineContent, settingsFor(3)));
  await act(() => playOut(first, (steps) => steps === 40));
  const turn = first.getSession()!.state.globalTurnNo;
  cleanup();

  const second = createGameStore();
  render(<App store={second} storage={storage} />);
  expect(screen.getByRole('status').textContent).toBe(t('save.pendingWatched', { turn }));
  await userEvent.click(screen.getByRole('button', { name: t('save.continue') }));
  expect(second.getOpponents()).toEqual(settingsFor(3));
  expect(finalHash(second)).toBe(finalHash(first));
});

test('a late answer is never applied after the game is replaced or restored', async () => {
  const { promise, resolve: release } = Promise.withResolvers<void>();
  fakeServer('jev', promise);
  const store = watchStore(2);
  while (store.advance({ human: true }));
  const pending = store.playOpponent(new AbortController().signal);

  store.start(watchConfig(2, 99), engineContent, settingsFor(2));
  const replacement = store.getSession();
  release();
  expect(await pending).toBe(false);
  expect(store.getSession()).toBe(replacement);
  expect(logLength(store)).toBe(0);
});

/** The playback hook on a watched store, at the instant pace unless a test says otherwise. */
function watch(store: GameStore, speed: 'normal' | 'instant' = 'instant') {
  const mounted = renderHook(() => {
    const view = useSyncExternalStore(store.subscribe, store.getSpectatorView);
    return useTurnPlayback(store, view);
  });
  if (speed === 'instant') act(() => mounted.result.current.setSpeed('instant'));
  return mounted;
}

const idle = (ms = 80) => act(() => new Promise<void>((resolve) => setTimeout(resolve, ms)));

test('paused holds the game, step applies exactly one action, resume continues (§3)', async () => {
  fakeServer();
  const store = watchStore(2);
  const { result } = watch(store);
  act(() => result.current.setPaused(true));
  await idle();
  expect(logLength(store)).toBe(0);

  for (let step = 1; step <= 40; step++) {
    await waitFor(() => expect(result.current.stepBlocked).toBeNull());
    act(() => result.current.step());
    await waitFor(() => expect(logLength(store)).toBe(step));
    await idle(20);
    expect(logLength(store)).toBe(step);
  }
  expect(store.getSession()!.log.actions.map((record) => record.action.actionSeq)).toEqual(
    Array.from({ length: 40 }, (_, index) => index + 1),
  );

  act(() => result.current.setPaused(false));
  await waitFor(() => expect(store.getSession()!.state.phase.kind).toBe('finished'), {
    timeout: 20_000,
  });
  // Pausing and stepping lost and repeated nothing: the same game as one that never paused.
  const uninterrupted = watchStore(2);
  await playOut(uninterrupted);
  expect(finalHash(store)).toBe(finalHash(uninterrupted));
});

test('a step while running is ignored and says why', async () => {
  fakeServer();
  const store = watchStore(2);
  const { result } = watch(store, 'normal');
  expect(result.current.stepBlocked).toBe(t('watch.stepWhileRunning'));
  act(() => result.current.step());
  await idle(150);
  expect(logLength(store)).toBe(0);
});

test('pausing leaves the decision in flight alone and starts no second one', async () => {
  const { promise, resolve: release } = Promise.withResolvers<void>();
  const calls = fakeServer('jev', promise);
  const store = watchStore(2);
  const { result } = watch(store);
  await waitFor(() => expect(result.current.thinking).toBe(true));
  const before = logLength(store);
  act(() => result.current.setPaused(true));
  expect(result.current.stepBlocked).toBe(t('watch.stepBusy'));
  release();
  await waitFor(() => expect(logLength(store)).toBe(before + 1));
  await idle();
  expect(logLength(store)).toBe(before + 1);
  expect(calls.decide).toBe(1);
});

test('leaving the game aborts the pending decision and its late answer changes nothing', async () => {
  const { promise, resolve: release } = Promise.withResolvers<void>();
  fakeServer('jev', promise);
  const store = watchStore(2);
  const { result, unmount } = watch(store);
  await waitFor(() => expect(result.current.thinking).toBe(true));
  const before = store.getSession();
  unmount();
  release();
  await idle();
  expect(store.getSession()).toBe(before);
});

test.each(['running', 'paused'] as const)(
  'skip to end finishes a %s game with a replayable log',
  async (state) => {
    fakeServer();
    const store = watchStore(4);
    const { result } = watch(store, 'normal');
    if (state === 'paused') act(() => result.current.setPaused(true));
    act(() => result.current.skipToEnd());
    await waitFor(() => expect(store.getSession()!.state.phase.kind).toBe('finished'), {
      timeout: 20_000,
    });
    expect(verifyReplay(store.getSession()!)).toMatchObject({ pass: true });
    expect(result.current.stepBlocked).not.toBeNull();
  },
);
