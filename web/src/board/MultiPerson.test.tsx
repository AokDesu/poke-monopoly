import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import {
  createGame,
  createGameConfig,
  createGameLog,
  type GameState,
} from '../../../engine/index.ts';
import { engineContent } from '../game/content.ts';
import { createGameStore, type GameStore, type Person } from '../game/store.ts';
import { t } from '../i18n/en.ts';
import { className, itemName } from '../i18n/names.ts';
import { BoardScreen } from './BoardScreen.tsx';

/**
 * Spec §3, §3.1, §4.1, Appendix C.3 (local multiplayer, #258): what each screen renders for each seat.
 * Seats 0 and 1 are people (Ton, Mai); seat 2, when present, is an AI. Ton and Mai hold different
 * Balls and a different secret item, so any leak from one person's screen to the other's shows up.
 */

beforeEach(() => {
  vi.stubGlobal('fetch', async () => {
    throw new Error('offline');
  });
});
afterEach(() => vi.unstubAllGlobals());

const PEOPLE: readonly Person[] = [
  { seatIndex: 0, name: 'Ton' },
  { seatIndex: 1, name: 'Mai' },
];
const CLASSES = ['main-character', 'fisherman', 'researcher'];
const TON_ITEM = 'price-shield';
const MAI_ITEM = 'lucky-egg';

function table(edit: (state: GameState) => void = () => {}, seats = 3): GameStore {
  const state = createGame(
    createGameConfig({
      seats: CLASSES.slice(0, seats).map((classId, seatIndex) => ({
        actorId: `p${seatIndex}`,
        seatIndex,
        classId,
        ...(classId === 'main-character' ? { starterSpeciesId: 'bulbasaur' } : {}),
        controller: seatIndex < 2 ? ('human' as const) : ('ai' as const),
      })),
      seed: 1,
      lapTarget: 2,
      socialWindow: true,
    }),
    engineContent,
  );
  state.phase = { kind: 'strategy' };
  state.globalTurnNo = 7;
  state.turnBudgets = { tacticalAction: 1, catchAttempt: 1, pokemonAbility: 1 };
  for (const player of state.players) player.ownTurnNo = 3;
  state.players[0]!.balls = { poke: 5, great: 2, ultra: 1 };
  state.players[1]!.balls = { poke: 9, great: 0, ultra: 3 };
  state.players[0]!.items = [
    { instanceId: 'ton-item', itemId: TON_ITEM, name: itemName(TON_ITEM), visibility: 'secret' },
  ];
  state.players[1]!.items = [
    { instanceId: 'mai-item', itemId: MAI_ITEM, name: itemName(MAI_ITEM), visibility: 'secret' },
  ];
  edit(state);
  const store = createGameStore();
  store.restore(
    { state, log: createGameLog(state) },
    seats > 2 ? [{ seatIndex: 2, personality: 'greedy', difficulty: 'normal' }] : [],
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    PEOPLE,
  );
  return store;
}

const passButton = (name: string) =>
  screen.getByRole('button', { name: t('pass.button', { name }) });
const hand = () => screen.queryByRole('region', { name: t('hand.label') });
const balls = (region: HTMLElement) =>
  ['poke', 'great', 'ultra'].map(
    (ball) => region.querySelector(`[data-ball="${ball}"] strong`)?.textContent,
  );
const pageText = () => document.body.textContent ?? '';

test('the pass screen holds nothing private: no board, no hand, no Balls or items (§3, §4.1)', () => {
  render(<BoardScreen store={table()} />);
  expect(screen.getByRole('heading', { name: t('pass.heading', { name: 'Ton' }) })).toBeTruthy();
  expect(screen.getByText(new RegExp(`^Mai, please look away`))).toBeTruthy();
  expect(passButton('Ton')).toBeTruthy();
  expect(document.activeElement).toBe(passButton('Ton'));
  // Nothing of the game: no hand, no decision card, no seat rows, no board.
  expect(hand()).toBeNull();
  expect(screen.queryByRole('region', { name: t('turn.actions') })).toBeNull();
  expect(screen.queryByTestId('player-0')).toBeNull();
  expect(document.querySelector('[data-ball]')).toBeNull();
  for (const secret of [itemName(TON_ITEM), itemName(MAI_ITEM)]) {
    expect(pageText()).not.toContain(secret);
  }
});

test('Ton sees only Ton’s hand after his pass screen, and Mai only Mai’s after hers (§4.1)', () => {
  const store = table();
  render(<BoardScreen store={store} />);
  fireEvent.click(passButton('Ton'));
  expect(hand()?.getAttribute('data-seat')).toBe('0');
  expect(balls(hand()!)).toEqual(['5', '2', '1']);
  expect(within(hand()!).getByText(itemName(TON_ITEM))).toBeTruthy();
  expect(pageText()).not.toContain(itemName(MAI_ITEM));

  // Ton ends his turn; the engine carries the game through to Mai and the board goes away.
  act(() => {
    for (let guard = 0; guard < 60 && store.getView(); guard++) {
      const view = store.getView()!;
      const next =
        view.legalActions.enabled.find((choice) => choice.kind === 'skip') ??
        view.legalActions.enabled[0];
      if (next) store.choose(next.id);
      else if (!store.advance({ human: true })) break;
    }
  });
  expect(screen.getByRole('heading', { name: t('pass.heading', { name: 'Mai' }) })).toBeTruthy();
  expect(hand()).toBeNull();
  expect(pageText()).not.toContain(itemName(TON_ITEM));
  expect(pageText()).not.toContain(itemName(MAI_ITEM));

  fireEvent.click(passButton('Mai'));
  expect(hand()?.getAttribute('data-seat')).toBe('1');
  expect(balls(hand()!)).toEqual(['9', '0', '3']);
  expect(within(hand()!).getByText(itemName(MAI_ITEM))).toBeTruthy();
  expect(pageText()).not.toContain(itemName(TON_ITEM));
});

test('a defender who is a person answers on a pass screen that says who challenges, then the turn returns (§4.4, App. C.3)', () => {
  const store = table();
  render(<BoardScreen store={store} />);
  fireEvent.click(passButton('Ton'));
  act(() => {
    const result = store.submit({
      actorId: 'p0',
      kind: 'declare_pvp',
      payload: { targetSeatIndex: 1 },
    });
    expect('accepted' in result).toBe(true);
  });
  const reason = t('pass.reason.challenge', { who: className('main-character') });
  expect(
    screen.getByRole('heading', { name: t('pass.headingAnswer', { name: 'Mai', reason }) }),
  ).toBeTruthy();
  expect(hand()).toBeNull();
  expect(pageText()).not.toContain(itemName(TON_ITEM));
  fireEvent.click(passButton('Mai'));
  expect(hand()?.getAttribute('data-seat')).toBe('1');
  expect(
    screen.getByRole('heading', { level: 2, name: t('battle.heading.response') }),
  ).toBeTruthy();
});

test('the chat card and the promise offers list AI rivals only; people talk at the table (§4.8)', () => {
  const store = table((state) => {
    state.phase = { kind: 'social' };
    state.turnBudgets = { ...state.turnBudgets, socialInteraction: 1 };
  });
  render(<BoardScreen store={store} />);
  fireEvent.click(passButton('Ton'));
  const card = screen.getByRole('region', { name: t('turn.actions') });
  expect(within(card).getAllByText(/AI rival · seat 2/).length).toBeGreaterThan(0);
  expect(card.textContent).not.toContain('Mai');
  // Promise offers name the one AI and no one else.
  const legends = [...card.querySelectorAll('.promise-offer-rival > legend')].map(
    (legend) => legend.textContent,
  );
  expect(legends.length).toBe(1);
  expect(legends[0]).toContain('AI rival · seat 2');
});

test('another person’s seat row names them and offers no promises (§4.8)', () => {
  render(<BoardScreen store={table()} />);
  fireEvent.click(passButton('Ton'));
  const row = screen.getByTestId('player-1');
  expect(within(row).getByText('Mai')).toBeTruthy();
  expect(within(row).getByText(className('fisherman'))).toBeTruthy();
  expect(row.textContent).not.toContain(t('row.promises', { name: 'Mai' }));
  expect(within(screen.getByTestId('player-2')).getByText(t('row.ai'))).toBeTruthy();
});

test('a game resumed at Mai’s turn opens on Mai’s pass screen, with nothing of Ton’s showing (§3.1, §6.9)', () => {
  render(
    <BoardScreen
      store={table((state) => {
        state.activeSeatIndex = 1;
      })}
    />,
  );
  expect(screen.getByRole('heading', { name: t('pass.heading', { name: 'Mai' }) })).toBeTruthy();
  expect(screen.getByText(/^Ton, please look away/)).toBeTruthy();
  expect(hand()).toBeNull();
  expect(pageText()).not.toContain(itemName(TON_ITEM));
});

test('a one-person game never shows a pass screen', () => {
  const state = createGame(
    createGameConfig({
      seats: ['main-character', 'researcher'].map((classId, seatIndex) => ({
        actorId: `p${seatIndex}`,
        seatIndex,
        classId,
        ...(classId === 'main-character' ? { starterSpeciesId: 'bulbasaur' } : {}),
        controller: seatIndex === 0 ? ('human' as const) : ('ai' as const),
      })),
      seed: 1,
      lapTarget: 2,
    }),
    engineContent,
  );
  state.phase = { kind: 'strategy' };
  const store = createGameStore();
  store.restore({ state, log: createGameLog(state) }, [
    { seatIndex: 1, personality: 'greedy', difficulty: 'normal' },
  ]);
  render(<BoardScreen store={store} />);
  expect(document.querySelector('[data-pass-seat]')).toBeNull();
  expect(hand()?.getAttribute('data-seat')).toBe('0');
});

test('a private reaction names no cause on the pass screen: only the person who must answer (§4.1)', () => {
  const store = table((state) => {
    state.pendingPickpocket = {
      attackId: 'attack:1',
      targetSeatIndex: 1,
    };
  });
  render(<BoardScreen store={store} />);
  // The reaction belongs to Mai, whatever the cause: her pass screen is the plain one.
  expect(screen.getByRole('heading', { name: t('pass.heading', { name: 'Mai' }) })).toBeTruthy();
  expect(pageText()).not.toMatch(/pickpocket|challenges you/i);
});
