import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { engineContent } from '../game/content.ts';
import type { GameSetup, OpponentChoice } from '../game/setup.ts';
import { configForSetup, createGameStore, opponentSettings } from '../game/store.ts';
import { rollForFirstPlayer } from '../game/firstPlayer.ts';
import { t } from '../i18n/en.ts';
import { FirstPlayerScreen } from './FirstPlayerScreen.tsx';

const rival = (classId: string, starterSpeciesId: string): OpponentChoice => ({
  classId,
  starterSpeciesId,
  personality: 'greedy',
  difficulty: 'easy',
});
// Setup offers one AI this cycle; the roll screen already handles more (spec §3), and only a
// third seat can show a tie that leaves someone out.
const threeSeats: GameSetup = {
  mode: 'quick',
  human: { classId: 'researcher', starterSpeciesId: 'porygon' },
  opponents: [rival('main-character', 'bulbasaur'), rival('rival', 'eevee')],
};

function rolled(seed: number) {
  const store = createGameStore();
  store.start(configForSetup(threeSeats, seed), engineContent, opponentSettings(threeSeats));
  rollForFirstPlayer(store);
  return store;
}

const attempts = () =>
  within(screen.getAllByRole('list')[1]!)
    .getAllByRole('heading', { level: 2 })
    .map((heading) => heading.closest('li')!);
const seatsIn = (attempt: HTMLElement) =>
  [...attempt.querySelectorAll<HTMLElement>('[data-seat]')].map((row) => row.dataset.seat);

test('a scripted tie shows only the tied seats re-rolling, each with its roll (§3)', () => {
  // Seed 15: the human rolls 2, both AIs roll 3; then only the AIs roll again (3 and 2).
  render(<FirstPlayerScreen store={rolled(15)} onToBoard={vi.fn()} onQuit={vi.fn()} />);
  const [first, second] = attempts();
  expect(seatsIn(first!)).toEqual(['0', '1', '2']);
  expect(seatsIn(second!)).toEqual(['1', '2']);
  expect(
    [...second!.querySelectorAll('[data-seat]')].map(
      (row) => row.textContent?.match(/Rolled (\d)/)?.[1],
    ),
  ).toEqual(['3', '2']);
  expect(within(second!).getByText(t('firstPlayer.tie'))).toBeTruthy();
  expect(screen.getByRole('status').textContent).toContain(t('firstPlayer.aiStarts'));
  expect(screen.queryByRole('button', { name: t('firstPlayer.rollAgain') })).toBeNull();
});

test('a resumed human tie advances automatically with no roll button (§3.1)', async () => {
  vi.useFakeTimers();
  try {
    // A saved tie awaiting the human re-roll: seats 0 and 2 tied, seat 1 stays out.
    const store = createGameStore();
    store.start(configForSetup(threeSeats, 6), engineContent);
    for (let step = 0; step < 6; step++) expect(store.advance({ human: true })).toBe(true);
    render(<FirstPlayerScreen store={store} onToBoard={vi.fn()} onQuit={vi.fn()} />);
    let [, second] = attempts();
    expect(seatsIn(second!)).toEqual(['0', '2']);
    expect(within(second!).getAllByText(t('firstPlayer.waiting'))).toHaveLength(2);
    expect(screen.queryByRole('button', { name: t('firstPlayer.rollAgain') })).toBeNull();
    // One engine action per timer keeps the saved rolls visible on Continue.
    for (let step = 0; step < 4; step++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1200);
      });
    }
    [, second] = attempts();
    expect(within(second!).queryByText(t('firstPlayer.waiting'))).toBeNull();
    expect(screen.getByRole('button', { name: t('firstPlayer.toBoard') })).toBeTruthy();
    expect(store.getSession()!.log.actions.every((record) => record.auto === true)).toBe(true);
  } finally {
    vi.useRealTimers();
  }
});

test('without a game the screen says so and offers a way home (§3.1)', async () => {
  const user = userEvent.setup();
  const onQuit = vi.fn();
  render(<FirstPlayerScreen store={createGameStore()} onToBoard={vi.fn()} onQuit={onQuit} />);
  expect(screen.getByText(t('firstPlayer.noGame'))).toBeTruthy();
  await user.click(screen.getByRole('button', { name: t('firstPlayer.quit') }));
  expect(onQuit).toHaveBeenCalled();
});
