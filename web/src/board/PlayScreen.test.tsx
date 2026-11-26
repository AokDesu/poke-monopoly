import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useSyncExternalStore } from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import {
  createGame,
  createGameConfig,
  createGameLog,
  createRng,
  fixtureSchema,
  observe,
  observeSpectator,
  type GameState,
} from '../../../engine/index.ts';
import encounterWithBalls from '../../../engine/fixtures/encounter-with-balls.json';
import sellThree from '../../../engine/fixtures/sell-phase-three-pokemon.json';
import shopLowCoins from '../../../engine/fixtures/shop-low-coins.json';
import strategyWithItems from '../../../engine/fixtures/strategy-with-items.json';
import { engineContent } from '../game/content.ts';
import { createGameStore, type GameStore, type SeatFeedEntry } from '../game/store.ts';
import { STATIC_PLAYBACK } from '../gallery/scenes.ts';
import { t } from '../i18n/en.ts';
import { itemName } from '../i18n/names.ts';
import type { TurnPlayback } from './useTurnPlayback.ts';
import { Board } from './Board.tsx';
import { BattleTerms } from './BattleTerms.tsx';
import { foldLabel } from './DecisionCard.tsx';
import { startPass } from './SellPanel.tsx';
import { TurnPanel } from './TurnPanel.tsx';
import { WALK_STEP_MS } from './usePawnWalk.ts';

// Must-never-break rules of the one-screen play layout (spec §3 Board screen, §3.1; issue #256).

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** A contract fixture played under the current engine version and content. */
function fixtureState(input: unknown): GameState {
  const state = structuredClone(fixtureSchema.parse(input).state);
  state.config = createGameConfig({ seats: state.config.seats, seed: 3, lapTarget: 3 });
  state.content = structuredClone(engineContent);
  state.rng = createRng(3);
  return state;
}

/** The same fixture with `seat` as the one human seat: the store reads the screen from it. */
function humanAt(state: GameState, seat: number): GameState {
  state.config.seats = state.config.seats.map((entry) => ({
    ...entry,
    controller: entry.seatIndex === seat ? ('human' as const) : ('ai' as const),
  }));
  return state;
}

function storeOf(state: GameState): GameStore {
  const store = createGameStore();
  store.restore({ state, log: createGameLog(state) });
  return store;
}

/** The live card router for the store's viewing seat, with the store's own Sell adapter. */
function Live({
  store,
  playback = STATIC_PLAYBACK,
  onChoose,
}: {
  store: GameStore;
  playback?: TurnPlayback;
  onChoose?: (id: string) => void;
}) {
  const view = useSyncExternalStore(store.subscribe, store.getView)!;
  return (
    <TurnPanel
      view={view}
      playback={playback}
      actionError={false}
      onChoose={onChoose ?? ((id) => store.choose(id))}
      quoteSale={store.quoteSale}
      onSell={(ids) =>
        store.submit({
          actorId: view.observation.public.players.find((p) => p.seatIndex === view.seatIndex)!
            .actorId,
          kind: 'sell',
          payload: { pokemonInstanceIds: ids },
        })
      }
    />
  );
}

const card = () => document.querySelector<HTMLElement>('.decision-card')!;
const footer = () => card().querySelector<HTMLElement>('.decision-actions')!;
const body = () => card().querySelector<HTMLElement>('.decision-body');

// ------------------------------------------------ 1. no hidden information outside its own seat

test('the hand shows only the viewing seat’s own Balls, items and team, read as a value (§4.1)', () => {
  const state = humanAt(fixtureState(strategyWithItems), 1);
  state.players[0]!.items.push({
    instanceId: 'SENTINEL-UID',
    itemId: 'pickpocket',
    name: 'SENTINEL-NAME',
    visibility: 'secret',
  });
  state.players[0]!.balls = { poke: 937, great: 941, ultra: 947 };
  state.players[1]!.balls = { poke: 3, great: 2, ultra: 1 };
  const { container } = render(<Board observation={observe(state, 1)} />);
  const hand = screen.getByRole('region', { name: t('hand.label') });
  expect(hand.getAttribute('data-seat')).toBe('1');
  for (const [ball, count] of Object.entries(state.players[1]!.balls)) {
    expect(hand.querySelector(`[data-ball="${ball}"] strong`)!.textContent).toBe(String(count));
  }
  const own = state.players[1]!.items.map((item) => itemName(item.itemId));
  const chips = [...hand.querySelectorAll('.hand-items .hand-chip')].map(
    (chip) => chip.textContent,
  );
  expect(chips).toEqual(own);
  // Seat 0's pouch and its secret item are nowhere on the screen read from seat 1.
  expect(container.innerHTML).not.toMatch(/SENTINEL|937|941|947/);
});

test('a watcher, who holds no seat, has no hand at all', () => {
  const state = fixtureState(strategyWithItems);
  render(<Board observation={{ public: observeSpectator(state).public }} />);
  expect(screen.queryByRole('region', { name: t('hand.label') })).toBeNull();
});

test.each([
  ['an encounter', encounterWithBalls],
  ['a Sell Phase', sellThree],
  ['a Shop', shopLowCoins],
  ['Strategy', strategyWithItems],
])('during a rival’s %s the card is the rival’s turn and shows none of its choices', (_, input) => {
  // Seat 0 decides; the screen is read from seat 1.
  const state = humanAt(fixtureState(input), 1);
  const rivalItems = state.players[0]!.items.map((item) => itemName(item.itemId));
  render(<Live store={storeOf(state)} />);
  expect(card().getAttribute('data-card')).toBe('rival');
  expect(card().querySelectorAll('input, [data-primary]:not([aria-keyshortcuts])')).toHaveLength(0);
  const text = card().textContent!;
  expect(text).not.toMatch(/ left|%|Sell |Buy /);
  for (const name of rivalItems) expect(text).not.toContain(name);
});

// ---------------------------- 2. the primary action and its alternative never scroll out of view

/** The footer holds `names` and the scrolling body holds none of them. */
function inFooter(...names: (string | RegExp)[]) {
  for (const name of names) {
    expect(within(footer()).getByRole('button', { name })).toBeTruthy();
    if (body()) expect(within(body()!).queryByRole('button', { name })).toBeNull();
  }
}

test('Encounter: every held Ball and Release sit in the footer, with how many are left (§4.3)', () => {
  const state = fixtureState(encounterWithBalls);
  const store = storeOf(state);
  render(<Live store={store} />);
  expect(card().getAttribute('data-card')).toBe('encounter');
  for (const odds of store.getView()!.catchOdds) {
    inFooter(
      t('encounter.ballChoiceLeft', {
        ball: t(`board.ball.${odds.ballType}`),
        percent: odds.percent,
        count: state.players[0]!.balls[odds.ballType],
      }),
    );
  }
  inFooter(t('encounter.release'));
});

test('Sell: Sell and Keep all sit in the footer; Sell is greyed with its reason until one is ticked', async () => {
  const store = storeOf(fixtureState(sellThree));
  render(<Live store={store} />);
  expect(card().getAttribute('data-card')).toBe('sell');
  inFooter(t('sell.confirm'), t('sell.keep'));
  const sell = within(footer()).getByRole('button', { name: t('sell.confirm') });
  expect(sell).toHaveProperty('disabled', true);
  expect(document.getElementById(sell.getAttribute('aria-describedby')!)!.textContent).toBe(
    t('sell.chooseFirst'),
  );
  const first = within(card()).getAllByRole('checkbox')[0]!;
  await userEvent.click(first);
  const quote = store.quoteSale([
    store.getView()!.observation.public.players[0]!.team[0]!.instanceId,
  ]);
  inFooter(
    t('sell.confirmOne', { pokemon: first.getAttribute('aria-label')!, amount: quote.total }),
  );
});

test('Shop: Leave the Shop sits in the footer; the offers that can be bought come first', () => {
  render(<Live store={storeOf(fixtureState(shopLowCoins))} />);
  expect(card().getAttribute('data-card')).toBe('shop');
  inFooter(t('shop.skip'));
  const offers = within(body()!).getAllByRole('button', { name: /^Buy / });
  expect(offers[0]).toHaveProperty('disabled', false);
});

test('Strategy: Skip sits in the footer and Enter presses it when nothing else has focus', async () => {
  const chosen: string[] = [];
  render(
    <Live store={storeOf(fixtureState(strategyWithItems))} onChoose={(id) => chosen.push(id)} />,
  );
  expect(card().getAttribute('data-card')).toBe('strategy');
  inFooter(t('strategy.skip'));
  await userEvent.keyboard('{Enter}');
  expect(chosen).toEqual(['skip']);
});

/** Seat 0 resolves the Gym at square 6 and owns the entry choice. */
function gymEntry(): GameState {
  const state = createGame(
    createGameConfig({
      seats: ['main-character', 'researcher'].map((classId, seatIndex) => ({
        actorId: `p${seatIndex}`,
        seatIndex,
        classId,
        starterSpeciesId: classId === 'main-character' ? 'bulbasaur' : undefined,
        controller: seatIndex === 0 ? ('human' as const) : ('ai' as const),
      })),
      seed: 2,
      lapTarget: 2,
    }),
    engineContent,
  );
  state.phase = { kind: 'resolve' };
  state.globalTurnNo = 1;
  state.players[0]!.ownTurnNo = 1;
  state.players[0]!.routeProgress = 6;
  return state;
}

test('Gym: Challenge and Skip the Gym sit in the footer (§4.4)', () => {
  const store = storeOf(gymEntry());
  act(() => void store.advance({ human: true }));
  render(<Live store={store} />);
  expect(card().getAttribute('data-card')).toBe('battle');
  inFooter(t('choice.challengeGym'), t('choice.skipGym'));
});

test('Enter never starts a Gym battle, which can cost coins (§4.4)', async () => {
  const chosen: string[] = [];
  const store = storeOf(gymEntry());
  act(() => void store.advance({ human: true }));
  render(<Live store={store} onChoose={(id) => chosen.push(id)} />);
  inFooter(t('choice.challengeGym'), t('choice.skipGym'));
  await userEvent.keyboard('{Enter}');
  expect(chosen).toEqual([]);
});

test('Enter never accepts a challenge to PvP: accepting risks coins, declining costs nothing (§4.4)', async () => {
  const chosen: string[] = [];
  const state = gymEntry();
  state.phase = { kind: 'strategy' };
  state.activeSeatIndex = 1;
  state.globalTurnNo = 2;
  state.turnBudgets = { tacticalAction: 1, catchAttempt: 1, pokemonAbility: 1 };
  for (const player of state.players) player.ownTurnNo = 2;
  state.players[0]!.routeProgress = 0;
  const store = storeOf(state);
  const declared = store.submit({
    actorId: 'p1',
    kind: 'declare_pvp',
    payload: { targetSeatIndex: 0 },
  } as never);
  expect('accepted' in declared).toBe(true);
  render(<Live store={store} onChoose={(id) => chosen.push(id)} />);
  expect(card().getAttribute('data-card')).toBe('battle');
  expect(within(card()).getByRole('button', { name: /accept/i })).toBeTruthy();
  await userEvent.keyboard('{Enter}');
  expect(chosen).toEqual([]);
});

// --------------------------------------------- 3. every greyed option still says why, folded

test('greyed Shop offers fold into one line that opens to the engine’s exact reasons (§3.1)', async () => {
  const state = fixtureState(shopLowCoins);
  if (state.phase.kind !== 'shop') throw new Error('Expected a Shop');
  const closed = state.phase.offers.filter((offer) => offer.price > state.players[0]!.coins);
  render(<Live store={storeOf(state)} />);
  const toggle = within(card()).getByRole('button', {
    name: foldLabel(closed.length, 'offers'),
  });
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  expect(within(card()).queryAllByRole('button', { name: /^Buy /, hidden: false })).toHaveLength(
    state.phase.offers.length - closed.length,
  );
  await userEvent.click(toggle);
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  const greyed = within(card())
    .getAllByRole('button', { name: /^Buy / })
    .filter((button) => button.hasAttribute('disabled'));
  expect(greyed).toHaveLength(closed.length);
  for (const button of greyed) {
    expect(document.getElementById(button.getAttribute('aria-describedby')!)!.textContent).toBe(
      t('action.reason.NOT_ENOUGH_COINS'),
    );
  }
});

test('battle terms show only the terms that are not zero; the full table opens in place (§4.4)', async () => {
  const side = (seatIndex: number, battle: number, classBonus: number) => ({
    seatIndex,
    actorId: `p${seatIndex}`,
    member: { instanceId: `m${seatIndex}`, speciesId: 'magikarp', effectiveBattle: battle },
    classBonus,
    abilityBonus: 0,
    itemBonus: 0,
    debuffs: 0,
  });
  const terms = {
    kind: 'pvp',
    snapshot: { kind: 'pvp', attacker: side(0, 2, 3), defender: side(1, 0, 0) },
    odds: { win: { percent: 60 }, tie: { percent: 10 }, loss: { percent: 30 } },
  } as unknown as Parameters<typeof BattleTerms>[0]['terms'];
  render(<BattleTerms terms={terms} viewerSeat={0} frozen={false} />);
  const summary = document.querySelector('.terms-summary')!;
  const [you, rival] = [...summary.querySelectorAll('li')];
  expect(you!.querySelector('.terms-figures')!.textContent).toBe(
    t('beat.join', {
      first: t('battle.termValue', { term: t('battle.term.battle'), value: 2 }),
      second: t('battle.termValue', { term: t('battle.term.class'), value: 3 }),
    }),
  );
  expect(rival!.querySelector('.terms-figures')!.textContent).toBe(t('battle.termsZero'));
  expect(screen.getByRole('status').textContent).toContain(
    t('battle.chance.pvp', { win: 60, tie: 10, lose: 30 }),
  );
  expect(screen.queryByRole('table')).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: t('battle.allTerms') }));
  expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(7);
});

// ---------------------------------------------------------------- 4. protected decisions

test.each([
  ['Encounter', encounterWithBalls],
  ['Sell', sellThree],
])('%s: focus moves into the card and stays there until it is answered', async (_, input) => {
  const store = storeOf(fixtureState(input));
  render(
    <>
      <button type="button">outside</button>
      <Live store={store} />
    </>,
  );
  const inside = () => card().contains(document.activeElement);
  expect(inside()).toBe(true);
  // Tab and Shift+Tab wrap inside the card.
  const focusable = [
    ...card().querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)'),
  ].filter((element) => !element.closest('[hidden]'));
  focusable.at(-1)!.focus();
  await userEvent.tab();
  expect(document.activeElement).toBe(focusable[0]);
  await userEvent.tab({ shift: true });
  expect(document.activeElement).toBe(focusable.at(-1));
  // Focus sent elsewhere (a click, a closing dialog) comes back; Escape dismisses nothing.
  act(() => screen.getByRole('button', { name: 'outside' }).focus());
  expect(inside()).toBe(true);
  await userEvent.keyboard('{Escape}');
  expect(card()).toBeTruthy();
  expect(store.getSession()!.log.actions).toHaveLength(0);
});

test('a card that is not protected leaves focus where the player put it', () => {
  render(
    <>
      <button type="button">outside</button>
      <Live store={storeOf(fixtureState(shopLowCoins))} />
    </>,
  );
  const outside = screen.getByRole('button', { name: 'outside' });
  act(() => outside.focus());
  expect(document.activeElement).toBe(outside);
});

test('Enter is left to a focused control and to an open dialog', async () => {
  const chosen: string[] = [];
  render(
    <>
      <dialog open>
        <p>reading</p>
      </dialog>
      <Live store={storeOf(fixtureState(strategyWithItems))} onChoose={(id) => chosen.push(id)} />
    </>,
  );
  await userEvent.keyboard('{Enter}');
  expect(chosen).toEqual([]);
});

// ------------------------------------------------------------ 5. Sell says what Start gave

function startFeed(state: GameState, abilities: boolean, turn = state.globalTurnNo) {
  const you = state.players[0]!;
  const entry: SeatFeedEntry = {
    before: { phase: { kind: 'move' }, activeSeatIndex: 0, globalTurnNo: turn, pokemon: [] },
    record: {
      action: { kind: 'dice_result' },
      events: [
        {
          kind: 'coin_transfer',
          source: { kind: 'bank' },
          destination: { kind: 'player', actorId: you.actorId },
          amount: 5,
          reason: 'start_income',
        },
        ...(abilities ? [{ kind: 'abilities_reset', ownerId: you.actorId, instanceIds: [] }] : []),
      ],
    },
  } as unknown as SeatFeedEntry;
  return [entry];
}

test('the Sell banner reads the engine’s Start income, the Lap and whether Abilities were reset', () => {
  const state = fixtureState(sellThree);
  const observation = observe(state, 0);
  const you = observation.public.players[0]!;
  expect(startPass(startFeed(state, true), observation)).toEqual({
    coins: 5,
    lap: you.creditedLap,
    target: observation.public.lapTarget,
    abilities: true,
  });
  expect(startPass(startFeed(state, false), observation)?.abilities).toBe(false);
  // A Start crossing from an earlier turn is not this Sell Phase's.
  expect(startPass(startFeed(state, true, state.globalTurnNo - 1), observation)).toBeNull();
});

// ------------------------------------------------------------------ 6. the pawn walk

function walkBoard(walk: boolean) {
  const state = fixtureState(strategyWithItems);
  state.players[1]!.routeProgress = 2;
  const { rerender } = render(<Board observation={observe(state, 0)} walk={walk} />);
  const at = () =>
    screen.getByTestId('token-1').closest('[data-position]')!.getAttribute('data-position');
  const moveTo = (progress: number) => {
    state.players[1]!.routeProgress = progress;
    rerender(<Board observation={observe(state, 0)} walk={walk} />);
  };
  return { at, moveTo };
}

test('a pawn walks to its new square one square every 180 ms, and stops there (§3)', () => {
  vi.useFakeTimers();
  const { at, moveTo } = walkBoard(true);
  expect(at()).toBe('2');
  moveTo(5);
  expect(at()).toBe('2');
  act(() => vi.advanceTimersByTime(WALK_STEP_MS - 1));
  expect(at()).toBe('2');
  act(() => vi.advanceTimersByTime(1));
  expect(at()).toBe('3');
  act(() => vi.advanceTimersByTime(WALK_STEP_MS));
  expect(at()).toBe('4');
  act(() => vi.advanceTimersByTime(WALK_STEP_MS * 5));
  expect(at()).toBe('5');
  // Past Start the walk wraps around the loop, the way the move went.
  moveTo(22);
  expect(at()).toBe('22');
  moveTo(26);
  // React schedules each next step once the last one renders: one step per act().
  for (const square of ['23', '0', '1', '2']) {
    act(() => vi.advanceTimersByTime(WALK_STEP_MS));
    expect(at()).toBe(square);
  }
  act(() => vi.advanceTimersByTime(WALK_STEP_MS * 3));
  expect(at()).toBe('2');
});

test('with reduced motion, or without a walk (Instant, a skip), the pawn jumps', () => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: query.includes('reduce'),
      addEventListener: () => {},
      removeEventListener: () => {},
    })),
  );
  const reduced = walkBoard(true);
  reduced.moveTo(5);
  expect(reduced.at()).toBe('5');
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  const instant = walkBoard(false);
  instant.moveTo(5);
  expect(instant.at()).toBe('5');
});

test('only the moving pawn walks; a new game far away is shown at once', () => {
  vi.useFakeTimers();
  const { at, moveTo } = walkBoard(true);
  moveTo(2 + 13);
  expect(at()).toBe('15');
  act(() => vi.advanceTimersByTime(WALK_STEP_MS * 3));
  expect(at()).toBe('15');
  expect(
    screen.getByTestId('token-0').closest('[data-position]')!.getAttribute('data-position'),
  ).toBe('0');
});

test('the Game record opens from the top bar with the field log in it, and Close returns focus', async () => {
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.open = false;
  };
  const state = fixtureState(strategyWithItems);
  render(<Board observation={observe(state, 0)} feed={[]} />);
  expect(screen.queryByRole('heading', { name: t('board.log') })).toBeNull();
  const opener = screen.getByRole('button', { name: t('record.open') });
  await userEvent.click(opener);
  const sheet = screen.getByRole('dialog', { name: t('record.heading') });
  expect(within(sheet).getByRole('heading', { name: t('board.log') })).toBeTruthy();
  await userEvent.click(within(sheet).getByRole('button', { name: t('record.close') }));
  expect(screen.queryByRole('dialog')).toBeNull();
  await act(async () => {});
  expect(document.activeElement).toBe(opener);
});
