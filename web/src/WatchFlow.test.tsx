import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { stateHash, winner } from '../../engine/index.ts';
import { App } from './App.tsx';
import {
  loadSave,
  META_KEY,
  SAVE_KEY,
  saveText,
  writeSave,
  type SaveStorage,
} from './game/save.ts';
import { createGameStore, type GameStore } from './game/store.ts';
import { t } from './i18n/en.ts';
import { className } from './i18n/names.ts';
import { ResultsScreen } from './ResultsScreen.tsx';
import { fakeServer, playOut, settingsFor, watchStore } from './test/watchGame.ts';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function memoryStorage(): SaveStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

/** The decisions in the raw log: every accepted action that a seat chose rather than the engine. */
function chosenBy(store: GameStore): Map<number, number> {
  const seatOf = new Map(
    store.getSession()!.state.config.seats.map((seat) => [seat.actorId, seat.seatIndex]),
  );
  const counts = new Map<number, number>();
  for (const { action, auto } of store.getSession()!.log.actions) {
    const seat = seatOf.get(action.actorId);
    if (seat === undefined || auto) continue;
    counts.set(seat, (counts.get(seat) ?? 0) + 1);
  }
  return counts;
}

const cell = (seat: number, column: 1 | 2) =>
  within(
    screen.getAllByRole('table')[1]!.querySelector('tbody')!.querySelectorAll('tr')[seat]!,
  ).getAllByRole('cell')[column - 1]!.textContent;

test('results name the engine winner, each seat’s setup and who decided its moves, with no "You" (§3, §3.1)', async () => {
  fakeServer();
  const store = watchStore(3);
  await playOut(store);
  render(<ResultsScreen store={store} onPlayAgain={() => {}} onWatchAgain={() => {}} />);

  const outcome = winner(store.getSession()!.state);
  const names = outcome.winners.map((actorId) => {
    const seat = store.getSession()!.state.players.find((player) => player.actorId === actorId)!;
    return t('board.rivalLabel', { seat: seat.seatIndex });
  });
  const status = screen.getByRole('status').textContent!;
  expect(names.every((name) => status.includes(name))).toBe(true);
  expect(status).toBe(
    outcome.reason === 'co_winners'
      ? t('results.coWinners', {
          names: names.reduce(
            (left, right) => (left ? t('results.nameJoin', { left, right }) : right),
            '',
          ),
        })
      : t(outcome.reason === 'badges' ? 'results.winBadges' : 'results.winCoins', {
          name: names[0]!,
        }),
  );

  const config = store.getSession()!.state.config;
  const settings = settingsFor(3);
  for (const seat of config.seats) {
    const row = screen.getAllByRole('row').find((entry) =>
      entry.textContent!.includes(
        t('results.seatSetup', {
          class: className(seat.classId),
          setup: t('watch.setup', {
            personality: t(`personality.${settings[seat.seatIndex]!.personality}`),
            difficulty: t(`difficulty.${settings[seat.seatIndex]!.difficulty}`),
          }),
        }),
      ),
    );
    expect(row, `seat ${seat.seatIndex} setup`).toBeTruthy();
  }

  // Every decision the log holds is counted once, to Jev or to the backup bot. Points the
  // decision service has no question for yet (Gym, Ability) are taken by the browser's own
  // fallback, which the store labels as such.
  const chosen = chosenBy(store);
  const unsupported = new Map<number, number>();
  for (const { record, decision } of store.getSpectatorView()!.feed) {
    if (decision?.fallbackReason !== 'unsupported_decision_point') continue;
    const seat = store
      .getSession()!
      .state.config.seats.find((entry) => entry.actorId === record.action.actorId)!.seatIndex;
    unsupported.set(seat, (unsupported.get(seat) ?? 0) + 1);
  }
  for (const seat of [0, 1, 2]) {
    const backup = unsupported.get(seat) ?? 0;
    expect(cell(seat, 2), `seat ${seat} backup`).toBe(String(backup));
    expect(cell(seat, 1), `seat ${seat} Jev`).toBe(String((chosen.get(seat) ?? 0) - backup));
  }
  expect(document.body.textContent).not.toMatch(/\bYou\b|\bYour\b/);
  expect(screen.queryByRole('button', { name: t('results.export') })).toBeNull();
  expect(screen.queryByRole('button', { name: t('results.playAgain') })).toBeNull();
  expect(screen.getByRole('button', { name: t('results.watchAgain') })).toBeTruthy();
}, 60_000);

test('with Jev down every decision is counted to the backup bot (§3.1)', async () => {
  fakeServer('down');
  const store = watchStore(2);
  await playOut(store);
  render(<ResultsScreen store={store} onPlayAgain={() => {}} />);
  const chosen = chosenBy(store);
  for (const seat of [0, 1]) {
    expect(cell(seat, 1)).toBe('0');
    expect(cell(seat, 2)).toBe(String(chosen.get(seat) ?? 0));
  }
  expect(chosen.get(0)! + chosen.get(1)!).toBeGreaterThan(0);
}, 60_000);

test('decisions made before a resume are said to be unrecorded, never counted to Jev or the backup bot', async () => {
  fakeServer();
  const first = watchStore(2);
  await playOut(first, (steps) => steps === 30);
  const loaded = loadSave(saveText(first.getSession()!));
  if (!loaded.ok) throw new Error(loaded.message);
  const second = createGameStore();
  second.restore(loaded.game, settingsFor(2));
  await playOut(second);
  render(<ResultsScreen store={second} onPlayAgain={() => {}} />);

  const total = [...chosenBy(second).values()].reduce((sum, count) => sum + count, 0);
  const shown = [0, 1].reduce(
    (sum, seat) => sum + Number(cell(seat, 1)) + Number(cell(seat, 2)),
    0,
  );
  const earlier = total - shown;
  expect(earlier).toBeGreaterThan(0);
  expect(screen.getByText(t('results.decisionsEarlier', { count: earlier }))).toBeTruthy();
}, 60_000);

/** Continue-prompt path: how a finished or half-played watched game reaches the board or results. */
async function openSaved(store: GameStore, storage: SaveStorage) {
  writeSave(storage, store.getSession()!, { opponents: store.getOpponents() });
  const fresh = createGameStore();
  render(<App store={fresh} storage={storage} />);
  await userEvent.click(screen.getByRole('button', { name: t('save.continue') }));
  return fresh;
}

test('Watch again starts a fresh game with the same setup and a new seed (§3)', async () => {
  fakeServer();
  const finished = watchStore(3, 'old-seed-1');
  await playOut(finished);
  const before = finished.getSession()!.state.config;
  const app = await openSaved(finished, memoryStorage());
  expect(screen.getByRole('heading', { name: t('results.heading') })).toBeTruthy();
  expect(app.getResults()).not.toBeNull();

  await userEvent.click(screen.getByRole('button', { name: t('results.watchAgain') }));
  const next = app.getSession()!;
  expect(screen.getByRole('heading', { name: t('play.heading') })).toBeTruthy();
  expect(next.state.config.seed).not.toBe(before.seed);
  expect(next.state.config.seats).toEqual(before.seats);
  expect(next.state.config.lapTarget).toBe(before.lapTarget);
  expect(app.getOpponents()).toEqual(settingsFor(3));
  expect(next.state.phase.kind).not.toBe('finished');
  expect(next.log.actions.length).toBeLessThanOrEqual(1);
  expect(app.getView()).toBeNull();
  expect(document.body.textContent).not.toMatch(/\bYou\b|\bYour\b/);
}, 60_000);

test('Leave with Save keeps the game for Continue, and Continue resumes the same state (§3.1)', async () => {
  fakeServer();
  const storage = memoryStorage();
  const partial = watchStore(3);
  await playOut(partial, (steps) => steps === 25);
  const app = await openSaved(partial, storage);
  expect(screen.getByRole('heading', { name: t('play.heading') })).toBeTruthy();
  const hash = stateHash(app.getSession()!.state);

  await userEvent.click(screen.getByRole('button', { name: t('watch.leave') }));
  await userEvent.click(screen.getByRole('button', { name: t('watch.leaveSave') }));
  const prompt = screen.getByRole('status');
  expect(prompt.textContent).toBe(
    t('save.pendingWatched', { turn: app.getSession()!.state.globalTurnNo }),
  );
  expect(storage.data.has(SAVE_KEY)).toBe(true);

  await userEvent.click(screen.getByRole('button', { name: t('save.continue') }));
  expect(screen.getByRole('heading', { name: t('play.heading') })).toBeTruthy();
  expect(stateHash(app.getSession()!.state)).toBe(hash);
}, 60_000);

test('Leave with End discards the game and its save (§3)', async () => {
  fakeServer();
  const storage = memoryStorage();
  const partial = watchStore(2);
  await playOut(partial, (steps) => steps === 10);
  const app = await openSaved(partial, storage);

  await userEvent.click(screen.getByRole('button', { name: t('watch.leave') }));
  await userEvent.click(screen.getByRole('button', { name: t('watch.leaveEnd') }));
  expect(app.getSession()).toBeNull();
  expect(storage.data.has(SAVE_KEY)).toBe(false);
  expect(storage.data.has(META_KEY)).toBe(false);
  expect(screen.queryByRole('button', { name: t('save.continue') })).toBeNull();
  expect(screen.getByRole('button', { name: t('home.newGame') })).toBeTruthy();
});

test('Leave cannot offer Save when the browser keeps no save, and says so (§3.1)', async () => {
  fakeServer();
  const partial = watchStore(2);
  const storage = memoryStorage();
  writeSave(storage, partial.getSession()!, { opponents: partial.getOpponents() });
  // The browser refuses writes from here on, so Continue's first save fails.
  storage.setItem = () => {
    throw new Error('quota');
  };
  render(<App store={createGameStore()} storage={storage} />);
  await userEvent.click(screen.getByRole('button', { name: t('save.continue') }));
  expect(screen.getByText(t('save.off'))).toBeTruthy();
  await userEvent.click(screen.getByRole('button', { name: t('watch.leave') }));
  const save = screen.getByRole('button', { name: t('watch.leaveSave') }) as HTMLButtonElement;
  expect(save.disabled).toBe(true);
  expect(screen.getByText(t('watch.leaveSaveOff'))).toBeTruthy();
});
