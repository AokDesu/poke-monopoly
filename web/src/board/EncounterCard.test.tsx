import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
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
import { EncounterCard } from './EncounterCard.tsx';

function encounter(input: unknown) {
  const { state } = fixtureSchema.parse(input);
  const onChoose = vi.fn();
  render(
    <EncounterCard
      observation={observe(state, 0)}
      legalActions={legalActions(state, 0)}
      catchOdds={oddsForAllBalls(state, 0)}
      onChoose={onChoose}
    />,
  );
  const card = document.querySelector<HTMLElement>('[data-card="encounter"]')!;
  return { state, onChoose, card, actions: card.querySelector<HTMLElement>('.decision-actions')! };
}

test('encounter-no-ball explains the greyed catch control; only release is clickable (§3.1)', async () => {
  const { actions, onChoose } = encounter(noBall);
  const buttons = within(actions).getAllByRole('button');
  const catchButton = within(actions).getByRole('button', { name: t('encounter.catch') });
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
  await userEvent.click(within(actions).getByRole('button', { name: t('encounter.release') }));
  expect(onChoose).toHaveBeenCalledExactlyOnceWith('release');
});

test('every held Ball has its exact engine odds, how many are left, and submits its own legal choice (§4.3)', async () => {
  const { state, actions, onChoose } = encounter(withBalls);
  for (const ballType of ['poke', 'great'] as const) {
    const ball = t(`board.ball.${ballType}`);
    const percent = catchOdds(state, 0, ballType).percent;
    const button = within(actions).getByRole('button', {
      name: t('encounter.ballChoiceLeft', {
        ball,
        percent,
        count: state.players[0]!.balls[ballType],
      }),
    });
    // What the button shows: the Ball and its chance, then how many of that Ball are left.
    expect(button.textContent).toBe(
      t('encounter.ballChoice', { ball, percent }) +
        t('encounter.ballsLeft', { count: state.players[0]!.balls[ballType] }),
    );
    await userEvent.click(button);
    expect(onChoose).toHaveBeenLastCalledWith(`catch:${ballType}`);
  }
  expect(within(actions).queryByRole('button', { name: /Ultra/ })).toBeNull();
  // The Ball not held is named once, so the player knows it was not left out by mistake.
  expect(actions.textContent).toContain(t('encounter.notHeldOne', { ball: t('board.ball.ultra') }));
});

test('the card shows the wild Pokémon by name with its facts, not a Ball emblem', () => {
  const { state, card } = encounter(withBalls);
  if (state.phase.kind !== 'encounter') throw new Error('Expected an encounter');
  expect(within(card).getByRole('heading', { level: 2 }).textContent).toMatch(/^A wild /);
  expect(within(card).getByRole('region', { name: t('encounter.facts') })).toBeTruthy();
  expect(screen.queryByRole('dialog')).toBeNull();
});
