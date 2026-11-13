import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { expect, test } from 'vitest';
import { App, type AppProps } from './App.tsx';
import { t } from './i18n/en.ts';

function setup(props: AppProps = {}) {
  const user = userEvent.setup();
  render(
    <StrictMode>
      <App {...props} />
    </StrictMode>,
  );
  let clicks = 0;
  const click = async (element: HTMLElement) => {
    clicks += 1;
    await user.click(element);
  };
  return { click, clicks: () => clicks };
}

const heading = () => screen.getByRole('heading', { level: 1 });
const button = (name: string) => screen.getByRole('button', { name });
const radio = (name: RegExp) => screen.getByRole('radio', { name });

/** Spec §3.1: every greyed control points at visible text that says why. */
function expectDisabledExplained() {
  const disabled = [...document.querySelectorAll<HTMLElement>('button:disabled, input:disabled')];
  for (const control of disabled) {
    const ids = control.getAttribute('aria-describedby')?.split(' ') ?? [];
    const reason = ids.map((id) => document.getElementById(id)?.textContent ?? '').join(' ');
    expect(reason.trim(), control.outerHTML.slice(0, 120)).not.toBe('');
  }
  return disabled.length;
}

async function walkToReview(click: (element: HTMLElement) => Promise<void>, classId: RegExp) {
  await click(button(t('home.newGame')));
  await click(screen.getByRole('button', { name: new RegExp(t('mode.quick')) }));
  await click(radio(classId));
  await click(button(t('nav.next')));
  await click(button(t('opponents.next')));
}

test('the manual path reaches a started game in at most 6 clicks (§3, issue #36)', async () => {
  // Seed 1 has no first-player tie, so no extra roll is needed.
  const { click, clicks } = setup({ seed: 1 });
  await walkToReview(click, /^Researcher/);
  expect(heading().textContent).toBe(t('review.heading'));
  await click(button(t('review.roll')));

  expect(heading().textContent).toBe(t('firstPlayer.heading'));
  expect(screen.getByRole('button', { name: t('firstPlayer.toBoard') })).toBeTruthy();
  expect(clicks()).toBeLessThanOrEqual(6);
});

test('Random All reaches a started game in 2 clicks (§3)', async () => {
  const { click, clicks } = setup({ seed: 1, random: () => 0.5 });
  await click(button(t('home.randomAll')));
  expect(heading().textContent).toBe(t('review.heading'));
  await click(button(t('review.roll')));
  expect(screen.getByRole('button', { name: t('firstPlayer.toBoard') })).toBeTruthy();
  expect(clicks()).toBe(2);
});

test('?seed=7 gives the same first-player result every time, tie included (§3)', async () => {
  const play = async () => {
    const { click } = setup({ seed: 7, random: () => 0 });
    await click(button(t('home.randomAll')));
    await click(button(t('review.roll')));
    // Seed 7 ties on the first roll; tied seats re-roll automatically (§3.1).
    expect(screen.queryByRole('button', { name: t('firstPlayer.rollAgain') })).toBeNull();
    expect(screen.getByRole('button', { name: t('firstPlayer.toBoard') })).toBeTruthy();
    const result = screen.getAllByRole('status').map((status) => status.textContent);
    const rolls = screen.getAllByRole('listitem').map((item) => item.textContent);
    cleanup();
    localStorage.clear();
    return { result, rolls };
  };
  const first = await play();
  expect(first.result.join(' ')).toContain(t('firstPlayer.youStart'));
  expect(await play()).toEqual(first);
  expect(await play()).toEqual(first);
});

test('Standard is visible but greyed with its reason; Play and Results wait for a game', async () => {
  const { click } = setup();
  // Before any game exists there is no way to Play or Results (captain's note, round 2).
  expect(screen.queryByRole('button', { name: t('nav.play') })).toBeNull();
  expect(screen.queryByRole('button', { name: t('nav.results') })).toBeNull();

  await click(button(t('home.newGame')));
  const standard = screen.getByRole('button', { name: new RegExp(t('mode.standard')) });
  expect(standard).toHaveProperty('disabled', true);
  const reason = document.getElementById(standard.getAttribute('aria-describedby')!);
  expect(reason?.textContent).toBe(t('mode.standardClosed'));
  expect(expectDisabledExplained()).toBe(1);
});

test('the rival cannot take the human class, and says why (§3)', async () => {
  const { click } = setup();
  await click(button(t('home.newGame')));
  await click(screen.getByRole('button', { name: new RegExp(t('mode.quick')) }));
  expectDisabledExplained(); // Next waits for a class, and the closed classes say why.
  expect(button(t('nav.next'))).toHaveProperty('disabled', true);
  await click(radio(/^Researcher/));
  await click(button(t('nav.next')));

  const taken = radio(/^Researcher/);
  expect(taken).toHaveProperty('disabled', true);
  expect(document.getElementById(taken.getAttribute('aria-describedby')!)?.textContent).toBe(
    t('opponents.classTaken'),
  );
  expect(radio(/^Main Character/)).toHaveProperty('checked', true);
  expect(radio(new RegExp(`^${t('personality.greedy')}`))).toHaveProperty('checked', true);
  expect(radio(new RegExp(`^${t('personality.aggressive')}`))).toHaveProperty('disabled', true);
  expect(expectDisabledExplained()).toBeGreaterThanOrEqual(4);

  // Changing the human class to the rival's moves the rival to a free class.
  await click(button(t('nav.back')));
  await click(radio(/^Main Character/));
  await click(button(t('nav.next')));
  expect(radio(/^Researcher/)).toHaveProperty('checked', true);
  expect(radio(/^Main Character/)).toHaveProperty('disabled', true);
});

test('a class with several Starters offers a picker, preset to the first (§4.1)', async () => {
  const { click } = setup();
  await click(button(t('home.newGame')));
  await click(screen.getByRole('button', { name: new RegExp(t('mode.quick')) }));
  expect(screen.queryByRole('group', { name: t('class.chooseStarter') })).toBeNull();
  await click(radio(/^Main Character/));
  const picker = screen.getByRole('group', { name: t('class.chooseStarter') });
  expect(within(picker).getByRole('radio', { name: 'Bulbasaur' })).toHaveProperty('checked', true);
  await click(within(picker).getByRole('radio', { name: 'Squirtle' }));
  await click(button(t('nav.next')));
  await click(button(t('opponents.next')));
  expect(screen.getByText(/Squirtle/)).toBeTruthy();
});

test('Back works on every setup step and no step is blank (§3.1)', async () => {
  const { click } = setup();
  await walkToReview(click, /^Researcher/);
  const expected = [
    t('opponents.heading'),
    t('class.heading'),
    t('mode.heading'),
    t('home.heading'),
  ];
  for (const name of expected) {
    expect(heading().textContent).not.toBe('');
    expectDisabledExplained();
    await click(button(t('nav.back')));
    expect(heading().textContent).toBe(name);
  }
  // Back kept the earlier answers.
  await click(button(t('home.newGame')));
  await click(screen.getByRole('button', { name: new RegExp(t('mode.quick')) }));
  expect(radio(/^Researcher/)).toHaveProperty('checked', true);
});

test('quitting from the first-roll screen returns Home', async () => {
  const { click } = setup({ seed: 1, random: () => 0 });
  await click(button(t('home.randomAll')));
  await click(button(t('review.roll')));
  await click(button(t('firstPlayer.quit')));
  expect(heading().textContent).toBe(t('home.heading'));
});

test('credits list the CC BY models and lead back where the player was', async () => {
  const { click } = setup();
  await click(button(t('home.newGame')));
  await click(button(t('credits.link')));
  expect(heading().textContent).toBe(t('credits.heading'));
  expect(screen.getAllByText('Tipatat Chennavasin')).toHaveLength(3);
  expect(screen.getAllByText('CC BY 3.0')).toHaveLength(3);
  await click(button(t('nav.back')));
  expect(heading().textContent).toBe(t('mode.heading'));
});

test('focus moves to each new heading, but not on first load; no 3D in jsdom', async () => {
  const { click } = setup();
  expect(document.activeElement).toBe(document.body);
  // Without WebGL the board falls back to its text legend.
  expect(screen.getByText(t('board.kind.gym'))).toBeTruthy();
  expect(document.querySelector('canvas')).toBeNull();
  await click(button(t('home.newGame')));
  expect(document.activeElement).toBe(heading());
});

test('no screen of the player flow links to or shows the developer gallery (issue #53)', async () => {
  const { click } = setup({ seed: 1 });
  const noGallery = () => {
    expect(document.querySelector('[href*="gallery" i], [data-testid="ui-gallery"]')).toBeNull();
    expect(screen.queryByText(t('gallery.title'))).toBeNull();
    for (const control of screen.queryAllByRole('button')) {
      expect(control.textContent!.toLowerCase(), control.outerHTML).not.toContain('gallery');
    }
  };
  noGallery();
  await click(button(t('home.newGame')));
  noGallery();
  await click(screen.getByRole('button', { name: new RegExp(t('mode.quick')) }));
  noGallery();
  await click(radio(/^Researcher/));
  await click(button(t('nav.next')));
  noGallery();
  await click(button(t('opponents.next')));
  noGallery();
  await click(button(t('review.roll')));
  noGallery();
  await click(button(t('firstPlayer.toBoard')));
  expect(screen.getByRole('region', { name: t('turn.actions') })).toBeTruthy();
  noGallery();
  await click(button(t('credits.link')));
  expect(heading().textContent).toBe(t('credits.heading'));
  noGallery();
});
