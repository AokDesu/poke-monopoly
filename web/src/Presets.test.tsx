import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { expect, test, vi } from 'vitest';
import { App } from './App.tsx';
import { classOptions } from './game/content.ts';
import { SETUP_PRESETS } from './game/presets.ts';
import { PERSONALITIES } from './game/setup.ts';
import { META_KEY, SAVE_KEY, type SaveStorage } from './game/save.ts';
import { createGameStore } from './game/store.ts';
import { t } from './i18n/en.ts';
import { className } from './i18n/names.ts';
import { PresetScreen } from './setup/PresetScreen.tsx';

// Named per-test budgets (ET-05): these take 2 to 8 s at full parallelism, so the 5 s default is too tight on a loaded machine.
const SLOW_TEST_MS = 30_000;

const heading = () => screen.getByRole('heading', { level: 1 });
const button = (name: string | RegExp) => screen.getByRole('button', { name });
const radio = (name: RegExp) => screen.getByRole('radio', { name });
const seats = () =>
  [
    ...screen
      .getByRole('heading', { name: t('review.seats') })
      .nextElementSibling!.querySelectorAll('li'),
  ].map((item) => item.textContent);

function memory(): SaveStorage {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

function open(props: Parameters<typeof App>[0] = {}) {
  const user = userEvent.setup();
  render(
    <StrictMode>
      <App {...props} />
    </StrictMode>,
  );
  return user;
}

const presetButton = (id: (typeof SETUP_PRESETS)[number]['id']) =>
  button(new RegExp(`^${t(`preset.${id}.name`)}`));

test('Home offers the presets and Random All and New game stay reachable without one (§3, #157)', async () => {
  const user = open({ seed: 1 });
  expect(button(t('home.randomAll'))).toHaveProperty('disabled', false);
  expect(button(t('home.newGame'))).toHaveProperty('disabled', false);
  await user.click(button(t('home.presets')));
  expect(heading().textContent).toBe(t('presets.heading'));
  for (const preset of SETUP_PRESETS) {
    expect(presetButton(preset.id), preset.id).toHaveProperty('disabled', false);
  }
  // Random All keeps its one entry, on Home.
  expect(screen.queryByRole('button', { name: new RegExp(t('home.randomAll')) })).toBeNull();
  await user.click(button(t('nav.back')));
  expect(heading().textContent).toBe(t('home.heading'));
});

test(
  'a preset fills every seat, the review shows each exact choice, and one edit changes no other seat (§3, #157)',
  async () => {
    const user = open({ seed: 1 });
    await user.click(button(t('home.presets')));
    await user.click(presetButton('two-rivals-normal'));

    expect(heading().textContent).toBe(t('review.heading'));
    expect(seats()).toEqual([
      expect.stringMatching(/^You.*Researcher.*Porygon/),
      expect.stringMatching(/^AI rival · seat 1.*Main Character.*Charmander.*Greedy.*Normal/),
      expect.stringMatching(/^AI rival · seat 2.*Bug Catcher.*Caterpie.*Greedy.*Normal/),
    ]);

    // Back reaches the per-seat editor with the preset's choices already in it.
    await user.click(button(t('nav.back')));
    expect(heading().textContent).toBe(t('opponents.heading'));
    await user.click(radio(/^AI rival · seat 2/));
    await user.click(radio(new RegExp(`^${t('difficulty.easy')}`)));
    await user.click(button(t('opponents.next')));
    expect(seats()).toEqual([
      expect.stringMatching(/^You.*Researcher.*Porygon/),
      expect.stringMatching(/^AI rival · seat 1.*Main Character.*Charmander.*Greedy.*Normal/),
      expect.stringMatching(/^AI rival · seat 2.*Bug Catcher.*Caterpie.*Greedy.*Easy/),
    ]);

    // The player's own class is editable too, and it does not touch a rival.
    await user.click(button(t('nav.back')));
    await user.click(button(t('nav.back')));
    await user.click(radio(/^Nurse Joy/));
    await user.click(button(t('nav.next')));
    await user.click(button(t('opponents.next')));
    expect(seats()[0]).toMatch(/^You.*Nurse Joy/);
    expect(seats().slice(1)).toEqual([
      expect.stringMatching(/Main Character.*Normal/),
      expect.stringMatching(/Bug Catcher.*Easy/),
    ]);
  },
  SLOW_TEST_MS,
);

test('Three rivals, random fills three seats with four different classes before the roll', async () => {
  const user = open({ seed: 1, random: () => 0.5 });
  await user.click(button(t('home.presets')));
  await user.click(presetButton('three-rivals-random'));
  expect(heading().textContent).toBe(t('review.heading'));
  const rows = seats();
  expect(rows).toHaveLength(4);
  const names = rows.map((text) =>
    classOptions.find((option) => text!.includes(className(option.id)))!,
  );
  expect(names.every(Boolean)).toBe(true);
  expect(new Set(names.map((option) => option.id)).size).toBe(4);
  expect(
    rows
      .slice(1)
      .every((text) => PERSONALITIES.some((entry) => text!.includes(t(`personality.${entry.id}`)))),
  ).toBe(true);
});

test('a game started from a preset saves and resumes like any other (§6.7, #157)', async () => {
  const box = memory();
  const store = createGameStore();
  const user = open({ store, storage: box, seed: 1 });
  await user.click(button(t('home.presets')));
  await user.click(presetButton('one-rival-easy'));
  await user.click(button(t('review.roll')));
  expect(heading().textContent).toBe(t('firstPlayer.heading'));
  expect(box.getItem(SAVE_KEY)).toBeTruthy();
  expect(JSON.parse(box.getItem(META_KEY)!).opponents).toEqual([
    { seatIndex: 1, personality: 'greedy', difficulty: 'easy' },
  ]);
  const before = store.getSession()!.state.config.seats.map((seat) => seat.classId);
  expect(before).toEqual(['main-character', 'fisherman']);
  cleanup();

  const next = createGameStore();
  render(<App store={next} storage={box} />);
  expect(heading().textContent).toBe(t('save.continueHeading'));
  const list = screen.getByRole('heading', { name: t('save.rivals') }).closest('section')!;
  expect(list.textContent).toContain('Fisherman, Greedy, Easy');
  fireEvent.click(button(t('save.continue')));
  expect(next.getSession()!.state.config.seats.map((seat) => seat.classId)).toEqual(before);
  expect(next.getOpponents()).toEqual([
    { seatIndex: 1, personality: 'greedy', difficulty: 'easy' },
  ]);
});

test('a preset that is no longer legal is greyed with its reason and applies nothing (§3.1, #157)', async () => {
  const user = userEvent.setup();
  const onApply = vi.fn();
  const classes = classOptions.map((option) =>
    option.id === 'fisherman' ? { ...option, playable: false } : option,
  );
  render(
    <PresetScreen classes={classes} openModes={['quick']} onApply={onApply} onBack={() => {}} />,
  );
  const off = presetButton('one-rival-easy');
  expect(off).toHaveProperty('disabled', true);
  const reason = document.getElementById(off.getAttribute('aria-describedby')!)!.textContent!;
  expect(reason).toContain('Fisherman');
  expect(reason).toContain(t('presets.problem.byHand'));
  await user.click(off);
  expect(onApply).not.toHaveBeenCalled();
  // The presets that still fit stay usable, and every greyed control has visible text.
  await user.click(presetButton('two-rivals-normal'));
  expect(onApply).toHaveBeenCalledTimes(1);
  expect(onApply.mock.calls[0]![0]).toMatchObject({ id: 'two-rivals-normal' });
  for (const control of document.querySelectorAll<HTMLButtonElement>('button:disabled')) {
    const text = control
      .getAttribute('aria-describedby')!
      .split(' ')
      .map((id) => document.getElementById(id)?.textContent ?? '')
      .join('');
    expect(text.trim()).not.toBe('');
  }
});

test('with every class closed no preset is offered as usable and the screen still explains itself', () => {
  const classes = classOptions.map((option) => ({ ...option, playable: false }));
  render(
    <PresetScreen classes={classes} openModes={['quick']} onApply={() => {}} onBack={() => {}} />,
  );
  const list = within(screen.getByRole('list'));
  for (const control of list.getAllByRole('button')) {
    expect(control).toHaveProperty('disabled', true);
  }
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(t('presets.heading'));
});

const reasonOf = (id: (typeof SETUP_PRESETS)[number]['id']) =>
  document.getElementById(presetButton(id).getAttribute('aria-describedby')!)!.textContent!;

test('a closed personality or difficulty is named by its label, not its id (§3.1, #157)', () => {
  const some = {
    personalities: PERSONALITIES.map((entry) => ({ ...entry, enabled: entry.id !== 'greedy' })),
    difficulties: ['normal'],
  };
  render(
    <PresetScreen
      classes={classOptions}
      openModes={['quick']}
      choices={some}
      onApply={() => {}}
      onBack={() => {}}
    />,
  );
  expect(reasonOf('one-rival-easy')).toContain(
    t('presets.problem.personality', { personality: 'Greedy' }),
  );
  expect(reasonOf('one-rival-easy')).not.toContain('greedy');
  expect(presetButton('three-rivals-random')).toHaveProperty('disabled', false);
  cleanup();

  render(
    <PresetScreen
      classes={classOptions}
      openModes={['quick']}
      choices={{ ...some, personalities: PERSONALITIES }}
      onApply={() => {}}
      onBack={() => {}}
    />,
  );
  expect(reasonOf('one-rival-easy')).toContain(
    t('presets.problem.difficulty', { difficulty: 'Easy' }),
  );
});

test('a random preset with no open personality is greyed with its reason (§3.1, #157)', () => {
  render(
    <PresetScreen
      classes={classOptions}
      openModes={['quick']}
      choices={{
        personalities: PERSONALITIES.map((entry) => ({ ...entry, enabled: false })),
        difficulties: ['easy', 'normal'],
      }}
      onApply={() => {}}
      onBack={() => {}}
    />,
  );
  expect(presetButton('three-rivals-random')).toHaveProperty('disabled', true);
  expect(reasonOf('three-rivals-random')).toContain(t('presets.problem.noPersonality'));
});

test('the seat shortage reads 1 class and 2 classes, and never "1 AI rivals" (#157)', () => {
  const only = (count: number) =>
    classOptions.map((option, index) => ({ ...option, playable: index < count }));
  for (const [count, words] of [
    [1, 'only 1 class is open'],
    [2, 'only 2 classes are open'],
    [0, 'no class is open'],
  ] as const) {
    render(
      <PresetScreen
        classes={only(count)}
        openModes={['quick']}
        onApply={() => {}}
        onBack={() => {}}
      />,
    );
    const reason = reasonOf('three-rivals-random');
    expect(reason, `${count}`).toContain(`3 AI rivals, but ${words}`);
    expect(reason).not.toMatch(/\b1 AI rivals/);
    cleanup();
  }
});
