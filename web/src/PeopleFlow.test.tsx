import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { StrictMode } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { App } from './App.tsx';
import { classOptions } from './game/content.ts';
import { META_KEY, SAVE_KEY, type SaveStorage } from './game/save.ts';
import { MODES } from './game/store.ts';
import { t } from './i18n/en.ts';
import { className } from './i18n/names.ts';

/** Spec §3 (local multiplayer setup and the pass screen), issue #258. */

beforeEach(() => {
  vi.stubGlobal('fetch', async () => {
    throw new Error('offline');
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function memory(): SaveStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

function open(props: Parameters<typeof App>[0]) {
  const user = userEvent.setup();
  render(
    <StrictMode>
      <App {...props} />
    </StrictMode>,
  );
  return user;
}

const heading = () => screen.getByRole('heading', { level: 1 }).textContent;
const button = (name: string | RegExp) => screen.getByRole('button', { name });
const footer = () => screen.getByTestId('people-footer').textContent;
const laps = MODES.quick.lapTarget;
const reasonOf = (control: HTMLElement) =>
  document.getElementById(control.getAttribute('aria-describedby') ?? '')?.textContent;
const playable = classOptions.filter((option) => option.playable);

async function toSeats(user: UserEvent) {
  await user.click(button(t('home.people')));
  expect(heading()).toBe(t('mode.heading'));
  await user.click(screen.getByRole('button', { name: new RegExp(t('mode.quick')) }));
  expect(heading()).toBe(t('people.heading'));
}

async function rename(user: UserEvent, seat: number, name: string) {
  const field = screen.getByLabelText(t('people.name', { n: seat }));
  await user.clear(field);
  await user.type(field, name);
}

async function pickClass(user: UserEvent, id: string) {
  await user.click(screen.getByRole('radio', { name: new RegExp(`^${className(id)}`) }));
}

test('Home offers Play with people beside the other ways in (§3)', () => {
  open({ storage: memory() });
  expect(button(t('home.people'))).toHaveProperty('disabled', false);
  expect(button(t('home.newGame'))).toHaveProperty('disabled', false);
});

test('seat rows switch between Person and AI, the footer counts them and the rule is stated (§3)', async () => {
  const user = open({ storage: memory() });
  await toSeats(user);
  expect(footer()).toBe(
    t('people.footer', {
      people: t('people.countPeople', { n: 2 }),
      ais: t('people.countAis', { n: 0 }),
      mode: t('mode.quick'),
      laps,
    }),
  );
  expect(screen.getByText(t('people.rule'))).toBeTruthy();
  expect(
    screen.getByText('Chat and promises are with AIs only. People talk at the table.'),
  ).toBeTruthy();

  await user.click(button(t('people.addSeat')));
  await user.click(button(t('people.addSeat')));
  expect(footer()).toBe(
    t('people.footer', {
      people: t('people.countPeople', { n: 2 }),
      ais: t('people.countAis', { n: 2 }),
      mode: t('mode.quick'),
      laps,
    }),
  );
  // Four seats is the most: the button is greyed with its reason.
  expect(button(t('people.addSeat'))).toHaveProperty('disabled', true);
  expect(reasonOf(button(t('people.addSeat')))).toBe(t('people.addSeatClosed'));

  // An AI row keeps its class, personality and difficulty as chips, and Change sets them.
  const row = screen
    .getByTestId('people-footer')
    .closest('section')!
    .querySelector('[data-seat-row="2"]')! as HTMLElement;
  expect(within(row).getByText(t('personality.greedy'))).toBeTruthy();
  await user.click(within(row).getByRole('button', { name: t('people.changeFor', { n: 2 }) }));
  await user.click(
    within(row).getByRole('radio', { name: new RegExp(`^${t('personality.aggressive')}`) }),
  );
  await user.click(within(row).getByRole('button', { name: t('people.changeFor', { n: 2 }) }));
  expect(within(row).getByText(t('personality.aggressive'))).toBeTruthy();
});

test('the switch works from the keyboard, and one person is told to use New game instead (§3, keyboard)', async () => {
  const user = open({ storage: memory() });
  await toSeats(user);
  const person = screen.getAllByRole('radio', { name: t('people.person') })[1]!;
  person.focus();
  await user.keyboard('{ArrowRight}');
  expect(footer()).toContain(t('people.countAi', { n: 1 }));
  expect(button(t('people.next'))).toHaveProperty('disabled', true);
  expect(reasonOf(button(t('people.next')))).toBe(t('people.needPeople'));
});

test('names must be present and different, with the reason shown (§3.1)', async () => {
  const user = open({ storage: memory() });
  await toSeats(user);
  await rename(user, 1, '   ');
  expect(reasonOf(button(t('people.next')))).toBe(t('people.nameEmpty', { n: 1 }));
  await rename(user, 1, 'Ton');
  await rename(user, 0, 'ton');
  expect(reasonOf(button(t('people.next')))).toBe(t('people.nameTaken', { n: 1 }));
  await rename(user, 0, 'Ton ');
  await rename(user, 1, 'Mai');
  expect(button(t('people.next'))).toHaveProperty('disabled', false);
});

test('two people and two AIs: setup, classes one person at a time, the review, and the first pass screen (§3, §4.1)', async () => {
  const storage = memory();
  const user = open({ seed: 1, storage });
  await toSeats(user);
  await user.click(button(t('people.addSeat')));
  await user.click(button(t('people.addSeat')));
  await rename(user, 0, 'Ton');
  await rename(user, 1, 'Mai');
  await user.click(button(t('people.next')));

  // Ton chooses first; Next waits for a class.
  expect(heading()).toBe(t('people.classHeading', { name: 'Ton' }));
  expect(button(t('nav.next'))).toHaveProperty('disabled', true);
  // The two AIs took the first two open classes; a person cannot choose one of those.
  const [heldA, heldB, tonClass, maiClass] = playable.map((option) => option.id);
  const held = screen.getByRole('radio', { name: new RegExp(`^${className(heldA!)}`) });
  expect(held).toHaveProperty('disabled', true);
  expect(reasonOf(held)).toBe(t('opponents.classTaken', { holder: 'AI rival · seat 2' }));
  expect(heldB).toBeTruthy();
  await pickClass(user, tonClass!);
  await user.click(button(t('nav.next')));

  expect(heading()).toBe(t('people.classHeading', { name: 'Mai' }));
  // Ton's class is Ton's: greyed for Mai with Ton named.
  const taken = screen.getByRole('radio', { name: new RegExp(`^${className(tonClass!)}`) });
  expect(taken).toHaveProperty('disabled', true);
  expect(reasonOf(taken)).toBe(t('opponents.classTaken', { holder: 'Ton' }));
  await pickClass(user, maiClass!);
  expect(button(t('people.classLast'))).toBeTruthy();
  await user.click(button(t('people.classLast')));

  expect(heading()).toBe(t('peopleReview.heading'));
  await user.click(button(t('peopleReview.roll')));
  expect(heading()).toBe(t('firstPlayer.heading'));
  await user.click(button(t('firstPlayer.toBoard')));

  // The board is hidden until the first person takes the device: nothing private, one button.
  const pass = document.querySelector<HTMLElement>('[data-pass-seat]')!;
  expect(pass).toBeTruthy();
  expect(screen.queryByRole('region', { name: t('hand.label') })).toBeNull();
  const first = within(pass).getByRole('heading', { level: 1 }).textContent!;
  expect(first).toMatch(/^Pass to (Ton|Mai)/);
  const name = first.includes('Ton') ? 'Ton' : 'Mai';
  await user.click(within(pass).getByRole('button', { name: t('pass.button', { name }) }));
  expect(document.querySelector('[data-pass-seat]')).toBeNull();
  expect(screen.getByRole('region', { name: t('hand.label') })).toBeTruthy();

  // The game is saved with the people's names, never in the engine log.
  const meta = JSON.parse(storage.data.get(META_KEY)!);
  expect(meta.people).toEqual([
    { seatIndex: 0, name: 'Ton' },
    { seatIndex: 1, name: 'Mai' },
  ]);
  expect(storage.data.get(SAVE_KEY)).not.toContain('Ton');
});

test('a saved table of people resumes on the right person’s pass screen (§3.1, §6.9)', async () => {
  const storage = memory();
  const first = open({ seed: 1, storage });
  await toSeats(first);
  await rename(first, 0, 'Ton');
  await rename(first, 1, 'Mai');
  await first.click(button(t('people.next')));
  await pickClass(first, playable[0]!.id);
  await first.click(button(t('nav.next')));
  await pickClass(first, playable[1]!.id);
  await first.click(button(t('people.classLast')));
  await first.click(button(t('peopleReview.roll')));
  await first.click(button(t('firstPlayer.toBoard')));
  const heading1 = within(document.querySelector<HTMLElement>('[data-pass-seat]')!).getByRole(
    'heading',
    { level: 1 },
  ).textContent;
  cleanup();

  // A reload: the save is offered with the people named, and Continue goes to the same person's pass screen.
  const second = open({ seed: 1, storage });
  expect(screen.getByText(t('save.people'))).toBeTruthy();
  expect(
    screen.getByText(t('save.personRow', { name: 'Ton', class: className(playable[0]!.id) })),
  ).toBeTruthy();
  await second.click(button(t('save.continue')));
  const pass = document.querySelector<HTMLElement>('[data-pass-seat]')!;
  expect(within(pass).getByRole('heading', { level: 1 }).textContent).toBe(heading1);
  expect(screen.queryByRole('region', { name: t('hand.label') })).toBeNull();
});
