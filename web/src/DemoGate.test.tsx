import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, expect, test, vi } from 'vitest';
import { App } from './App.tsx';
import { fakeJevAnswer } from './game/fakeJevAnswer.ts';
import { writeSave, type SaveStorage } from './game/save.ts';
import { t } from './i18n/en.ts';
import { demoGame, seekOpponent } from './test/demoGame.ts';

// The "What Jev chose" panel needs two things at once: the page asks for it (`?demo`) and the
// server's status says its demo setting is on. These tests open a saved game at a rival's decision
// and resume it, the path where a player could add `?demo` to a normal game (issue #247).

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

function memoryStorage(): SaveStorage {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

/** A saved one-human game with a rival's decision waiting, as a reload would find it. */
function savedAtRivalDecision(): SaveStorage {
  const store = demoGame();
  seekOpponent(store);
  const storage = memoryStorage();
  writeSave(storage, store.getSession()!, { opponents: store.getOpponents() });
  return storage;
}

type Status = () => Response | Promise<Response>;

interface Wire {
  /** Paths of every request the page made. */
  paths: string[];
  outcomes: number;
}

/**
 * The local server, faked: `status` answers `/api/ai/status`; Jev answers a decision with a
 * `detail` whatever the setting, as a server in demo mode would. Only what the browser reads
 * matters here.
 */
function server(status: Status): Wire {
  const wire: Wire = { paths: [], outcomes: 0 };
  vi.stubGlobal('fetch', async (path: string, init?: RequestInit) => {
    wire.paths.push(path);
    if (path === '/api/ai/outcome') {
      wire.outcomes += 1;
      return new Response(null, { status: 204 });
    }
    if (path === '/api/ai/status') return status();
    const { enabledActions } = JSON.parse(String(init?.body)) as {
      enabledActions: { id: string }[];
    };
    if (path === '/api/ai/fallback')
      return Response.json({
        choice: enabledActions[0]!.id,
        source: 'fallback',
        fallbackReason: 'rate_limited',
        requestId: 'x',
        latencyMs: 0,
      });
    const pick = enabledActions.findLast((action) => !action.id.startsWith('declare-pvp'))!;
    return Response.json(
      fakeJevAnswer({
        choice: pick.id,
        confidence: 0.6200000001,
        options: enabledActions.map(({ id }) => ({
          id,
          probability: id === pick.id ? 0.8299999 : 0.01,
        })),
      }),
    );
  });
  return wire;
}

const base = { jevEnabled: true, backupOnly: false, reason: null, speech: { enabled: true } };

async function resume(demo: boolean, storage: SaveStorage) {
  render(<App demo={demo} storage={storage} />);
  await userEvent.click(screen.getByRole('button', { name: t('save.continue') }));
}

/** The rival's decision has gone to the server and been applied (and reported, once). */
const decided = (wire: Wire) => waitFor(() => expect(wire.outcomes).toBe(1), { timeout: 5000 });

test.each([
  ['the status has no demo field (the server today)', () => Response.json(base)],
  ['demo is false', () => Response.json({ ...base, demo: false })],
  ['demo is not a boolean', () => Response.json({ ...base, demo: 'true' })],
  ['the status is refused', () => Response.json({ ...base, demo: true }, { status: 503 })],
  ['the status is not JSON', () => new Response('<html>', { status: 200 })],
  ['the status cannot be reached', () => Promise.reject(new Error('network down'))],
] as [string, Status][])(
  'with ?demo on a resumed save but %s: no panel, no banner, no number, and the turn goes on',
  async (_name, status) => {
    const wire = server(status);
    await resume(true, savedAtRivalDecision());
    await decided(wire);
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: t('play.heading') })).toBeTruthy(),
    );
    expect(document.querySelector('.jev-panel')).toBeNull();
    expect(screen.queryByText(t('demo.banner'))).toBeNull();
    expect(screen.queryByText(t('demo.heading'))).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
    expect(document.body.textContent).not.toMatch(/0\.83|0\.62|0\.8299999/);
    // Jev's answer was asked for and applied exactly as in any game.
    expect(wire.paths.filter((path) => path === '/api/ai/decide')).toHaveLength(1);
  },
);

test.each(['?demo=0', '?demo=false', 'no parameter'])(
  'the server’s demo setting on is not enough: a page opened with %s shows nothing',
  async () => {
    const wire = server(() => Response.json({ ...base, demo: true }));
    await resume(false, savedAtRivalDecision());
    await decided(wire);
    expect(document.querySelector('.jev-panel')).toBeNull();
    expect(screen.queryByText(t('demo.banner'))).toBeNull();
    expect(document.body.textContent).not.toMatch(/0\.83|0\.62/);
  },
);

test('with ?demo and the server’s setting on, a resumed save shows the panel, banner, rounded numbers and the model-output note', async () => {
  const wire = server(() => Response.json({ ...base, demo: true }));
  await resume(true, savedAtRivalDecision());
  await decided(wire);
  const panel = await waitFor(() => {
    const found = document.querySelector<HTMLElement>('.jev-panel');
    expect(found).toBeTruthy();
    return found!;
  });
  expect(panel.textContent).toContain(t('demo.banner'));
  expect(panel.textContent).toContain('0.83');
  expect(panel.textContent).not.toMatch(/0\.8299999|0\.6200000001/);
  expect(panel.textContent).toContain(t('demo.confidence', { value: '0.62' }));
  expect(panel.textContent).toContain(t('demo.modelNote'));
});

test('the setting is read only for a page that asks for demo mode', async () => {
  // On the Home screen no game, and so no badge, is asking: any status request here is the gate's.
  for (const [demo, requests] of [
    [false, 0],
    [true, 1],
  ] as const) {
    const wire = server(() => Response.json({ ...base, demo: true }));
    render(<App demo={demo} storage={memoryStorage()} />);
    await screen.findByRole('button', { name: t('home.newGame') });
    await waitFor(() =>
      expect(wire.paths.filter((path) => path === '/api/ai/status')).toHaveLength(requests),
    );
    cleanup();
  }
});
