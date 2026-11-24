import { describe, expect, test } from 'vitest';
import {
  applyAction,
  bucketCount,
  bucketSaleValue,
  checkInvariants,
  createGame,
  createGameConfig,
  dealFacts,
  fixtureSchema,
  itemUseWindow,
  legalActions,
  observe,
  observeSpectator,
  pendingDecision,
  type GameState,
} from './index.ts';
import { decisionFactsSchema } from './contract/decision.ts';
import { concessionWithinBudget, dealBudgetState, dealValuation } from './deal-facts.ts';
import { dealProblem } from './deals.ts';
import fixture from './fixtures/start-of-game-2p.json';

// Spec §4.8 Deal Card (valuation, concession, budget), §4.7 sale price, §5.4 named buckets.

const caught = (instanceId: string, speciesId: string) => ({
  instanceId,
  speciesId,
  origin: 'caught' as const,
  evolutionStage: 0,
  tired: false,
  abilityReady: true,
});
const item = (instanceId: string, itemId: string, visibility: 'public' | 'secret' = 'secret') => ({
  instanceId,
  itemId,
  name: itemId,
  visibility,
});

/**
 * Seat 0 (human) in Social, seat 1 (AI) and, with `seats: 3`, seat 2 (AI). Seat 0 holds a Pidgey (Base Sale `mine`)
 * and a secret Potion; seat 1 holds a Caterpie (Base Sale `theirs`) and a public class item. The content sets the
 * deal budget the spec's baseline names unless `budget` is `null`.
 */
function scenario(
  options: {
    seats?: 2 | 3;
    mine?: number;
    theirs?: number;
    budget?: { perDeal: number; perGame: number } | null;
  } = {},
) {
  const { seats = 2, mine = 6, theirs = 6, budget = { perDeal: 2, perGame: 3 } } = options;
  const base = fixtureSchema.parse(fixture).state;
  const content = structuredClone(base.content);
  content.species.find((entry) => entry.id === 'pidgey')!.base = mine;
  content.species.find((entry) => entry.id === 'caterpie')!.base = theirs;
  content.items.push({ id: 'mystery-orb', name: 'Mystery Orb', kind: 'utility', price: 6 });
  if (budget) content.dealBudget = budget;
  else delete content.dealBudget;
  content.classes.push({
    id: 'team-rocket',
    name: 'Team Rocket',
    starterSpeciesIds: ['eevee'],
    classItemId: 'pickpocket',
  });
  const seatList = [
    ...base.config.seats,
    { actorId: 'player-2', seatIndex: 2, classId: 'team-rocket', controller: 'ai' as const },
  ].slice(0, seats);
  const state = createGame(
    createGameConfig({ seats: seatList, seed: 4, lapTarget: 3, socialWindow: true }),
    content,
  );
  state.phase = { kind: 'social' };
  state.globalTurnNo = 1;
  state.players[0]!.ownTurnNo = 1;
  state.turnBudgets = {
    tacticalAction: 1,
    catchAttempt: 1,
    pokemonAbility: 1,
    socialInteraction: 1,
  };
  state.players[0]!.team.push(caught('caught:0:a', 'pidgey'));
  state.players[0]!.items.push(item('item:0:potion', 'potion'), item('item:0:orb', 'mystery-orb'));
  state.players[1]!.team.push(caught('caught:1:a', 'caterpie'));
  state.players[1]!.items.push(item('item:1:class', 'repel', 'public'));
  return state;
}

function command(state: GameState, kind: string, payload: object = {}, seat?: number) {
  const actor = seat ?? pendingDecision(state)!.seatIndex;
  const revision = observe(state, actor).public.stateRevision;
  return {
    actorId: state.players[actor]!.actorId,
    actionSeq: revision + 1,
    stateRevisionBefore: revision,
    kind,
    payload,
  };
}
function accepted(state: GameState, kind: string, payload: object = {}) {
  const action = command(state, kind, payload);
  const result = applyAction(state, action);
  if ('rejected' in result) throw new Error(`${kind}: ${result.reason}`);
  expect(checkInvariants(state, action, result)).toEqual([]);
  return result.state;
}

const side = (coins = 0, pokemon: string[] = [], items: string[] = []) => ({
  coins,
  pokemonInstanceIds: pokemon,
  itemInstanceIds: items,
});
const sellPokemon = (id: string, coins: number) => ({
  targetSeatIndex: 1,
  give: side(0, [id]),
  get: side(coins),
});
const sellItem = (id: string, coins: number) => ({
  targetSeatIndex: 1,
  give: side(0, [], [id]),
  get: side(coins),
});
const buyPokemon = (id: string, coins: number) => ({
  targetSeatIndex: 1,
  give: side(coins),
  get: side(0, [id]),
});
const buyItem = (id: string, coins: number) => ({
  targetSeatIndex: 1,
  give: side(coins),
  get: side(0, [], [id]),
});

const propose = (state: GameState, payload: object) => accepted(state, 'propose_deal', payload);
const answers = (state: GameState) => legalActions(state, 1).enabled.map((choice) => choice.id);
const valuation = (state: GameState, payload: ReturnType<typeof sellPokemon>) =>
  dealValuation(state, 0, 1, { give: payload.give, get: payload.get });

describe('named buckets at their boundaries (§5.4)', () => {
  test('value buckets use the Sell scheme: low 0–5, medium 6–12, high 13 and more', () => {
    expect([0, 1, 5].map(bucketSaleValue)).toEqual(['low', 'low', 'low']);
    expect([6, 9, 12].map(bucketSaleValue)).toEqual(['medium', 'medium', 'medium']);
    expect([13, 14, 40].map(bucketSaleValue)).toEqual(['high', 'high', 'high']);
    expect(() => bucketSaleValue(-1)).toThrow(RangeError);
    expect(() => bucketSaleValue(1.5)).toThrow(RangeError);
  });

  test('concession and budget use the count scheme: none, one, few (2–3), many (4 and more)', () => {
    expect([0, 1, 2, 3, 4, 9].map(bucketCount)).toEqual([
      'none',
      'one',
      'few',
      'few',
      'many',
      'many',
    ]);
  });

  test('the facts a responder gets are those buckets of the engine numbers, at each boundary', () => {
    const cases: [number, number, string, string, string][] = [
      // Base Sale of the Pokémon, coins offered, value received, value given, concession.
      [5, 5, 'low', 'low', 'none'],
      [6, 6, 'medium', 'medium', 'none'],
      [12, 13, 'medium', 'high', 'one'],
      [13, 12, 'high', 'medium', 'none'],
    ];
    for (const [base, coins, received, given, concession] of cases) {
      const state = propose(scenario({ mine: base }), sellPokemon('caught:0:a', coins));
      expect(dealFacts(state, 1), `${base} for ${coins}`).toMatchObject({
        valueReceived: received,
        valueGiven: given,
        concession,
      });
    }
  });
});

describe('the engine values both sides of a deal (§4.8, §4.7)', () => {
  test('a Pokémon is worth its sale price now: Base Sale, and round(x×0.8) when Tired, with no class bonus', () => {
    const state = scenario({ mine: 10 });
    const sale = (coins: number) => valuation(state, sellPokemon('caught:0:a', coins));
    expect(sale(4)).toEqual({ valueGiven: 4, valueReceived: 10, concession: 0 });
    state.players[0]!.team.find((entry) => entry.instanceId === 'caught:0:a')!.tired = true;
    expect(sale(4).valueReceived).toBe(8);
    state.content.species.find((entry) => entry.id === 'pidgey')!.base = 7;
    expect(sale(4).valueReceived).toBe(6);
    // The Bug Catcher's Sell Phase bonus is never part of a deal's value: its own bug Pokémon keeps its Base Sale.
    state.content.classes.push({
      id: 'bug-catcher',
      name: 'Bug Catcher',
      starterSpeciesIds: ['caterpie'],
      classItemId: 'repel',
      passive: 'bug_catch_sale_bonus',
    });
    state.players[1]!.classId = 'bug-catcher';
    state.content.species.find((entry) => entry.id === 'caterpie')!.base = 9;
    const bought = buyPokemon('caught:1:a', 20);
    expect(dealValuation(state, 0, 1, { give: bought.give, get: bought.get }).valueGiven).toBe(9);
  });

  test('the Starter that is still in base form is worth 5 and a Rescue Starter is not for sale', () => {
    const state = scenario();
    const starter = state.players[0]!.team[0]!;
    expect(valuation(state, sellPokemon(starter.instanceId, 1)).valueReceived).toBe(5);
    starter.origin = 'rescue_starter';
    expect(valuation(state, sellPokemon(starter.instanceId, 1)).valueReceived).toBe(0);
    expect(
      dealProblem(state, 0, 1, sellPokemon(starter.instanceId, 1) as never, { targetQuota: true }),
    ).toBe('not_tradeable');
  });

  test('the concession is what the AI gives above what it gets, in either direction', () => {
    const state = scenario({ mine: 6, theirs: 9 });
    // The AI buys a Base Sale 6 Pokémon: paying 8 concedes 2, paying 6 or less concedes nothing.
    expect(valuation(state, sellPokemon('caught:0:a', 8))).toEqual({
      valueGiven: 8,
      valueReceived: 6,
      concession: 2,
    });
    expect(valuation(state, sellPokemon('caught:0:a', 6)).concession).toBe(0);
    // The AI sells a Base Sale 9 Pokémon: 5 coins concedes 4, 12 coins concedes nothing.
    const buy = (coins: number) =>
      dealValuation(state, 0, 1, {
        give: buyPokemon('caught:1:a', coins).give,
        get: buyPokemon('caught:1:a', coins).get,
      });
    expect(buy(5)).toEqual({ valueGiven: 9, valueReceived: 5, concession: 4 });
    expect(buy(12).concession).toBe(0);
  });

  test('an item is worth its content price', () => {
    const state = scenario();
    expect(valuation(state, sellItem('item:0:potion', 1)).valueReceived).toBe(2);
    const toBuy = dealValuation(state, 0, 1, {
      give: buyItem('item:1:class', 1).give,
      get: buyItem('item:1:class', 1).get,
    });
    expect(toBuy).toEqual({ valueGiven: 3, valueReceived: 1, concession: 2 });
  });

  test('an item with no use window is worth 0: planned effect, final turn played, finished game', () => {
    const state = scenario();
    const orb = (coins: number) => valuation(state, sellItem('item:0:orb', coins));
    // Planned: held and listed, but no legal use exists (§4.6), whatever the content price says.
    expect(orb(3)).toEqual({ valueGiven: 3, valueReceived: 0, concession: 3 });
    expect(valuation(state, sellItem('item:0:potion', 3)).valueReceived).toBe(2);

    // Final Table Round: the AI seat that has played its last turn can never use the item; the active human can.
    state.finalTableRound = { triggerSeatIndex: 0, targetOwnTurnNo: 3 };
    const ai = state.players[1]!;
    ai.ownTurnNo = 2;
    expect(valuation(state, sellItem('item:0:potion', 3)).valueReceived).toBe(2);
    ai.ownTurnNo = 3;
    expect(valuation(state, sellItem('item:0:potion', 3))).toEqual({
      valueGiven: 3,
      valueReceived: 0,
      concession: 3,
    });
    expect(valuation(state, sellPokemon('caught:0:a', 3)).valueReceived).toBe(6);
    // The human is the active seat with Strategy ahead, so the AI's public item keeps its value to it.
    state.players[0]!.ownTurnNo = 3;
    expect(valuation(state, { ...buyItem('item:1:class', 1) }).valueGiven).toBe(3);

    expect(itemUseWindow(state, ai, 'potion')).toBe(false);
    state.finalTableRound = null;
    expect(itemUseWindow(state, ai, 'potion')).toBe(true);
    expect(itemUseWindow(state, ai, 'no-such-item')).toBe(false);
    state.phase = { kind: 'finished' };
    expect(itemUseWindow(state, ai, 'potion')).toBe(false);
  });
});

describe('a Potion nothing can use is worth 0 (§4.8, spec owner)', () => {
  /** The final turn of the human, the active seat in Social, buying the AI's public Potion for 1 coin. */
  function finalTurnPotion(options: { humanTired?: boolean; turnLeft?: boolean } = {}) {
    const state = scenario();
    state.players[1]!.items.push(item('item:1:potion', 'potion', 'public'));
    state.finalTableRound = { triggerSeatIndex: 0, targetOwnTurnNo: 3 };
    state.players[0]!.ownTurnNo = options.turnLeft ? 2 : 3;
    state.players[1]!.ownTurnNo = 3;
    if (options.humanTired) state.players[0]!.team[0]!.tired = true;
    return state;
  }
  const buyPotion = (coins: number) => buyItem('item:1:potion', coins);

  test('a healthy holder on its last turn cannot use it: value 0, so a sale for 1 concedes nothing', () => {
    const state = finalTurnPotion();
    expect(valuation(state, buyPotion(1))).toEqual({
      valueGiven: 0,
      valueReceived: 1,
      concession: 0,
    });
    const proposed = propose(state, buyPotion(1));
    expect(dealFacts(proposed, 1)).toMatchObject({ valueGiven: 'low', concession: 'none' });
    const confirmed = accepted(
      accepted(proposed, 'respond_deal', { answer: 'accept' }),
      'confirm_deal',
    );
    expect(confirmed.players[1]!.dealConcessionSpent ?? 0).toBe(0);
  });

  test('it keeps its price when anything can still use it', () => {
    // A tired Pokémon, which every seat can see, gives the Potion a target.
    expect(valuation(finalTurnPotion({ humanTired: true }), buyPotion(1)).valueGiven).toBe(2);
    // A later turn of the holder could still leave a Pokémon tired.
    expect(valuation(finalTurnPotion({ turnLeft: true }), buyPotion(1)).valueGiven).toBe(2);
    // Before any Final Table Round is announced nothing is guaranteed.
    const open = finalTurnPotion();
    open.finalTableRound = null;
    expect(valuation(open, buyPotion(1)).valueGiven).toBe(2);
  });

  test('a private combat debuff changes nothing: the Deal facts are the same with or without it (§4.8, §5.4)', () => {
    const plain = finalTurnPotion();
    const debuffed = finalTurnPotion();
    debuffed.players[0]!.team[0]!.combatDebuffed = true;
    // The AI seat cannot tell the two states apart before the Deal ...
    expect(observe(debuffed, 1)).toEqual(observe(plain, 1));
    // ... so neither may the valuation or the facts it is given.
    expect(valuation(debuffed, buyPotion(1))).toEqual(valuation(plain, buyPotion(1)));
    expect(dealFacts(propose(debuffed, buyPotion(1)), 1)).toEqual(
      dealFacts(propose(plain, buyPotion(1)), 1),
    );
  });

  test("it reads the holder's public team only, and other items are unaffected", () => {
    const state = finalTurnPotion();
    // The Pickpocket-class item has a Strategy use on the last turn whatever the team's health.
    expect(valuation(state, buyItem('item:1:class', 1)).valueGiven).toBe(3);
  });
});

describe('the budget comes from content, and only a commit spends it (§4.8)', () => {
  const FULL = { perDeal: 2, perGame: 3 };

  test('the cap is read from the content config, not fixed in the engine', () => {
    const state = scenario({ budget: { perDeal: 5, perGame: 7 } });
    expect(dealBudgetState(state, state.players[1]!)).toEqual({
      perDeal: 5,
      perGame: 7,
      spent: 0,
      remaining: 7,
      room: 5,
    });
    expect(dealBudgetState(scenario({ budget: null }), scenario().players[1]!)).toBeUndefined();
  });

  test('at most 2 per deal: a concession of 2 may be accepted and 3 may not, only reject and affordable counters are left', () => {
    const within = propose(scenario({ mine: 6 }), sellPokemon('caught:0:a', 8));
    expect(answers(within)).toContain('respond-deal:accept');
    const over = propose(scenario({ mine: 6 }), sellPokemon('caught:0:a', 9));
    expect(dealFacts(over, 1)).toMatchObject({ concession: 'few', budgetLeft: 'few' });
    expect(answers(over)).not.toContain('respond-deal:accept');
    expect(answers(over)).toContain('respond-deal:reject');
    // A counter is offered only where its own concession fits: coins 6, 7 and 8 do, 9 is the current ask.
    expect(answers(over).filter((id) => id.startsWith('counter-deal:'))).toContain(
      'counter-deal:coins-8',
    );
    expect(answers(over).filter((id) => id.startsWith('counter-deal:'))).not.toContain(
      'counter-deal:coins-12',
    );
  });

  test('at most 3 per game: what a seat has already conceded shrinks what it may concede now', () => {
    for (const [spent, concession, ok] of [
      [0, 2, true],
      [1, 2, true],
      [2, 2, false],
      [2, 1, true],
      [3, 1, false],
      [3, 0, true],
    ] as const) {
      const state = scenario({ mine: 6 });
      state.players[1]!.dealConcessionSpent = spent;
      const proposed = propose(state, sellPokemon('caught:0:a', 6 + concession));
      expect(
        answers(proposed).includes('respond-deal:accept'),
        `${spent} spent, ${concession}`,
      ).toBe(ok);
    }
  });

  test('a spent budget leaves only reject and zero-concession counters for any concession, and tells the AI so', () => {
    const state = scenario({ mine: 6 });
    state.players[1]!.dealConcessionSpent = 3;
    const proposed = propose(state, sellPokemon('caught:0:a', 7));
    expect(dealFacts(proposed, 1)).toMatchObject({ concession: 'one', budgetLeft: 'none' });
    expect(answers(proposed).filter((id) => !id.startsWith('counter-deal:'))).toEqual([
      'respond-deal:reject',
    ]);
    // The counters left concede nothing: the Pidgey is worth 6, so 6 coins or fewer.
    const counters = answers(proposed).filter((id) => id.startsWith('counter-deal:coins-'));
    expect(counters.length).toBeGreaterThan(0);
    for (const id of counters) expect(Number(id.split('-').pop())).toBeLessThanOrEqual(6);
    // A forged accept is refused with the state unchanged.
    const forged = applyAction(proposed, command(proposed, 'respond_deal', { answer: 'accept' }));
    expect(forged).toMatchObject({ rejected: true });
    expect(forged.state).toEqual(proposed);
    // A deal that concedes nothing is still open to it.
    const free = propose(Object.assign(scenario({ mine: 6 }), {}), sellPokemon('caught:0:a', 6));
    expect(answers(free)).toContain('respond-deal:accept');
  });

  test('over budget the AI may still counter within the room left, but never accept (§4.8)', () => {
    const state = scenario({ mine: 6 });
    state.players[1]!.dealConcessionSpent = 2; // room 1
    const proposed = propose(state, sellPokemon('caught:0:a', 9)); // concession 3
    const ids = answers(proposed);
    expect(ids).not.toContain('respond-deal:accept');
    expect(ids).toContain('respond-deal:reject');
    // Coins 6 and 7 concede 0 and 1 and fit; 8 concedes 2 and does not.
    const counters = ids.filter((id) => id.startsWith('counter-deal:'));
    expect(counters).toContain('counter-deal:coins-7');
    expect(counters).not.toContain('counter-deal:coins-8');
    const countered = applyAction(proposed, command(proposed, 'counter_deal', { coins: 7 }));
    expect(countered).not.toMatchObject({ rejected: true });
  });

  test('the offer never asks the budget, so the proposer cannot learn it', () => {
    const fresh = scenario();
    const spent = scenario();
    spent.players[1]!.dealConcessionSpent = 3;
    expect(legalActions(spent, 0)).toEqual(legalActions(fresh, 0));
    expect(
      dealProblem(spent, 0, 1, sellPokemon('caught:0:a', 12) as never, { targetQuota: false }),
    ).toBeNull();
    expect(
      dealProblem(spent, 0, 1, sellPokemon('caught:0:a', 12) as never, { targetQuota: true }),
    ).toBe('budget');
    expect(concessionWithinBudget(spent, spent.players[1]!, 0)).toBe(true);
    expect(concessionWithinBudget(spent, spent.players[1]!, 1)).toBe(false);
  });

  test('nothing is charged by a proposal, an accept, a counter, a reject or a cancel', () => {
    const spentOf = (state: GameState) => state.players[1]!.dealConcessionSpent;
    const proposed = propose(scenario({ mine: 6 }), sellPokemon('caught:0:a', 8));
    expect(spentOf(proposed)).toBeUndefined();
    const accept = accepted(proposed, 'respond_deal', { answer: 'accept' });
    expect(spentOf(accept)).toBeUndefined();
    expect(spentOf(accepted(accept, 'cancel_deal'))).toBeUndefined();
    expect(spentOf(accepted(proposed, 'respond_deal', { answer: 'reject' }))).toBeUndefined();
    const countered = accepted(proposed, 'counter_deal', { coins: 7 });
    expect(spentOf(countered)).toBeUndefined();
    expect(spentOf(accepted(countered, 'cancel_deal'))).toBeUndefined();
  });

  test('a commit charges exactly the concession of the terms it commits, a counter included', () => {
    const proposed = propose(scenario({ mine: 6 }), sellPokemon('caught:0:a', 8));
    const agreed = accepted(proposed, 'respond_deal', { answer: 'accept' });
    const committed = accepted(agreed, 'confirm_deal');
    expect(committed.players[1]!.dealConcessionSpent).toBe(2);
    expect(committed.players[0]!.dealConcessionSpent).toBeUndefined();
    expect(dealBudgetState(committed, committed.players[1]!)).toMatchObject({
      spent: 2,
      remaining: 1,
      room: 1,
    });

    const countered = accepted(proposed, 'counter_deal', { coins: 7 });
    expect(accepted(countered, 'confirm_deal').players[1]!.dealConcessionSpent).toBe(1);
    // A deal at or below value costs the AI nothing.
    const cheap = propose(scenario({ mine: 6 }), sellPokemon('caught:0:a', 4));
    const done = accepted(accepted(cheap, 'respond_deal', { answer: 'accept' }), 'confirm_deal');
    expect(done.players[1]!.dealConcessionSpent).toBeUndefined();
    expect(FULL.perGame).toBe(3);
  });

  test('without a content budget nothing is enforced and no budget bucket is told', () => {
    const proposed = propose(scenario({ mine: 6, budget: null }), sellPokemon('caught:0:a', 12));
    expect(answers(proposed)).toContain('respond-deal:accept');
    const facts = dealFacts(proposed, 1)!;
    expect(facts).toMatchObject({ concession: 'many' });
    expect(facts).not.toHaveProperty('budgetLeft');
  });
});

describe("trust and the counter price are the engine's facts, not ai/'s (§4.8, §5.4)", () => {
  const trustIn = (state: GameState, value: number | undefined) => {
    if (value !== undefined) {
      state.trust = [{ fromSeatIndex: 1, toSeatIndex: 0, value, keptGain: 0 }];
    }
    return dealFacts(propose(state, sellPokemon('caught:0:a', 6)), 1)!.proposerTrust;
  };

  test('proposerTrust is low below 0, neutral at 0 and none settled, high above 0', () => {
    expect([-3, -1].map((value) => trustIn(scenario(), value))).toEqual(['low', 'low']);
    expect([0, undefined].map((value) => trustIn(scenario(), value))).toEqual([
      'neutral',
      'neutral',
    ]);
    expect([1, 3].map((value) => trustIn(scenario(), value))).toEqual(['high', 'high']);
  });

  test('only the AI’s own trust in the proposer counts, not the proposer’s in the AI', () => {
    const state = scenario();
    state.trust = [{ fromSeatIndex: 0, toSeatIndex: 1, value: 3, keptGain: 0 }];
    expect(dealFacts(propose(state, sellPokemon('caught:0:a', 6)), 1)!.proposerTrust).toBe(
      'neutral',
    );
  });

  test('when the AI pays, the favourable counter is the listed one just below the price', () => {
    const proposed = propose(scenario({ mine: 6 }), sellPokemon('caught:0:a', 8));
    expect(dealFacts(proposed, 1)!.favourableCounter).toBe('counter-deal:coins-7');
    expect(answers(proposed)).toContain('counter-deal:coins-7');
  });

  test('when the proposer pays, it is the listed one just above the price', () => {
    const proposed = propose(scenario({ theirs: 6 }), buyPokemon('caught:1:a', 5));
    expect(dealFacts(proposed, 1)!.favourableCounter).toBe('counter-deal:coins-6');
    expect(answers(proposed)).toContain('counter-deal:coins-6');
  });

  test('it is only ever a listed counter: none when the room left allows no better price', () => {
    // The AI pays 1 coin: no lower price exists to counter at.
    const low = propose(scenario({ mine: 6 }), sellPokemon('caught:0:a', 1));
    expect(dealFacts(low, 1)).not.toHaveProperty('favourableCounter');
    // A proposer paying every coin it holds has no higher price to counter at.
    const state = scenario({ theirs: 6 });
    state.players[0]!.coins = 5;
    const all = propose(state, buyPokemon('caught:1:a', 5));
    expect(dealFacts(all, 1)).not.toHaveProperty('favourableCounter');
    // Over budget, a counter that is still over budget is not favourable either.
    const spent = scenario({ mine: 6 });
    spent.players[1]!.dealConcessionSpent = 3;
    const over = propose(spent, sellPokemon('caught:0:a', 9));
    expect(dealFacts(over, 1)!.favourableCounter).toBe('counter-deal:coins-6');
    expect(answers(over)).toContain(dealFacts(over, 1)!.favourableCounter);
  });

  test('a countered deal has no second counter, so no favourable one', () => {
    const proposed = propose(scenario({ mine: 6 }), sellPokemon('caught:0:a', 8));
    const countered = accepted(proposed, 'counter_deal', { coins: 7 });
    expect(dealFacts(countered, 1)).toBeNull();
  });
});

describe('who gets the facts (§5.4, §4.8 privacy)', () => {
  test('only the AI answering sees them, in its observation and as decision facts', () => {
    const proposed = propose(scenario({ seats: 3, mine: 6 }), sellPokemon('caught:0:a', 8));
    const facts = dealFacts(proposed, 1)!;
    expect(facts).toEqual({
      valueGiven: 'medium',
      valueReceived: 'medium',
      concession: 'few',
      budgetLeft: 'few',
      proposerTrust: 'neutral',
      favourableCounter: 'counter-deal:coins-7',
    });
    expect(observe(proposed, 1).own.pendingResponse).toMatchObject({ kind: 'deal', facts });
    expect(decisionFactsSchema.parse({ deal: facts }).deal).toEqual(facts);
    // The proposer, a seat outside the deal and a spectator never get the AI's valuation or budget.
    expect(observe(proposed, 0).own.pendingResponse).not.toHaveProperty('facts');
    expect(dealFacts(proposed, 0)).toBeNull();
    expect(dealFacts(proposed, 2)).toBeNull();
    expect(observe(proposed, 2).own.pendingResponse).toBeUndefined();
    expect(JSON.stringify(observe(proposed, 0))).not.toMatch(
      /budgetLeft|valueGiven|concession|proposerTrust|favourableCounter/,
    );
    expect(JSON.stringify(observe(proposed, 2))).not.toMatch(
      /budgetLeft|valueGiven|concession|proposerTrust|favourableCounter/,
    );
    expect(JSON.stringify(observeSpectator(proposed))).not.toMatch(
      /budgetLeft|valueGiven|concession|dealConcessionSpent|proposerTrust|favourableCounter/,
    );
    // Once the question is the proposer's to settle, the AI's facts are gone too.
    const agreed = accepted(proposed, 'respond_deal', { answer: 'accept' });
    expect(dealFacts(agreed, 1)).toBeNull();
    expect(observe(agreed, 1).own.pendingResponse).not.toHaveProperty('facts');
  });

  test("a seat's spent budget is never in any observation, only its bucket is", () => {
    const state = scenario();
    state.players[1]!.dealConcessionSpent = 2;
    for (const seat of [0, 1]) {
      expect(JSON.stringify(observe(state, seat))).not.toMatch(/dealConcessionSpent/);
    }
    const proposed = propose(state, sellPokemon('caught:0:a', 6));
    expect(dealFacts(proposed, 1)?.budgetLeft).toBe('one');
  });

  test('the facts carry no raw number', () => {
    const proposed = propose(scenario({ mine: 6 }), sellPokemon('caught:0:a', 8));
    for (const value of Object.values(dealFacts(proposed, 1)!)) {
      expect(typeof value).toBe('string');
    }
    expect(() => decisionFactsSchema.parse({ deal: { valueGiven: 8 } })).toThrow();
  });
});

describe('the deals-atomic invariant also covers the budget (§8)', () => {
  const agreed = () =>
    accepted(propose(scenario({ mine: 6 }), sellPokemon('caught:0:a', 8)), 'respond_deal', {
      answer: 'accept',
    });
  const violations = (
    before: GameState,
    edit: (state: GameState) => void,
    kind = 'confirm_deal',
    payload: object = {},
  ) => {
    const action = command(before, kind, payload);
    const result = applyAction(before, action);
    if ('rejected' in result) throw new Error(result.reason);
    const state = structuredClone(result.state);
    edit(state);
    return checkInvariants(before, action, { ...result, state })
      .filter((violation) => violation.invariant === 'deals-atomic')
      .map((violation) => violation.message)
      .join();
  };

  test('passes the real commit', () => {
    expect(violations(agreed(), () => {})).toBe('');
  });

  test('a commit that charges the wrong concession or none is reported', () => {
    expect(
      violations(agreed(), (state) => {
        state.players[1]!.dealConcessionSpent = 1;
      }),
    ).toMatch(/charge exactly its concession/);
    expect(
      violations(agreed(), (state) => {
        delete state.players[1]!.dealConcessionSpent;
      }),
    ).toMatch(/charge exactly its concession/);
  });

  test('a charge outside a confirmed deal, and one past the budget, are reported', () => {
    const proposing = scenario({ mine: 6 });
    expect(
      violations(
        proposing,
        (state) => {
          state.players[1]!.dealConcessionSpent = 1;
        },
        'skip',
      ),
    ).toMatch(/outside a confirmed deal/);
    // A deal step before the commit leaves the budget untouched too, with the holdings (deals-atomic's comparison).
    const proposedDeal = propose(scenario({ mine: 6 }), sellPokemon('caught:0:a', 8));
    expect(
      violations(
        proposedDeal,
        (state) => {
          state.players[1]!.dealConcessionSpent = 1;
        },
        'respond_deal',
        { answer: 'accept' },
      ),
    ).toMatch(/respond_deal changed the coins, deal quota or holdings/);
    // A commit that spends past the budget: the AI had already conceded 2, and this deal concedes 2 more.
    const forged = agreed();
    const action = command(forged, 'confirm_deal');
    const result = applyAction(forged, action);
    if ('rejected' in result) throw new Error(result.reason);
    const prior = structuredClone(forged);
    prior.players[1]!.dealConcessionSpent = 2;
    const state = structuredClone(result.state);
    state.players[1]!.dealConcessionSpent = 4;
    expect(
      checkInvariants(prior, action, { ...result, state })
        .filter((violation) => violation.invariant === 'deals-atomic')
        .map((violation) => violation.message)
        .join(),
    ).toMatch(/more than the AI budget allows/);
  });
});
