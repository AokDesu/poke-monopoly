import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { ErrorBoundary } from './ErrorBoundary.tsx';
import { t } from './i18n/en.ts';

afterEach(() => {
  vi.restoreAllMocks();
});

test('a child that throws shows a message and a retry that renders the child again (§3.1)', async () => {
  // React reports caught render errors on the console; keep the test output readable.
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const user = userEvent.setup();
  let broken = true;
  function Child() {
    if (broken) throw new Error('render failed');
    return <p>{t('home.heading')}</p>;
  }

  render(
    <ErrorBoundary>
      <Child />
    </ErrorBoundary>,
  );

  const alert = screen.getByRole('alert');
  expect(alert.textContent).toContain(t('error.heading'));
  expect(alert.textContent).toContain(t('error.body'));

  // Still failing: retry keeps the message on screen instead of going blank.
  await user.click(screen.getByRole('button', { name: t('error.retry') }));
  expect(screen.getByRole('alert')).toBeTruthy();

  broken = false;
  await user.click(screen.getByRole('button', { name: t('error.retry') }));
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByText(t('home.heading'))).toBeTruthy();
});
