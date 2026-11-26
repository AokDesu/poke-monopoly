import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, expect, test, vi } from 'vitest';
import { engineContent } from '../game/content.ts';
import {
  configForSetup,
  createGameStore,
  opponentSettings,
  type GameStore,
} from '../game/store.ts';
import { t } from '../i18n/en.ts';
import { tableBeats } from './beats.ts';
import { BoardScreen } from './BoardScreen.tsx';
import { holdMs, PACE_TIMING } from './pace.ts';

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

const READABLE = PACE_TIMING.readable;
const QUIET = ['skip', 'roll', 'keep-die', 'finish-sell', 'skip-shop', 'release'];
/** Shorter than the decision deadline (1.5 s), so the held answer is still the one in flight. */
const AI_WAIT = 1000;

type Pick = (actions: { id: string; kind: string }[]) => { id: string } | undefined;

/**
 * The local server with Jev on and Haiku off, so table talk comes from the line bank at once.
 * `gate` holds every decision until released; `pick` chooses for the rivals.
 */
function server({ gate, pick }: { gate?: Promise<void>; pick?: Pick } = {}) {
  const calls = { decide: 0, aborted: 0 };
  vi.stubGlobal('fetch', async (url: RequestInfo | URL, init?: RequestInit) => {
    const path = String(url);
    if (path === '/api/ai/status')
      return new Response(
        JSON.stringify({
          backupOnly: false,
          jevEnabled: true,
          reason: null,
          speech: { enabled: false, reason: 'disabled' },
        }),
      );
    if (path === '/api/ai/outcome') return new Response(null, { status: 204 });
    const { enabledActions } = JSON.parse(String(init?.body)) as {
      enabledActions: { id: string; kind: string }[];
    };
    const choice = pick?.(enabledActions) ?? enabledActions[0]!;
    if (path === '/api/ai/fallback')
      return new Response(JSON.stringify({ choice: choice.id, source: 'fallback' }));
    calls.decide++;
    init?.signal?.addEventListener('abort', () => calls.aborted++);
    await gate;
    return new Response(JSON.stringify({ choice: choice.id, source: 'jev' }));
  });
  return calls;
}

function humanGame(seed = 7): GameStore {
  const setup = {
    mode: 'quick' as const,
    // The audit's table (#251): a Researcher, whose end of turn has nothing to choose.
    human: { classId: 'researcher', starterSpeciesId: 'porygon' },
    opponents: [
      { classId: 'main-character', starterSpeciesId: 'bulbasaur' },
      { classId: 'rival', starterSpeciesId: 'eevee' },
      { classId: 'fisherman', starterSpeciesId: 'magikarp' },
    ].map((seat) => ({ ...seat, personality: 'greedy' as const, difficulty: 'normal' as const })),
  };
  const store = createGameStore();
  store.start(configForSetup(setup, seed), engineContent, opponentSettings(setup));
  return store;
}

/**
 * The human's answer when the game waits for a choice: a Ball if `catching`, else the quietest
 * one. A sole option is the engine's to apply, as it is in play.
 */
function answerForHuman(store: GameStore, catching = false) {
  const view = store.getView()!;
  if (view.decision?.seatIndex !== 0 || view.legalActions.enabled.length < 2) return;
  const options = view.legalActions.enabled;
  const choice =
    (catching ? options.find((entry) => entry.kind === 'catch') : undefined) ??
    QUIET.map((id) => options.find((entry) => entry.id === id)).find(Boolean) ??
    options[0]!;
  store.choose(choice.id);
}

/** When each log record landed, on the fake clock. */
function clock(store: GameStore) {
  const times: number[] = store.getSession()!.log.actions.map(() => Date.now());
  store.subscribe(() => {
    const length = store.getSession()?.log.actions.length ?? 0;
    while (times.length < length) times.push(Date.now());
  });
  return times;
}

const run = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

/** Plays on in small steps, the human answering at once, until `done` holds. */
async function playUntil(store: GameStore, done: () => boolean, catching = false) {
  for (let spent = 0; spent < 400_000 && !done(); spent += 50) {
    act(() => answerForHuman(store, catching));
    await run(50);
  }
  expect(done()).toBe(true);
}

const activeSeat = (store: GameStore) => store.getView()!.observation.public.activeSeatIndex;
const turn = (store: GameStore) => store.getView()!.observation.public.globalTurnNo;
const logLength = (store: GameStore) => store.getSession()!.log.actions.length;

/** Each log record's place in the human's feed (-1: a chat the human may not see). */
function feedIndexes(store: GameStore): number[] {
  const feed = store.getView()!.feed;
  let next = 0;
  return store.getSession()!.log.actions.map((record) => {
    const entry = feed[next];
    return entry &&
      entry.record.action.actorId === record.action.actorId &&
      entry.record.action.kind === record.action.kind
      ? next++
      : -1;
  });
}

test('every outcome is held within the formula before the next step, the player’s own results at least 2.5 s even when the player answers at once (§3)', async () => {
  vi.useFakeTimers();
  server({ pick: (actions) => actions.find((entry) => entry.kind === 'catch') });
  const store = humanGame();
  const times = clock(store);
  render(<BoardScreen store={store} />);
  await playUntil(store, () => turn(store) >= 17, true);

  const view = store.getView()!;
  const beats = tableBeats(view.feed, { game: view.observation.public, viewerSeat: 0 });
  const records = store.getSession()!.log.actions;
  const indexes = feedIndexes(store);
  // What each record told, and how long Readable holds it.
  const toldBy = records.map((_, index) => beats.filter((beat) => beat.at === indexes[index]));
  const heldBy = toldBy.map((told) =>
    told.reduce(
      (sum, beat) =>
        sum +
        holdMs(
          {
            text: beat.text,
            ownChoice: beat.seatIndex === 0 && beat.kind === 'choice',
            ownResult: beat.seatIndex === 0 && beat.kind === 'result',
          },
          'readable',
        ),
      0,
    ),
  );
  // The player's own choices: the player may make one at any time, even while a beat is held.
  const byPlayer = records.map((record) => record.action.actorId === 'human' && !record.auto);
  let rivalOutcomes = 0;
  let ownResults = 0;
  let answeredDuringHold = 0;
  toldBy.forEach((told, index) => {
    if (told.length === 0) return;
    // The next step the game starts by itself waits for this hold and for every one told after it
    // in the meantime: a choice the player makes meanwhile ends none of them, only Next does.
    let next = index + 1;
    let held = heldBy[index]!;
    while (byPlayer[next]) held += heldBy[next++]!;
    if (!records[next]) return;
    const gap = times[next]! - times[index]!;
    const where = `${told.map((beat) => beat.text).join(' | ')} (record ${index})`;
    expect(gap, where).toBeGreaterThanOrEqual(held);
    // Never much longer: the hold, a speech line's second and one filler step. A step the game
    // started is told at once; the player's choice may wait behind a hold still running.
    if (next === index + 1 && !byPlayer[index])
      expect(gap, where).toBeLessThanOrEqual(held + READABLE.speechMs + READABLE.fillerMs + 100);
    for (const beat of told) {
      if (beat.seatIndex !== 0) rivalOutcomes++;
      else if (beat.kind === 'result') {
        ownResults++;
        if (next > index + 1) answeredDuringHold++;
        expect(gap, where).toBeGreaterThanOrEqual(2500);
      }
    }
  });
  expect(rivalOutcomes).toBeGreaterThan(10);
  expect(ownResults).toBeGreaterThan(2);
  // The player answered while their own result was held, as a quick player does.
  expect(answeredDuringHold).toBeGreaterThan(0);
}, 300_000);

test('Next (Space) ends a rival’s hold at once; the next step follows after the filler time (§3)', async () => {
  vi.useFakeTimers();
  server();
  const store = humanGame();
  render(<BoardScreen store={store} />);
  const held = () =>
    document.querySelector('.seat-row:not([data-seat="0"]) .seat-beat[data-current="true"]');
  await playUntil(store, () => activeSeat(store) !== 0 && held() !== null);
  const before = logLength(store);
  await run(READABLE.fillerMs + 10);
  expect(logLength(store), 'the hold keeps the game still').toBe(before);
  fireEvent.keyDown(document.body, { key: ' ' });
  await run(READABLE.fillerMs + 10);
  expect(logLength(store)).toBeGreaterThan(before);
}, 120_000);

test('Pause (P) holds the game for as long as it stays paused, and P again resumes (§3)', async () => {
  vi.useFakeTimers();
  server();
  const store = humanGame();
  render(<BoardScreen store={store} />);
  await playUntil(store, () => activeSeat(store) !== 0);
  fireEvent.keyDown(document.body, { key: 'p' });
  expect(screen.getByRole('button', { name: t('pace.resume') })).toBeTruthy();
  // The beat already on screen finishes its hold; then nothing starts.
  await run(READABLE.hold!.maxMs + READABLE.speechMs);
  const paused = logLength(store);
  await run(120_000);
  expect(logLength(store)).toBe(paused);
  fireEvent.keyDown(document.body, { key: 'P' });
  await run(READABLE.hold!.maxMs + READABLE.speechMs + READABLE.fillerMs);
  expect(logLength(store)).toBeGreaterThan(paused);
}, 120_000);

test('a pause stepped through with Next ends when the turn reaches the player: the game never locks (§3)', async () => {
  vi.useFakeTimers();
  server();
  const store = humanGame();
  render(<BoardScreen store={store} />);
  await playUntil(store, () => activeSeat(store) !== 0);
  fireEvent.keyDown(document.body, { key: 'p' });
  expect(screen.getByRole('button', { name: t('pace.resume') })).toBeTruthy();
  const next = () =>
    screen.queryByRole('button', {
      name: new RegExp(`^${t('pace.next')}`),
    }) as HTMLButtonElement | null;
  // Next and nothing else, until the turn passes to the player.
  for (let presses = 0; presses < 400 && activeSeat(store) !== 0; presses++) {
    await run(50);
    const button = next();
    if (button && !button.disabled) fireEvent.click(button);
  }
  expect(activeSeat(store)).toBe(0);
  await run(50);
  expect(screen.queryByRole('button', { name: t('pace.resume') })).toBeNull();
  // The player plays their turn, and the rivals' next turn plays by itself: nothing is still paused.
  await playUntil(store, () => activeSeat(store) !== 0);
  const before = logLength(store);
  await run(READABLE.hold!.maxMs + READABLE.speechMs + 2 * READABLE.fillerMs);
  expect(screen.queryByRole('button', { name: t('pace.resume') })).toBeNull();
  expect(screen.getByRole('button', { name: t('pace.pause') })).toBeTruthy();
  expect(logLength(store)).toBeGreaterThan(before);
}, 300_000);

test('a key meant for what has focus is left to it: P in the pace list is typing, Space on a button presses it', async () => {
  vi.useFakeTimers();
  server();
  const store = humanGame();
  render(<BoardScreen store={store} />);
  const held = () =>
    document.querySelector('.seat-row:not([data-seat="0"]) .seat-beat[data-current="true"]');
  await playUntil(store, () => activeSeat(store) !== 0 && held() !== null);
  fireEvent.keyDown(screen.getByLabelText(t('pace.label')), { key: 'p' });
  expect(screen.queryByRole('button', { name: t('pace.resume') })).toBeNull();
  // Space on a focused button is that button's; the hold stays.
  const before = logLength(store);
  fireEvent.keyDown(screen.getByRole('button', { name: t('pace.skipToMyTurn') }), { key: ' ' });
  await run(READABLE.fillerMs + 10);
  expect(logLength(store)).toBe(before);
  expect(held()).not.toBeNull();
  // P on a button is not typing: it pauses.
  fireEvent.keyDown(screen.getByRole('button', { name: t('pace.skipToMyTurn') }), { key: 'p' });
  expect(screen.getByRole('button', { name: t('pace.resume') })).toBeTruthy();
});

test('Skip to my turn runs to the player’s turn at once and still writes every rival’s turn in its row (§3)', async () => {
  vi.useFakeTimers();
  server({ pick: (actions) => actions.find((entry) => entry.kind === 'catch') });
  const store = humanGame();
  render(<BoardScreen store={store} />);
  // The first rival has just started: the rest of the round has not been played yet.
  await playUntil(store, () => activeSeat(store) === 1 && turn(store) >= 5);
  const start = turn(store);
  fireEvent.click(screen.getByRole('button', { name: t('pace.skipToMyTurn') }));
  for (let i = 0; i < 40 && activeSeat(store) !== 0; i++) await run(10);
  expect(activeSeat(store)).toBe(0);
  expect(turn(store)).toBe(start + 3);
  // Back at the chosen pace: the player's own turn is read at Readable.
  expect(screen.queryByRole('button', { name: t('pace.skipToMyTurn') })).toBeNull();
  expect((screen.getByLabelText(t('pace.label')) as HTMLSelectElement).value).toBe('readable');
  // The last rival's row folds once its turn has been over for the fold time.
  await run(READABLE.foldMs);

  const view = store.getView()!;
  const beats = tableBeats(view.feed, { game: view.observation.public, viewerSeat: 0 });
  for (const seat of [1, 2, 3]) {
    const lastTurn = beats.filter(
      (beat) => beat.seatIndex === seat && beat.turn === start + seat - 1,
    );
    expect(lastTurn.length, `seat ${seat}`).toBeGreaterThan(0);
    const row = screen.getByTestId(`player-${seat}`);
    // The beat's words, without the "→ you" tag a beat that touched the player carries.
    const shown = [...row.querySelectorAll('.seat-beat')].map((item) =>
      item.textContent!.replace(t('row.toYou'), ''),
    );
    // A long turn shows its last four beats; every one of them is in the row.
    expect(shown).toEqual(lastTurn.slice(-4).map((beat) => beat.text));
    expect(row.querySelector('.seat-story')?.getAttribute('data-folded')).toBe('true');
  }
}, 120_000);

test('nothing the UI does to its timing cancels or repeats an AI decision in flight (§3)', async () => {
  vi.useFakeTimers();
  const { promise: gate, resolve: release } = Promise.withResolvers<void>();
  // Rivals decide only through the held route from their first choice on.
  const calls = server({
    gate,
    pick: (actions) => actions.find((entry) => entry.kind === 'catch'),
  });
  const store = humanGame();
  render(<BoardScreen store={store} />);
  await playUntil(store, () => calls.decide > 0);
  expect(screen.getByText(t('ai.thinking'))).toBeTruthy();
  const waiting = logLength(store);
  // Everything the player can do to the pace while the rival thinks.
  fireEvent.keyDown(document.body, { key: ' ' });
  fireEvent.keyDown(document.body, { key: 'p' });
  for (const pace of ['step', 'instant', 'fast', 'readable']) {
    fireEvent.change(screen.getByLabelText(t('pace.label')), { target: { value: pace } });
  }
  fireEvent.keyDown(document.body, { key: 'p' });
  fireEvent.click(screen.getByRole('button', { name: t('pace.skipToMyTurn') }));
  await run(AI_WAIT);
  expect(calls.decide).toBe(1);
  expect(calls.aborted).toBe(0);
  release();
  await run(10);
  // The answer landed as the rival's decision, from Jev, once.
  expect(logLength(store)).toBeGreaterThan(waiting);
  expect(store.getSession()!.log.actions[waiting]!.action.actorId).not.toBe('human');
  expect(store.getView()!.feed.some((entry) => entry.decision?.source === 'jev')).toBe(true);
}, 120_000);

test('at Step pace a rival’s outcome waits for Next however long it takes (§3)', async () => {
  vi.useFakeTimers();
  server();
  const store = humanGame();
  store.setPace('step');
  render(<BoardScreen store={store} />);
  const held = () =>
    document.querySelector('.seat-row:not([data-seat="0"]) .seat-beat[data-current="true"]');
  for (let i = 0; i < 4000 && !(activeSeat(store) !== 0 && held()); i++) {
    act(() => answerForHuman(store));
    fireEvent.keyDown(document.body, { key: ' ' });
    await run(50);
  }
  expect(held()).not.toBeNull();
  const waiting = logLength(store);
  await run(10 * 60_000);
  expect(logLength(store)).toBe(waiting);
  fireEvent.click(screen.getByRole('button', { name: t('pace.next') }));
  await run(READABLE.fillerMs + 10);
  expect(logLength(store)).toBeGreaterThan(waiting);
}, 300_000);

test('a rival’s challenge to the player is lit in its row and listed first when the player’s turn starts (§3)', async () => {
  vi.useFakeTimers();
  server({
    pick: (actions) =>
      actions.find((entry) => entry.id === 'declare-pvp:0') ??
      actions.find((entry) => entry.kind === 'declare_pvp'),
  });
  const store = humanGame();
  render(<BoardScreen store={store} />);
  const banner = () => screen.queryByRole('region', { name: t('row.touched') });
  await playUntil(store, () => activeSeat(store) === 0 && turn(store) > 4 && banner() !== null);
  const view = store.getView()!;
  const touched = tableBeats(view.feed, { game: view.observation.public, viewerSeat: 0 }).filter(
    (beat) => beat.touchedYou && beat.seatIndex !== 0 && beat.turn >= turn(store) - 3,
  );
  expect(touched.length).toBeGreaterThan(0);
  const listed = within(banner()!)
    .getAllByRole('listitem')
    .map((item) => item.textContent);
  for (const beat of touched) expect(listed.some((line) => line?.endsWith(beat.text))).toBe(true);
  // The banner comes before the rows, and the row that touched the player is lit.
  const area = document.querySelector('.players-area')!;
  expect(area.firstElementChild).toBe(banner());
  for (const seat of new Set(touched.map((beat) => beat.seatIndex))) {
    expect(screen.getByTestId(`player-${seat}`).getAttribute('data-touched')).toBe('true');
  }
}, 300_000);
