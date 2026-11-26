import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { useSyncExternalStore } from 'react';
import { expect, test } from 'vitest';
import {
  applyAction,
  createGameConfig,
  createGameLog,
  createRng,
  fixtureSchema,
  legalActions,
  observe,
  saleQuote,
  type GameState,
} from '../../../engine/index.ts';
import lowCoins from '../../../engine/fixtures/shop-low-coins.json';
import sellFixture from '../../../engine/fixtures/sell-phase-three-pokemon.json';
import { content, engineContent } from '../game/content.ts';
import { createGameStore, type GameStore } from '../game/store.ts';
import { STATIC_PLAYBACK } from '../gallery/scenes.ts';
import { t } from '../i18n/en.ts';
import { openFolds } from '../test/folds.ts';
import { ShopPanel } from './ShopPanel.tsx';
import { StrategyPanel } from './StrategyPanel.tsx';
import { SellPanel } from './SellPanel.tsx';
import { TurnPanel } from './TurnPanel.tsx';

function scenario(input: unknown): GameState {
  const state = fixtureSchema.parse(input).state;
  state.config = createGameConfig({ seats: state.config.seats, seed: 3, lapTarget: 3 });
  state.content = structuredClone(engineContent);
  state.rng = createRng(3);
  return state;
}

function command(state: GameState, kind: string, payload: unknown) {
  const result = applyAction(state, {
    actorId: state.players[0]!.actorId,
    actionSeq: state.stateRevision + 1,
    stateRevisionBefore: state.stateRevision,
    kind,
    payload,
  });
  if ('rejected' in result) throw new Error(result.reason);
  return result.state;
}

function shop(state: GameState) {
  let current = state;
  const onChoose = (id: string) => {
    const action = legalActions(current, 0).enabled.find((entry) => entry.id === id)!;
    current = command(current, action.kind, action.payload);
  };
  render(
    <ShopPanel
      observation={observe(state, 0)}
      legalActions={legalActions(state, 0)}
      onChoose={onChoose}
    />,
  );
  return () => current;
}

test('one-coin Shop fixture shows engine prices and reasons for all offers, and skip keeps the inventory', () => {
  const state = scenario(lowCoins);
  const current = shop(state);
  if (state.phase.kind !== 'shop') throw new Error('Expected Shop');
  // Offers that cannot be bought are folded into one line; open it to read each reason.
  openFolds();
  for (const offer of state.phase.offers) {
    const name = content.items.find((entry) => entry.id === offer.itemId)!.name;
    const button = screen.getByRole('button', {
      name: t(offer.price === 1 ? 'shop.buyOne' : 'shop.buy', { item: name, price: offer.price }),
    });
    expect(button.hasAttribute('disabled')).toBe(offer.itemId !== 'poke-ball');
    if (offer.itemId !== 'poke-ball') {
      expect(document.getElementById(button.getAttribute('aria-describedby')!)!.textContent).toBe(
        t('action.reason.NOT_ENOUGH_COINS'),
      );
    }
  }
  fireEvent.click(screen.getByRole('button', { name: t('shop.skip') }));
  expect(current().phase.kind).toBe('end');
  expect(current().players).toEqual(state.players);
});

test('four held utility items disable item offers but not Balls; buying closes the visit', () => {
  const state = scenario(lowCoins);
  state.players[0]!.coins = 20;
  state.players[0]!.items = Array.from({ length: 4 }, (_, n) => ({
    instanceId: `owned-${n}`,
    itemId: 'repel',
    name: 'Repel',
    visibility: 'secret',
  }));
  const current = shop(state);
  if (state.phase.kind !== 'shop') throw new Error('Expected Shop');
  openFolds();
  for (const offer of state.phase.offers) {
    const name = content.items.find((entry) => entry.id === offer.itemId)!.name;
    const button = screen.getByRole('button', {
      name: t(offer.price === 1 ? 'shop.buyOne' : 'shop.buy', { item: name, price: offer.price }),
    });
    expect(button.hasAttribute('disabled')).toBe(offer.kind === 'utility');
    if (offer.kind === 'utility')
      expect(document.getElementById(button.getAttribute('aria-describedby')!)!.textContent).toBe(
        t('action.reason.ITEMS_FULL'),
      );
  }
  fireEvent.click(
    screen.getByRole('button', { name: t('shop.buyOne', { item: 'Poké Ball', price: 1 }) }),
  );
  expect(current().phase.kind).toBe('end');
  expect(current().players[0]!.balls.poke).toBe(state.players[0]!.balls.poke + 1);
  expect(current().players[0]!.coins).toBe(19);
  expect(current().players[0]!.items).toEqual(state.players[0]!.items);
});

function strategyState() {
  const state = scenario(lowCoins);
  state.phase = { kind: 'strategy' };
  state.turnBudgets.tacticalAction = 1;
  state.players[0]!.items = ['pickpocket', 'repel', 'potion', 'lucky-egg'].map((itemId) => ({
    instanceId: `owned-${itemId}`,
    itemId,
    name: content.items.find((entry) => entry.id === itemId)!.name,
    visibility: 'secret',
  }));
  return state;
}

test.each(['pickpocket', 'repel', 'lucky-egg'])(
  'item %s previews content without spending, targets only legal opponents, then confirms through applyAction',
  (itemId) => {
    const state = strategyState();
    let current = state;
    render(
      <StrategyPanel
        observation={observe(state, 0)}
        legalActions={legalActions(state, 0)}
        onChoose={(id) => {
          const action = legalActions(state, 0).enabled.find((entry) => entry.id === id)!;
          current = command(state, action.kind, action.payload);
        }}
      />,
    );
    const item = content.items.find((entry) => entry.id === itemId)!;
    fireEvent.click(screen.getByRole('button', { name: item.name }));
    expect(current).toBe(state);
    if (itemId !== 'lucky-egg') {
      const targets = screen.getByRole('group', { name: t('strategy.targets') });
      expect(within(targets).queryByRole('button', { name: t('seat.you') })).toBeNull();
      fireEvent.click(
        within(targets).getByRole('button', { name: t('board.rivalLabel', { seat: 1 }) }),
      );
    }
    expect(screen.getByLabelText(t('strategy.preview')).textContent).toContain(
      item.kind === 'utility' ? item.effect : '',
    );
    expect(current.players[0]!.items).toEqual(state.players[0]!.items);
    fireEvent.click(
      screen.getByRole('button', { name: t('strategy.confirm', { item: item.name }) }),
    );
    expect(current.players[0]!.items.some((owned) => owned.itemId === itemId)).toBe(false);
    expect(current.turnBudgets.tacticalAction).toBe(0);
    if (itemId !== 'lucky-egg')
      expect(
        legalActions(current, 0).disabled.some(
          (action) => action.reasonCode === 'ALREADY_USED_THIS_TURN',
        ),
      ).toBe(true);
  },
);

test('Potion and invalid hostile targets show precise engine reasons and cannot confirm', () => {
  const state = strategyState();
  state.players[1]!.coins = 0;
  state.players[1]!.pendingSlows = ['repel'];
  render(
    <StrategyPanel
      observation={observe(state, 0)}
      legalActions={legalActions(state, 0)}
      onChoose={() => {
        throw new Error('Disabled item used');
      }}
    />,
  );
  // Items that cannot be used now are folded into one line; open it to read each reason.
  openFolds();
  for (const id of ['potion', 'pickpocket', 'repel']) {
    const name = content.items.find((item) => item.id === id)!.name;
    const button = screen.getByRole('button', { name });
    expect(button.hasAttribute('disabled')).toBe(true);
    const reason = legalActions(state, 0).disabled.find(
      (action) => action.kind === 'use_item' && action.payload.itemInstanceId === `owned-${id}`,
    )!;
    expect(document.getElementById(button.getAttribute('aria-describedby')!)!.textContent).toBe(
      reason.reasonText,
    );
  }
  expect(screen.queryByRole('button', { name: /Confirm/ })).toBeNull();
  expect(screen.getByRole('button', { name: t('strategy.skip') }).hasAttribute('disabled')).toBe(
    false,
  );
});

function sellPanel(state: GameState) {
  let current = state;
  const props = {
    observation: observe(state, 0),
    quoteSale: (ids: string[]) => saleQuote(state, 0, ids),
    onSell: (ids: string[]) => {
      current = command(state, 'sell', { pokemonInstanceIds: ids });
    },
  };
  const { unmount } = render(<SellPanel {...props} />);
  return { current: () => current, unmount };
}

/** The Sell button: it names what is ticked and the engine's total ("Sell Caterpie for 7 coins"). */
const sellButton = () => screen.getByRole('button', { name: /^Sell / });

test('sale selection shows engine price parts and total, reallocating the class bonus for each batch', () => {
  const state = scenario(sellFixture);
  state.players[0]!.classId = 'researcher';
  state.players[0]!.team[2]!.tired = true;
  const { current } = sellPanel(state);
  fireEvent.click(screen.getByRole('checkbox', { name: 'Caterpie' }));
  let quote = saleQuote(state, 0, ['pokemon-3']);
  expect(screen.getByLabelText(t('sell.total')).textContent).toBe(
    t('sell.coins', { amount: quote.total }),
  );
  expect(screen.getByTestId('sale-pokemon-3').textContent).toContain(
    t('sell.priceBonus', quote.rows[0]!),
  );
  expect(screen.getByTestId('sale-pokemon-3').textContent).toContain(t('sell.tired'));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Bulbasaur' }));
  quote = saleQuote(state, 0, ['pokemon-0', 'pokemon-3']);
  expect(screen.getByLabelText(t('sell.total')).textContent).toBe(
    t('sell.coins', { amount: quote.total }),
  );
  expect(screen.getByTestId('sale-pokemon-0').textContent).toContain(
    t('sell.priceBonus', quote.rows[0]!),
  );
  expect(screen.getByTestId('sale-pokemon-3').textContent).toContain(
    t('sell.price', quote.rows[1]!),
  );
  fireEvent.click(sellButton());
  expect(current().players[0]!.team.map((pokemon) => pokemon.instanceId)).toEqual(['pokemon-2']);
  expect(current().players[0]!.coins - state.players[0]!.coins).toBe(quote.total);
  expect(current().phase.kind).toBe('resolve');
});

test('selling all previews a zero-value Rescue Starter and the committed observation shows the replacement', () => {
  const state = scenario(sellFixture);
  const { current } = sellPanel(state);
  for (const checkbox of screen.getAllByRole('checkbox')) fireEvent.click(checkbox);
  expect(
    screen.getByText(
      t('sell.rescuePreview', {
        value: saleQuote(
          state,
          0,
          state.players[0]!.team.map((pokemon) => pokemon.instanceId),
        ).rescueStarter!.saleValue,
      }),
    ),
  ).toBeTruthy();
  fireEvent.click(sellButton());
  const after = observe(current(), 0);
  expect(after.public.players[0]!.team).toMatchObject([
    { origin: 'rescue_starter', speciesId: 'bulbasaur' },
  ]);
  expect(after.public.phase.kind).toBe('resolve');
});

test('selling none keeps the team and finishes without error or a Rescue Starter warning', () => {
  const state = scenario(sellFixture);
  const { current } = sellPanel(state);
  expect(screen.queryByText(t('sell.rescuePreview', { value: 0 }))).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: t('sell.keep') }));
  expect(current().players[0]!.team).toEqual(state.players[0]!.team);
  expect(current().phase.kind).toBe('resolve');
  expect(screen.queryByRole('alert')).toBeNull();
});

test('several selected Pokémon show the engine batch total and their price parts on every card', () => {
  const state = scenario(sellFixture);
  const { current } = sellPanel(state);
  const all = state.players[0]!.team.map((pokemon) => pokemon.instanceId);
  // Nothing ticked: Sell is greyed out and says what to do.
  expect(sellButton()).toHaveProperty('disabled', true);
  expect(document.getElementById(sellButton().getAttribute('aria-describedby')!)!.textContent).toBe(
    t('sell.chooseFirst'),
  );
  for (const checkbox of screen.getAllByRole('checkbox')) fireEvent.click(checkbox);
  const quote = saleQuote(state, 0, all);
  expect(screen.getByLabelText(t('sell.total')).textContent).toBe(
    t('sell.coins', { amount: quote.total }),
  );
  for (const row of quote.rows) {
    expect(screen.getByTestId(`sale-${row.instanceId}`).textContent).toContain(
      t(row.classBonus === 0 ? 'sell.price' : 'sell.priceBonus', row),
    );
  }
  expect(sellButton().textContent).toBe(
    t('sell.confirmMany', { count: all.length, amount: quote.total }),
  );
  fireEvent.click(sellButton());
  expect(current().players[0]!.team).toMatchObject([{ origin: 'rescue_starter' }]);
  expect(current().phase.kind).toBe('resolve');
});

/** The live Sell card, from a store, as the play screen routes it. */
function SellHarness({ store }: { store: GameStore }) {
  const view = useSyncExternalStore(store.subscribe, store.getView)!;
  return (
    <TurnPanel
      view={view}
      playback={STATIC_PLAYBACK}
      actionError={false}
      onChoose={(id) => store.choose(id)}
      quoteSale={store.quoteSale}
      onSell={(ids) =>
        store.submit({ actorId: 'player-0', kind: 'sell', payload: { pokemonInstanceIds: ids } })
      }
    />
  );
}

function liveSell() {
  const state = scenario(sellFixture);
  const store = createGameStore();
  store.restore({ state, log: createGameLog(state) });
  render(<SellHarness store={store} />);
  return store;
}

test('the Sell card takes focus into the team, and once answered leaves focus on the next card', async () => {
  const outside = document.createElement('button');
  outside.textContent = 'outside';
  document.body.appendChild(outside);
  outside.focus();
  const store = liveSell();
  const sell = document.querySelector<HTMLElement>('[data-card="sell"]')!;
  // Nothing is ticked yet, so the first control in the card takes focus: the first Pokémon.
  expect(document.activeElement).toBe(within(sell).getAllByRole('checkbox')[0]);
  fireEvent.click(within(sell).getByRole('button', { name: t('sell.keep') }));
  expect(store.getSession()!.state.phase.kind).not.toBe('sell');
  await act(async () => {});
  // The page body never takes it: focus is on the card that replaced Sell.
  expect(document.activeElement).toBe(document.querySelector('.decision-card'));
  outside.remove();
});

test('Escape does not leave the Sell Phase: keeping is an explicit choice (§3.1)', () => {
  const store = liveSell();
  const sell = document.querySelector<HTMLElement>('[data-card="sell"]')!;
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
  expect(store.getSession()!.state.phase.kind).toBe('sell');
  expect(document.querySelector('[data-card="sell"]')).toBe(sell);
  expect(within(sell).getByRole('button', { name: t('sell.keep') })).toBeTruthy();
});
