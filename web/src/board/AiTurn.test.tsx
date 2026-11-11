import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, expect, test, vi } from 'vitest';
import { deserialize, replay, serialize, stateHash } from '../../../engine/index.ts';
import { engineContent } from '../game/content.ts';
import {
  configForSetup,
  createGameStore,
  opponentSettings,
  type GameStore,
} from '../game/store.ts';
import { t } from '../i18n/en.ts';
import { BoardScreen } from './BoardScreen.tsx';
import { turnMessages } from './turnMessages.ts';
import { HUMAN_STEP_MS, STEP_MS } from './useTurnPlayback.ts';

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
});

const setup = {
  mode: 'quick',
  human: { classId: 'main-character', starterSpeciesId: 'bulbasaur' },
  opponents: [
    {
      classId: 'researcher',
      starterSpeciesId: 'porygon',
      personality: 'greedy',
      difficulty: 'normal',
    },
  ],
} as const;
const noticeId = 'fallback-notice-greedy-neutral-1';
function game() {
  const store = createGameStore();
  store.start(
    { ...configForSetup({ ...setup, opponents: [...setup.opponents] }, 1), lapTarget: 1 },
    engineContent,
    opponentSettings({ ...setup, opponents: [...setup.opponents] }),
  );
  return store;
}
function pass(store: GameStore) {
  if (store.getView()!.legalActions.enabled.length <= 1) return;
  const choice = store
    .getView()!
    .legalActions.enabled.find(
      (entry) =>
        ['skip', 'release', 'skip_shop'].includes(entry.kind) || entry.id === 'finish-sell',
    );
  if (choice) store.choose(choice.id);
}
function seekOpponent(store: GameStore) {
  for (let i = 0; i < 300; i++) {
    if (store.advance({ human: true })) continue;
    if (store.getView()!.observation.public.activeSeatIndex !== 0) return;
    pass(store);
  }
  throw new Error('No opponent decision');
}
function answer(
  request: { enabledActions: { id: string; kind: string }[] },
  fallback = true,
  fallbackReason = 'rate_limited',
) {
  const choice = fallback ? request.enabledActions[0]! : request.enabledActions.at(-1)!;
  return new Response(
    JSON.stringify({
      choice: choice.id,
      source: fallback ? 'fallback' : 'jev',
      ...(fallback && { fallbackReason }),
      requestId: 'test-decision',
      latencyMs: 0,
    }),
    {
      headers: {
        'x-ai-decision-ms': '1500',
        ...(fallback && {
          'x-ai-line-id': noticeId,
          'x-ai-dialogue-events': JSON.stringify([
            { kind: 'random_result', purpose: 'line:fallback_notice', result: 0, drawCounter: 1 },
            {
              kind: 'line_selected',
              situation: 'fallback_notice',
              personalityId: 'greedy',
              trustBucket: 'neutral',
              lineId: noticeId,
            },
          ]),
        }),
      },
    },
  );
}
function transport({
  backupOnly = true,
  delay = 0,
  broken = false,
  decisionFallback = false,
  fallbackReason = 'rate_limited',
} = {}) {
  const requests: string[] = [];
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    requests.push(url);
    if (broken) return new Response('', { status: 503 });
    if (url === '/api/ai/status')
      return new Response(
        JSON.stringify({
          jevEnabled: !backupOnly,
          backupOnly,
          reason: backupOnly ? 'disabled' : null,
        }),
      );
    const request = JSON.parse(String(init?.body));
    if (url === '/api/ai/decide' && delay) {
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, delay);
      await promise;
    }
    return answer(
      request,
      url === '/api/ai/fallback' || backupOnly || decisionFallback,
      fallbackReason,
    );
  });
  return requests;
}
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test('the server fallback commits at the decision deadline, and a 2s late answer never changes it', async () => {
  vi.useFakeTimers();
  transport({ backupOnly: false, delay: 2000 });
  const store = game();
  seekOpponent(store);
  const before = store.getSession()!;
  const pending = store.playOpponent(new AbortController().signal);
  await vi.advanceTimersByTimeAsync(1499);
  expect(store.getSession()).toBe(before);
  await vi.advanceTimersByTimeAsync(1);
  expect(await pending).toBe(true);
  const decided = store.getSession()!;
  expect(decided.state.stateRevision).toBe(before.state.stateRevision + 1);
  expect(decided.log.actions.at(-1)!.action.kind).not.toBe('release');
  await vi.advanceTimersByTimeAsync(1000);
  expect(store.getSession()).toBe(decided);
  expect(stateHash(replay(decided.log))).toBe(stateHash(decided.state));
});

test('backup-only status marks an AI turn before a decision, with one catalog banner and a skippable bank line', async () => {
  vi.useFakeTimers();
  const requests = transport();
  const store = game();
  seekOpponent(store);
  render(<BoardScreen store={store} />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(screen.getByText(t('ai.backupBadge'))).toBeTruthy();
  expect(screen.getAllByText(t('ai.allBackupBanner'))).toHaveLength(1);
  expect(screen.getByText(t('ai.reason.disabled'))).toBeTruthy();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(STEP_MS.normal);
  });
  expect(screen.getByText('A backup bot is playing for me right now.')).toBeTruthy();
  const committed = store.getSession();
  fireEvent.click(screen.getByRole('button', { name: t('ai.skipLine') }));
  expect(screen.queryByText('A backup bot is playing for me right now.')).toBeNull();
  expect(store.getSession()).toBe(committed);
  expect(requests.every((url) => url.startsWith('/api/'))).toBe(true);
});

test('during an opponent turn the now-strip names the same action as the log and the board points at the rival', async () => {
  vi.useFakeTimers();
  transport();
  const store = game();
  seekOpponent(store);
  render(<BoardScreen store={store} />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  for (let i = 0; i < 6 && !document.querySelector('.now-strip'); i++) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(STEP_MS.normal);
    });
  }
  const view = store.getView()!;
  const latest = view.feed.at(-1)!;
  const message = turnMessages(latest).find((entry) => entry.key.startsWith('ai.'));
  expect(message).toBeTruthy();
  const seat = latest.before.activeSeatIndex;
  const strip = document.querySelector('.now-strip');
  expect(strip).not.toBeNull();
  expect(strip!.getAttribute('data-seat')).toBe(String(seat));
  expect(strip!.textContent).toContain(message!.text);
  const rival = view.observation.public.players.find((player) => player.seatIndex === seat)!;
  const square = document.querySelector('.loop-square[data-focus="ai"]');
  expect(square).not.toBeNull();
  expect(square!.getAttribute('data-position')).toBe(String(rival.position));
  expect(square!.getAttribute('data-focus-seat')).toBe(String(seat));
  const pawn = document.querySelector('.trainer-pawn[data-focus="ai"]');
  expect(pawn?.getAttribute('data-seat')).toBe(String(seat));
});

test('during a rival movement die the now-strip stays visible, truthful and aligned with the spotlight', async () => {
  vi.useFakeTimers();
  transport();
  const store = game();
  seekOpponent(store);
  render(<BoardScreen store={store} />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  let seen = false;
  for (let i = 0; i < 60 && !seen; i++) {
    const view = store.getView()!;
    if (view.observation.public.activeSeatIndex === 0) {
      const enabled = view.legalActions.enabled;
      const choice =
        enabled.find(
          (entry) =>
            ['skip', 'release', 'skip_shop'].includes(entry.kind) || entry.id === 'finish-sell',
        ) ?? enabled.at(-1);
      if (enabled.length > 1 && choice) store.choose(choice.id);
    }
    await act(async () => {
      await vi.advanceTimersByTimeAsync(STEP_MS.normal);
    });
    const latest = store.getView()!.feed.at(-1)!;
    const movesDie =
      latest.before.activeSeatIndex !== 0 &&
      latest.record.action.kind === 'dice_result' &&
      latest.before.phase.kind === 'move';
    if (!movesDie) continue;
    const message = turnMessages(latest).find((entry) => entry.key.startsWith('ai.'));
    expect(message).toBeTruthy();
    expect(message!.text).toContain(
      String(latest.record.events.find((event) => event.kind === 'random_result')?.result),
    );
    const strip = document.querySelector('.now-strip');
    expect(strip).not.toBeNull();
    expect(strip!.getAttribute('data-seat')).toBe(String(latest.before.activeSeatIndex));
    expect(strip!.textContent).toContain(message!.text);
    const rival = store
      .getView()!
      .observation.public.players.find(
        (player) => player.seatIndex === latest.before.activeSeatIndex,
      )!;
    const square = document.querySelector('.loop-square[data-focus="ai"]');
    expect(square).not.toBeNull();
    expect(square!.getAttribute('data-position')).toBe(String(rival.position));
    expect(square!.getAttribute('data-focus-seat')).toBe(String(latest.before.activeSeatIndex));
    seen = true;
  }
  expect(seen).toBe(true);
});

test('a human automatic step commits on the human pause, not the slower AI normal pace', async () => {
  vi.useFakeTimers();
  transport();
  const store = game();
  render(<BoardScreen store={store} />);
  const before = store.getSession()!;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(HUMAN_STEP_MS.normal - 1);
  });
  expect(store.getSession()).toBe(before);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  const after = store.getSession()!;
  expect(after.log.actions).toHaveLength(before.log.actions.length + 1);
  expect(after.log.actions.at(-1)!).toMatchObject({ auto: true, action: { kind: 'roll' } });
  expect(HUMAN_STEP_MS.normal).toBeLessThan(STEP_MS.normal);
});

test('a pending decision always resolves to the fallback or a visible retry error', async () => {
  vi.useFakeTimers();
  transport({ broken: true });
  const store = game();
  seekOpponent(store);
  render(<BoardScreen store={store} />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(STEP_MS.normal);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1500);
  });
  expect(screen.getByRole('alert').textContent).toBe(t('turn.opponentError'));
  expect(screen.getByRole('button', { name: t('turn.retry') })).toBeTruthy();
  expect(screen.queryByText(t('ai.thinking'))).toBeNull();
});

test('normal and instant playback finish with identical accepted actions and gameplay state', async () => {
  vi.useFakeTimers();
  transport();
  async function finish(instant: boolean) {
    const store = game();
    const mounted = render(<BoardScreen store={store} />);
    if (instant)
      fireEvent.change(screen.getByRole('combobox', { name: t('ai.speed') }), {
        target: { value: 'instant' },
      });
    for (
      let i = 0;
      i < 1200 && store.getView()!.observation.public.phase.kind !== 'finished';
      i++
    ) {
      await act(async () => {
        pass(store);
        await vi.advanceTimersByTimeAsync(STEP_MS.normal);
      });
    }
    const session = store.getSession()!;
    expect(session.state.phase.kind).toBe('finished');
    expect(stateHash(replay(session.log))).toBe(stateHash(session.state));
    mounted.unmount();
    return session;
  }
  const normal = await finish(false);
  const instant = await finish(true);
  expect(instant.log.actions).toEqual(normal.log.actions);
  expect(stateHash(instant.state)).toBe(stateHash(normal.state));
}, 60000);

test('changing speed while thinking neither restarts the decision nor changes its deadline', async () => {
  vi.useFakeTimers();
  const requests = transport({ backupOnly: false, delay: 2000 });
  const store = game();
  seekOpponent(store);
  const revision = store.getView()!.observation.public.stateRevision;
  render(<BoardScreen store={store} />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(STEP_MS.normal);
  });
  expect(screen.getByText(t('ai.thinking'))).toBeTruthy();
  fireEvent.change(screen.getByRole('combobox', { name: t('ai.speed') }), {
    target: { value: 'fast' },
  });
  fireEvent.change(screen.getByRole('combobox', { name: t('ai.speed') }), {
    target: { value: 'instant' },
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1499);
  });
  expect(store.getView()!.observation.public.stateRevision).toBe(revision);
  expect(requests.filter((path) => path === '/api/ai/decide')).toHaveLength(1);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(
    store.getView()!.feed.find((entry) => entry.record.action.stateRevisionBefore === revision)
      ?.decision,
  ).toMatchObject({ source: 'fallback', fallbackReason: 'timeout' });
  expect(screen.queryByText(t('ai.thinking'))).toBeNull();
});

test('a decision-specific fallback belongs only to that AI and a later Jev decision clears it', async () => {
  vi.useFakeTimers();
  transport({ backupOnly: false, decisionFallback: true });
  const store = game();
  seekOpponent(store);
  render(<BoardScreen store={store} />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(STEP_MS.normal);
  });
  expect(document.querySelector('[data-ai-seat="1"]')?.textContent).toContain(t('ai.backupBadge'));
  expect(document.querySelector('[data-ai-seat="0"]')).toBeNull();
  expect(screen.getByText(t('ai.reason.rate_limited'))).toBeTruthy();
  transport({ backupOnly: false });
  act(() => {
    seekOpponent(store);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(STEP_MS.normal);
  });
  expect(screen.queryByText(t('ai.backupBadge'))).toBeNull();
  expect(screen.queryByText(t('ai.allBackupBanner'))).toBeNull();
});

test.each(['auto', 'low_confidence', 'stub', 'invalid_choice'])(
  'a %s fallback is normal play: no Backup bot badge or banner (spec §3, §5.6)',
  async (fallbackReason) => {
    vi.useFakeTimers();
    transport({ backupOnly: false, decisionFallback: true, fallbackReason });
    const store = game();
    seekOpponent(store);
    render(<BoardScreen store={store} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1200);
    });
    expect(
      store.getView()!.feed.some((entry) => entry.decision?.fallbackReason === fallbackReason),
    ).toBe(true);
    expect(screen.queryByText(t('ai.backupBadge'))).toBeNull();
    expect(screen.queryByText(t('ai.allBackupBanner'))).toBeNull();
  },
);

test('dialogue annotations survive save/load without changing command replay', async () => {
  transport();
  const store = game();
  seekOpponent(store);
  await store.playOpponent(new AbortController().signal);
  const session = store.getSession()!;
  const loaded = deserialize(serialize(session));
  expect(loaded.log.dialogueEvents).toEqual([
    { kind: 'random_result', purpose: 'line:fallback_notice', result: 0, drawCounter: 1 },
    {
      kind: 'line_selected',
      situation: 'fallback_notice',
      personalityId: 'greedy',
      trustBucket: 'neutral',
      lineId: noticeId,
    },
  ]);
  expect(stateHash(replay(loaded.log))).toBe(stateHash(loaded.state));
});

test('unusable speech metadata never changes a valid chosen action', async () => {
  const store = game();
  seekOpponent(store);
  const revision = store.getView()!.observation.public.stateRevision;
  vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body));
    const response = answer(request, false);
    response.headers.set('x-ai-line-id', 'not-a-bank-line');
    response.headers.set('x-ai-dialogue-events', 'broken JSON');
    return response;
  });
  expect(await store.playOpponent(new AbortController().signal)).toBe(true);
  expect(store.getView()!.observation.public.stateRevision).toBe(revision + 1);
  expect(store.getView()!.feed.at(-1)!.decision?.source).toBe('jev');
});

test('a selected sale line fills Pokémon and coins from the engine result, not from AI text', async () => {
  transport();
  const store = game();
  for (let i = 0; i < 400; i++) {
    const game = store.getView()!.observation.public;
    if (game.activeSeatIndex === 1 && game.phase.kind === 'sell') break;
    if (store.advance({ human: true })) continue;
    if (game.activeSeatIndex === 0) pass(store);
    else await store.playOpponent(new AbortController().signal);
  }
  expect(store.getView()!.observation.public.phase.kind).toBe('sell');
  vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
    if (!init?.body)
      return new Response(JSON.stringify({ jevEnabled: true, backupOnly: false, reason: null }));
    const request = JSON.parse(String(init.body));
    return new Response(JSON.stringify({ choice: request.enabledActions[0].id, source: 'jev' }), {
      headers: { 'x-ai-line-id': 'sold-pokemon-greedy-neutral-1' },
    });
  });
  await store.playOpponent(new AbortController().signal);
  render(<BoardScreen store={store} />);
  expect(screen.getByText('Sold Porygon for 8 coins.')).toBeTruthy();
});
