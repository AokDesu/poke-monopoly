import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import fixture from '../../../engine/fixtures/start-of-game-2p.json';
import { projectBoardFixture } from '../game/store.ts';
import { t } from '../i18n/en.ts';
import { FixtureScreen } from './FixtureScreen.tsx';

const fixtures = { 'start-of-game-2p': projectBoardFixture(fixture) };

test('a named fixture opens its Board instead of setup', () => {
  render(<FixtureScreen name="start-of-game-2p" fixtures={fixtures} />);
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(t('play.heading'));
  expect(
    screen.getByTestId('token-0').closest('[data-position]')?.getAttribute('data-position'),
  ).toBe('0');
});

test.each(['missing', '', '__proto__', 'toString'])(
  'unknown fixture %s has a visible recovery message',
  (name) => {
    render(<FixtureScreen name={name} fixtures={fixtures} />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(t('board.fixtureMissing'));
    expect(screen.getByText(t('board.fixtureMissingBody'))).toBeTruthy();
    expect(screen.queryByTestId('token-0')).toBeNull();
  },
);
