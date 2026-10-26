import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { engineContent } from './game/content.ts';
import { configForSetup, createGameStore, type GameStore } from './game/store.ts';
import { t } from './i18n/en.ts';
import { ResultsScreen } from './ResultsScreen.tsx';

const opponents = [{ seatIndex: 1, personality: 'greedy' as const, difficulty: 'normal' as const }];
const setup = {
  mode: 'quick' as const,
  human: { classId: 'main-character', starterSpeciesId: 'bulbasaur' },
  opponents: [
    {
      classId: 'researcher',
      starterSpeciesId: 'porygon',
      personality: 'greedy' as const,
      difficulty: 'normal' as const,
    },
  ],
};

function finished(rows: { coins: number; badges: number; team: number }[]): GameStore {
  const store = createGameStore();
  store.start(configForSetup(setup, 1), engineContent, opponents);
  const session = store.getSession()!;
  const state = structuredClone(session.state);
  state.phase = { kind: 'finished' };
  for (const [index, player] of state.players.entries()) {
    const row = rows[index]!;
    const starter = player.team[0];
    if (!starter) throw new Error('missing starter');
    player.coins = row.coins;
    player.badges = row.badges;
    player.team = Array.from({ length: row.team }, (_, nth) => ({
      ...structuredClone(starter),
      instanceId: `decoy-${index}-${nth}`,
    }));
  }
  store.restore({ state, log: session.log });
  return store;
}

const rival = t('board.rivalLabel', { seat: 1 });

test('a coin tie with unequal badges shows the badge winner, not the larger team (§4.7)', () => {
  const store = finished([
    { coins: 40, badges: 0, team: 17 },
    { coins: 40, badges: 3, team: 13 },
  ]);
  render(<ResultsScreen store={store} onPlayAgain={() => {}} />);
  expect(screen.getByRole('status').textContent).toBe(t('results.winBadges', { name: rival }));
  expect(screen.getAllByText(t('results.winnerMark'))).toHaveLength(1);
  expect(screen.getByRole('row', { name: new RegExp(rival) }).textContent).toContain(
    t('results.winnerMark'),
  );
  expect(document.body.textContent).not.toMatch(/pokémon|pokemon|evolution/i);
  expect(document.body.textContent).not.toContain('17');
  expect(document.body.textContent).not.toContain('13');
});

test('a full tie shows co-winners and still hides Pokémon counts (§4.7)', () => {
  const store = finished([
    { coins: 25, badges: 1, team: 19 },
    { coins: 25, badges: 1, team: 8 },
  ]);
  render(<ResultsScreen store={store} onPlayAgain={() => {}} />);
  const status = screen.getByRole('status').textContent ?? '';
  expect(status).toBe(
    t('results.coWinners', { names: t('results.nameJoin', { left: t('seat.you'), right: rival }) }),
  );
  expect(status).toContain('co-winners');
  expect(screen.getAllByText(t('results.winnerMark'))).toHaveLength(2);
  expect(document.body.textContent).not.toMatch(/pokémon|pokemon|evolution/i);
  expect(document.body.textContent).not.toContain('19');
  expect(document.body.textContent).not.toContain('8');
});

test('more badges and a larger team do not beat more coins (§4.7)', () => {
  const store = finished([
    { coins: 10, badges: 5, team: 14 },
    { coins: 30, badges: 0, team: 16 },
  ]);
  render(<ResultsScreen store={store} onPlayAgain={() => {}} />);
  expect(screen.getByRole('status').textContent).toBe(t('results.winCoins', { name: rival }));
  expect(screen.getByRole('status').textContent).not.toMatch(/badge/i);
  expect(document.body.textContent).not.toContain('14');
  expect(document.body.textContent).not.toContain('16');
});
