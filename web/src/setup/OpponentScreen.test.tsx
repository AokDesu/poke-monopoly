import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { classOptions, personalityDescriptions } from '../game/content.ts';
import { PERSONALITIES, type OpponentChoice } from '../game/setup.ts';
import { t } from '../i18n/en.ts';
import { OpponentScreen } from './OpponentScreen.tsx';

const human = { classId: 'researcher', starterSpeciesId: 'porygon' };
const rival = (classId: string, starterSpeciesId: string): OpponentChoice => ({
  classId,
  starterSpeciesId,
  personality: 'greedy',
  difficulty: 'easy',
});
const only = (...ids: string[]) =>
  classOptions.map((option) => ({ ...option, playable: ids.includes(option.id) }));

function show(classes: typeof classOptions, rivals: OpponentChoice[], onChange = vi.fn()) {
  render(
    <OpponentScreen
      classes={classes}
      human={human}
      rivals={rivals}
      onChange={onChange}
      onNext={vi.fn()}
      onBack={vi.fn()}
    />,
  );
  return onChange;
}

const reasonOf = (control: HTMLElement) =>
  document.getElementById(control.getAttribute('aria-describedby')!)?.textContent;

test('a count the open classes cannot seat is greyed with its reason and changes nothing (§3, §3.1)', async () => {
  const classes = only('researcher', 'main-character', 'fisherman');
  const onChange = show(classes, [rival('main-character', 'bulbasaur')]);
  const three = screen.getByRole('radio', { name: /^3 AI rivals/ });
  expect(three).toHaveProperty('disabled', true);
  expect(reasonOf(three)).toBe(t('opponents.countClosed', { open: 3, max: 2 }));
  await userEvent.setup().click(three);
  expect(onChange).not.toHaveBeenCalled();
  expect(screen.getByRole('radio', { name: /^2 AI rivals/ })).toHaveProperty('disabled', false);
});

test('with no open class left for a rival the screen says so and cannot go on (§3.1)', () => {
  show(only('researcher'), []);
  const next = screen.getByRole('button', { name: t('opponents.next') });
  expect(next).toHaveProperty('disabled', true);
  expect(reasonOf(next)).toBe(t('opponents.noFreeClass'));
  for (const count of [1, 2, 3]) {
    const radio = screen
      .getAllByRole('radio')
      .find((entry) => entry.getAttribute('value') === String(count));
    expect(radio).toHaveProperty('disabled', true);
    expect(reasonOf(radio!)).not.toBe('');
  }
});

test('a class another rival has is greyed with that rival named (§3)', () => {
  show(classOptions, [rival('main-character', 'bulbasaur'), rival('fisherman', 'magikarp')]);
  // Editing rival 1: rival 2's class is taken, and so is the human's.
  const fisherman = screen.getByRole('radio', { name: /^Fisherman/ });
  expect(reasonOf(fisherman)).toBe(
    t('opponents.classTaken', { holder: t('board.rivalLabel', { seat: 2 }) }),
  );
  expect(screen.getByRole('radio', { name: /^Researcher/ })).toHaveProperty('disabled', true);
  expect(screen.getByRole('radio', { name: /^Bug Catcher/ })).toHaveProperty('disabled', false);
});

test('a rival that repeats the human class opens first, flagged, and blocks Review (§3)', () => {
  render(
    <OpponentScreen
      classes={classOptions}
      human={{ classId: 'fisherman', starterSpeciesId: 'magikarp' }}
      rivals={[rival('main-character', 'bulbasaur'), rival('fisherman', 'magikarp')]}
      onChange={vi.fn()}
      onNext={vi.fn()}
      onBack={vi.fn()}
    />,
  );
  expect(
    screen.getByRole('heading', { level: 2, name: t('board.rivalLabel', { seat: 2 }) }),
  ).toBeTruthy();
  const flagged = screen.getByRole('radio', {
    name: new RegExp(`^${t('board.rivalLabel', { seat: 2 })}`),
  });
  expect(flagged.closest('label')!.textContent).toContain(t('opponents.needsClass'));
  const fisherman = screen.getByRole('radio', { name: /^Fisherman/ });
  expect(fisherman).toHaveProperty('checked', true);
  expect(fisherman).toHaveProperty('disabled', true);
  const next = screen.getByRole('button', { name: t('opponents.next') });
  expect(next).toHaveProperty('disabled', true);
  expect(reasonOf(next)).toBe(
    t('opponents.fixClass', { rival: t('board.rivalLabel', { seat: 2 }) }),
  );
});

test('every personality is open, shows its content-file description and is saved on the rival (§3, §5.5)', async () => {
  const first = rival('main-character', 'bulbasaur');
  const second = rival('fisherman', 'magikarp');
  const onChange = show(classOptions, [first, second]);
  const user = userEvent.setup();
  for (const { id } of PERSONALITIES) {
    const choice = screen.getByRole('radio', { name: new RegExp(`^${t(`personality.${id}`)}`) });
    expect(choice).toHaveProperty('disabled', false);
    expect(choice.closest('label')!.textContent).toContain(personalityDescriptions[id]);
    expect(choice.hasAttribute('aria-describedby')).toBe(false);
    if (id === 'greedy') continue;
    await user.click(choice);
    expect(onChange).toHaveBeenLastCalledWith([{ ...first, personality: id }, second]);
  }
});
