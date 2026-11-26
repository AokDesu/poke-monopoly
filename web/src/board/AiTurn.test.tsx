import { useSyncExternalStore } from 'react';
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  within,
} from '@testing-library/react';
import { afterEach, beforeAll, expect, test, vi } from 'vitest';
import {
  createGame,
  createGameLog,
  deserialize,
  pendingDecision,
  replay,
  serialize,
  stateHash,
} from '../../../engine/index.ts';
import { engineContent } from '../game/content.ts';
import {
  configForSetup,
  createGameStore,
  opponentSettings,
  type GameStore,
} from '../game/store.ts';
import { t } from '../i18n/en.ts';
import { BoardScreen } from './BoardScreen.tsx';
import { tableBeats } from './beats.ts';
import { PACE_TIMING } from './pace.ts';
import { useTurnPlayback } from './useTurnPlayback.ts';

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
  const requests: string[] & { outcomes?: Record<string, unknown>[] } = [];
  const outcomes: Record<string, unknown>[] = [];
  requests.outcomes = outcomes;
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    requests.push(url);
    if (url === '/api/ai/outcome') {
      outcomes.push(JSON.parse(String(init?.body)));
      return new Response(null, { status: 204 });
    }
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
  const requests = transport({ backupOnly: false, delay: 2000 });
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
  // The browser tells the server what it applied (spec §6.8): its fallback with timeout, once, and
  // never the answer that was still on its way.
  expect(requests.outcomes).toHaveLength(1);
  const [outcome] = requests.outcomes!;
  expect(outcome).toMatchObject({
    source: 'fallback',
    fallbackReason: 'timeout',
    stateRevision: before.state.stateRevision,
    choice: expect.any(String),
  });
  expect(Object.keys(outcome!).sort()).toEqual(
    [
      'choice',
      'decisionPoint',
      'fallbackReason',
      'gameId',
      'seatIndex',
      'source',
      'stateRevision',
      'turnKey',
    ].sort(),
  );
});

test('backup-only status marks every rival row with the badge and its reason, under one banner; the notice line is not repeated as speech', async () => {
  vi.useFakeTimers();
  const requests = transport();
  const store = game();
  seekOpponent(store);
  render(<BoardScreen store={store} />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(within(screen.getByTestId('player-1')).getByText(t('ai.backupBadge'))).toBeTruthy();
  expect(within(screen.getByTestId('player-0')).queryByText(t('ai.backupBadge'))).toBeNull();
  expect(screen.getAllByText(t('ai.allBackupBanner'))).toHaveLength(1);
  expect(screen.getByText(t('ai.reason.disabled'))).toBeTruthy();
  for (let i = 0; i < 20; i++) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PACE_TIMING.readable.hold!.maxMs);
    });
  }
  // The rival answered with the backup bot's notice: the badge already says it, so no speech.
  expect(store.getView()!.feed.some((entry) => entry.decision?.lineId === noticeId)).toBe(true);
  expect(screen.queryByText('A backup bot is playing for me right now.')).toBeNull();
  expect(requests.every((url) => url.startsWith('/api/'))).toBe(true);
});

test('during an opponent turn the rival’s row writes the beat the feed tells and the board points at the rival', async () => {
  vi.useFakeTimers();
  transport();
  const store = game();
  seekOpponent(store);
  render(<BoardScreen store={store} />);
  const told = () => document.querySelectorAll('[data-testid="player-1"] .seat-beat');
  for (let i = 0; i < 20 && told().length === 0; i++) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PACE_TIMING.readable.fillerMs);
    });
  }
  const view = store.getView()!;
  const beats = tableBeats(view.feed, { game: view.observation.public, viewerSeat: 0 });
  const latest = beats.findLast((beat) => beat.seatIndex === 1)!;
  expect(latest).toBeTruthy();
  expect([...told()].at(-1)!.textContent).toContain(latest.text);
  // The beat being held is marked, and the row it sits in is the playing one.
  expect([...told()].at(-1)!.getAttribute('data-current')).toBe('true');
  expect(screen.getByTestId('player-1').getAttribute('data-writing')).toBe('true');
  const rival = view.observation.public.players.find((player) => player.seatIndex === 1)!;
  const square = document.querySelector('.loop-square[data-focus="ai"]');
  expect(square).not.toBeNull();
  expect(square!.getAttribute('data-position')).toBe(String(rival.position));
  expect(square!.getAttribute('data-focus-seat')).toBe('1');
  const pawn = document.querySelector('.trainer-pawn[data-focus="ai"]');
  expect(pawn?.getAttribute('data-seat')).toBe('1');
});

test('a rival’s move beat names the die the engine rolled and the square the spotlight shows', async () => {
  vi.useFakeTimers();
  transport();
  const store = game();
  seekOpponent(store);
  render(<BoardScreen store={store} />);
  let seen = false;
  for (let i = 0; i < 120 && !seen; i++) {
    await act(async () => {
      pass(store);
      await vi.advanceTimersByTimeAsync(PACE_TIMING.readable.fillerMs);
    });
    const view = store.getView()!;
    if (view.observation.public.activeSeatIndex !== 1) continue;
    const row = screen.getByTestId('player-1');
    const move = row.querySelector('.seat-beat[data-message-key="beat.move"]');
    if (!move) continue;
    const roll = view.feed
      .filter((entry) => entry.before.activeSeatIndex === 1)
      .flatMap((entry) => entry.record.events)
      .findLast((event) => event.kind === 'random_result' && event.purpose.startsWith('move:'));
    const rival = view.observation.public.players.find((player) => player.seatIndex === 1)!;
    const kind = view.observation.public.board.find(
      (space) => space.position === rival.position,
    )!.kind;
    expect(move.textContent).toBe(
      t('beat.move', {
        roll: roll?.kind === 'random_result' ? Number(roll.result) : -1,
        square: t('beat.square', { kind: t(`board.kind.${kind}`), position: rival.position }),
      }),
    );
    const square = document.querySelector('.loop-square[data-focus="ai"]');
    expect(square!.getAttribute('data-position')).toBe(String(rival.position));
    seen = true;
  }
  expect(seen).toBe(true);
});

test('a step that tells nothing waits the filler time, not an outcome’s hold', async () => {
  vi.useFakeTimers();
  transport();
  const store = game();
  render(<BoardScreen store={store} />);
  const before = store.getSession()!;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(PACE_TIMING.readable.fillerMs - 1);
  });
  // A greeting may be saved beside the game meanwhile; the game itself has not moved.
  expect(store.getSession()!.state).toBe(before.state);
  expect(store.getSession()!.log.actions).toBe(before.log.actions);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  const after = store.getSession()!;
  expect(after.log.actions).toHaveLength(before.log.actions.length + 1);
  expect(after.log.actions.at(-1)!).toMatchObject({ auto: true, action: { kind: 'roll' } });
  expect(PACE_TIMING.readable.fillerMs).toBeLessThan(PACE_TIMING.readable.hold!.minMs);
});

test('a pending decision always resolves to the fallback or a visible retry error', async () => {
  vi.useFakeTimers();
  transport({ broken: true });
  const store = game();
  seekOpponent(store);
  render(<BoardScreen store={store} />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(PACE_TIMING.readable.fillerMs);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1500);
  });
  expect(screen.getByRole('alert').textContent).toBe(t('turn.opponentError'));
  expect(screen.getByRole('button', { name: t('turn.retry') })).toBeTruthy();
  expect(screen.queryByText(t('ai.thinking'))).toBeNull();
});

test('readable and instant playback finish with identical accepted actions and gameplay state', async () => {
  vi.useFakeTimers();
  transport();
  async function finish(instant: boolean) {
    const store = game();
    const mounted = render(<BoardScreen store={store} />);
    if (instant)
      fireEvent.change(screen.getByRole('combobox', { name: t('pace.label') }), {
        target: { value: 'instant' },
      });
    for (
      let i = 0;
      i < 1200 && store.getView()!.observation.public.phase.kind !== 'finished';
      i++
    ) {
      await act(async () => {
        pass(store);
        await vi.advanceTimersByTimeAsync(PACE_TIMING.readable.hold!.maxMs);
      });
    }
    const session = store.getSession()!;
    expect(session.state.phase.kind).toBe('finished');
    expect(stateHash(replay(session.log))).toBe(stateHash(session.state));
    mounted.unmount();
    return session;
  }
  const readable = await finish(false);
  const instant = await finish(true);
  expect(instant.log.actions).toEqual(readable.log.actions);
  expect(stateHash(instant.state)).toBe(stateHash(readable.state));
}, 120_000);

test('changing the pace while thinking neither restarts the decision nor changes its deadline', async () => {
  vi.useFakeTimers();
  const requests = transport({ backupOnly: false, delay: 2000 });
  const store = game();
  seekOpponent(store);
  const revision = store.getView()!.observation.public.stateRevision;
  render(<BoardScreen store={store} />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(PACE_TIMING.readable.fillerMs);
  });
  expect(screen.getByText(t('ai.thinking'))).toBeTruthy();
  for (const pace of ['fast', 'instant', 'step']) {
    fireEvent.change(screen.getByRole('combobox', { name: t('pace.label') }), {
      target: { value: pace },
    });
  }
  fireEvent.click(screen.getByRole('button', { name: t('pace.pause') }));
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
    await vi.advanceTimersByTimeAsync(PACE_TIMING.readable.fillerMs);
  });
  expect(within(screen.getByTestId('player-1')).getByText(t('ai.backupBadge'))).toBeTruthy();
  expect(within(screen.getByTestId('player-0')).queryByText(t('ai.backupBadge'))).toBeNull();
  expect(screen.getByText(t('ai.reason.rate_limited'))).toBeTruthy();
  transport({ backupOnly: false });
  act(() => {
    seekOpponent(store);
  });
  // The beats the jump told are held first; the rival's next decision follows them.
  const decided = () =>
    store.getView()!.feed.findLast((entry) => entry.decision)?.decision?.source === 'jev';
  for (let i = 0; i < 400 && !decided(); i++) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
  }
  expect(decided()).toBe(true);
  expect(screen.queryByText(t('ai.backupBadge'))).toBeNull();
  expect(screen.queryByText(t('ai.allBackupBanner'))).toBeNull();
});

test.each([
  ['not_an_option', 'ai.backupInvalidAnswer'],
  ['invalid_choice', 'ai.backupInvalidAnswer'],
  ['revision_mismatch', 'ai.backupRevisionMismatch'],
  ['low_confidence', 'ai.backupLowConfidence'],
  ['auto', null],
] as const)(
  'a %s fallback is normal play: its §3.1 note only, no Backup bot badge or banner (spec §3)',
  async (fallbackReason, note) => {
    vi.useFakeTimers();
    transport({ backupOnly: false, decisionFallback: true, fallbackReason });
    const store = game();
    seekOpponent(store);
    render(<BoardScreen store={store} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PACE_TIMING.readable.fillerMs);
    });
    expect(
      store.getView()!.feed.some((entry) => entry.decision?.fallbackReason === fallbackReason),
    ).toBe(true);
    expect(screen.queryByText(t('ai.backupBadge'))).toBeNull();
    expect(screen.queryByText(t('ai.allBackupBanner'))).toBeNull();
    const shown = document.querySelector('.ai-turn-note');
    if (note) expect(shown?.textContent).toBe(t(note));
    else expect(shown).toBeNull();
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

test('playback answers an AI defender’s Ability window during the human turn (§6.4)', async () => {
  vi.useFakeTimers();
  vi.stubGlobal(
    'fetch',
    async () =>
      new Response(JSON.stringify({ backupOnly: true, jevEnabled: false, reason: 'disabled' })),
  );
  const state = createGame(
    configForSetup(
      {
        mode: 'quick',
        human: { classId: 'researcher', starterSpeciesId: 'porygon' },
        opponents: [
          {
            classId: 'main-character',
            starterSpeciesId: 'squirtle',
            personality: 'greedy',
            difficulty: 'normal',
          },
        ],
      },
      'playback-defender',
    ),
    engineContent,
  );
  state.phase = { kind: 'strategy' };
  state.globalTurnNo = 5;
  state.turnBudgets = { tacticalAction: 1, catchAttempt: 1, pokemonAbility: 1 };
  for (const player of state.players) player.ownTurnNo = 2;
  state.players[0]!.team[0]!.abilityReady = false;
  state.players[0]!.items = [
    { instanceId: 'ticket', itemId: 'battle-ticket', name: 'Battle Ticket', visibility: 'secret' },
  ];
  const store = createGameStore();
  store.restore({ state, log: createGameLog(state) }, [
    { seatIndex: 1, personality: 'greedy', difficulty: 'normal' },
  ]);
  expect('accepted' in store.choose('use-item:ticket:seat-1')).toBe(true);
  while (store.advance({ human: true }));
  expect(store.getSession()!.state.phase).toMatchObject({
    kind: 'pvp',
    battle: { step: 'defender_window' },
  });
  expect(store.getSession()!.state.activeSeatIndex).toBe(0);
  expect(pendingDecision(store.getSession()!.state)?.seatIndex).toBe(1);
  const mounted = renderHook(() => {
    const view = useSyncExternalStore(store.subscribe, store.getView);
    return useTurnPlayback(store, view);
  });
  act(() => mounted.result.current.setPace('instant'));
  for (let step = 0; step < 10; step++) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
  }
  expect(
    store
      .getSession()!
      .log.actions.some(
        (record) => record.action.actorId === 'ai-1' && record.action.kind === 'activate_ability',
      ),
  ).toBe(true);
  expect(store.getSession()!.state.phase).not.toMatchObject({
    kind: 'pvp',
    battle: { step: 'defender_window' },
  });
  mounted.unmount();
});
