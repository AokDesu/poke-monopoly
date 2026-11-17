import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { t } from './i18n/en.ts';
import { Root } from './Root.tsx';

// A dev server's Vite plugin supplies the fixtures to the route; the test hands the page its own.
vi.mock('./gallery/GalleryRoute.tsx', async () => {
  const { GalleryPage } = await import('./gallery/GalleryPage.tsx');
  const fixtures = {
    'encounter-no-ball': (await import('../../engine/fixtures/encounter-no-ball.json')).default,
    'sell-phase-three-pokemon': (
      await import('../../engine/fixtures/sell-phase-three-pokemon.json')
    ).default,
    'shop-low-coins': (await import('../../engine/fixtures/shop-low-coins.json')).default,
    'shop-no-coins': (await import('../../engine/fixtures/shop-no-coins.json')).default,
  };
  return { default: () => <GalleryPage fixtures={fixtures} /> };
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

test('a dev build opens the gallery at ?gallery', async () => {
  render(<Root search="?gallery" dev />);
  expect(await screen.findByTestId('ui-gallery')).toBeTruthy();
  expect(screen.getByRole('heading', { level: 1, name: t('gallery.title') })).toBeTruthy();
});

test.each(['?gallery', '?gallery=1', '?seed=3&gallery'])(
  'a production build ignores %s and opens the game',
  (search) => {
    render(<Root search={search} dev={false} />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(t('home.heading'));
    expect(screen.queryByTestId('ui-gallery')).toBeNull();
  },
);

test('without ?gallery a dev build opens the game too', () => {
  render(<Root search="" dev />);
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(t('home.heading'));
  expect(screen.queryByTestId('ui-gallery')).toBeNull();
});
