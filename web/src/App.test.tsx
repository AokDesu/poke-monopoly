import { render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
import { App } from './App.tsx';
import { t } from './i18n/th.ts';

test('the home placeholder is in Thai and the flow walks home, setup, play, results (§3)', async () => {
  const user = userEvent.setup();
  // StrictMode as in main.tsx: its double effect run must not steal focus on first load.
  render(
    <StrictMode>
      <App />
    </StrictMode>,
  );

  const heading = () => screen.getByRole('heading', { level: 1 });
  const currentStep = () =>
    screen.getByRole('navigation', { name: t('steps.label') }).querySelector('[aria-current]');

  expect(heading().textContent).toBe(t('home.heading'));
  expect(heading().textContent).toMatch(/[\u0E00-\u0E7F]/);
  expect(currentStep()?.textContent).toBe(t('steps.home'));
  expect(screen.queryByRole('button', { name: t('nav.home') })).toBeNull();
  expect(document.activeElement).toBe(document.body);

  await user.click(screen.getByRole('button', { name: t('nav.setup') }));
  expect(heading().textContent).toBe(t('setup.heading'));
  expect(document.activeElement).toBe(heading());
  expect(currentStep()?.textContent).toBe(t('steps.setup'));

  await user.click(screen.getByRole('button', { name: t('nav.play') }));
  expect(heading().textContent).toBe(t('play.heading'));

  await user.click(screen.getByRole('button', { name: t('nav.results') }));
  expect(heading().textContent).toBe(t('results.heading'));
  expect(currentStep()?.textContent).toBe(t('steps.results'));
  // The last screen still offers a way on: back to home.
  expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
    t('nav.home'),
  ]);

  await user.click(screen.getByRole('button', { name: t('nav.home') }));
  expect(heading().textContent).toBe(t('home.heading'));
});
