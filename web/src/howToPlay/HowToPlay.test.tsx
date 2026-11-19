import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode, type ReactElement } from 'react';
import { afterEach, beforeAll, expect, test, vi } from 'vitest';
import encounterNoBall from '../../../engine/fixtures/encounter-no-ball.json';
import sellPhaseThree from '../../../engine/fixtures/sell-phase-three-pokemon.json';
import shopLowCoins from '../../../engine/fixtures/shop-low-coins.json';
import shopNoCoins from '../../../engine/fixtures/shop-no-coins.json';
import { stateHash } from '../../../engine/index.ts';
import { App } from '../App.tsx';
import { BoardScreen } from '../board/BoardScreen.tsx';
import { STEP_MS } from '../board/useTurnPlayback.ts';
import { createScenes, type Scene } from '../gallery/scenes.ts';
import { META_KEY, SAVE_KEY, writeSave, type SaveStorage } from '../game/save.ts';
import { content } from '../game/content.ts';
import { createGameStore } from '../game/store.ts';
import { t } from '../i18n/en.ts';
import { Root } from '../Root.tsx';
import { fakeServer, watchStore } from '../test/watchGame.ts';
import { HowToPlayButton, HowToPlayProvider } from './HowToPlay.tsx';
import { buildSteps } from './steps.ts';

beforeAll(() => {
  // jsdom has no modal dialogs; these keep the open state a real browser would.
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  // Like a browser, closing fires `close` a moment later.
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
    queueMicrotask(() => this.dispatchEvent(new Event('close')));
  };
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** The app runs in StrictMode, which mounts every effect twice. */
const renderStrict = (ui: ReactElement) => render(<StrictMode>{ui}</StrictMode>);
const opener = () => screen.getByRole('button', { name: t('howToPlay.open') });
const guide = () => screen.getByRole('dialog', { name: t('howToPlay.heading') });
const noGuide = () =>
  expect(screen.queryByRole('dialog', { name: t('howToPlay.heading') })).toBeNull();

interface MemoryStorage extends SaveStorage {
  data: Map<string, string>;
}

function memoryStorage(): MemoryStorage {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

test('it is never open on its own: Home, demo mode, a seed and a participant code all start closed', () => {
  for (const search of ['', '?demo', '?seed=3', '?code=ABC123&demo&seed=3', '?participant=P07']) {
    renderStrict(<Root search={search} dev={false} />);
    expect(document.querySelector('dialog'), search).toBeNull();
    expect(opener()).toBeTruthy();
    document.body.innerHTML = '';
  }
});

test('Home opens the walkthrough with the first step, and Close returns focus to the opener', async () => {
  const user = userEvent.setup();
  renderStrict(<Root search="" dev={false} />);
  const home = opener();
  await user.click(home);
  // Still open after the effects ran twice and every late event arrived.
  await act(async () => {});
  const dialog = guide();
  const first = buildSteps()[0]!;
  expect(within(dialog).getByRole('heading', { level: 3, name: first.title })).toBeTruthy();
  expect(
    within(dialog).getByText(t('howToPlay.progress', { current: 1, total: buildSteps().length })),
  ).toBeTruthy();
  // The game's own words, not a copy: Home still shows its heading behind the modal.
  expect(document.activeElement).toBe(within(dialog).getByRole('heading', { level: 2 }));
  await user.click(within(dialog).getByRole('button', { name: t('howToPlay.close') }));
  noGuide();
  expect(document.activeElement).toBe(home);
});

test('Escape (the dialog’s cancel) closes it the way a browser closes a modal, and focus goes back to the opener', async () => {
  const user = userEvent.setup();
  renderStrict(<Root search="" dev={false} />);
  await user.click(opener());
  // A browser fires `cancel` on the dialog for Escape; jsdom has no key handling for it.
  fireEvent(guide(), new Event('cancel', { cancelable: true }));
  await act(async () => {});
  noGuide();
  expect(document.activeElement).toBe(opener());
});

test('every step is reachable by keyboard alone, and a greyed button says why', async () => {
  const user = userEvent.setup();
  renderStrict(<Root search="" dev={false} />);
  opener().focus();
  await user.keyboard('{Enter}');
  const dialog = guide();
  const steps = buildSteps();
  // Back is greyed out on the first step with its reason on screen.
  const back = within(dialog).getByRole('button', { name: t('nav.back') });
  expect(back.hasAttribute('disabled')).toBe(true);
  expect(document.getElementById(back.getAttribute('aria-describedby')!)!.textContent).toBe(
    t('howToPlay.firstStep'),
  );
  for (const [index, step] of steps.entries()) {
    expect(within(dialog).getByRole('heading', { level: 3 }).textContent).toBe(step.title);
    if (index === steps.length - 1) break;
    // From the heading one Tab reaches Next (Back is greyed out); then Enter alone walks on.
    if (index === 0) await user.tab();
    expect(document.activeElement).toBe(
      within(dialog).getByRole('button', { name: t('nav.next') }),
    );
    await user.keyboard('{Enter}');
  }
  // On the last step Next is greyed out with its reason, and focus is not lost.
  const next = within(dialog).getByRole('button', { name: t('nav.next') });
  expect(next.hasAttribute('disabled')).toBe(true);
  expect(document.getElementById(next.getAttribute('aria-describedby')!)!.textContent).toBe(
    t('howToPlay.lastStep'),
  );
  expect(document.activeElement).toBe(
    within(dialog).getByRole('button', { name: t('howToPlay.close') }),
  );
  await user.keyboard('{Enter}');
  noGuide();
  expect(document.activeElement).toBe(opener());
  // Back goes the other way, one step at a time.
  await user.keyboard('{Enter}');
  const reopened = guide();
  expect(within(reopened).getByRole('heading', { level: 3 }).textContent).toBe(steps[0]!.title);
});

test('the numbers on screen follow the content: a changed config shows its new values', async () => {
  const user = userEvent.setup();
  const kit = content.config.startingKit;
  const before = { ...kit };
  const income = content.config.startIncome;
  kit.coins = 47;
  kit.pokeBalls = 9;
  content.config.startIncome = 8;
  try {
    renderStrict(<Root search="" dev={false} />);
    await user.click(opener());
    const dialog = guide();
    const fact = (id: string) => dialog.querySelector(`[data-fact="${id}"] strong`)?.textContent;
    expect(fact('coins')).toBe('47');
    expect(fact('balls')).toBe('9');
    await user.click(within(dialog).getByRole('button', { name: t('nav.next') }));
    await user.click(within(dialog).getByRole('button', { name: t('nav.next') }));
    expect(fact('income')).toBe('8');
  } finally {
    Object.assign(kit, before);
    content.config.startIncome = income;
  }
});

const scenes = () =>
  createScenes({
    'encounter-no-ball': encounterNoBall,
    'sell-phase-three-pokemon': sellPhaseThree,
    'shop-low-coins': shopLowCoins,
    'shop-no-coins': shopNoCoins,
  });

/** A saved human game, opened through Continue the way a returning player reaches the board. */
async function openSavedGame(storage: MemoryStorage, scene: Scene) {
  writeSave(storage, scene.store.getSession()!, { opponents: scene.store.getOpponents() });
  const store = createGameStore();
  renderStrict(<App store={store} storage={storage} />);
  await userEvent.click(screen.getByRole('button', { name: t('save.continue') }));
  return store;
}

test('at a Sell Phase it opens from the Sell dialog and from the board, and a game stays exactly as it was', async () => {
  const user = userEvent.setup();
  const storage = memoryStorage();
  const store = await openSavedGame(storage, scenes().sellPhaseFullTeam());
  expect(store.getView()!.observation.public.phase.kind).toBe('sell');
  // Opening a saved game shows no walkthrough, even in a session that carries a participant code.
  noGuide();

  const snapshot = () => ({
    hash: stateHash(store.getSession()!.state),
    actions: store.getSession()!.log.actions.length,
    revision: store.getView()!.observation.public.stateRevision,
    legal: store.getView()!.legalActions.enabled.map((entry) => entry.id),
    save: [storage.data.get(SAVE_KEY), storage.data.get(META_KEY)],
  });
  const before = snapshot();
  const sell = screen.getByRole('dialog', { name: t('turn.sellHeading') });

  // The page behind a Sell dialog is inert, so the walkthrough opens from inside that dialog.
  const from = within(sell).getByRole('button', { name: t('howToPlay.open') });
  await user.click(from);
  const dialog = guide();
  for (let step = 1; step < buildSteps().length; step++) {
    await user.click(within(dialog).getByRole('button', { name: t('nav.next') }));
  }
  await user.click(within(dialog).getByRole('button', { name: t('howToPlay.close') }));
  noGuide();
  expect(document.activeElement).toBe(from);
  expect(snapshot()).toEqual(before);
  // The same decision is still pending and still answerable.
  expect(
    within(sell)
      .getByRole('button', { name: t('sell.keep') })
      .hasAttribute('disabled'),
  ).toBe(false);
});

test('the board offers it in its header at a Shop decision, and closing changes nothing', async () => {
  const user = userEvent.setup();
  const storage = memoryStorage();
  const store = await openSavedGame(storage, scenes().shopNothingAffordable());
  expect(store.getView()!.observation.public.phase.kind).toBe('shop');
  const hash = stateHash(store.getSession()!.state);
  const saved = [...storage.data];
  // The app header is the first banner; the board has headers of its own below it.
  const header = screen.getAllByRole('banner')[0]!;
  const from = within(header).getByRole('button', { name: t('howToPlay.open') });
  await user.click(from);
  expect(within(guide()).getByText(t('howToPlay.gameWaits'))).toBeTruthy();
  await user.click(within(guide()).getByRole('button', { name: t('howToPlay.close') }));
  expect(document.activeElement).toBe(from);
  expect(stateHash(store.getSession()!.state)).toBe(hash);
  expect([...storage.data]).toEqual(saved);
});

test('a watched game is never opened by it, and while it is open the game waits where it stands', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: false });
  fakeServer();
  const store = watchStore(2);
  renderStrict(
    <HowToPlayProvider gameWaits>
      <HowToPlayButton />
      <BoardScreen store={store} />
    </HowToPlayProvider>,
  );
  noGuide();
  const length = () => store.getSession()!.log.actions.length;
  const run = (steps: number) =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(STEP_MS.normal * steps);
    });
  await run(4);
  expect(length()).toBeGreaterThan(0);

  fireEvent.click(opener());
  const heldAt = length();
  const hashAt = stateHash(store.getSession()!.state);
  await run(40);
  // Nothing moved, however long the walkthrough stays open.
  expect(length()).toBe(heldAt);
  expect(stateHash(store.getSession()!.state)).toBe(hashAt);

  fireEvent.click(within(guide()).getByRole('button', { name: t('howToPlay.close') }));
  noGuide();
  await run(4);
  expect(length()).toBeGreaterThan(heldAt);
}, 30_000);

test('a rival’s question in flight when it opens is withdrawn and asked again on Close', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: false });
  const { promise: gate, resolve: release } = Promise.withResolvers<void>();
  const calls = fakeServer('jev', gate);
  const store = watchStore(2);
  renderStrict(
    <HowToPlayProvider gameWaits>
      <HowToPlayButton />
      <BoardScreen store={store} />
    </HowToPlayProvider>,
  );
  const length = () => store.getSession()!.log.actions.length;
  // Play on until a decision is out to the server and held there.
  for (let step = 0; step < 60 && calls.decide === 0; step++) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(STEP_MS.normal);
    });
  }
  expect(calls.decide).toBe(1);
  const heldAt = length();

  fireEvent.click(opener());
  await act(async () => {
    release();
    await vi.advanceTimersByTimeAsync(STEP_MS.normal * 10);
  });
  // The late answer is thrown away: it must not land while the player is reading.
  expect(length()).toBe(heldAt);

  fireEvent.click(within(guide()).getByRole('button', { name: t('howToPlay.close') }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(STEP_MS.normal * 6);
  });
  expect(calls.decide).toBeGreaterThan(1);
  expect(length()).toBeGreaterThan(heldAt);
}, 30_000);
