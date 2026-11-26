import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { rollForFirstPlayer } from '../game/firstPlayer.ts';
import { engineContent, currentForm } from '../game/content.ts';
import { configForSetup, createGameStore, type GameStore } from '../game/store.ts';
import { t } from '../i18n/en.ts';
import { className } from '../i18n/names.ts';
import { fakeServer, settingsFor, watchStore } from '../test/watchGame.ts';
import type { Beat, StorySpeech } from './beats.ts';
import { Board } from './Board.tsx';
import { BoardScreen } from './BoardScreen.tsx';
import { SeatRows } from './SeatRows.tsx';

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
  // Settle on the human's own decision first. Left at the first-player roll, the board plays that
  // automatic roll after HUMAN_STEP_MS, which the clicks outlast on a loaded machine (#64).
  rollForFirstPlayer(store);
  while (store.advance());
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

test('for a watcher and a player alike, the seat rows lead the side column and the one card follows (§3)', () => {
  fakeServer();
  for (const store of [watchStore(3), playerStore(2)]) {
    const { unmount } = render(<BoardScreen store={store} />);
    const column = screen.getByRole('complementary', { name: t('play.side') });
    const [rows, slot] = [...column.children];
    expect(rows!.querySelector('.players-area')).toBeTruthy();
    expect(slot!.getAttribute('aria-label')).toBe(t('turn.actions'));
    expect(slot!.querySelectorAll('.decision-card')).toHaveLength(1);
    unmount();
  }
});

/** A table where seat 1 is playing, so its row is open as a list of beats. */
function seatOnePlaying() {
  const { observation } = playerStore(2).getView()!;
  return { ...observation, public: { ...observation.public, activeSeatIndex: 1 } };
}

/** Seat 1's turn `turn`, told in `count` beats. */
const turnOfSeatOne = (turn: number, count: number): Beat[] =>
  Array.from({ length: count }, (_, index) => ({
    seatIndex: 1,
    turn,
    at: turn * 100 + index,
    key: 'beat.moveTo',
    text: `Turn ${turn}, beat ${index + 1}`,
    kind: 'result',
    touchedYou: false,
  }));

/** Everything in `beats` told, each seat's last turn being its latest beat's. */
const storyOf = (beats: Beat[], speech = new Map<number, StorySpeech>()) => ({
  beats,
  shown: beats.length,
  current: null,
  turns: new Map(beats.map((beat) => [beat.seatIndex, beat.turn])),
  speech,
});

const beatsOf = (seat: number) =>
  [...rowOf(seat).querySelectorAll('.seat-beat')].map((item) => item.textContent);

test('“+N more” opens a long turn in place and keeps the keyboard on it; the seat’s next turn starts at its last four beats (§3)', async () => {
  const user = userEvent.setup();
  const observation = seatOnePlaying();
  const first = turnOfSeatOne(5, 6);
  const { rerender } = render(
    <SeatRows observation={observation} viewerSeat={0} story={storyOf(first)} pace="readable" />,
  );
  expect(beatsOf(1)).toEqual(first.slice(-4).map((beat) => beat.text));
  const more = within(rowOf(1)).getByRole('button', { name: t('row.more', { count: 2 }) });
  expect(more.getAttribute('aria-expanded')).toBe('false');

  more.focus();
  await user.keyboard('{Enter}');
  expect(beatsOf(1)).toEqual(first.map((beat) => beat.text));
  expect(document.activeElement, 'focus stays on the control').toBe(more);
  expect(more.getAttribute('aria-expanded')).toBe('true');
  expect(more.textContent).toBe(t('row.fewer'));
  await user.keyboard('{Enter}');
  expect(beatsOf(1)).toHaveLength(4);
  expect(document.activeElement).toBe(more);
  expect(more.getAttribute('aria-expanded')).toBe('false');

  // Left open, then the seat plays its next long turn: that turn starts at its last four beats.
  await user.keyboard('{Enter}');
  const next = turnOfSeatOne(9, 6);
  rerender(
    <SeatRows
      observation={observation}
      viewerSeat={0}
      story={storyOf([...first, ...next])}
      pace="readable"
    />,
  );
  expect(beatsOf(1)).toEqual(next.slice(-4).map((beat) => beat.text));
  expect(
    within(rowOf(1))
      .getByRole('button', { name: t('row.more', { count: 2 }) })
      .getAttribute('aria-expanded'),
  ).toBe('false');
});

test('a seat’s speech line shows only at Step or Readable, also after the pace changes mid-line (§3)', () => {
  const observation = seatOnePlaying();
  const line = { text: 'What a roll!', source: 'bank' as const, toYou: false };
  const story = storyOf(turnOfSeatOne(5, 2), new Map([[1, line]]));
  const speech = () =>
    within(rowOf(1)).queryByLabelText(
      t('row.speech', { name: className(observation.public.players[1]!.classId), line: line.text }),
    );
  const { rerender } = render(
    <SeatRows observation={observation} viewerSeat={0} story={story} pace="readable" />,
  );
  expect(speech()).not.toBeNull();
  for (const [pace, shown] of [
    ['fast', false],
    ['instant', false],
    ['step', true],
    ['readable', true],
  ] as const) {
    rerender(<SeatRows observation={observation} viewerSeat={0} story={story} pace={pace} />);
    expect(speech() !== null, pace).toBe(shown);
  }
});
