import { act, cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, expect, test, vi } from 'vitest';
import { serialize } from '../../../engine/index.ts';
import { engineContent } from '../game/content.ts';
import { fakeJevAnswer } from '../game/fakeJevAnswer.ts';
import { createGameStore, type GameStore } from '../game/store.ts';
import { t } from '../i18n/en.ts';
import { demoGame, seekOpponent } from '../test/demoGame.ts';
import { settingsFor, watchConfig } from '../test/watchGame.ts';
import { BoardScreen } from './BoardScreen.tsx';
import { latestJevChoice } from './JevChoicePanel.tsx';
import { turnMessages } from './turnMessages.ts';

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
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const game = (demo: boolean) => demoGame(() => demo);

/** Probabilities the fake Jev sends: the last option is its pick, the rest share what is left. */
const PROBABILITIES = [0.83, 0.07, 0.06, 0.04, 0.03, 0.02, 0.01];

interface Wire {
  bodies: { path: string; body: string }[];
  outcomes: Record<string, unknown>[];
}

/**
 * The local server, faked with an answer of the proposed shape. Jev answers `decide` with a
 * `detail` (or the backup bot when `backup`); `delay` holds that answer back.
 */
function server({ backup = false, delay = 0 } = {}): Wire {
  const wire: Wire = { bodies: [], outcomes: [] };
  vi.stubGlobal('fetch', async (path: string, init?: RequestInit) => {
    if (path === '/api/ai/outcome') {
      wire.outcomes.push(JSON.parse(String(init?.body)));
      return new Response(null, { status: 204 });
    }
    if (path === '/api/ai/status')
      return new Response(
        JSON.stringify({ jevEnabled: !backup, backupOnly: backup, reason: null }),
      );
    const body = String(init?.body);
    wire.bodies.push({ path, body });
    const request = JSON.parse(body) as { enabledActions: { id: string }[] };
    const actions = request.enabledActions;
    if (path === '/api/ai/fallback' || backup)
      return new Response(
        JSON.stringify({
          choice: actions[0]!.id,
          source: 'fallback',
          fallbackReason: backup ? 'timeout' : 'rate_limited',
          requestId: 'test-decision',
          latencyMs: 0,
        }),
      );
    if (delay) {
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, delay);
      await promise;
    }
    // Mirror the proposed server: Jev's probability for each option it saw, the pick highest.
    // The pick is never a PvP challenge: the server does not offer AI seats one yet (spec §5.3).
    const pick = actions.findLast((action) => !action.id.startsWith('declare-pvp'))!;
    let rest = 0;
    return new Response(
      JSON.stringify(
        fakeJevAnswer({
          choice: pick.id,
          options: actions.map(({ id }) => ({
            id,
            probability: id === pick.id ? PROBABILITIES[0]! : PROBABILITIES[++rest]!,
          })),
        }),
      ),
    );
  });
  return wire;
}

async function decide(store: GameStore) {
  seekOpponent(store);
  expect(await store.playOpponent(new AbortController().signal)).toBe(true);
}

const rows = () => within(screen.getByRole('table')).getAllByRole('row').slice(1);

test('demo off, the default: Jev sends its detail anyway and nothing of it is shown, asked for or kept', async () => {
  const wire = server();
  const store = game(false);
  await decide(store);
  render(<BoardScreen store={store} />);
  // No panel, no banner, no probability or confidence text, and no table in the page.
  expect(document.querySelector('.jev-panel')).toBeNull();
  expect(screen.queryByText(t('demo.banner'))).toBeNull();
  expect(screen.queryByRole('table')).toBeNull();
  for (const number of PROBABILITIES) expect(document.body.textContent).not.toContain(`${number}`);
  expect(document.body.textContent).not.toContain('0.62');
  // Not kept: nothing in the store's view mentions the detail, whatever the feed holds.
  const kept = JSON.stringify(store.getView());
  expect(kept).not.toMatch(/probabilit|confidence|"demo"|"detail"/);
  expect(store.getView()!.feed.some((entry) => entry.decision?.demo)).toBe(false);
  // Not asked for: the request is the one demo mode sends, and the outcome report carries IDs only.
  expect(wire.bodies.map(({ path }) => path).sort()).toEqual([
    '/api/ai/decide',
    '/api/ai/fallback',
  ]);
  for (const { body } of wire.bodies) expect(Object.keys(JSON.parse(body))).not.toContain('demo');
  expect(wire.outcomes).toHaveLength(1);
  expect(Object.keys(wire.outcomes[0]!).sort()).toEqual(
    ['choice', 'decisionPoint', 'gameId', 'seatIndex', 'source', 'stateRevision', 'turnKey'].sort(),
  );
});

test('demo on: every option Jev saw, its probability exactly as sent, its confidence, its pick and the engine record', async () => {
  const wire = server();
  const store = game(true);
  await decide(store);
  render(<BoardScreen store={store} />);
  const panel = document.querySelector<HTMLElement>('.jev-panel')!;
  expect(panel).toBeTruthy();
  // The banner is part of the panel and names the private options.
  expect(within(panel).getByText(t('demo.banner'))).toBeTruthy();
  expect(within(panel).getByRole('heading', { name: t('demo.heading') })).toBeTruthy();
  const request = JSON.parse(wire.bodies.find(({ path }) => path === '/api/ai/decide')!.body) as {
    enabledActions: { id: string }[];
  };
  const shown = rows();
  // One row per option the browser sent, most likely first, probabilities copied as received.
  expect(shown).toHaveLength(request.enabledActions.length);
  const numbers = shown.map((row) => Number(within(row).getAllByRole('cell')[0]!.textContent));
  expect(numbers).toEqual([...numbers].sort((a, b) => b - a));
  expect(numbers).toContain(0.83);
  expect(within(panel).getByText(t('demo.confidence', { value: 0.62 }))).toBeTruthy();
  // The pick is marked once, on the 0.83 row, and the source is Jev.
  const chosen = shown.filter((row) => within(row).queryByText(t('demo.chosen')));
  expect(chosen).toHaveLength(1);
  expect(within(chosen[0]!).getAllByRole('cell')[0]!.textContent).toBe('0.83');
  expect(within(panel).getByText(t('demo.byJev'))).toBeTruthy();
  // The result line is the engine record of what the rival did, in the field log's words.
  const action = turnMessages(store.getView()!.feed.at(-1)!, 0).find(({ key }) =>
    key.startsWith('ai.action.'),
  )!;
  expect(within(panel).getByText(t('demo.result'))).toBeTruthy();
  expect(within(panel).getByText(action.text)).toBeTruthy();
});

test('demo on, but the backup bot decided: its reason and the banner, no probabilities', async () => {
  server({ backup: true });
  const store = game(true);
  await decide(store);
  render(<BoardScreen store={store} />);
  const panel = document.querySelector<HTMLElement>('.jev-panel')!;
  expect(within(panel).getByText(t('demo.banner'))).toBeTruthy();
  expect(within(panel).getByText(t('demo.byBackup'))).toBeTruthy();
  expect(within(panel).getByText(t('ai.reason.timeout'))).toBeTruthy();
  expect(within(panel).queryByRole('table')).toBeNull();
  expect(panel.textContent).not.toMatch(/\d\.\d/);
});

test('a late detail never holds up the turn: the deadline fallback commits and the late answer changes nothing', async () => {
  vi.useFakeTimers();
  server({ delay: 2000 });
  const store = game(true);
  seekOpponent(store);
  const before = store.getSession()!;
  const pending = store.playOpponent(new AbortController().signal);
  await vi.advanceTimersByTimeAsync(1499);
  expect(store.getSession()).toBe(before);
  await vi.advanceTimersByTimeAsync(1);
  expect(await pending).toBe(true);
  const decided = store.getSession()!;
  const shown = latestJevChoice(store.getView()!)!;
  expect(shown.choice).toMatchObject({ source: 'fallback', fallbackReason: 'timeout', rows: [] });
  await vi.advanceTimersByTimeAsync(1000);
  expect(store.getSession()).toBe(decided);
  expect(latestJevChoice(store.getView()!)!.choice.rows).toEqual([]);
});

test('a missing or malformed detail shows nothing and still plays the turn', async () => {
  for (const detail of [undefined, { questionId: 'strategy', confidence: 2, options: [] }, 'x']) {
    vi.stubGlobal('fetch', async (path: string, init?: RequestInit) => {
      if (path === '/api/ai/outcome') return new Response(null, { status: 204 });
      const { enabledActions } = JSON.parse(String(init?.body)) as {
        enabledActions: { id: string }[];
      };
      const source = path === '/api/ai/fallback' ? 'fallback' : 'jev';
      return new Response(
        JSON.stringify({
          choice: enabledActions.at(-1)!.id,
          source,
          ...(source === 'fallback' && { fallbackReason: 'rate_limited' }),
          requestId: 'x',
          latencyMs: 0,
          ...(detail !== undefined && { detail }),
        }),
      );
    });
    const store = game(true);
    await decide(store);
    expect(latestJevChoice(store.getView()!)).toBeUndefined();
    render(<BoardScreen store={store} />);
    expect(document.querySelector('.jev-panel')).toBeNull();
    cleanup();
  }
});

test('the panel never shows the human seat’s own decision', async () => {
  server();
  const store = game(true);
  await decide(store);
  const view = store.getView()!;
  expect(latestJevChoice(view)).toBeDefined();
  // The same entry, read as if the human seat had been the one to act.
  const asHuman = {
    ...view,
    feed: view.feed.map((entry) => ({
      ...entry,
      before: { ...entry.before, activeSeatIndex: view.seatIndex },
    })),
  };
  expect(latestJevChoice(asHuman)).toBeUndefined();
});

test('the panel is presentation only: saves and exported logs are the same with it on or off', async () => {
  const play = async (demo: boolean) => {
    server();
    const store = game(demo);
    await decide(store);
    await act(async () => {});
    return serialize(store.getSession()!);
  };
  const off = await play(false);
  const on = await play(true);
  expect(on).toBe(off);
  expect(on).not.toMatch(/probabilit|confidence|detail|demo/i);
});

test('a watched game keeps and shows nothing, even in demo mode', async () => {
  vi.stubGlobal('fetch', async (path: string, init?: RequestInit) => {
    if (path === '/api/ai/outcome') return new Response(null, { status: 204 });
    const { enabledActions } = JSON.parse(String(init?.body)) as {
      enabledActions: { id: string }[];
    };
    const options = enabledActions.map(({ id }, index) => ({
      id,
      probability: index === 0 ? 0.9 : 0.1 / Math.max(1, enabledActions.length - 1),
    }));
    return new Response(JSON.stringify(fakeJevAnswer({ choice: enabledActions[0]!.id, options })));
  });
  // Every seat is an AI: no human seat to show a rival's private options to.
  const store = createGameStore({ demo: () => true });
  store.start(watchConfig(2), engineContent, settingsFor(2));
  for (let i = 0; i < 400 && !store.getSpectatorView()!.feed.some((e) => e.decision); i++) {
    if (!store.advance()) await store.playOpponent(new AbortController().signal);
  }
  const feed = store.getSpectatorView()!.feed;
  expect(feed.some((entry) => entry.decision)).toBe(true);
  expect(feed.some((entry) => entry.decision?.demo)).toBe(false);
  expect(JSON.stringify(feed)).not.toMatch(/probabilit|confidence|"detail"/);
});

test('numbers are rounded for display and labelled as Jev’s own output, not a measured rate', async () => {
  vi.stubGlobal('fetch', async (path: string, init?: RequestInit) => {
    if (path === '/api/ai/outcome') return new Response(null, { status: 204 });
    const { enabledActions } = JSON.parse(String(init?.body)) as {
      enabledActions: { id: string }[];
    };
    const pick = enabledActions.findLast((action) => !action.id.startsWith('declare-pvp'))!;
    if (path === '/api/ai/fallback')
      return Response.json({
        choice: enabledActions[0]!.id,
        source: 'fallback',
        fallbackReason: 'rate_limited',
        requestId: 'x',
        latencyMs: 0,
      });
    // Raw floats as a model can send them: 0.8299999 and a chance too small to round to 0.01.
    const raw = [0.8299999, 0.0004];
    let rest = 0;
    return Response.json(
      fakeJevAnswer({
        choice: pick.id,
        confidence: 0.6200000001,
        options: enabledActions.map(({ id }) => ({
          id,
          probability: id === pick.id ? raw[0]! : (raw[++rest] ?? 0.01),
        })),
      }),
    );
  });
  const store = game(true);
  await decide(store);
  render(<BoardScreen store={store} />);
  const panel = document.querySelector<HTMLElement>('.jev-panel')!;
  const shown = rows().map((row) => within(row).getAllByRole('cell')[0]!.textContent);
  expect(shown[0]).toBe('0.83');
  for (const text of shown) expect(text).toMatch(/^(\d\.\d\d|<0\.01)$/);
  expect(shown.at(-1)).toBe('<0.01');
  expect(panel.textContent).not.toMatch(/\d\.\d{3,}/);
  expect(within(panel).getByText(t('demo.confidence', { value: '0.62' }))).toBeTruthy();
  expect(within(panel).getByText(t('demo.modelNote'))).toBeTruthy();
  // The row still holds the number as received: only the display is rounded.
  const kept = latestJevChoice(store.getView()!)!.choice.rows.map((row) => row.probability);
  expect(kept).toContain(0.8299999);
});

test('the model-output note is on a Jev panel and absent from a backup-bot one, which shows no number', async () => {
  server({ backup: true });
  const store = game(true);
  await decide(store);
  render(<BoardScreen store={store} />);
  expect(screen.queryByText(t('demo.modelNote'))).toBeNull();
});

test('the store reads the demo gate at each rival decision: closed, nothing is kept; opened, the next one is', async () => {
  server();
  let open = false;
  const store = demoGame(() => open);
  await decide(store);
  expect(latestJevChoice(store.getView()!)).toBeUndefined();
  expect(JSON.stringify(store.getView())).not.toMatch(/probabilit|confidence|"demo"|"detail"/);
  // The server's setting arrives late; the decision already made stays as it was.
  open = true;
  expect(latestJevChoice(store.getView()!)).toBeUndefined();
  // A later decision, once the gate is open, is kept.
  for (let i = 0; i < 300 && !latestJevChoice(store.getView()!); i++) {
    if (store.advance({ human: true })) continue;
    if (store.getView()!.observation.public.activeSeatIndex !== 0) {
      await store.playOpponent(new AbortController().signal);
      continue;
    }
    const pass = store
      .getView()!
      .legalActions.enabled.find(
        (entry) =>
          ['skip', 'release', 'skip_shop'].includes(entry.kind) || entry.id === 'finish-sell',
      );
    if (pass) store.choose(pass.id);
  }
  expect(latestJevChoice(store.getView()!)).toBeDefined();
});
