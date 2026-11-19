import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { engineContent, currentForm } from '../game/content.ts';
import { configForSetup, createGameStore, type GameStore } from '../game/store.ts';
import { t } from '../i18n/en.ts';
import { className } from '../i18n/names.ts';
import { fakeServer, settingsFor, watchStore } from '../test/watchGame.ts';
import { Board } from './Board.tsx';
import { BoardScreen } from './BoardScreen.tsx';

afterEach(() => {
  vi.unstubAllGlobals();
});
const RIVALS = [
  { classId: 'researcher', starterSpeciesId: 'porygon' },
  { classId: 'rival', starterSpeciesId: 'eevee' },
  { classId: 'fisherman', starterSpeciesId: 'magikarp' },
];

/** A game with the human at seat 0 and one to three AI rivals, never calling a model. */
function playerStore(rivals: 1 | 2 | 3): GameStore {
  const store = createGameStore();
  store.start(
    configForSetup(
      {
        mode: 'quick',
        human: { classId: 'main-character', starterSpeciesId: 'bulbasaur' },
        opponents: RIVALS.slice(0, rivals).map((rival) => ({
          ...rival,
          personality: 'greedy' as const,
          difficulty: 'normal' as const,
        })),
      },
      7,
    ),
    engineContent,
    settingsFor(rivals + 1).slice(1),
  );
  return store;
}

const rowOf = (seat: number) => screen.getByTestId(`player-${seat}`);
const toggleOf = (seat: number) =>
  within(rowOf(seat)).getByRole('button', { name: /^Details for / });
const bodyOf = (seat: number) => rowOf(seat).querySelector<HTMLElement>('.player-body')!;
const summaryOf = (seat: number) => rowOf(seat).querySelector<HTMLElement>('.seat-row-summary')!;

test.each([1, 2, 3] as const)(
  'with %i rival(s) every row shows its name, coins and square closed, from the engine projection (§3)',
  (rivals) => {
    const store = playerStore(rivals);
    const { observation } = store.getView()!;
    render(<Board observation={observation} />);
    const { players, lapTarget, activeSeatIndex, board } = observation.public;
    expect(players).toHaveLength(rivals + 1);
    for (const player of players) {
      const summary = summaryOf(player.seatIndex);
      // One name per seat: "You" for the player, the class (unique in a game) for a rival.
      expect(within(rowOf(player.seatIndex)).getByRole('heading', { level: 2 }).textContent).toBe(
        player.seatIndex === 0
          ? `${t('seat.you')} ${className(player.classId)}`
          : `${className(player.classId)} ${t('row.ai')}`,
      );
      expect(within(summary).getByLabelText(t('board.coins')).textContent).toBe(
        String(player.coins),
      );
      const square = board.find((space) => space.position === player.position)!;
      expect(within(summary).getByLabelText(t('board.position')).textContent).toBe(
        t('beat.square', { kind: t(`board.kind.${square.kind}`), position: player.position }),
      );
      // Lap, items and team open under the row's toggle, from the same projection.
      const body = bodyOf(player.seatIndex);
      expect(within(body).getByLabelText(t('board.lap')).textContent).toBe(
        `${player.creditedLap} / ${lapTarget}`,
      );
      expect(within(body).getByLabelText(t('board.itemCount')).textContent).toBe(
        String(player.itemCount),
      );
      expect(body.textContent).toContain(
        t('board.teamGlance', {
          count: player.team.length,
          name: currentForm(player.team[0]!.speciesId).name,
        }),
      );
      // Closed: the rest of the seat is out of the page, not merely out of view.
      expect(toggleOf(player.seatIndex).getAttribute('aria-expanded')).toBe('false');
      expect(body.hidden).toBe(true);
    }
    // Whose turn it is: one row, marked in words and for assistive technology.
    const active = document.querySelectorAll('.seat-row[data-active="true"]');
    expect(active).toHaveLength(1);
    expect(active[0]!.getAttribute('data-seat')).toBe(String(activeSeatIndex));
    expect(active[0]!.getAttribute('aria-current')).toBe('true');
    expect(active[0]!.querySelector('.turn-badge')?.textContent).toBe(
      activeSeatIndex === 0 ? t('row.yourTurn') : t('row.playing'),
    );
    expect(document.querySelectorAll('.turn-badge')).toHaveLength(1);
  },
);

test('details open for one seat at a time and close again, with the board still on screen (§3)', async () => {
  const user = userEvent.setup();
  const store = playerStore(2);
  render(<Board observation={store.getView()!.observation} />);
  expect(screen.getByLabelText(t('board.loop'))).toBeTruthy();

  await user.click(toggleOf(1));
  expect(toggleOf(1).getAttribute('aria-expanded')).toBe('true');
  expect(bodyOf(1).hidden).toBe(false);
  expect(within(bodyOf(1)).getByRole('list', { name: t('board.team') })).toBeTruthy();

  await user.click(toggleOf(2));
  expect(toggleOf(2).getAttribute('aria-expanded')).toBe('true');
  expect(toggleOf(1).getAttribute('aria-expanded')).toBe('false');
  expect(bodyOf(1).hidden).toBe(true);
  expect(bodyOf(2).hidden).toBe(false);

  await user.click(toggleOf(2));
  expect(toggleOf(2).getAttribute('aria-expanded')).toBe('false');
  expect(document.querySelectorAll('.player-body:not([hidden])')).toHaveLength(0);
  expect(screen.getByLabelText(t('board.loop'))).toBeTruthy();
});

test('each toggle is named for its seat and points at the body it opens', () => {
  const store = playerStore(2);
  const { observation } = store.getView()!;
  render(<Board observation={observation} />);
  for (const player of observation.public.players) {
    const toggle = toggleOf(player.seatIndex);
    expect(toggle.getAttribute('aria-label')).toBe(
      t('board.openDetails', {
        name: player.seatIndex === 0 ? t('seat.you') : className(player.classId),
      }),
    );
    expect(document.getElementById(toggle.getAttribute('aria-controls')!)).toBe(
      bodyOf(player.seatIndex),
    );
  }
});

test('the keyboard opens, closes and leaves focus on the seat it was using (§3)', async () => {
  const user = userEvent.setup();
  render(<Board observation={playerStore(1).getView()!.observation} />);
  const first = toggleOf(0);
  first.focus();
  await user.keyboard('{Enter}');
  expect(first.getAttribute('aria-expanded')).toBe('true');
  await user.keyboard(' ');
  expect(first.getAttribute('aria-expanded')).toBe('false');
  await user.keyboard('{Enter}');

  // Tab walks on into the open body (its Inspect control), then Escape closes it from there.
  await user.tab();
  const inBody = document.activeElement as HTMLElement;
  expect(bodyOf(0).contains(inBody)).toBe(true);
  await user.keyboard('{Escape}');
  expect(first.getAttribute('aria-expanded')).toBe('false');
  expect(document.activeElement).toBe(first);

  // Escape with nothing open changes nothing, and Tab reaches the next seat's toggle.
  await user.keyboard('{Escape}');
  await user.tab();
  expect(document.activeElement).toBe(toggleOf(1));
});

test('opening and closing a seat is a view choice: it never reaches the game', async () => {
  fakeServer();
  const user = userEvent.setup();
  const store = playerStore(2);
  const before = store.getSession()!.log.actions.length;
  const revision = store.getView()!.observation.public.stateRevision;
  render(<BoardScreen store={store} />);
  for (const seat of [0, 1, 2, 1]) await user.click(toggleOf(seat));
  expect(store.getSession()!.log.actions).toHaveLength(before);
  expect(store.getView()!.observation.public.stateRevision).toBe(revision);
});

test('a rival opened up shows its team and an item count only; the Ball pouch stays yours (§4.1)', async () => {
  const user = userEvent.setup();
  const store = playerStore(2);
  const { observation } = store.getView()!;
  const rival = observation.public.players.find((player) => player.seatIndex === 1)!;
  const secret = structuredClone(observation);
  // Whatever a rival holds beyond its public numbers must never be drawn, open or closed.
  Object.assign(secret.public.players[1]!, {
    balls: { poke: 7771, great: 7772, ultra: 7773 },
    secretItems: [{ itemId: 'x', name: 'SENTINEL-SECRET' }],
  });
  const { container } = render(<Board observation={secret} />);
  for (const seat of [0, 1, 2]) {
    await user.click(toggleOf(seat));
    expect(container.innerHTML).not.toMatch(/SENTINEL|777[123]/);
  }
  await user.click(toggleOf(1));
  const body = bodyOf(1);
  expect(within(body).getByText(t('board.hiddenInventory'))).toBeTruthy();
  expect(within(body).queryByLabelText(t('board.balls'))).toBeNull();
  expect(within(body).queryByLabelText(t('board.items'))).toBeNull();
  expect(within(body).getByLabelText(t('board.itemCount')).textContent).toBe(
    String(rival.itemCount),
  );
  // The player's own body is the only one with the Ball pouch.
  await user.click(toggleOf(0));
  expect(within(bodyOf(0)).getByLabelText(t('board.balls'))).toBeTruthy();
  expect(document.querySelectorAll('.ball-pouch')).toHaveLength(1);
});

test('a watched game shows every seat’s class, and its personality and difficulty under the row, and nobody is “You” (§3, §4.1)', async () => {
  fakeServer();
  const user = userEvent.setup();
  const store = watchStore(4);
  render(<BoardScreen store={store} />);
  const players = store.getSpectatorView()!.observation.public.players;
  for (const [seat, setup] of settingsFor(4).entries()) {
    expect(summaryOf(seat).textContent).toContain(className(players[seat]!.classId));
    expect(bodyOf(seat).textContent).toContain(
      t('watch.setup', {
        personality: t(`personality.${setup.personality}`),
        difficulty: t(`difficulty.${setup.difficulty}`),
      }),
    );
    expect(within(bodyOf(seat)).getByLabelText(t('board.itemCount'))).toBeTruthy();
    expect(bodyOf(seat).hidden).toBe(true);
  }
  expect(document.querySelectorAll('.turn-badge')).toHaveLength(1);
  expect(document.body.textContent).not.toMatch(/\bYou\b|\bYour\b/);
  await user.click(toggleOf(3));
  expect(bodyOf(3).hidden).toBe(false);
  expect(document.querySelector('.ball-pouch')).toBeNull();
});

test('the turn badge follows the active seat when the view changes', () => {
  const store = playerStore(1);
  const { observation } = store.getView()!;
  const other = observation.public.players.find(
    (player) => player.seatIndex !== observation.public.activeSeatIndex,
  )!;
  const moved = structuredClone(observation);
  moved.public.activeSeatIndex = other.seatIndex;
  const { rerender } = render(<Board observation={observation} />);
  const badgeSeat = () =>
    document.querySelector('.seat-row[data-active="true"]')?.getAttribute('data-seat');
  expect(badgeSeat()).toBe(String(observation.public.activeSeatIndex));
  rerender(<Board observation={moved} />);
  expect(badgeSeat()).toBe(String(other.seatIndex));
});

test('a watcher’s seats lead the column; a player’s turn controls come first (§3)', () => {
  fakeServer();
  const { unmount } = render(<BoardScreen store={watchStore(3)} />);
  expect(document.querySelector('.trainer-panels')!.firstElementChild!.className).toBe(
    'players-area',
  );
  unmount();
  render(<BoardScreen store={playerStore(2)} />);
  const column = document.querySelector('.trainer-panels')!;
  expect(column.firstElementChild!.className).not.toBe('players-area');
  expect(column.lastElementChild!.className).toBe('players-area');
});
