import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeAll, expect, test, vi } from 'vitest';
import { replay, stateHash } from '../../../engine/index.ts';
import { engineContent } from '../game/content.ts';
import { configForSetup, createGameStore, type GameStore } from '../game/store.ts';
import { t } from '../i18n/en.ts';
import { BoardScreen } from './BoardScreen.tsx';
import { PACE_TIMING } from './pace.ts';

// Twenty seeded human turns through the real screen: ~50 s at full parallelism, so a 60 s limit is not a margin (ET-05).
const LONG_GAME_MS = 240_000;

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function start(seed = 1) {
  vi.useFakeTimers();
  vi.stubGlobal('fetch', async (_url: RequestInfo | URL, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body));
    const choice =
      request.enabledActions.find((entry: { kind: string }) =>
        ['release', 'skip', 'skip_shop'].includes(entry.kind),
      ) ?? request.enabledActions[0];
    return new Response(
      JSON.stringify({ choice: choice.id, source: 'fallback', fallbackReason: 'stub' }),
    );
  });
  const store = createGameStore();
  store.start(
    {
      ...configForSetup(
        {
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
        },
        seed,
      ),
      lapTarget: 10,
    },
    engineContent,
    [{ seatIndex: 1, personality: 'greedy', difficulty: 'normal' }],
  );
  render(
    <StrictMode>
      <BoardScreen store={store} />
    </StrictMode>,
  );
  current = store;
  return store;
}
/**
 * Plays on in short steps until the game moves, for at most a long Readable hold chain. Each
 * step is its own `act`, so the pace engine re-renders and schedules its next timer in between.
 */
let current: GameStore | null = null;
const tick = async () => {
  const revision = current?.getSession()?.state.stateRevision;
  const { hold, speechMs, fillerMs } = PACE_TIMING.readable;
  for (let spent = 0; spent < 2 * hold!.maxMs + speechMs + fillerMs; spent += 250) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    if (current?.getSession()?.state.stateRevision !== revision) return;
  }
};
function clickDecision() {
  const area =
    screen.queryByRole('dialog') ?? screen.getByRole('region', { name: t('turn.actions') });
  const pass = [
    t('shop.skip'),
    t('strategy.skip'),
    t('sell.keep'),
    t('social.skip'),
    t('social.continue'),
  ]
    .map((name) => within(area).queryByRole('button', { name }))
    .find((button) => button !== null);
  if (pass) {
    fireEvent.click(pass);
    return;
  }
  const buttons = within(area)
    .queryAllByRole('button')
    // The pace of the table is not a decision.
    .filter((entry) => !entry.hasAttribute('disabled') && !entry.closest('.pace-controls'));
  if (area.tagName === 'DIALOG' && buttons.length === 1) return;
  if (buttons[0]) fireEvent.click(buttons[0]);
  // A battle reward is selected first and committed by Confirm.
  const confirm = within(area).queryByRole('button', { name: t('battle.reward.confirm') });
  if (confirm) fireEvent.click(confirm);
}
function reasonsAreVisible() {
  for (const button of document.querySelectorAll('button:disabled')) {
    const reason = document.getElementById(button.getAttribute('aria-describedby')!);
    expect(reason?.textContent?.trim()).toBeTruthy();
    expect(button.getAttribute('aria-disabled')).toBe('true');
  }
}

test(
  '20 seeded human turns have reachable choices, automatic single steps, visible reasons and replayable actions',
  async () => {
    const store = start(1);
    for (let step = 0; step < 700; step++) {
      expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(t('play.heading'));
      expect(
        screen.getByRole('region', { name: t('turn.actions') }).textContent?.trim(),
      ).toBeTruthy();
      reasonsAreVisible();
      const view = store.getView()!;
      if (
        view.observation.public.activeSeatIndex === 0 &&
        view.observation.public.phase.kind === 'encounter' &&
        !view.observation.public.phase.catchRoll
      ) {
        if (view.legalActions.enabled.length > 1) {
          expect(screen.getByRole('region', { name: t('turn.actions') }).textContent).toContain(
            t('turn.encounterBody'),
          );
        }
      }
      if (view.observation.public.players[0]!.ownTurnNo > 20) break;
      // A click may end in the next human decision (Social, then Strategy), which waits for the
      // player; the turn still has to have moved on since before it.
      const revision = store.getView()!.observation.public.stateRevision;
      clickDecision();
      await tick();
      expect(store.getView()!.observation.public.stateRevision).toBeGreaterThan(revision);
    }
    expect(store.getView()!.observation.public.players[0]!.ownTurnNo).toBe(21);
    for (const result of ['caught', 'escaped', 'released']) {
      expect(document.querySelector(`[data-message-key="encounter.${result}"]`)).not.toBeNull();
    }
    expect(
      within(screen.getByRole('log', { name: t('board.log') })).getAllByText(
        t('turn.automatic', { phase: t('board.phase.start') }),
      ).length,
    ).toBeGreaterThan(0);
    const session = store.getSession()!;
    expect(stateHash(replay(session.log))).toBe(stateHash(session.state));
  },
  LONG_GAME_MS,
);

test('Start opens Sell before the destination resolves, then continues through the engine', async () => {
  const store = start(1);
  for (let step = 0; step < 250; step++) {
    const game = store.getView()!.observation.public;
    if (game.phase.kind === 'sell' && game.activeSeatIndex === 0) break;
    clickDecision();
    await tick();
  }
  expect(store.getView()!.observation.public.phase.kind).toBe('sell');
  const sellDialog = screen.getByRole('dialog');
  expect(within(sellDialog).getByRole('heading', { name: t('turn.sellHeading') })).toBeTruthy();
  expect(within(sellDialog).getByRole('button', { name: t('sell.keep') })).toBeTruthy();
  const records = store.getSession()!.log.actions;
  const move = records.findLast((record) =>
    record.events.some((event) => event.kind === 'phase_changed' && event.to === 'sell'),
  )!;
  expect(move.events.map((event) => event.kind)).toEqual([
    'random_result',
    'coin_transfer',
    'phase_changed',
  ]);
  expect(move.events[1]).toMatchObject({ reason: 'start_income' });
  expect(
    records
      .slice(records.indexOf(move))
      .flatMap((record) => record.events)
      .some((event) => event.kind === 'space_resolved'),
  ).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: t('sell.keep') }));
  expect(store.getView()!.observation.public.phase.kind).toBe('resolve');
  expect(store.getSession()!.log.actions.at(-1)!.action).toMatchObject({
    kind: 'sell',
    payload: { pokemonInstanceIds: [] },
  });
  const soldAt = store.getSession()!.log.actions.length;
  await tick();
  // The human's own steps run on a short pause (not the AI pace), so the resolve and
  // end-handoff may both commit within one tick; the destination still resolves.
  expect(
    store
      .getSession()!
      .log.actions.slice(soldAt)
      .some((record) => record.events.some((event) => event.kind === 'space_resolved')),
  ).toBe(true);
}, 30000);

test('an unavailable opponent service has an explicit retry and preserves the decision until success', async () => {
  const store = start(1);
  vi.stubGlobal('fetch', async () => new Response('', { status: 503 }));
  for (
    let step = 0;
    step < 100 && !screen.queryByRole('button', { name: t('turn.retry') });
    step++
  ) {
    clickDecision();
    await tick();
  }
  expect(screen.getByRole('alert').textContent).toBe(t('turn.opponentError'));
  const before = store.getSession();
  vi.stubGlobal('fetch', async (_url: RequestInfo | URL, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body));
    return new Response(
      JSON.stringify({
        choice: request.enabledActions[0].id,
        source: 'fallback',
        fallbackReason: 'stub',
      }),
    );
  });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: t('turn.retry') }));
  });
  await tick();
  expect(store.getSession()).not.toBe(before);
  expect(screen.queryByRole('alert')).toBeNull();
}, 15000);
