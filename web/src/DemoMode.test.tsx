import { cleanup, render, screen } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { StrictMode } from 'react';
import { afterEach, beforeAll, expect, test, vi } from 'vitest';
import { deserialize, stateHash, verifyReplay } from '../../engine/index.ts';
import { App } from './App.tsx';
import { DEMO_SCENES } from './game/demoScenes.ts';
import { META_KEY, SAVE_KEY, type SaveStorage } from './game/save.ts';
import { t } from './i18n/en.ts';
import { DemoScreen } from './setup/DemoScreen.tsx';

// Named per-test budgets (ET-05): these take 2 to 8 s at full parallelism, so the 5 s default is too tight on a loaded machine.
const SLOW_TEST_MS = 30_000;

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function memory(initial: Record<string, string> = {}): SaveStorage & { text(key: string): string } {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
    text: (key) => data.get(key) ?? '',
  };
}

function open(storage: SaveStorage, demo: boolean) {
  // No model is ever called: the page's own requests fail and the backup bot is what it would use.
  vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
  const user = userEvent.setup();
  const view = render(
    <StrictMode>
      <App demo={demo} storage={storage} />
    </StrictMode>,
  );
  return { user, ...view };
}

const banner = () => screen.queryByText(t('demo.scene.banner'));
const sceneButton = (id: string) => {
  const scene = DEMO_SCENES.find((entry) => entry.id === id)!;
  return screen.getByRole('button', { name: new RegExp(t(scene.title)) });
};
const entry = () => screen.queryByRole('button', { name: t('demo.scenes.entry') });

async function openScene(user: UserEvent, id: string) {
  await user.click(entry()!);
  await user.click(sceneButton(id));
}

test('without ?demo, Home and every screen leave scenes unmentioned (issue #222)', async () => {
  const { user, container } = open(memory(), false);
  expect(entry()).toBeNull();
  expect(container.textContent).not.toMatch(/prepared|scenario/i);
  await user.click(screen.getByRole('button', { name: t('home.newGame') }));
  expect(container.textContent).not.toMatch(/prepared|scenario/i);
});

test('with ?demo, Home opens a list of every scene with its one-line description', async () => {
  const { user } = open(memory(), true);
  expect(banner()).toBeNull();
  await user.click(entry()!);
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(t('demo.scenes.heading'));
  for (const scene of DEMO_SCENES) {
    expect(sceneButton(scene.id).textContent).toContain(t(scene.description));
  }
  await user.click(screen.getByRole('button', { name: t('nav.home') }));
  expect(entry()).not.toBeNull();
});

test('a scene opens at its moment with the banner, and the banner stays on other screens', async () => {
  const storage = memory();
  const { user } = open(storage, true);
  await openScene(user, 'ball');
  expect(banner()).not.toBeNull();
  // The game is the scene's: its saved log is an ordinary log that replays.
  const saved = deserialize(storage.text(SAVE_KEY));
  expect(verifyReplay(saved).pass).toBe(true);
  expect(storage.text(SAVE_KEY)).not.toContain('scene');
  await user.click(screen.getByRole('button', { name: t('credits.link') }));
  expect(banner()).not.toBeNull();
});

test(
  'the same scene opened twice gives the same state hash',
  async () => {
    const hashes: string[] = [];
    for (const id of DEMO_SCENES.map((scene) => scene.id)) {
      for (let launch = 0; launch < 2; launch++) {
        const storage = memory();
        const { user } = open(storage, true);
        await openScene(user, id);
        hashes.push(`${id}:${stateHash(deserialize(storage.text(SAVE_KEY)).state)}`);
        cleanup();
      }
    }
    for (const id of DEMO_SCENES.map((scene) => scene.id)) {
      const own = hashes.filter((hash) => hash.startsWith(`${id}:`));
      expect(new Set(own).size).toBe(1);
    }
  },
  SLOW_TEST_MS,
);

test('a reload keeps the banner: the prompt and the resumed game both announce the scene', async () => {
  const storage = memory();
  const first = open(storage, true);
  await openScene(first.user, 'pvp');
  const before = storage.text(SAVE_KEY);
  first.unmount();

  const { user } = open(storage, true);
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(t('save.continueHeading'));
  expect(banner()).not.toBeNull();
  await user.click(screen.getByRole('button', { name: t('save.continue') }));
  expect(banner()).not.toBeNull();
  // Resuming adds nothing to the log.
  expect(storage.text(SAVE_KEY)).toBe(before);
});

test('a scene game is never offered, or announced, without ?demo', async () => {
  const storage = memory();
  const first = open(storage, true);
  await openScene(first.user, 'ball');
  first.unmount();

  const { container } = open(storage, false);
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(t('home.heading'));
  expect(entry()).toBeNull();
  expect(banner()).toBeNull();
  expect(container.textContent).not.toMatch(/prepared|scenario/i);
});

test('a scene save from another engine version is not offered and is rebuilt from the list', async () => {
  const storage = memory();
  const first = open(storage, true);
  await openScene(first.user, 'ball');
  first.unmount();
  const stale = JSON.parse(storage.text(SAVE_KEY)) as Record<string, unknown>;
  storage.setItem(SAVE_KEY, JSON.stringify({ ...stale, engineVersion: '0.0.1' }));

  const { user } = open(storage, true);
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(t('home.heading'));
  expect(banner()).toBeNull();
  await openScene(user, 'ball');
  expect(banner()).not.toBeNull();
  expect(verifyReplay(deserialize(storage.text(SAVE_KEY))).pass).toBe(true);
});

test('an ordinary save is still offered under ?demo, without the banner', async () => {
  const storage = memory();
  const first = open(storage, true);
  await openScene(first.user, 'ball');
  first.unmount();
  // The same game, saved as an ordinary one: its meta carries no scene.
  const meta = JSON.parse(storage.text(META_KEY)) as Record<string, unknown>;
  delete meta.scene;
  storage.setItem(META_KEY, JSON.stringify(meta));

  open(storage, true);
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(t('save.continueHeading'));
  expect(banner()).toBeNull();
});

test('a scene that cannot be built says why and offers the way back', () => {
  render(
    <DemoScreen
      scenes={[]}
      failure={{ kind: 'step', step: 2, total: 5 }}
      onOpen={() => {}}
      onBack={() => {}}
    />,
  );
  expect(screen.getByRole('alert').textContent).toContain(
    t('demo.failed.step', { step: 2, total: 5 }),
  );
  expect(screen.getByRole('status').textContent).toBe(t('demo.scenes.none'));
  expect(screen.getByRole('button', { name: t('nav.home') })).toBeTruthy();
});
