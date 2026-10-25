import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { ActionButton } from './ActionButton.tsx';

test('an unavailable action exposes its reason and cannot fire by pointer or keyboard', async () => {
  const choose = vi.fn();
  const user = userEvent.setup();
  render(
    <ActionButton enabled={false} reasonText="No Ball" onClick={choose}>
      Catch
    </ActionButton>,
  );
  const button = screen.getByRole('button', { name: 'Catch' });
  expect(button).toHaveProperty('disabled', true);
  expect(button.getAttribute('aria-disabled')).toBe('true');
  expect(document.getElementById(button.getAttribute('aria-describedby')!)?.textContent).toBe(
    'No Ball',
  );
  await user.click(button);
  await user.keyboard('{Enter} ');
  expect(choose).not.toHaveBeenCalled();
});

test('an enabled action is keyboard reachable and fires once', async () => {
  const choose = vi.fn();
  const user = userEvent.setup();
  render(
    <ActionButton enabled onClick={choose}>
      Release
    </ActionButton>,
  );
  await user.tab();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Release' }));
  await user.keyboard('{Enter}');
  expect(choose).toHaveBeenCalledTimes(1);
});
