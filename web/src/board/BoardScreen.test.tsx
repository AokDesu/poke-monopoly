import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeAll, expect, test, vi } from 'vitest';
import { replay, stateHash } from '../../../engine/index.ts';
import { engineContent } from '../game/content.ts';
import { configForSetup, createGameStore } from '../game/store.ts';
import { t } from '../i18n/en.ts';
import { BoardScreen } from './BoardScreen.tsx';

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
    return new Response(JSON.stringify({ choice: choice.id }));
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
  return store;
}
const tick = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(1600);
  });
function clickDecision() {
  const area =
    screen.queryByRole('dialog') ?? screen.getByRole('region', { name: t('turn.actions') });
  const buttons = within(area)
    .queryAllByRole('button')
    .filter((entry) => !entry.hasAttribute('disabled'));
  if (area.tagName === 'DIALOG' && buttons.length === 1) return;
  if (buttons[0]) fireEvent.click(buttons[0]);
}
function reasonsAreVisible() {
  for (const button of document.querySelectorAll('button:disabled')) {
    const reason = document.getElementById(button.getAttribute('aria-describedby')!);
    expect(reason?.textContent?.trim()).toBeTruthy();
    expect(button.getAttribute('aria-disabled')).toBe('true');
  }
}

test('20 seeded human turns have reachable choices, automatic single steps, visible reasons and replayable actions', async () => {
  const store = start(1);
  let sawBalls = false;
  let sawNoBalls = false;
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
      sawBalls ||= view.catchOdds.length > 0;
      sawNoBalls ||= view.catchOdds.length === 0;
      if (view.legalActions.enabled.length > 1) {
        expect(screen.getByRole('region', { name: t('turn.actions') }).textContent).toContain(
          t('turn.encounterBody'),
        );
      }
    }
    if (view.observation.public.players[0]!.ownTurnNo > 20) break;
    clickDecision();
    const revision = store.getView()!.observation.public.stateRevision;
    await tick();
    expect(store.getView()!.observation.public.stateRevision).toBeGreaterThan(revision);
  }
  expect(store.getView()!.observation.public.players[0]!.ownTurnNo).toBe(21);
  expect(sawBalls).toBe(true);
  expect(sawNoBalls).toBe(true);
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
}, 60000);

test('Start opens Sell before the destination resolves, then continues through the engine', async () => {
  const store = start(1);
  for (let step = 0; step < 250; step++) {
    const game = store.getView()!.observation.public;
    if (game.phase.kind === 'sell' && game.activeSeatIndex === 0) break;
    clickDecision();
    await tick();
  }
  expect(store.getView()!.observation.public.phase.kind).toBe('sell');
  expect(screen.getByRole('heading', { name: t('turn.sellHeading') })).toBeTruthy();
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
  fireEvent.click(screen.getByRole('button', { name: t('turn.continue') }));
  expect(store.getView()!.observation.public.phase.kind).toBe('resolve');
  expect(store.getSession()!.log.actions.at(-1)!.action).toMatchObject({
    kind: 'sell',
    payload: { pokemonInstanceIds: [] },
  });
  await tick();
  expect(
    store
      .getSession()!
      .log.actions.at(-1)!
      .events.some((event) => event.kind === 'space_resolved'),
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
    return new Response(JSON.stringify({ choice: request.enabledActions[0].id }));
  });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: t('turn.retry') }));
  });
  await tick();
  expect(store.getSession()).not.toBe(before);
  expect(screen.queryByRole('alert')).toBeNull();
}, 15000);
