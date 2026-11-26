import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import type { GameState } from '../../../engine/index.ts';
import { createGameStore, type GameStore } from '../game/store.ts';
import { en, t } from '../i18n/en.ts';
import { className, itemName } from '../i18n/names.ts';
import { fakeServer, socialGame, toHumanSocial } from '../test/socialGame.ts';
import { BoardScreen } from './BoardScreen.tsx';

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
});
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const rival = className('main-character');
const coins = (count: number) => t(count === 1 ? 'deal.coinsOne' : 'deal.coinsMany', { count });
const settle = (ms = 10_000) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
const card = () => document.querySelector<HTMLElement>('[data-card="deal"]')!;
const press = (name: string | RegExp) =>
  fireEvent.click(within(card()).getByRole('button', { name }));
const pick = (name: string | RegExp) =>
  fireEvent.click(within(card()).getByRole('radio', { name }));

/**
 * Edits the game as a save restored. By default the edit is made to the log's first state too, so the recorded
 * actions still replay over it; `onlyNow` edits the state alone and drops the log, for a change no move can make.
 */
function edit(store: GameStore, change: (state: GameState) => void, onlyNow = false) {
  const { state, log } = store.getSession()!;
  const next = structuredClone(state);
  change(next);
  const initialState = structuredClone(log.initialState);
  if (!onlyNow) change(initialState);
  const edited = onlyNow ? { ...log, actions: [] } : { ...log, initialState };
  act(() =>
    store.restore({ state: next, log: edited }, store.getOpponents(), undefined, store.getGameId()),
  );
}

const caught = (instanceId: string, speciesId: string) => ({
  instanceId,
  speciesId,
  origin: 'caught' as const,
  evolutionStage: 0,
  tired: false,
  abilityReady: true,
});
const item = (instanceId: string, itemId: string, visibility: 'public' | 'secret') => ({
  instanceId,
  itemId,
  name: itemId,
  visibility,
});

/**
 * Seat 0 (the human, 20 coins) holds Porygon, a Pidgey, its public Potion and a secret Repel. Seat 1 holds two
 * Pokémon, a public Repel and a secret Pickpocket it must never show.
 */
async function dealGame({
  pidgey = true,
  decide,
}: { pidgey?: boolean; decide?: Parameters<typeof fakeServer>[2] } = {}) {
  const server = fakeServer(undefined, undefined, decide);
  const store = socialGame(1);
  expect(await toHumanSocial(store)).toBe(true);
  edit(store, (state) => {
    if (pidgey) state.players[0]!.team.push(caught('caught:0:pidgey', 'pidgey'));
    state.players[0]!.items.push(item('item:0:repel', 'repel', 'secret'));
    state.players[1]!.items.push(
      item('item:1:public-repel', 'repel', 'public'),
      item('item:1:secret', 'pickpocket', 'secret'),
    );
  });
  render(<BoardScreen store={store} />);
  return { server, store };
}

const records = (store: GameStore, kind: string) =>
  store.getSession()!.log.actions.filter((record) => record.action.kind === kind);
const holdings = (store: GameStore) =>
  store.getSession()!.state.players.map(({ seatIndex, coins: held, team, items }) => ({
    seatIndex,
    coins: held,
    team: team.map((member) => member.instanceId),
    items: items.map((entry) => entry.instanceId),
  }));
const stage = (store: GameStore) => {
  const pending = store.getSession()!.state.pendingResponse;
  return pending?.kind === 'deal' ? pending.stage : null;
};
const rivalActor = (store: GameStore) => store.getSession()!.state.players[1]!.actorId;
const openBuilder = () => fireEvent.click(screen.getByRole('button', { name: t('deal.open') }));

/** Walks one proposal to the rival's yes: open, choose, send, let the table answer. */
async function proposeAndAnswer(direction: 'sell' | 'buy', asset: RegExp, price: number) {
  openBuilder();
  if (direction === 'buy') press(t('deal.direction.buy', { rival }));
  pick(asset);
  pick(coins(price));
  press(t('deal.send', { rival }));
  await settle();
}

test('selling a Pokémon: the rival says yes, nothing moves until the player confirms, then exactly that Pokémon and those coins move once', async () => {
  const { store } = await dealGame();
  const before = holdings(store);
  await proposeAndAnswer('sell', /Pidgey/, 2);

  expect(stage(store)).toBe('accepted');
  expect(card().textContent).toContain(t('deal.lead.accepted', { rival }));
  expect(card().textContent).toContain(t('deal.reconfirmAfterFallback'));
  // The rival's yes moved nothing, however long the table waits.
  await settle(60_000);
  expect(holdings(store)).toEqual(before);
  expect(records(store, 'confirm_deal')).toHaveLength(0);

  const terms = within(card()).getByLabelText(t('deal.terms'));
  expect(terms.textContent).toContain('Pidgey');
  expect(terms.textContent).toContain(coins(2));
  press(t('deal.confirmPrice', { coins: coins(2) }));

  const after = holdings(store);
  expect(after[0]!.team).not.toContain('caught:0:pidgey');
  expect(after[1]!.team).toContain('caught:0:pidgey');
  expect(after[0]!.coins).toBe(before[0]!.coins + 2);
  expect(after[1]!.coins).toBe(before[1]!.coins - 2);
  expect(records(store, 'confirm_deal')).toHaveLength(1);
  const events = records(store, 'confirm_deal')[0]!.events;
  expect(events.filter((event) => event.kind === 'deal_committed')).toHaveLength(1);
  expect(
    events.filter((event) => event.kind === 'coin_transfer' && event.reason === 'deal'),
  ).toHaveLength(1);
  expect(card().textContent).toContain(t('deal.lead.committed', { rival }));
  fireEvent.click(within(card()).getByRole('button', { name: t('social.continue') }));
  expect(store.getView()!.observation.public.phase.kind).toBe('strategy');
});

test('buying an item the rival shows: one counteroffer needs its own confirmation, and only the new price commits', async () => {
  const { store } = await dealGame();
  const before = holdings(store);
  openBuilder();
  press(t('deal.direction.buy', { rival }));
  pick(new RegExp(itemName('repel')));
  pick(coins(1));
  press(t('deal.send', { rival }));
  // The rival answers with a new price instead of a yes (the table has not run yet).
  act(() => {
    store.submit({
      actorId: rivalActor(store),
      kind: 'counter_deal',
      payload: { coins: 5 },
    });
  });
  expect(stage(store)).toBe('countered');
  expect(card().textContent).toContain(t('deal.lead.countered.asks', { rival, coins: coins(5) }));
  const change = card().querySelector('[data-deal-counter]')!;
  expect(change.textContent).toContain(`${t('deal.yourOffer')}: ${coins(1)}`);
  expect(change.textContent).toContain(`${t('deal.newPrice')} ${coins(5)}`);
  // The old price has no button: only the current one can be confirmed.
  expect(
    within(card()).queryByRole('button', { name: t('deal.confirmPrice', { coins: coins(1) }) }),
  ).toBeNull();
  await settle(60_000);
  expect(holdings(store)).toEqual(before);

  press(t('deal.confirmPrice', { coins: coins(5) }));
  const after = holdings(store);
  expect(after[0]!.items).toContain('item:1:public-repel');
  expect(after[1]!.items).not.toContain('item:1:public-repel');
  expect(after[0]!.coins).toBe(before[0]!.coins - 5);
  expect(after[1]!.coins).toBe(before[1]!.coins + 5);
  expect(records(store, 'confirm_deal')).toHaveLength(1);
});

test('selling an item and buying a Pokémon both complete', async () => {
  const { store } = await dealGame();
  await proposeAndAnswer('sell', new RegExp(itemName('repel')), 1);
  expect(card().textContent).toContain(t('deal.shownOnly', { rival }));
  press(t('deal.confirmPrice', { coins: coins(1) }));
  expect(holdings(store)[1]!.items).toContain('item:0:repel');
  cleanup();

  const second = await dealGame();
  await proposeAndAnswer('buy', /Caterpie/, 5);
  press(t('deal.confirmPrice', { coins: coins(5) }));
  expect(holdings(second.store)[0]!.team).toContain('caught:1:13');
});

test('a Confirm is refused unless it is for the revision and the terms now in force, and a second Confirm never commits again', async () => {
  const { store } = await dealGame();
  await proposeAndAnswer('sell', /Pidgey/, 2);
  const view = store.getView()!;
  const pending = view.observation.own.pendingResponse!;
  if (pending.kind !== 'deal') throw new Error('No Deal Card is pending');
  const shown = { revision: view.observation.public.stateRevision, terms: pending.terms };
  const before = JSON.stringify(holdings(store));
  const actions = store.getSession()!.log.actions.length;
  // Another revision, or other coins, is not what the player was shown.
  expect(store.confirmDeal({ ...shown, revision: shown.revision - 1 })).toEqual({ stale: true });
  expect(
    store.confirmDeal({
      ...shown,
      terms: { ...shown.terms, get: { ...shown.terms.get, coins: 4 } },
    }),
  ).toEqual({ stale: true });
  expect(JSON.stringify(holdings(store))).toBe(before);
  expect(store.getSession()!.log.actions).toHaveLength(actions);
  // Nothing automatic ever confirms for the player.
  expect(store.advance({ human: true })).toBe(false);
  expect(store.getSession()!.log.actions).toHaveLength(actions);

  expect(store.confirmDeal(shown)).toHaveProperty('accepted', true);
  expect(store.confirmDeal(shown)).toEqual({ stale: true });
  expect(records(store, 'confirm_deal')).toHaveLength(1);
});

test('an asset that changed hands before the Confirm commits nothing and asks the player to look again', async () => {
  const { store } = await dealGame();
  await proposeAndAnswer('sell', /Pidgey/, 2);
  const rivalBefore = JSON.stringify(store.getSession()!.state.players[1]);
  edit(
    store,
    (state) => {
      state.players[0]!.team = state.players[0]!.team.filter(
        (member) => member.instanceId !== 'caught:0:pidgey',
      );
    },
    true,
  );
  expect(card().textContent).toContain(t('deal.lead.blocked'));
  expect(within(card()).getByRole('alert').textContent).toBe(t('deal.stale'));
  expect(within(card()).queryByRole('button', { name: /Confirm the deal/ })).toBeNull();
  expect(records(store, 'confirm_deal')).toHaveLength(0);
  expect(JSON.stringify(store.getSession()!.state.players[1])).toBe(rivalBefore);
  // Walking away is the one choice left, and it moves nothing.
  press(t('deal.cancel'));
  expect(records(store, 'cancel_deal')).toHaveLength(1);
  expect(rivalBefore).toBe(JSON.stringify(store.getSession()!.state.players[1]));
});

test('a refused Confirm shows the alert and commits nothing', async () => {
  const { store } = await dealGame();
  await proposeAndAnswer('sell', /Pidgey/, 2);
  const real = store.confirmDeal;
  store.confirmDeal = () => ({ stale: true });
  press(t('deal.confirmPrice', { coins: coins(2) }));
  store.confirmDeal = real;
  expect(within(card()).getByRole('alert').textContent).toBe(t('deal.stale'));
  expect(records(store, 'confirm_deal')).toHaveLength(0);
  expect(stage(store)).toBe('accepted');
});

test('reloading while the rival is asked, or after its answer, never commits and asks for a fresh Confirm', async () => {
  const { store } = await dealGame();
  openBuilder();
  pick(/Pidgey/);
  pick(coins(2));
  press(t('deal.send', { rival }));
  expect(stage(store)).toBe('proposed');
  const saved = store.getSession()!;
  cleanup();

  // A new page over the same save: the question is asked once, answered once, and not confirmed.
  const reopened = createGameStore();
  reopened.restore(saved, store.getOpponents(), undefined, store.getGameId());
  render(<BoardScreen store={reopened} />);
  await settle(60_000);
  expect(stage(reopened)).toBe('accepted');
  expect(records(reopened, 'respond_deal')).toHaveLength(1);
  expect(records(reopened, 'confirm_deal')).toHaveLength(0);
  expect(holdings(reopened)).toEqual(holdings(store));

  cleanup();
  const again = createGameStore();
  again.restore(reopened.getSession()!, store.getOpponents(), undefined, store.getGameId());
  render(<BoardScreen store={again} />);
  await settle(60_000);
  expect(records(again, 'confirm_deal')).toHaveLength(0);
  expect(card().textContent).toContain(t('deal.lead.accepted', { rival }));
  press(t('deal.confirmPrice', { coins: coins(2) }));
  expect(records(again, 'confirm_deal')).toHaveLength(1);
});

const dealAnswer = (choice: string, source: 'jev' | 'fallback' = 'jev') =>
  new Response(
    JSON.stringify({
      choice,
      source,
      ...(source === 'fallback' && { fallbackReason: 'timeout' }),
    }),
  );
const dealRequests = (server: ReturnType<typeof fakeServer>) =>
  server.calls.decide.filter((call) => call.decisionPoint === 'deal_response');

test('a rival refuses the lopsided deal the first listed choice used to accept: the server’s deal_response answer is applied (§5.3, #164 D3)', async () => {
  // A Pidgey-for-5-coins sale is within the engine's budget, so `respond-deal:accept` is listed first.
  const { store, server } = await dealGame({
    decide: (path, body) =>
      body.decisionPoint === 'deal_response' && path === '/api/ai/decide'
        ? dealAnswer('respond-deal:reject')
        : undefined,
  });
  const before = holdings(store);
  await proposeAndAnswer('sell', /Pidgey/, 5);

  expect(dealRequests(server)).toHaveLength(1);
  expect(stage(store)).toBeNull();
  expect(card().textContent).toContain(t('deal.lead.declined', { rival }));
  expect(holdings(store)).toEqual(before);
  expect(records(store, 'confirm_deal')).toHaveLength(0);
  expect(records(store, 'respond_deal')[0]!.action).toMatchObject({
    kind: 'respond_deal',
    payload: { answer: 'reject' },
  });
});

test('the rival is asked at the deal_response point, by its own seat, with only the answers the engine lists', async () => {
  const { store, server } = await dealGame();
  await proposeAndAnswer('sell', /Pidgey/, 2);
  const [asked, ...rest] = dealRequests(server);
  expect(rest).toEqual([]);
  expect(asked).toMatchObject({ decisionPoint: 'deal_response', seatIndex: 1 });
  expect(asked!.observation.own).toMatchObject({
    seatIndex: 1,
    pendingResponse: { kind: 'deal', stage: 'proposed', responderSeatIndex: 1 },
  });
  expect(asked!.enabledActions.length).toBeGreaterThan(1);
  for (const action of asked!.enabledActions)
    expect(['respond_deal', 'counter_deal']).toContain(action.kind);
  expect(stage(store)).toBe('accepted');
});

test('the server’s counter is applied as a new price the player must confirm', async () => {
  const { store, server } = await dealGame({
    decide: (path, body) => {
      if (path !== '/api/ai/decide' || body.decisionPoint !== 'deal_response') return undefined;
      const counter = body.enabledActions.find((action) => action.kind === 'counter_deal');
      return counter ? dealAnswer(counter.id) : undefined;
    },
  });
  await proposeAndAnswer('buy', /Caterpie/, 1);
  expect(dealRequests(server)).toHaveLength(1);
  expect(stage(store)).toBe('countered');
  expect(records(store, 'confirm_deal')).toHaveLength(0);
});

test('when the service fails the bounded fallback answers, and it refuses rather than accepts', async () => {
  const { store, server } = await dealGame({
    decide: (path, body) => {
      if (body.decisionPoint !== 'deal_response') return undefined;
      return path === '/api/ai/decide'
        ? new Response('down', { status: 500 })
        : dealAnswer('respond-deal:reject', 'fallback');
    },
  });
  const before = holdings(store);
  await proposeAndAnswer('sell', /Pidgey/, 5);
  expect(dealRequests(server)).toHaveLength(1);
  expect(card().textContent).toContain(t('deal.lead.declined', { rival }));
  expect(holdings(store)).toEqual(before);
});

test('the rival’s answer is applied with no source or fallback reason, whoever gave it', async () => {
  for (const source of ['jev', 'fallback'] as const) {
    const { store } = await dealGame({
      decide: (path, body) =>
        body.decisionPoint === 'deal_response' && path === '/api/ai/decide'
          ? dealAnswer('respond-deal:accept', source)
          : undefined,
    });
    await proposeAndAnswer('sell', /Pidgey/, 2);
    const dealEntries = store
      .getView()!
      .feed.filter((entry) => entry.record.action.kind.endsWith('_deal'));
    expect(dealEntries.map((entry) => entry.record.action.kind)).toEqual([
      'propose_deal',
      'respond_deal',
    ]);
    for (const entry of dealEntries) expect(entry.decision).toBeUndefined();
    for (const record of records(store, 'respond_deal'))
      expect(record.events.map((event) => event.kind)).not.toContain('line_selected');
    // Nothing on the card or the page names how the rival decided.
    expect(document.body.textContent).not.toMatch(/fallbackReason|unsupported_decision_point/i);
    expect(card().textContent).not.toMatch(/backup|fallback|jev|service|bot/i);
    cleanup();
  }
});

test('an AI refusal on its own quota reads as an ordinary no, and says nothing of why', async () => {
  const { store } = await dealGame();
  edit(store, (state) => {
    state.players[1]!.dealUsedLap = state.players[1]!.creditedLap;
  });
  const before = holdings(store);
  await proposeAndAnswer('sell', /Pidgey/, 2);
  expect(card().textContent).toContain(t('deal.lead.declined', { rival }));
  expect(card().textContent).not.toMatch(/quota|budget|lap/i);
  expect(holdings(store)).toEqual(before);
  expect(records(store, 'confirm_deal')).toHaveLength(0);
  fireEvent.click(within(card()).getByRole('button', { name: t('social.continue') }));
  expect(store.getView()!.observation.public.phase.kind).toBe('strategy');
});

test('walking away spends the interaction and moves nothing', async () => {
  const { store } = await dealGame();
  const before = holdings(store);
  await proposeAndAnswer('sell', /Pidgey/, 2);
  press(t('deal.cancel'));
  expect(holdings(store)).toEqual(before);
  expect(records(store, 'cancel_deal')).toHaveLength(1);
  expect(store.getSession()!.state.turnBudgets.socialInteraction).toBe(0);
  expect(card().textContent).toContain(t('deal.lead.cancelled'));
});

test('the picker greys out what the engine will not allow, with the engine’s own words', async () => {
  const { store } = await dealGame();
  edit(store, (state) => {
    Object.assign(state.players[0]!.team[1]!, { origin: 'rescue_starter', tradeable: false });
    state.players[0]!.coins = 1;
  });
  openBuilder();
  // Selling: the Rescue Starter is folded with its reason.
  fireEvent.click(within(card()).getByRole('button', { name: t('fold.dealsOne') }));
  expect(card().textContent).toContain('A Rescue Starter cannot be traded');
  // Buying: only the 1-coin price is affordable; the others say so.
  press(t('deal.direction.buy', { rival }));
  pick(/Caterpie/);
  expect(within(card()).queryByRole('radio', { name: coins(2) })).toBeNull();
  expect(card().querySelector('[data-deal-price-reason]')!.textContent).toBe(
    'You do not have enough coins',
  );
});

test('a full bag, and a last Pokémon, are folded with the engine’s reasons', async () => {
  const { store } = await dealGame({ pidgey: false });
  edit(store, (state) => {
    state.players[0]!.items.push(
      item('item:0:a', 'repel', 'secret'),
      item('item:0:b', 'repel', 'secret'),
    );
  });
  openBuilder();
  fireEvent.click(within(card()).getByRole('button', { name: t('fold.dealsOne') }));
  expect(card().textContent).toContain('You cannot trade away your last Pokémon');
  press(t('deal.direction.buy', { rival }));
  fireEvent.click(within(card()).getByRole('button', { name: t('fold.dealsOne') }));
  expect(card().textContent).toContain('Your items are full');
});

test('with the player’s own deal quota spent, the card shows the engine reason and no picker', async () => {
  const { store } = await dealGame();
  edit(store, (state) => {
    state.players[0]!.dealUsedLap = state.players[0]!.creditedLap;
  });
  openBuilder();
  expect(within(card()).queryByRole('radio')).toBeNull();
  expect(card().textContent).toContain(t('deal.none'));
  expect(card().textContent).toContain('You already made a deal this Lap');
  expect(within(card()).queryByRole('button', { name: /Send offer/ })).toBeNull();
});

test('a rival’s secret item is never named, listed or asked for', async () => {
  const { store } = await dealGame();
  openBuilder();
  press(t('deal.direction.buy', { rival }));
  const text = document.body.textContent!;
  expect(text).toContain(t('deal.secretNote', { rival }));
  expect(text).not.toContain(itemName('pickpocket'));
  expect(JSON.stringify(store.getView())).not.toContain('item:1:secret');
  // Its public item is listed once, by the name the content gives it.
  expect(
    within(card()).getAllByRole('radio', { name: new RegExp(itemName('repel')) }),
  ).toHaveLength(1);
});

test('the Confirm is never the Enter key’s primary action', async () => {
  await dealGame();
  await proposeAndAnswer('sell', /Pidgey/, 2);
  const confirm = within(card()).getByRole('button', {
    name: t('deal.confirmPrice', { coins: coins(2) }),
  });
  expect(confirm.hasAttribute('data-primary')).toBe(false);
  expect(card().querySelector('[data-primary]')).toBeNull();
});

test('no Deal Card wording says how a rival decided', () => {
  for (const [key, text] of Object.entries(en)) {
    if (key.startsWith('deal.')) expect(text, key).not.toMatch(/backup|fallback|jev|service|bot/i);
  }
});
