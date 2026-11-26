import { cleanup, render, within } from '@testing-library/react';
import { afterEach, beforeAll, expect, test, vi } from 'vitest';
import { deserialize, serialize, type GameState } from '../../../engine/index.ts';
import encounterNoBall from '../../../engine/fixtures/encounter-no-ball.json';
import sellPhase from '../../../engine/fixtures/sell-phase-three-pokemon.json';
import shopLowCoins from '../../../engine/fixtures/shop-low-coins.json';
import shopNoCoins from '../../../engine/fixtures/shop-no-coins.json';
import { content, engineContent } from '../game/content.ts';
import { createFixtureStore, createGameStore, type GameStore } from '../game/store.ts';
import { createScenes } from '../gallery/scenes.ts';
import { t } from '../i18n/en.ts';
import { openRecord } from '../test/record.ts';
import { itemName, speciesName } from '../i18n/names.ts';
import { Board } from './Board.tsx';
import { BoardScreen } from './BoardScreen.tsx';
import { eventCardText } from './eventCard.ts';

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

const EVENT_SQUARE = 2;
const EVENT_IDS = content.events.map(({ id }) => id);

/**
 * A seat lands on an Event square with a chosen draw pile and the engine applies the Resolve
 * step itself: the same single accepted action a real landing is. The test draws nothing.
 */
function land(
  drawPile: string[],
  options: {
    seat?: 0 | 1;
    edit?: (state: GameState) => void;
    spectate?: boolean;
  } = {},
): GameStore {
  const seat = options.seat ?? 0;
  const store = createFixtureStore(shopLowCoins, engineContent, (state) => {
    state.phase = { kind: 'resolve' };
    state.activeSeatIndex = seat;
    state.players[seat]!.routeProgress = EVENT_SQUARE;
    state.eventDeck = { drawPile, discardPile: [] };
    if (options.spectate) for (const entry of state.config.seats) entry.controller = 'ai';
    options.edit?.(state);
  });
  expect(store.advance({ human: true })).toBe(true);
  return store;
}

/** The board for the store's seat (or a watcher), with its Game record open as a player opens it. */
function showBoard(store: GameStore) {
  const spectator = store.getSpectatorView();
  const view = store.getView();
  render(
    spectator ? (
      <Board observation={{ public: spectator.observation.public }} feed={spectator.feed} />
    ) : (
      <Board observation={view!.observation} feed={view!.feed} />
    ),
  );
  const record = openRecord();
  return {
    card: within(record).getByRole('region', { name: t('event.card.heading') }),
    log: within(record).getByRole('log', { name: t('board.log') }),
  };
}
const result = (card: HTMLElement) => card.querySelector('.event-card-result')?.textContent;
const rows = (log: HTMLElement) =>
  within(log)
    .getAllByRole('listitem')
    .map((li) => li.textContent);
/** The result sentence of a landing, with the previous render removed. */
function resultOf(store: GameStore): string | null | undefined {
  const text = result(showBoard(store).card);
  cleanup();
  return text;
}
const offline = () =>
  vi.stubGlobal('fetch', async () => {
    throw new Error('no network in tests');
  });

test.each(EVENT_IDS)(
  'drawing %s shows the card text and the engine result: no blank or dead-end screen (§3.1, §4.6)',
  (eventId) => {
    const { card, log } = showBoard(land([eventId, 'e1']));
    expect(card.getAttribute('data-event-id')).toBe(eventId);
    expect(within(card).getByText(eventCardText(eventId))).toBeTruthy();
    expect(result(card)).toMatch(/\S/);
    expect(
      rows(log).some((row) => row?.includes(`drew an Event card: ${eventCardText(eventId)}`)),
    ).toBe(true);
    expect(card.textContent).not.toContain(t('event.deckReshuffled'));
  },
);

test('e2 announces the bank’s 6 coins once, not as both a transfer row and a result row', () => {
  const { card, log } = showBoard(land(['e2']));
  expect(result(card)).toBe('You received 6 coins from the bank.');
  expect(rows(log).filter((row) => /from the bank|paid/.test(row ?? ''))).toEqual([
    'You received 6 coins from the bank.',
  ]);
});

test('e3 pays what the engine took: min(4, coins), singular for 1, nothing when broke', () => {
  const pay = (coins: number) => {
    const store = land(['e3'], { edit: (state) => (state.players[0]!.coins = coins) });
    const after = store.getView()!.observation.public.players[0]!.coins;
    return { after, text: resultOf(store) };
  };
  expect(pay(20)).toEqual({ after: 16, text: 'You paid 4 coins to the bank.' });
  expect(pay(1)).toEqual({ after: 0, text: 'You paid 1 coin to the bank.' });
  expect(pay(0)).toEqual({ after: 0, text: 'No coins changed hands.' });
});

test('e6 names every poorest seat and the engine’s split', () => {
  const poorest = land(['e6'], { edit: (state) => (state.players[0]!.coins = 1) });
  expect(resultOf(poorest)).toBe('You received 5 coins from the bank.');
  const tied = land(['e6'], {
    edit: (state) => {
      state.players[0]!.coins = 7;
      state.players[1]!.coins = 7;
    },
  });
  expect(resultOf(tied)).toBe('You, AI rival · seat 1 received 2 coins from the bank.');
});

test('e4 tells the recipient the item, or the Ball a full hand received instead', () => {
  const store = land(['e4']);
  const gained = store.getView()!.observation.own.items.at(-1)!;
  expect(resultOf(store)).toBe(`You received ${itemName(gained.itemId)}.`);
  const full = land(['e4'], {
    edit: (state) => {
      state.players[0]!.items = Array.from({ length: 4 }, (_, n) => ({
        instanceId: `owned-${n}`,
        itemId: 'repel',
        name: 'Repel',
        visibility: 'secret' as const,
      }));
    },
  });
  expect(resultOf(full)).toBe('You held 4 items, so a Poké Ball was added instead.');
});

test('e5 tires the engine’s target, and an empty team has nothing to tire', () => {
  const store = land(['e5']);
  const tired = store
    .getView()!
    .observation.public.players[0]!.team.find((member) => member.tired)!;
  expect(resultOf(store)).toBe(`You: ${speciesName(tired.speciesId)} became Tired.`);
  const empty = land(['e5'], { edit: (state) => (state.players[0]!.team = []) });
  expect(resultOf(empty)).toBe('You has no Pokémon, so nothing became Tired.');
});

test('an e5 row keeps the Pokémon it tired after that Pokémon is sold or evolves', () => {
  const store = land(['e5']);
  const { observation, feed } = store.getView()!;
  const player = observation.public.players[0]!;
  const tired = player.team.find((member) => member.tired)!;
  const asDrawn = `You: ${speciesName(tired.speciesId)} became Tired.`;
  const other = content.species.find(({ id }) => id !== tired.speciesId)!.id;

  const sold = structuredClone(observation);
  sold.public.players[0]!.team = player.team.filter((member) => member !== tired);
  const evolved = structuredClone(observation);
  evolved.public.players[0]!.team.find(
    (member) => member.instanceId === tired.instanceId,
  )!.speciesId = other;

  for (const later of [sold, evolved]) {
    render(<Board observation={later} feed={feed} />);
    const record = openRecord();
    const card = within(record).getByRole('region', { name: t('event.card.heading') });
    const log = within(record).getByRole('log', { name: t('board.log') });
    expect(result(card)).toBe(asDrawn);
    expect(rows(log)).toContain(asDrawn);
    expect(rows(log).join('\n')).not.toContain(
      t('event.result.tiredNone', { name: t('seat.you') }),
    );
    cleanup();
  }
});

/** The encounter card in the decision slot. */
const encounterCard = () => document.querySelector<HTMLElement>('[data-card="encounter"]')!;

test('e1 opens the encounter, and the encounter card says the Event card started it', () => {
  offline();
  const store = land(['e1']);
  render(<BoardScreen store={store} />);
  const phase = store.getView()!.observation.public.phase;
  if (phase.kind !== 'encounter') throw new Error('e1 did not open an encounter');
  expect(
    within(encounterCard()).getByText(t('event.card.fromEncounter', { text: eventCardText('e1') })),
  ).toBeTruthy();
  expect(
    within(within(openRecord()).getByRole('region', { name: t('event.card.heading') })).getByText(
      t('event.result.encounter', {
        name: t('seat.you'),
        pokemon: speciesName(phase.pokemon.speciesId),
      }),
    ),
  ).toBeTruthy();
});

test('a card other than e1 drawn on an encounter turn is not named as the encounter’s source', () => {
  offline();
  const store = land(['e1']);
  const view = store.getView()!;
  const feed = view.feed.map((entry) => ({
    ...entry,
    record: {
      ...entry.record,
      events: entry.record.events.map((event) =>
        event.kind === 'event_drawn' ? { ...event, eventId: 'e2' } : event,
      ),
    },
  }));
  const redrawn = { ...view, feed };
  render(<BoardScreen store={{ ...store, getView: () => redrawn }} />);
  const dialog = encounterCard();
  expect(
    within(dialog).queryByText(t('event.card.fromEncounter', { text: eventCardText('e2') })),
  ).toBeNull();
  expect(
    within(dialog).queryByText(t('event.card.fromEncounter', { text: eventCardText('e1') })),
  ).toBeNull();
});

test('the first fill of the deck is not announced as the deck running out; a later refill is, once', () => {
  const first = showBoard(land(['e2']));
  expect(first.card.textContent).not.toContain(t('event.deckReshuffled'));
  cleanup();

  const fill = showBoard(land([]));
  expect(rows(fill.log)).toContain(t('board.event.deckShuffled'));
  expect(rows(fill.log)).not.toContain(t('event.deckReshuffled'));
  expect(fill.card.textContent).not.toContain(t('event.deckReshuffled'));
  cleanup();

  const scene = createScenes({
    'encounter-no-ball': encounterNoBall,
    'sell-phase-three-pokemon': sellPhase,
    'shop-low-coins': shopLowCoins,
    'shop-no-coins': shopNoCoins,
  }).eventAfterReshuffle();
  render(<Board observation={scene.view.observation} feed={scene.view.feed} />);
  const record = openRecord();
  const card = within(record).getByRole('region', { name: t('event.card.heading') });
  const log = within(record).getByRole('log', { name: t('board.log') });
  expect(within(card).getByText(t('event.deckReshuffled'))).toBeTruthy();
  expect(rows(log).filter((row) => row === t('event.deckReshuffled'))).toHaveLength(1);
  expect(rows(log).filter((row) => row === t('board.event.deckShuffled'))).toHaveLength(1);
  expect(rows(log).filter((row) => row?.includes('drew an Event card'))).toHaveLength(2);
});

test('a rival’s secret item is told as a reward; no item name or later card reaches this seat', () => {
  const { card, log } = showBoard(land(['e4', 'e6'], { seat: 1 }));
  expect(result(card)).toBe('AI rival · seat 1 received a reward.');
  const utility = content.items.filter((item) => item.kind === 'utility').map((item) => item.name);
  for (const text of [card.textContent!, log.textContent!]) {
    for (const name of utility) expect(text).not.toContain(name);
    expect(text).not.toContain(eventCardText('e6'));
  }
});

test('a watcher sees the same public card and result, never the reward or the deck', () => {
  const { card, log } = showBoard(land(['e4', 'e6'], { seat: 1, spectate: true }));
  expect(result(card)).toBe('AI rival · seat 1 received a reward.');
  expect(card.textContent).not.toContain(eventCardText('e6'));
  const utility = content.items.filter((item) => item.kind === 'utility').map((item) => item.name);
  for (const name of utility) expect(log.textContent).not.toContain(name);
});

test('a save made mid-event resumes at the same event: same card, same encounter, nothing drawn again', () => {
  offline();
  const session = land(['e1', 'e2']).getSession()!;
  const resumed = createGameStore();
  resumed.restore(deserialize(serialize(session)));
  render(<BoardScreen store={resumed} />);
  expect(
    within(encounterCard()).getByText(t('event.card.fromEncounter', { text: eventCardText('e1') })),
  ).toBeTruthy();
  expect(
    within(within(openRecord()).getByRole('region', { name: t('event.card.heading') })).getByText(
      eventCardText('e1'),
    ),
  ).toBeTruthy();
  expect(resumed.getSession()!.log.actions).toHaveLength(session.log.actions.length);
  expect(resumed.getSession()!.state.eventDeck).toEqual(session.state.eventDeck);
});
