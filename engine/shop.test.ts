import { expect, test } from 'vitest';
import { fc } from '@fast-check/vitest';
import {
  advanceAutomatically,
  applyAction,
  createGame,
  createGameConfig,
  createGameLog,
  createRng,
  fixtureSchema,
  legalActions,
  observe,
  replay,
  type GameState,
} from './index.ts';
import fixture from './fixtures/start-of-game-2p.json';

/** Seat 0 about to resolve its destination; positions 4, 10, 15 and 20 are Shops. */
function resolving(position = 4, seed = 4): GameState {
  const scenario = fixtureSchema.parse(fixture).state;
  const state = createGame(
    createGameConfig({ seats: scenario.config.seats, seed, lapTarget: 3 }),
    scenario.content,
  );
  state.phase = { kind: 'resolve' };
  state.players[0]!.routeProgress = position;
  return state;
}

function command(state: GameState, kind: string, payload = {}) {
  return applyAction(state, {
    actorId: state.players[state.activeSeatIndex]!.actorId,
    actionSeq: state.stateRevision + 1,
    stateRevisionBefore: state.stateRevision,
    kind,
    payload,
  });
}

function accepted(state: GameState, kind: string, payload = {}) {
  const result = command(state, kind, payload);
  if ('rejected' in result) throw new Error(result.reason);
  return result;
}

test('resolving a Shop square offers all 3 Balls at 1/2/3 coins plus 2 drawn utility items (§4.6, Appendix A)', () => {
  const result = accepted(resolving(), 'skip');
  expect(result.state.phase.kind).toBe('shop');
  if (result.state.phase.kind !== 'shop') return;
  const offers = result.state.phase.offers;
  expect(offers.filter((offer) => offer.kind === 'ball')).toEqual([
    { id: 'offer-poke', itemId: 'poke-ball', kind: 'ball', ballType: 'poke', price: 1 },
    { id: 'offer-great', itemId: 'great-ball', kind: 'ball', ballType: 'great', price: 2 },
    { id: 'offer-ultra', itemId: 'ultra-ball', kind: 'ball', ballType: 'ultra', price: 3 },
  ]);
  const items = offers.filter((offer) => offer.kind === 'utility');
  expect(items).toHaveLength(2);
  expect(new Set(items.map((offer) => offer.itemId)).size).toBe(2);
  for (const offer of items) {
    expect(['lucky-egg', 'repel', 'pickpocket']).toContain(offer.itemId);
    expect(offer.price).toBe(3);
  }
  expect(result.events.filter((event) => event.kind === 'random_result')).toHaveLength(2);
  expect(result.events[0]).toEqual({ kind: 'space_resolved', seatIndex: 0, position: 4 });
  expect(result.events.at(-1)).toEqual({ kind: 'phase_changed', from: 'resolve', to: 'shop' });
  expect(legalActions(result.state, 0).enabled.map((choice) => choice.id)).toContain('skip-shop');
});

function shop(position = 4, seed = 4): GameState {
  return accepted(resolving(position, seed), 'skip').state;
}

test.each([
  ['poke', 1, { poke: 6, great: 1, ultra: 0 }, 19],
  ['great', 2, { poke: 5, great: 2, ultra: 0 }, 18],
  ['ultra', 3, { poke: 5, great: 1, ultra: 1 }, 17],
] as const)(
  'buying a %s Ball adds exactly 1 to the pouch and pays %i coins to the bank (§4.6)',
  (ballType, price, balls, coins) => {
    // Main Character starts with 20 coins, 5 Poké Balls and a Great Ball (§4.1).
    const state = shop();
    const before = structuredClone(state.players[0]!);
    const result = accepted(state, 'buy', { offerId: `offer-${ballType}` });
    expect(result.state.players[0]!.balls).toEqual(balls);
    expect(result.state.players[0]!.coins).toBe(coins);
    expect(result.state.players[0]!.items).toEqual(before.items);
    expect(result.events).toEqual([
      {
        kind: 'coin_transfer',
        source: { kind: 'player', actorId: 'player-0' },
        destination: { kind: 'bank' },
        amount: price,
        reason: 'shop_purchase',
      },
      { kind: 'phase_changed', from: 'shop', to: 'end' },
    ]);
  },
);

test('a visit allows at most one purchase: a second buy is rejected and nothing refreshes (§4.6)', () => {
  const bought = accepted(shop(), 'buy', { offerId: 'offer-poke' }).state;
  const second = command(bought, 'buy', { offerId: 'offer-poke' });
  expect(second).toEqual({ rejected: true, reason: 'illegal_action', state: bought });
  expect(bought.players[0]!.balls.poke).toBe(6);
  const choices = legalActions(shop(), 0);
  expect(new Set([...choices.enabled, ...choices.disabled].map((choice) => choice.kind))).toEqual(
    new Set(['buy', 'skip_shop']),
  );
});

test('skip_shop leaves the Shop without paying or buying (§4.6)', () => {
  const state = shop();
  const result = accepted(state, 'skip_shop');
  expect(result.state.players).toEqual(state.players);
  expect(result.events).toEqual([{ kind: 'phase_changed', from: 'shop', to: 'end' }]);
});

test('buying a utility item creates a secret item instance with uid_created after payment (§4.1, §4.6, §6.6)', () => {
  const state = shop();
  if (state.phase.kind !== 'shop') throw new Error('expected Shop');
  const offer = state.phase.offers.find((entry) => entry.kind === 'utility')!;
  const result = accepted(state, 'buy', { offerId: offer.id });
  const player = result.state.players[0]!;
  expect(player.coins).toBe(17);
  expect(player.balls).toEqual(state.players[0]!.balls);
  expect(player.items).toHaveLength(1);
  const item = player.items[0]!;
  expect(item).toMatchObject({ itemId: offer.itemId, visibility: 'secret' });
  expect(result.events).toEqual([
    {
      kind: 'coin_transfer',
      source: { kind: 'player', actorId: 'player-0' },
      destination: { kind: 'bank' },
      amount: 3,
      reason: 'shop_purchase',
    },
    { kind: 'uid_created', instanceId: item.instanceId, entity: 'item', ownerId: 'player-0' },
    { kind: 'phase_changed', from: 'shop', to: 'end' },
  ]);
  const ids = result.state.players.flatMap((entry) => [
    ...entry.team.map((pokemon) => pokemon.instanceId),
    ...entry.items.map((owned) => owned.instanceId),
  ]);
  expect(new Set(ids).size).toBe(ids.length);
  expect(observe(result.state, 1).public.players[0]).toMatchObject({
    itemCount: 1,
    knownItems: [],
  });
});

test('with 1 coin only the Poké Ball is enabled and buying it leaves exactly 0 coins (§3.1, §4.6)', () => {
  const state = shop();
  state.players[0]!.coins = 1;
  const choices = legalActions(state, 0);
  expect(choices.enabled.map((choice) => choice.id)).toEqual(['buy:offer-poke', 'skip-shop']);
  expect(choices.disabled).toHaveLength(4);
  for (const choice of choices.disabled) {
    expect(choice).toMatchObject({
      reasonCode: 'NOT_ENOUGH_COINS',
      reasonText: 'Not enough coins',
    });
  }
  const unaffordable = command(state, 'buy', { offerId: 'offer-great' });
  expect(unaffordable).toEqual({ rejected: true, reason: 'illegal_action', state });
  const bought = accepted(state, 'buy', { offerId: 'offer-poke' }).state;
  expect(bought.players[0]!.coins).toBe(0);
});

test.each([
  ['offer-great', 2],
  ['offer-ultra', 3],
] as const)('%s is enabled with exactly %i coins and leaves 0 (§4.6)', (offerId, price) => {
  const state = shop();
  state.players[0]!.coins = price;
  expect(legalActions(state, 0).enabled.map((choice) => choice.id)).toContain(`buy:${offerId}`);
  expect(accepted(state, 'buy', { offerId }).state.players[0]!.coins).toBe(0);
});

test('with 0 coins every offer is disabled and skip_shop is the only, automatic choice (§3.1)', () => {
  const state = shop();
  state.players[0]!.coins = 0;
  const choices = legalActions(state, 0);
  expect(choices.enabled).toEqual([{ id: 'skip-shop', kind: 'skip_shop', payload: {} }]);
  expect(choices.disabled.map((choice) => choice.reasonCode)).toEqual(
    Array(5).fill('NOT_ENOUGH_COINS'),
  );
  const advanced = advanceAutomatically(state);
  expect(advanced.records[0]!.action.kind).toBe('skip_shop');
  expect(advanced.state.phase.kind).toBe('end');
});

test('with 4 utility items held the item offers are disabled as Items full while Balls stay buyable (§3.1, §4.6)', () => {
  const state = shop();
  if (state.phase.kind !== 'shop') throw new Error('expected Shop');
  state.players[0]!.items = [1, 2, 3, 4].map((n) => ({
    instanceId: `held-${n}`,
    itemId: 'repel',
    name: 'Repel',
    visibility: 'secret' as const,
  }));
  const choices = legalActions(state, 0);
  expect(choices.enabled.map((choice) => choice.id)).toEqual([
    'buy:offer-poke',
    'buy:offer-great',
    'buy:offer-ultra',
    'skip-shop',
  ]);
  const itemOffers = state.phase.offers.filter((offer) => offer.kind === 'utility');
  expect(choices.disabled).toEqual(
    itemOffers.map((offer) => ({
      id: `buy:${offer.id}`,
      kind: 'buy',
      payload: { offerId: offer.id },
      reasonCode: 'ITEMS_FULL',
      reasonText: 'Items full',
    })),
  );
  const full = command(state, 'buy', { offerId: itemOffers[0]!.id });
  expect(full).toEqual({ rejected: true, reason: 'illegal_action', state });
  expect(accepted(state, 'buy', { offerId: 'offer-ultra' }).state.players[0]!.balls.ultra).toBe(1);
});

test('Shop squares are exactly 4, 10, 15 and 20, and only they open the Shop (Appendix A)', () => {
  const board = resolving().content.board;
  expect(board.filter((space) => space.kind === 'shop').map((space) => space.position)).toEqual([
    4, 10, 15, 20,
  ]);
  const opened = board
    .map((space) => space.position)
    .filter((position) => accepted(resolving(position), 'skip').state.phase.kind === 'shop');
  expect(opened).toEqual([4, 10, 15, 20]);
});

test('every one of 1,000 Shop visits offers all 3 Balls and exactly 2 different pool items (§4.6)', () => {
  const base = resolving();
  fc.assert(
    fc.property(
      fc.integer({ min: 0, max: 2 ** 31 - 1 }),
      fc.constantFrom(4, 10, 15, 20),
      (seed, position) => {
        const state = structuredClone(base);
        state.rng = createRng(seed);
        state.players[0]!.routeProgress = position;
        const result = accepted(state, 'skip');
        if (result.state.phase.kind !== 'shop') throw new Error('expected Shop');
        const offers = result.state.phase.offers;
        expect(offers.filter((offer) => offer.kind === 'ball').map((offer) => offer.id)).toEqual([
          'offer-poke',
          'offer-great',
          'offer-ultra',
        ]);
        const items = offers
          .filter((offer) => offer.kind === 'utility')
          .map((offer) => offer.itemId);
        expect(items).toHaveLength(2);
        expect(items[0]).not.toBe(items[1]);
        for (const itemId of items) expect(['lucky-egg', 'repel', 'pickpocket']).toContain(itemId);
      },
    ),
    { numRuns: 1000, seed: 29 },
  );
});

test('a Shop visit and purchase replay exactly from the command log (§6.8, §8)', () => {
  const initial = resolving(10, 7);
  const log = createGameLog(initial);
  const opened = accepted(initial, 'skip');
  if (opened.state.phase.kind !== 'shop') throw new Error('expected Shop');
  const offer = opened.state.phase.offers.find((entry) => entry.kind === 'utility')!;
  const bought = accepted(opened.state, 'buy', { offerId: offer.id });
  log.actions.push(opened.record, bought.record);
  expect(replay(JSON.parse(JSON.stringify(log)))).toEqual(bought.state);
});

test('setup rejects content with fewer than 2 Shop utility items (§4.6)', () => {
  const scenario = fixtureSchema.parse(fixture).state;
  const config = createGameConfig({ seats: scenario.config.seats, seed: 1, lapTarget: 3 });
  const oneUtility = structuredClone(scenario.content);
  oneUtility.items = oneUtility.items.filter(({ id }) => id !== 'repel' && id !== 'pickpocket');
  expect(() => createGame(config, oneUtility)).toThrow(/Shop needs 2 utility items/);
});
