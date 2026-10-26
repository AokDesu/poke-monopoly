import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, expect, test, vi } from 'vitest';
import {
  catchOdds,
  fixtureSchema,
  legalActions,
  observe,
  oddsForAllBalls,
} from '../../../engine/index.ts';
import noBall from '../../../engine/fixtures/encounter-no-ball.json';
import withBalls from '../../../engine/fixtures/encounter-with-balls.json';
import { t } from '../i18n/en.ts';
import { EncounterDialog } from './EncounterDialog.tsx';

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
});

function encounter(input: unknown) {
  const { state } = fixtureSchema.parse(input);
  const onChoose = vi.fn();
  render(
    <EncounterDialog
      observation={observe(state, 0)}
      legalActions={legalActions(state, 0)}
      catchOdds={oddsForAllBalls(state, 0)}
      onChoose={onChoose}
    />,
  );
  return { state, onChoose, dialog: screen.getByRole('dialog') };
}

test('encounter-no-ball explains the greyed catch control; only release is clickable (§3.1)', async () => {
  const { dialog, onChoose } = encounter(noBall);
  const buttons = within(dialog).getAllByRole('button');
  const catchButton = within(dialog).getByRole('button', { name: t('encounter.catch') });
  expect(catchButton).toHaveProperty('disabled', true);
  expect(catchButton.getAttribute('aria-disabled')).toBe('true');
  expect(document.getElementById(catchButton.getAttribute('aria-describedby')!)?.textContent).toBe(
    t('action.reason.NO_BALL'),
  );
  expect(
    buttons
      .filter((button) => !button.hasAttribute('disabled'))
      .map((button) => button.textContent),
  ).toEqual([t('encounter.release')]);
  await userEvent.click(catchButton);
  expect(onChoose).not.toHaveBeenCalled();
  await userEvent.click(within(dialog).getByRole('button', { name: t('encounter.release') }));
  expect(onChoose).toHaveBeenCalledExactlyOnceWith('release');
});

test('every held Ball has its exact engine odds and submits its own legal choice (§4.3)', async () => {
  const { state, dialog, onChoose } = encounter(withBalls);
  for (const ballType of ['poke', 'great'] as const) {
    const label = t('encounter.ballChoice', {
      ball: t(`board.ball.${ballType}`),
      percent: catchOdds(state, 0, ballType).percent,
    });
    await userEvent.click(within(dialog).getByRole('button', { name: label }));
    expect(onChoose).toHaveBeenLastCalledWith(`catch:${ballType}`);
  }
  expect(within(dialog).queryByRole('button', { name: /Ultra/ })).toBeNull();
});
