import { cleanup, render, renderHook, screen, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { StrictMode } from 'react';
import { afterEach, expect, test } from 'vitest';
import { App } from './App.tsx';
import { useTableTalk } from './board/useTableTalk.ts';
import { useTurnPlayback } from './board/useTurnPlayback.ts';
import { classOptions, engineContent } from './game/content.ts';
import { META_KEY, SAVE_KEY, WATCH_SETUP_KEY, type SaveStorage } from './game/save.ts';
import { completeWatchSetup, DEFAULT_WATCH_SETTINGS } from './game/setup.ts';
import { configForWatch, createGameStore, watchOpponentSettings } from './game/store.ts';
import { t } from './i18n/en.ts';
import { className } from './i18n/names.ts';
import { HomeScreen } from './setup/HomeScreen.tsx';

afterEach(cleanup);

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
const button = (name: string) => screen.getByRole('button', { name });
const radio = (name: RegExp) => screen.getByRole('radio', { name });
const reasonOf = (control: HTMLElement) =>
  document.getElementById(control.getAttribute('aria-describedby') ?? '')?.textContent;

async function toAis(user: UserEvent) {
  await user.click(button(t('home.watch')));
  await user.click(screen.getByRole('button', { name: new RegExp(t('mode.quick')) }));
  expect(heading()).toBe(t('watchSetup.heading'));
}

/** The seat chooser: one radio per AI, labelled with its seat and class. */
const tab = (seat: number) => radio(new RegExp(`^${t('board.rivalLabel', { seat })}`));

/** The class of an AI as the seat chooser shows it. */
const classOf = (seat: number) =>
  classOptions.find((option) =>
    tab(seat).closest('label')!.textContent!.includes(className(option.id)),
  )?.id;

test('Home offers Watch AIs play beside New game and Random All, and nothing else changes (§3)', () => {
  open({ storage: memory() });
  expect(button(t('home.watch'))).toHaveProperty('disabled', false);
  expect(button(t('home.newGame'))).toHaveProperty('disabled', false);
  expect(button(t('home.randomAll'))).toHaveProperty('disabled', false);
});

test('with fewer than two open classes Watch is greyed with its reason (§3.1)', () => {
  render(
    <HomeScreen
      board={[]}
      canStart={false}
      canWatch={false}
      onNewGame={() => {}}
      onRandomAll={() => {}}
      onWatch={() => {}}
    />,
  );
  const watch = button(t('home.watch'));
  expect(watch).toHaveProperty('disabled', true);
  expect(reasonOf(watch)).toBe(t('home.watchNotEnough'));
});

test.each([2, 3, 4])(
  '%i AIs start from the flow with every seat as chosen, no human and an automatic roll (§3)',
  async (count) => {
    const store = createGameStore();
    const user = open({ store, storage: memory(), seed: 1 });
    await toAis(user);

    await user.click(radio(new RegExp(`^${count} AIs`)));
    // Make seat 0 different from the default so "as chosen" is not an accident.
    await user.click(tab(0));
    await user.click(radio(/^Researcher/));
    await user.click(radio(/^Normal/));
    // Another seat's choice is untouched by it.
    for (let seat = 1; seat < count; seat++) {
      await user.click(tab(seat));
      expect(radio(/^Easy/)).toHaveProperty('checked', true);
    }
    await user.click(button(t('watchSetup.next')));
    expect(heading()).toBe(t('watchOptions.heading'));
    await user.click(radio(/^Talk off/));
    await user.click(radio(/^Fast/));
    await user.click(button(t('watchOptions.next')));
    expect(heading()).toBe(t('watchReview.heading'));
    await user.click(button(t('watchReview.start')));

    // No human roll screen: the game is under way and the rolls are the first log entries.
    expect(screen.queryByRole('heading', { name: t('firstPlayer.heading') })).toBeNull();
    const { state, log } = store.getSession()!;
    expect(state.config.seats).toHaveLength(count);
    expect(state.config.seats.every((seat) => seat.controller === 'ai')).toBe(true);
    expect(state.config.seats[0]).toMatchObject({
      classId: 'researcher',
      starterSpeciesId: 'porygon',
    });
    expect(new Set(state.config.seats.map((seat) => seat.classId)).size).toBe(count);
    expect(store.getOpponents()[0]).toMatchObject({ seatIndex: 0, difficulty: 'normal' });
    expect(store.getWatchSettings()).toEqual({ talk: false, speed: 'fast' });
    expect(state.phase.kind).not.toBe('first_player_roll');
    expect(log.actions.slice(0, 2).map((record) => record.action.kind)).toEqual([
      'roll',
      'dice_result',
    ]);
    expect(store.getView()).toBeNull();
  },
);

test('Back and forward keep every answer, and changing one AI never changes another (§3)', async () => {
  const user = open({ storage: memory() });
  await toAis(user);
  await user.click(radio(/^3 AIs/));
  const before = [0, 1, 2].map(classOf);
  expect(new Set(before).size).toBe(3);

  // Change AI seat 1 only: a class nobody holds, and a difficulty.
  await user.click(tab(1));
  const free = classOptions.find((option) => option.playable && !before.includes(option.id))!;
  await user.click(radio(new RegExp(`^${className(free.id)}`)));
  await user.click(radio(/^Normal/));
  const after = [0, 1, 2].map(classOf);
  expect(after).toEqual([before[0], free.id, before[2]]);

  await user.click(button(t('watchSetup.next')));
  await user.click(button(t('watchOptions.next')));
  expect(heading()).toBe(t('watchReview.heading'));
  await user.click(button(t('nav.back')));
  await user.click(button(t('nav.back')));
  expect(heading()).toBe(t('watchSetup.heading'));
  expect(radio(/^3 AIs/)).toHaveProperty('checked', true);
  expect([0, 1, 2].map(classOf)).toEqual(after);
  await user.click(tab(1));
  expect(radio(/^Normal/)).toHaveProperty('checked', true);
  await user.click(tab(0));
  expect(radio(/^Easy/)).toHaveProperty('checked', true);
});

test('a class another AI has, a closed personality and a closed mode are greyed with a reason (§3.1)', async () => {
  const user = open({ storage: memory() });
  await user.click(button(t('home.watch')));
  const standard = screen.getByRole('button', { name: new RegExp(t('mode.standard')) });
  expect(standard).toHaveProperty('disabled', true);
  expect(reasonOf(standard)).toBe(t('mode.standardClosed'));
  await user.click(screen.getByRole('button', { name: new RegExp(t('mode.quick')) }));

  const holder = classOf(1)!;
  const taken = radio(new RegExp(`^${className(holder)}`));
  expect(taken).toHaveProperty('disabled', true);
  expect(reasonOf(taken)).toBe(
    t('opponents.classTaken', { holder: t('board.rivalLabel', { seat: 1 }) }),
  );
  for (const id of ['aggressive', 'cautious', 'opportunist'] as const) {
    const closed = radio(new RegExp(`^${t(`personality.${id}`)}`));
    expect(closed).toHaveProperty('disabled', true);
    expect(reasonOf(closed)).toBe(t('opponents.personalityClosed'));
  }
  // Nothing was swapped behind the player's back.
  expect(classOf(0)).not.toBe(holder);
  expect(radio(/^Greedy/)).toHaveProperty('checked', true);
});

test('Random All fills every AI, keeps the count and never repeats a class (§3)', async () => {
  let calls = 0;
  const random = () => (calls++ * 0.37 + 0.11) % 1;
  const user = open({ storage: memory(), random });
  await toAis(user);
  await user.click(radio(/^4 AIs/));
  const names = (count: number) => Array.from({ length: count }, (_, seat) => classOf(seat));
  const before = names(4);
  await user.click(button(t('watchSetup.randomAll')));
  const after = names(4);
  expect(radio(/^4 AIs/)).toHaveProperty('checked', true);
  expect(after.every((id) => id !== undefined)).toBe(true);
  expect(new Set(after).size).toBe(4);
  expect(after).not.toEqual(before);
  await user.click(button(t('watchSetup.next')));
  await user.click(button(t('watchOptions.next')));
  expect(heading()).toBe(t('watchReview.heading'));
  const text = document.body.textContent!;
  const positions = after.map((id) => text.indexOf(className(id!)));
  expect(positions.every((position) => position >= 0)).toBe(true);
  expect([...positions].sort((a, b) => a - b)).toEqual(positions);
});

test('a reload on the review screen restores every seat and setting; Back still works (§3.1)', async () => {
  const storage = memory();
  const first = open({ storage });
  await toAis(first);
  await first.click(radio(/^3 AIs/));
  await first.click(tab(2));
  await first.click(radio(/^Normal/));
  const chosen = [0, 1, 2].map(classOf);
  await first.click(button(t('watchSetup.next')));
  await first.click(radio(/^Talk off/));
  await first.click(radio(/^Instant/));
  await first.click(button(t('watchOptions.next')));
  expect(heading()).toBe(t('watchReview.heading'));
  expect(storage.data.has(WATCH_SETUP_KEY)).toBe(true);
  cleanup();

  const store = createGameStore();
  const second = open({ storage, store, seed: 1 });
  expect(heading()).toBe(t('watchReview.heading'));
  const text = document.body.textContent!;
  const positions = chosen.map((id) => text.indexOf(className(id!)));
  expect(positions.every((position) => position >= 0)).toBe(true);
  expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  expect(text).toContain(`${t('watchReview.talk')}: ${t('watchReview.off')}`);
  expect(text).toContain(`${t('watchReview.speed')}: ${t('ai.speed.instant')}`);
  expect(within(document.body).getAllByText(new RegExp(t('difficulty.normal'))).length).toBe(1);

  await second.click(button(t('nav.back')));
  await second.click(button(t('nav.back')));
  expect(radio(/^3 AIs/)).toHaveProperty('checked', true);
  expect([0, 1, 2].map(classOf)).toEqual(chosen);

  // Starting uses exactly the restored answers, and the unfinished setup is forgotten.
  await second.click(button(t('watchSetup.next')));
  await second.click(button(t('watchOptions.next')));
  await second.click(button(t('watchReview.start')));
  expect(store.getSession()!.state.config.seats.map((seat) => seat.classId)).toEqual(chosen);
  expect(store.getWatchSettings()).toEqual({ talk: false, speed: 'instant' });
  expect(storage.data.has(WATCH_SETUP_KEY)).toBe(false);
});

test('leaving the watch setup for Home forgets it, and a reload then opens Home (§3.1)', async () => {
  const storage = memory();
  const user = open({ storage });
  await toAis(user);
  expect(storage.data.has(WATCH_SETUP_KEY)).toBe(true);
  await user.click(button(t('nav.back')));
  await user.click(button(t('nav.back')));
  expect(storage.data.has(WATCH_SETUP_KEY)).toBe(false);
  cleanup();
  open({ storage });
  expect(button(t('home.watch'))).toBeTruthy();
});

test('a saved watch setup that no longer fits is dropped and the flow opens on the step that still needs an answer', () => {
  const storage = memory();
  storage.setItem(
    WATCH_SETUP_KEY,
    JSON.stringify({
      step: 'review',
      mode: 'quick',
      ais: [
        {
          classId: 'fisherman',
          starterSpeciesId: 'magikarp',
          personality: 'cautious',
          difficulty: 'easy',
        },
        {
          classId: 'researcher',
          starterSpeciesId: 'porygon',
          personality: 'greedy',
          difficulty: 'easy',
        },
      ],
      talk: true,
      speed: 'normal',
    }),
  );
  open({ storage });
  expect(heading()).toBe(t('watchSetup.heading'));
  expect(radio(/^2 AIs/)).toHaveProperty('checked', true);
});

test('a saved game waiting on Home wins over a stale watch setup (§3.1)', async () => {
  const storage = memory();
  const store = createGameStore();
  const user = open({ storage, store, seed: 1 });
  await toAis(user);
  await user.click(button(t('watchSetup.next')));
  await user.click(button(t('watchOptions.next')));
  await user.click(button(t('watchReview.start')));
  expect(storage.data.has(SAVE_KEY)).toBe(true);
  cleanup();
  storage.setItem(
    WATCH_SETUP_KEY,
    JSON.stringify({ step: 'review', mode: 'quick', ais: [], talk: true, speed: 'normal' }),
  );

  open({ storage, store: createGameStore() });
  expect(heading()).toBe(t('save.continueHeading'));
  expect(storage.data.has(WATCH_SETUP_KEY)).toBe(false);
});

test('the saved game resumes as a watched game with the same seats and settings (§3.1)', async () => {
  const storage = memory();
  const first = createGameStore();
  const user = open({ storage, store: first, seed: 3 });
  await toAis(user);
  await user.click(radio(/^3 AIs/));
  await user.click(tab(1));
  await user.click(radio(/^Normal/));
  await user.click(button(t('watchSetup.next')));
  await user.click(radio(/^Talk off/));
  await user.click(radio(/^Instant/));
  await user.click(button(t('watchOptions.next')));
  await user.click(button(t('watchReview.start')));
  const seats = first
    .getSession()!
    .state.config.seats.map((seat) => [seat.seatIndex, seat.classId]);
  const opponents = first.getOpponents();
  expect(JSON.parse(storage.data.get(META_KEY)!)).toMatchObject({
    watch: { talk: false, speed: 'instant' },
  });
  cleanup();

  const second = createGameStore();
  const again = open({ storage, store: second });
  expect(heading()).toBe(t('save.continueHeading'));
  await again.click(button(t('save.continue')));
  expect(screen.queryByRole('heading', { name: t('firstPlayer.heading') })).toBeNull();
  const resumed = second.getSession()!.state;
  expect(resumed.config.seats.map((seat) => [seat.seatIndex, seat.classId])).toEqual(seats);
  expect(resumed.config.seats.every((seat) => seat.controller === 'ai')).toBe(true);
  expect(second.getOpponents()).toEqual(opponents);
  expect(second.getWatchSettings()).toEqual({ talk: false, speed: 'instant' });
  expect(second.getView()).toBeNull();
  expect(second.getSpectatorView()).not.toBeNull();
});

test('a normal New game still ends setup on its own first-player roll screen (§3)', async () => {
  const user = open({ storage: memory(), seed: 1 });
  await user.click(button(t('home.newGame')));
  await user.click(screen.getByRole('button', { name: new RegExp(t('mode.quick')) }));
  await user.click(radio(/^Researcher/));
  await user.click(button(t('nav.next')));
  await user.click(button(t('opponents.next')));
  await user.click(button(t('review.roll')));
  expect(heading()).toBe(t('firstPlayer.heading'));
});

function watched(settings: { talk: boolean; speed: 'normal' | 'fast' | 'instant' }) {
  const setup = completeWatchSetup(
    {
      mode: 'quick',
      ais: ['fisherman', 'researcher'].map((classId) => ({
        classId,
        starterSpeciesId: classOptions.find((option) => option.id === classId)!
          .starterSpeciesIds[0]!,
        personality: 'greedy' as const,
        difficulty: 'easy' as const,
      })),
      settings,
    },
    classOptions,
  )!;
  const store = createGameStore();
  store.start(
    configForWatch(setup, 4),
    engineContent,
    watchOpponentSettings(setup),
    setup.settings,
  );
  return store;
}

test('a watched game starts at its chosen speed and asks for no table talk when talk is off (§3, §5.7)', () => {
  const quiet = watched({ talk: false, speed: 'fast' });
  const playback = renderHook(() => useTurnPlayback(quiet, quiet.getSpectatorView())).result
    .current;
  expect(playback.speed).toBe('fast');
  const talkOff = renderHook(() =>
    useTableTalk(quiet, quiet.getSpectatorView(), { speed: 'normal', paused: false, status: null }),
  ).result.current;
  expect(talkOff.enabled).toBe(false);

  const chatty = watched({ ...DEFAULT_WATCH_SETTINGS });
  expect(
    renderHook(() => useTurnPlayback(chatty, chatty.getSpectatorView())).result.current.speed,
  ).toBe('normal');
  expect(
    renderHook(() =>
      useTableTalk(chatty, chatty.getSpectatorView(), {
        speed: 'normal',
        paused: false,
        status: null,
      }),
    ).result.current.enabled,
  ).toBe(true);
});

test('a game with a human seat keeps Normal speed and table talk on (§5.7)', () => {
  const store = createGameStore();
  const hook = renderHook(() => useTurnPlayback(store, store.getSpectatorView()));
  expect(hook.result.current.speed).toBe('normal');
  expect(
    renderHook(() =>
      useTableTalk(store, store.getSpectatorView(), {
        speed: 'normal',
        paused: false,
        status: null,
      }),
    ).result.current.enabled,
  ).toBe(true);
});
