import { describe, expect, test } from 'vitest';
import {
  actionVisibleTo,
  actionVisibleToSpectator,
  applyAction,
  checkInvariants,
  createGame,
  createGameConfig,
  createGameLog,
  dealFacts,
  deserialize,
  eventsVisibleTo,
  eventsVisibleToSpectator,
  fixtureSchema,
  legalActions,
  observe,
  observeSpectator,
  pendingDecision,
  replay,
  resume,
  serialize,
  stateHash,
  verifyReplay,
  type ActionRecord,
  type GameState,
  type SeatActionRecord,
} from './index.ts';
import { dealProblem, DEAL_COIN_LADDER } from './deals.ts';
import { ENGINE_VERSION } from './versions.ts';
import type { ApplyActionResult, EngineEvent } from './index.ts';
import { publicRevision } from './revision.ts';
import fixture from './fixtures/start-of-game-2p.json';

const caught = (instanceId: string, speciesId = 'caterpie') => ({
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
 * Seat 0 (human) in Social with its one interaction, the rest AIs. Seat 0 holds a Pokémon and a secret Potion
 * besides its Starter; seat 1 holds a Pokémon, a secret Repel and its public class item; seat 2 and 3 hold a secret
 * item of their own.
 */
function social(options: { seats?: 2 | 3 | 4; seed?: number } = {}) {
  const { seats = 2, seed = 4 } = options;
  const scenario = fixtureSchema.parse(fixture).state;
  const content = structuredClone(scenario.content);
  content.classes.push(
    {
      id: 'team-rocket',
      name: 'Team Rocket',
      starterSpeciesIds: ['eevee'],
      classItemId: 'pickpocket',
    },
    {
      id: 'gym-trainer',
      name: 'Gym Trainer',
      starterSpeciesIds: ['eevee'],
      classItemId: 'pickpocket',
    },
  );
  const seatList = [
    ...scenario.config.seats,
    { actorId: 'player-2', seatIndex: 2, classId: 'team-rocket', controller: 'ai' as const },
    { actorId: 'player-3', seatIndex: 3, classId: 'gym-trainer', controller: 'ai' as const },
  ].slice(0, seats);
  const state = createGame(
    createGameConfig({ seats: seatList, seed, lapTarget: 3, socialWindow: true }),
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
  state.players[0]!.items.push(item('item:0:potion', 'potion'));
  state.players[1]!.team.push(caught('caught:1:a', 'caterpie'));
  state.players[1]!.items.push(item('item:1:repel', 'repel'));
  for (const player of state.players.slice(2)) {
    player.items.push(item(`item:${player.seatIndex}:x`, 'repel'));
  }
  return state;
}

/** A command from `seat` (default: whoever the engine says acts) on the revision that seat observes. */
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
const attempt = (state: GameState, kind: string, payload: object = {}, seat?: number) =>
  applyAction(state, command(state, kind, payload, seat));
function accepted(state: GameState, kind: string, payload: object = {}, seat?: number) {
  const result = attempt(state, kind, payload, seat);
  if ('rejected' in result) throw new Error(`${kind}: ${result.reason}`);
  return result;
}

const side = (coins = 0, pokemon: string[] = [], items: string[] = []) => ({
  coins,
  pokemonInstanceIds: pokemon,
  itemInstanceIds: items,
});
/** The human sells a Pokémon to seat `to` for `coins`. */
const sellPokemon = (id: string, coins: number, to = 1) => ({
  targetSeatIndex: to,
  give: side(0, [id]),
  get: side(coins),
});
const sellItem = (id: string, coins: number, to = 1) => ({
  targetSeatIndex: to,
  give: side(0, [], [id]),
  get: side(coins),
});
const buyPokemon = (id: string, coins: number, from = 1) => ({
  targetSeatIndex: from,
  give: side(coins),
  get: side(0, [id]),
});
const buyItem = (id: string, coins: number, from = 1) => ({
  targetSeatIndex: from,
  give: side(coins),
  get: side(0, [], [id]),
});

const propose = (state: GameState, payload: object) => accepted(state, 'propose_deal', payload);
const reply = (state: GameState, answer: 'accept' | 'reject') =>
  accepted(state, 'respond_deal', { answer });
const confirm = (state: GameState) => accepted(state, 'confirm_deal');
/** A whole accepted deal: propose, accept, confirm. */
function deal(state: GameState, payload: object) {
  const proposed = propose(state, payload);
  const agreed = reply(proposed.state, 'accept');
  return { proposed, agreed, confirmed: confirm(agreed.state) };
}

const choicesOf = (state: GameState, seat: number) => legalActions(state, seat).enabled;
const kindsOf = (state: GameState, seat: number) => choicesOf(state, seat).map((c) => c.kind);
const holdings = (state: GameState, seat: number) => {
  const player = state.players[seat]!;
  return {
    coins: player.coins,
    team: player.team.map((pokemon) => pokemon.instanceId),
    items: player.items.map((entry) => entry.instanceId),
  };
};

/** `result` is refused as an illegal action and leaves the state byte for byte unchanged. */
function expectRefused(state: GameState, kind: string, payload: object, seat?: number) {
  const before = stateHash(state);
  const copy = structuredClone(state);
  const action = command(state, kind, payload, seat);
  const result = applyAction(state, action);
  expect(result).toMatchObject({ rejected: true });
  expect(stateHash(result.state)).toBe(before);
  expect(state).toEqual(copy);
  expect(checkInvariants(state, action, result)).toEqual([]);
  return result as Extract<ApplyActionResult, { rejected: true }>;
}

describe('which Deal Cards the human may propose (§4.8)', () => {
  test('proposals are listed for each AI, for what the human holds and what the AI shows', () => {
    const state = social();
    const proposals = choicesOf(state, 0).filter((choice) => choice.kind === 'propose_deal');
    const ids = proposals.map((choice) => choice.id);
    // Sell a Pokémon (2), reveal the secret Potion, buy the AI's Pokémon (2) and its public class item.
    for (const [subject, count] of [
      ['give:pokemon:starter:0', DEAL_COIN_LADDER.length],
      ['give:pokemon:caught:0:a', DEAL_COIN_LADDER.length],
      ['give:item:item:0:potion', DEAL_COIN_LADDER.length],
      ['get:pokemon:starter:1', DEAL_COIN_LADDER.length],
      ['get:pokemon:caught:1:a', DEAL_COIN_LADDER.length],
      ['get:item:class-item:1', DEAL_COIN_LADDER.length],
    ] as const) {
      expect(ids.filter((id) => id.startsWith(`deal:seat-1:${subject}:`))).toHaveLength(count);
    }
    expect(ids.some((id) => id.includes('item:1:repel'))).toBe(false);
    expect(new Set(ids).size).toBe(ids.length);
    // Every listed proposal is accepted by the executor.
    for (const choice of proposals) {
      expect(applyAction(state, command(state, choice.kind, choice.payload))).toMatchObject({
        accepted: true,
      });
    }
  });

  test('only the active human, in an open Social window, with the interaction unspent', () => {
    expect(kindsOf(social(), 1)).not.toContain('propose_deal');
    const strategy = social();
    strategy.phase = { kind: 'strategy' };
    expect(kindsOf(strategy, 0)).not.toContain('propose_deal');
    const spent = social();
    spent.turnBudgets.socialInteraction = 0;
    expect(kindsOf(spent, 0)).not.toContain('propose_deal');
    const off = social();
    off.config.socialWindow = false;
    expect(kindsOf(off, 0)).not.toContain('propose_deal');
    expectRefused(off, 'propose_deal', sellPokemon('caught:0:a', 3));
    const pending = propose(social(), sellPokemon('caught:0:a', 3)).state;
    expect(kindsOf(pending, 0)).toEqual([]);
    expectRefused(pending, 'propose_deal', sellPokemon('caught:0:a', 3), 0);
  });

  test('an AI is never offered a proposal and cannot make one', () => {
    const state = social();
    state.activeSeatIndex = 1;
    expect(kindsOf(state, 1)).not.toContain('propose_deal');
    expectRefused(state, 'propose_deal', { ...buyPokemon('starter:0', 2, 0) }, 1);
  });

  test('a deal can only be with an AI seat, never oneself', () => {
    const state = social();
    expectRefused(state, 'propose_deal', sellPokemon('caught:0:a', 3, 0));
    state.config.seats[1]!.controller = 'human';
    expectRefused(state, 'propose_deal', sellPokemon('caught:0:a', 3, 1));
    expect(kindsOf(state, 0)).not.toContain('propose_deal');
  });

  test('with two human seats (local multiplayer) proposals go to the AI seats only (§6: no deals between people)', () => {
    const state = social({ seats: 3 });
    state.config.seats[1]!.controller = 'human';
    const targets = (seat: number) =>
      choicesOf(state, seat)
        .filter((choice) => choice.kind === 'propose_deal')
        .map((choice) => (choice.payload as { targetSeatIndex: number }).targetSeatIndex);
    // The active human is offered deals with the one AI seat and with no human seat.
    expect(new Set(targets(0))).toEqual(new Set([2]));
    // The other human is not the active seat, so it is offered none.
    expect(targets(1)).toEqual([]);
    // A forged or stale proposal naming the human seat, in any of the four formats, is refused with the state unchanged.
    for (const payload of [
      sellPokemon('caught:0:a', 3, 1),
      sellItem('item:0:potion', 3, 1),
      buyPokemon('caught:1:a', 3, 1),
      buyItem('item:1:repel', 3, 1),
    ]) {
      expectRefused(state, 'propose_deal', payload);
    }
    // The same proposal to the AI seat is still fine, so the refusal is about the target and nothing else.
    expect(attempt(state, 'propose_deal', sellPokemon('caught:0:a', 3, 2))).toHaveProperty(
      'accepted',
    );
  });
});

describe('legality: every illegal case is refused with the state unchanged (§4.8)', () => {
  const problem = (state: GameState, payload: ReturnType<typeof sellPokemon>) =>
    dealProblem(
      state,
      0,
      payload.targetSeatIndex,
      { give: payload.give, get: payload.get },
      { targetQuota: true },
    );

  test.each([
    ['an asset the proposer does not hold', 'not_held', () => sellPokemon('nope', 3)],
    ["the AI's Pokémon offered as the human's", 'not_held', () => sellPokemon('caught:1:a', 3)],
    ['an item the human does not hold', 'not_held', () => sellItem('item:1:repel', 3)],
    ['an asked Pokémon the AI does not hold', 'not_held', () => buyPokemon('caught:0:a', 3)],
    [
      "one of the AI's secret items (never requestable)",
      'secret_item',
      () => buyItem('item:1:repel', 3),
    ],
    [
      'more coins than the paying human has',
      'not_enough_coins',
      () => buyPokemon('caught:1:a', 21),
    ],
    ['more coins than the paying AI has', 'not_enough_coins', () => sellPokemon('caught:0:a', 21)],
    ['no coins at all', 'format', () => sellPokemon('caught:0:a', 0)],
    [
      'a Pokémon for a Pokémon (cut, §10)',
      'format',
      () => ({
        targetSeatIndex: 1,
        give: side(0, ['caught:0:a']),
        get: side(0, ['caught:1:a']),
      }),
    ],
    [
      'coins on both sides',
      'format',
      () => ({
        targetSeatIndex: 1,
        give: side(2, ['caught:0:a']),
        get: side(3),
      }),
    ],
    [
      'a Pokémon and an item together',
      'format',
      () => ({
        targetSeatIndex: 1,
        give: side(0, ['caught:0:a'], ['item:0:potion']),
        get: side(3),
      }),
    ],
    [
      'an asset with coins on the same side',
      'format',
      () => ({
        targetSeatIndex: 1,
        give: side(1, ['caught:0:a']),
        get: side(3),
      }),
    ],
    ['nothing at all', 'format', () => ({ targetSeatIndex: 1, give: side(), get: side(3) })],
  ] as const)('%s → %s', (_name, reason, build) => {
    const state = social();
    const payload = build();
    expect(problem(state, payload)).toBe(reason);
    expectRefused(state, 'propose_deal', payload);
  });

  test('a duplicate UID in one side is named as a duplicate and refused', () => {
    const state = social();
    const payload = {
      targetSeatIndex: 1,
      give: side(0, [], ['item:0:potion', 'item:0:potion']),
      get: side(3),
    };
    // The schema allows one asset per kind per side, so the shape itself is malformed.
    expect(attempt(state, 'propose_deal', payload)).toMatchObject({
      rejected: true,
      reason: 'malformed_action',
    });
    expect(stateHash(attempt(state, 'propose_deal', payload).state)).toBe(stateHash(state));
    expect(
      dealProblem(
        state,
        0,
        1,
        { give: side(0, ['caught:0:a'], []), get: side(3, [], []) },
        { targetQuota: true },
      ),
    ).toBeNull();
  });

  test('a Rescue Starter is untradeable, in either direction', () => {
    const state = social();
    Object.assign(state.players[0]!.team[1]!, { origin: 'rescue_starter', tradeable: false });
    Object.assign(state.players[1]!.team[1]!, { origin: 'rescue_starter', tradeable: false });
    expect(problem(state, sellPokemon('caught:0:a', 3))).toBe('not_tradeable');
    expect(problem(state, buyPokemon('caught:1:a', 3))).toBe('not_tradeable');
    expectRefused(state, 'propose_deal', sellPokemon('caught:0:a', 3));
    expect(choicesOf(state, 0).filter((choice) => /caught:(0|1):a/.test(choice.id))).toEqual([]);
  });

  test('the giver keeps a Pokémon: a last one is not dealt, by either side', () => {
    const state = social();
    state.players[0]!.team.pop();
    state.players[1]!.team.pop();
    expect(problem(state, sellPokemon('starter:0', 3))).toBe('last_pokemon');
    expect(problem(state, buyPokemon('starter:1', 3))).toBe('last_pokemon');
    expectRefused(state, 'propose_deal', sellPokemon('starter:0', 3));
    expectRefused(state, 'propose_deal', buyPokemon('starter:1', 3));
  });

  describe('the giver keeps a Pokémon (a new rule where §4.8 is silent), both sides, both formats', () => {
    const dealsIn = (state: GameState) =>
      choicesOf(state, 0)
        .filter((choice) => choice.kind === 'propose_deal')
        .map((choice) => choice.id);

    test('the human cannot sell their last Pokémon and the AI cannot be asked for its last: nothing is listed', () => {
      const state = social();
      state.players[0]!.team.pop();
      state.players[1]!.team.pop();
      const ids = dealsIn(state);
      expect(ids.some((id) => id.includes('give:pokemon:starter:0'))).toBe(false);
      expect(ids.some((id) => id.includes('get:pokemon:starter:1'))).toBe(false);
      // Item deals are untouched by the rule: both formats stay listed where they are legal.
      expect(ids.some((id) => id.includes('give:item:item:0:potion'))).toBe(true);
      expect(ids.some((id) => id.includes('get:item:class-item:1'))).toBe(true);
      // And a forged action for either side is refused unchanged, whatever the coins.
      for (const coins of [1, 3, 20]) {
        expectRefused(state, 'propose_deal', sellPokemon('starter:0', coins));
        expectRefused(state, 'propose_deal', buyPokemon('starter:1', coins));
      }
      for (const item of ['item:0:potion', 'class-item:1']) {
        const payload = item.startsWith('item:0') ? sellItem(item, 3) : buyItem(item, 3);
        expect(problem(state, payload)).toBeNull();
      }
    });

    test('a team of two deals one Pokémon, not both, in either direction', () => {
      const state = social();
      expect(dealsIn(state).some((id) => id.includes('give:pokemon:caught:0:a'))).toBe(true);
      expect(dealsIn(state).some((id) => id.includes('get:pokemon:caught:1:a'))).toBe(true);
      const sold = accepted(
        reply(propose(state, sellPokemon('caught:0:a', 3)).state, 'accept').state,
        'confirm_deal',
      ).state;
      expect(sold.players[0]!.team.map((p) => p.instanceId)).toEqual(['starter:0']);
      // The quota is spent after a deal, so nothing more is proposed this turn; the last-Pokémon rule still names itself.
      expect(dealsIn(sold)).toEqual([]);
      expect(problem(sold, sellPokemon('starter:0', 3))).toBe('last_pokemon');
    });

    test('a pending deal whose asset became the giver’s last Pokémon is refused at the answer and at the confirm', () => {
      const sell = propose(social(), sellPokemon('caught:0:a', 6)).state;
      sell.players[0]!.team.shift();
      // The AI's only answer left is reject; accepting or countering is not listed.
      expect(choicesOf(sell, 1).map((choice) => choice.id)).toEqual(['respond-deal:reject']);
      const refusedAnswer = expectRefused(sell, 'respond_deal', { answer: 'accept' }, 1);
      expect(refusedAnswer.reason).toBe('illegal_action');

      const agreed = reply(propose(social(), sellPokemon('caught:0:a', 6)).state, 'accept').state;
      agreed.players[0]!.team.shift();
      expect(kindsOf(agreed, 0)).toEqual(['cancel_deal']);
      expect(expectRefused(agreed, 'confirm_deal', {}, 0).reason).toBe('illegal_action');

      const buy = reply(propose(social(), buyPokemon('caught:1:a', 6)).state, 'accept').state;
      buy.players[1]!.team.shift();
      expect(kindsOf(buy, 0)).toEqual(['cancel_deal']);
      expect(expectRefused(buy, 'confirm_deal', {}, 0).reason).toBe('illegal_action');
    });

    test('a Rescue Starter counts as a team member (§4.5 and D12, §C.7), so it is kept but never dealt', () => {
      const state = social();
      // Each side holds one ordinary Pokémon and one Rescue Starter.
      state.players[0]!.team.shift();
      state.players[1]!.team.shift();
      Object.assign(state.players[0]!.team[0]!, { origin: 'rescue_starter', tradeable: false });
      Object.assign(state.players[1]!.team[0]!, { origin: 'rescue_starter', tradeable: false });
      state.players[0]!.team.push(caught('caught:0:b', 'pidgey'));
      state.players[1]!.team.push(caught('caught:1:b', 'caterpie'));
      // The ordinary one may go: the Rescue Starter stays as a team member.
      expect(problem(state, sellPokemon('caught:0:b', 3))).toBeNull();
      expect(problem(state, buyPokemon('caught:1:b', 3))).toBeNull();
      // The Rescue Starter itself is untradeable, so it is never offered.
      expect(problem(state, sellPokemon('caught:0:a', 3))).toBe('not_tradeable');
      expect(problem(state, buyPokemon('caught:1:a', 3))).toBe('not_tradeable');
      expect(dealsIn(state).some((id) => /pokemon:caught:(0|1):a/.test(id))).toBe(false);
    });
  });

  test('items stay at four or fewer after the deal, for the receiving side', () => {
    const state = social();
    state.players[1]!.items.push(item('item:1:b', 'potion'), item('item:1:c', 'potion'));
    expect(state.players[1]!.items).toHaveLength(4);
    // The AI is full: it cannot be sold another item, but can sell its public one.
    expect(problem(state, sellItem('item:0:potion', 2))).toBe('items_full');
    expectRefused(state, 'propose_deal', sellItem('item:0:potion', 2));
    // The human is full: it cannot buy an item.
    const human = social();
    human.players[0]!.items.push(
      item('item:0:b', 'potion'),
      item('item:0:c', 'potion'),
      item('item:0:d', 'potion'),
    );
    expect(human.players[0]!.items).toHaveLength(4);
    expect(problem(human, buyItem('class-item:1', 2))).toBe('items_full');
    expectRefused(human, 'propose_deal', buyItem('class-item:1', 2));
  });

  test('a stale revision, a wrong actor and an unknown target are refused unchanged', () => {
    const state = social();
    const good = command(state, 'propose_deal', sellPokemon('caught:0:a', 3));
    for (const bad of [
      { ...good, stateRevisionBefore: good.stateRevisionBefore + 1 },
      { ...good, actionSeq: good.actionSeq + 1 },
      { ...good, actorId: 'player-1' },
    ]) {
      const result = applyAction(state, bad);
      expect(result).toMatchObject({ rejected: true });
      expect(stateHash(result.state)).toBe(stateHash(state));
      expect(checkInvariants(state, bad, result)).toEqual([]);
    }
    expectRefused(state, 'propose_deal', sellPokemon('caught:0:a', 3, 9));
  });

  test('a deal step with no Deal Card pending is refused', () => {
    const state = social();
    for (const [kind, payload] of [
      ['respond_deal', { answer: 'accept' }],
      ['counter_deal', { coins: 2 }],
      ['confirm_deal', {}],
      ['cancel_deal', {}],
    ] as const) {
      expectRefused(state, kind, payload, 0);
      expectRefused(state, kind, payload, 1);
    }
  });

  test('the human proposes once: a second proposal is refused while one is open', () => {
    const open = propose(social(), sellPokemon('caught:0:a', 3)).state;
    expectRefused(open, 'propose_deal', sellPokemon('starter:0', 3), 0);
  });

  test('the proposer cannot answer for the AI, nor the AI confirm for the human', () => {
    const open = propose(social(), sellPokemon('caught:0:a', 3)).state;
    expectRefused(open, 'respond_deal', { answer: 'accept' }, 0);
    expectRefused(open, 'confirm_deal', {}, 0);
    expectRefused(open, 'confirm_deal', {}, 1);
    const agreed = reply(open, 'accept').state;
    expectRefused(agreed, 'respond_deal', { answer: 'accept' }, 1);
    expectRefused(agreed, 'confirm_deal', {}, 1);
    expectRefused(agreed, 'cancel_deal', {}, 1);
    expectRefused(agreed, 'respond_deal', { answer: 'reject' }, 0);
  });
});

describe('the exchange: propose, answer, confirm (§4.8)', () => {
  test('proposing opens a question owned by the AI, moves nothing and keeps the interaction', () => {
    const state = social();
    const result = propose(state, sellPokemon('caught:0:a', 3));
    const next = result.state;
    expect(next.pendingResponse).toMatchObject({
      kind: 'deal',
      stage: 'proposed',
      initiatorSeatIndex: 0,
      responderSeatIndex: 1,
      targetSeatIndex: 1,
      counterDepth: 0,
    });
    expect(pendingDecision(next)?.seatIndex).toBe(1);
    expect(result.events.map((event) => event.kind)).toEqual(['deal_proposed']);
    for (const seat of [0, 1]) expect(holdings(next, seat)).toEqual(holdings(state, seat));
    expect(next.turnBudgets).toEqual(state.turnBudgets);
    // The proposer waits, and the responder has accept, reject and every legal counter.
    expect(choicesOf(next, 0)).toEqual([]);
    expect(kindsOf(next, 1).filter((kind) => kind !== 'counter_deal')).toEqual([
      'respond_deal',
      'respond_deal',
    ]);
    expect(choicesOf(next, 1).filter((c) => c.kind === 'counter_deal')).toHaveLength(19);
  });

  test('a confirmed deal moves the asset and the coins once, and spends only the interaction', () => {
    const state = social();
    const { proposed, agreed, confirmed } = deal(state, sellPokemon('caught:0:a', 7));
    expect(agreed.events.map((event) => event.kind)).toEqual(['deal_accepted']);
    // Accepting alone commits nothing.
    for (const seat of [0, 1]) expect(holdings(agreed.state, seat)).toEqual(holdings(state, seat));
    expect(agreed.state.turnBudgets.socialInteraction).toBe(1);
    expect(pendingDecision(agreed.state)?.seatIndex).toBe(0);
    expect(kindsOf(agreed.state, 0).sort()).toEqual(['cancel_deal', 'confirm_deal']);
    const after = confirmed.state;
    expect(holdings(after, 0)).toEqual({
      coins: 27,
      team: ['starter:0'],
      items: ['item:0:potion'],
    });
    expect(holdings(after, 1)).toEqual({
      coins: 13,
      team: ['starter:1', 'caught:1:a', 'caught:0:a'],
      items: ['class-item:1', 'item:1:repel'],
    });
    expect(after.pendingResponse).toBeUndefined();
    expect(after.turnBudgets).toMatchObject({ tacticalAction: 1, socialInteraction: 0 });
    expect(after.players[0]!.dealUsedLap).toBe(0);
    expect(after.players[1]!.dealUsedLap).toBe(0);
    expect(confirmed.events.map((event) => event.kind)).toEqual([
      'coin_transfer',
      'deal_committed',
    ]);
    expect(confirmed.events[0]).toMatchObject({
      reason: 'deal',
      amount: 7,
      source: { kind: 'player', actorId: 'player-1' },
      destination: { kind: 'player', actorId: 'player-0' },
    });
    expect(proposed.state.pendingResponse).toBeDefined();
    // Nothing else changed: the phase stays in Social and only Skip remains.
    expect(after.phase).toEqual({ kind: 'social' });
    expect(kindsOf(after, 0)).toEqual(['skip']);
  });

  test('buying a Pokémon, selling an item and buying the public item all commit', () => {
    const buy = deal(social(), buyPokemon('caught:1:a', 4)).confirmed.state;
    expect(holdings(buy, 0)).toEqual({
      coins: 16,
      team: ['starter:0', 'caught:0:a', 'caught:1:a'],
      items: ['item:0:potion'],
    });
    expect(holdings(buy, 1).coins).toBe(24);
    const sell = deal(social(), sellItem('item:0:potion', 6)).confirmed.state;
    expect(holdings(sell, 0)).toMatchObject({ coins: 26, items: [] });
    expect(holdings(sell, 1)).toMatchObject({
      coins: 14,
      items: ['class-item:1', 'item:1:repel', 'item:0:potion'],
    });
    // The potion stays secret, now in the AI's hand; the class item stays public in the human's.
    expect(sell.players[1]!.items.at(-1)!.visibility).toBe('secret');
    const egg = deal(social(), buyItem('class-item:1', 3)).confirmed.state;
    expect(holdings(egg, 0)).toMatchObject({ coins: 17, items: ['item:0:potion', 'class-item:1'] });
    expect(egg.players[0]!.items.at(-1)!.visibility).toBe('public');
    for (const state of [buy, sell, egg]) {
      expect(
        state.players.flatMap((p) => [...p.team, ...p.items]).map((x) => x.instanceId),
      ).toHaveLength(
        new Set(state.players.flatMap((p) => [...p.team, ...p.items]).map((x) => x.instanceId))
          .size,
      );
    }
  });

  test('a reject ends it: nothing moves, the interaction is spent, no quota is used', () => {
    const state = social();
    const rejected = reply(propose(state, sellPokemon('caught:0:a', 3)).state, 'reject');
    expect(rejected.events.map((event) => event.kind)).toEqual(['deal_rejected']);
    for (const seat of [0, 1]) {
      expect(holdings(rejected.state, seat)).toEqual(holdings(state, seat));
    }
    expect(rejected.state.pendingResponse).toBeUndefined();
    expect(rejected.state.turnBudgets.socialInteraction).toBe(0);
    expect(rejected.state.players[0]!.dealUsedLap).toBeUndefined();
    expect(kindsOf(rejected.state, 0)).toEqual(['skip']);
  });

  test('the AI counters once with a new coin amount; the human then confirms or walks away', () => {
    const state = social();
    const opened = propose(state, sellPokemon('caught:0:a', 3)).state;
    expect(
      choicesOf(opened, 1)
        .filter((choice) => choice.kind === 'counter_deal')
        .map((choice) => choice.payload),
    ).not.toContainEqual({ coins: 3 });
    const countered = accepted(opened, 'counter_deal', { coins: 9 });
    expect(countered.events.map((event) => event.kind)).toEqual(['deal_countered']);
    expect(countered.state.pendingResponse).toMatchObject({
      stage: 'countered',
      counterDepth: 1,
      responderSeatIndex: 0,
      terms: { give: side(0, ['caught:0:a']), get: side(9) },
    });
    // Depth is 1: neither seat may counter again, and the AI has nothing to answer.
    expect(kindsOf(countered.state, 0).sort()).toEqual(['cancel_deal', 'confirm_deal']);
    expect(kindsOf(countered.state, 1)).toEqual([]);
    expectRefused(countered.state, 'counter_deal', { coins: 5 }, 0);
    expectRefused(countered.state, 'counter_deal', { coins: 5 }, 1);
    // Confirming commits the countered coins, not the first ones.
    const done = confirm(countered.state).state;
    expect(holdings(done, 0).coins).toBe(29);
    expect(holdings(done, 1).coins).toBe(11);
    // Walking away moves nothing and still spends the interaction.
    const walked = accepted(countered.state, 'cancel_deal');
    expect(walked.events.map((event) => event.kind)).toEqual(['deal_cancelled']);
    for (const seat of [0, 1]) expect(holdings(walked.state, seat)).toEqual(holdings(state, seat));
    expect(walked.state.turnBudgets.socialInteraction).toBe(0);
    expect(walked.state.pendingResponse).toBeUndefined();
    expect(walked.state.players[0]!.dealUsedLap).toBeUndefined();
  });

  test('a counter keeps the asset and its direction and stays within what the payer holds', () => {
    const buying = propose(social(), buyPokemon('caught:1:a', 4)).state;
    const amounts = choicesOf(buying, 1)
      .filter((choice) => choice.kind === 'counter_deal')
      .map((choice) => (choice.payload as { coins: number }).coins);
    // The human pays here, with 20 coins: 1..20 without the current 4.
    expect(amounts).toEqual([...Array(20).keys()].map((n) => n + 1).filter((n) => n !== 4));
    const countered = accepted(buying, 'counter_deal', { coins: 20 }).state;
    expect(countered.pendingResponse).toMatchObject({
      terms: { give: side(20), get: side(0, ['caught:1:a']) },
    });
    expectRefused(buying, 'counter_deal', { coins: 21 }, 1);
    expectRefused(buying, 'counter_deal', { coins: 4 }, 1);
    expectRefused(buying, 'counter_deal', { coins: 0 }, 1);
  });

  test('one successful deal per Lap per player counts both sides; a new Lap restores it', () => {
    const first = deal(social(), sellPokemon('caught:0:a', 3)).confirmed.state;
    // Another interaction this turn would be needed; give one back to test the quota alone.
    first.turnBudgets.socialInteraction = 1;
    expect(kindsOf(first, 0)).not.toContain('propose_deal');
    expectRefused(first, 'propose_deal', sellItem('item:0:potion', 2));
    first.players[0]!.creditedLap = 1;
    expect(kindsOf(first, 0)).toContain('propose_deal');
    // The target's own quota counts too: an AI that dealt this Lap is not offered here...
    const used = social();
    used.players[1]!.dealUsedLap = 0;
    // ...but the offer is made, so the human learns nothing from the listing,
    expect(kindsOf(used, 0)).toContain('propose_deal');
    const asked = propose(used, sellPokemon('caught:0:a', 3)).state;
    // and the AI's only answer is the ordinary reject.
    expect(choicesOf(asked, 1).map((choice) => choice.id)).toEqual(['respond-deal:reject']);
    expectRefused(asked, 'respond_deal', { answer: 'accept' }, 1);
    expectRefused(asked, 'counter_deal', { coins: 2 }, 1);
    expect(reply(asked, 'reject').events.map((event) => event.kind)).toEqual(['deal_rejected']);
  });

  test('failed deals do not use the quota: reject then propose again next turn', () => {
    const rejected = reply(propose(social(), sellPokemon('caught:0:a', 3)).state, 'reject').state;
    rejected.turnBudgets.socialInteraction = 1;
    expect(kindsOf(rejected, 0)).toContain('propose_deal');
  });

  test('a deal never touches the tactical action or any other budget', () => {
    const state = social();
    const after = deal(state, sellPokemon('caught:0:a', 3)).confirmed.state;
    expect(after.turnBudgets).toEqual({ ...state.turnBudgets, socialInteraction: 0 });
    expect(after.phase).toEqual(state.phase);
    expect(after.activeSeatIndex).toBe(state.activeSeatIndex);
    expect(after.rng).toEqual(state.rng);
  });

  test('a tired Pokémon keeps the number of its owner turns it had left (§4.4)', () => {
    const state = social();
    state.players[0]!.ownTurnNo = 4;
    state.players[1]!.ownTurnNo = 9;
    Object.assign(state.players[0]!.team[1]!, { tired: true, tiredExpiresOwnTurnNo: 5 });
    const after = deal(state, sellPokemon('caught:0:a', 2)).confirmed.state;
    expect(after.players[1]!.team.at(-1)).toMatchObject({
      instanceId: 'caught:0:a',
      tired: true,
      tiredExpiresOwnTurnNo: 10,
    });
  });
});

describe('atomic commit after a re-check (§4.8, §8)', () => {
  /** An agreed deal whose terms are made illegal by `spoil` before the human confirms. */
  function spoiled(spoil: (state: GameState) => void) {
    const agreed = reply(propose(social(), sellPokemon('caught:0:a', 6)).state, 'accept').state;
    spoil(agreed);
    return agreed;
  }

  test.each([
    [
      'the asset left the giver',
      (s: GameState) => {
        s.players[0]!.team.pop();
      },
    ],
    [
      'the payer can no longer pay',
      (s: GameState) => {
        s.players[1]!.coins = 5;
      },
    ],
    [
      'a quota was used meanwhile',
      (s: GameState) => {
        s.players[1]!.dealUsedLap = 0;
      },
    ],
    [
      'the asset became a Rescue Starter',
      (s: GameState) => {
        Object.assign(s.players[0]!.team[1]!, { origin: 'rescue_starter', tradeable: false });
      },
    ],
  ] as const)('%s: confirm is refused, nothing transfers, and cancel still works', (_n, spoil) => {
    const state = spoiled(spoil);
    expect(kindsOf(state, 0)).toEqual(['cancel_deal']);
    const refused = expectRefused(state, 'confirm_deal', {}, 0);
    expect(refused.state.pendingResponse).toBeDefined();
    const walked = accepted(state, 'cancel_deal');
    expect(walked.state.pendingResponse).toBeUndefined();
  });

  test('an item deal whose receiver filled up meanwhile is refused unchanged', () => {
    const agreed = reply(propose(social(), sellItem('item:0:potion', 3)).state, 'accept').state;
    agreed.players[1]!.items.push(
      item('i:b', 'potion'),
      item('i:c', 'potion'),
      item('i:d', 'potion'),
    );
    expect(kindsOf(agreed, 0)).toEqual(['cancel_deal']);
    expectRefused(agreed, 'confirm_deal', {}, 0);
  });

  test('the commit is all or nothing across every field it touches', () => {
    const agreed = reply(propose(social(), sellPokemon('caught:0:a', 6)).state, 'accept').state;
    const before = structuredClone(agreed);
    const result = confirm(agreed);
    // The input state is never mutated and the commit is one accepted action.
    expect(agreed).toEqual(before);
    const diff = (a: GameState, b: GameState) =>
      b.players.flatMap((player, seat) =>
        (['coins', 'team', 'items', 'dealUsedLap'] as const).filter(
          (key) => JSON.stringify(player[key]) !== JSON.stringify(a.players[seat]![key]),
        ),
      );
    expect(diff(agreed, result.state).sort()).toEqual([
      'coins',
      'coins',
      'dealUsedLap',
      'dealUsedLap',
      'team',
      'team',
    ]);
    expect(result.state.players.reduce((total, player) => total + player.coins, 0)).toBe(
      agreed.players.reduce((total, player) => total + player.coins, 0),
    );
    expect(checkInvariants(agreed, command(agreed, 'confirm_deal'), result)).toEqual([]);
  });

  test('the invariants hold at every step of a deal, in 2, 3 and 4 seats', () => {
    for (const seats of [2, 3, 4] as const) {
      let state = social({ seats });
      const steps: [string, object, number?][] = [
        ['propose_deal', sellPokemon('caught:0:a', 6, seats - 1)],
        ['counter_deal', { coins: 9 }],
        ['confirm_deal', {}],
      ];
      for (const [kind, payload] of steps) {
        const action = command(state, kind, payload);
        const result = applyAction(state, action);
        expect(result).toMatchObject({ accepted: true });
        expect(checkInvariants(state, action, result)).toEqual([]);
        state = result.state;
      }
      expect(state.players[0]!.coins).toBe(29);
    }
  });
});

describe('hidden items stay hidden (§4.8)', () => {
  test('asking for a held secret item and for one that does not exist look the same', () => {
    const held = social();
    const other = social();
    other.players[1]!.items = other.players[1]!.items.map((entry) =>
      entry.instanceId === 'item:1:repel' ? { ...entry, itemId: 'potion', name: 'potion' } : entry,
    );
    // The same legal list, whatever secret item the AI holds, and the same refusal for a guess.
    const ids = (state: GameState) => choicesOf(state, 0).map((choice) => choice.id);
    expect(ids(held)).toEqual(ids(other));
    const guess = buyItem('item:1:repel', 2);
    const missing = buyItem('item:1:missing', 2);
    const a = expectRefused(held, 'propose_deal', guess);
    const b = expectRefused(held, 'propose_deal', missing);
    expect(a).toEqual({ ...b, state: a.state });
    expect(a.reason).toBe(b.reason);
    expect(
      dealProblem(
        held,
        0,
        1,
        { give: side(2), get: side(0, [], ['item:1:repel']) },
        { targetQuota: true },
      ),
    ).toBe('secret_item');
  });

  test('there is no request for "any item", and the AI is never asked about a hidden one', () => {
    const state = social();
    for (const payload of [
      { targetSeatIndex: 1, give: side(2), get: side(0, [], []) },
      { targetSeatIndex: 1, give: side(2), get: side(0, [], ['*']) },
      { targetSeatIndex: 1, give: side(2), get: side(0, [], ['any']) },
    ]) {
      expectRefused(state, 'propose_deal', payload);
    }
    // The AI's observation of a pending deal shows only the item the human chose to reveal.
    const sold = propose(state, sellItem('item:0:potion', 3)).state;
    const view = observe(sold, 1);
    expect(view.own.pendingResponse).toMatchObject({
      revealedItem: { instanceId: 'item:0:potion', itemId: 'potion' },
    });
    expect(JSON.stringify(view.public)).not.toContain('item:0:potion');
    // Every other item of the human is still hidden from the AI.
    const secret = social();
    secret.players[0]!.items.push(item('item:0:hidden', 'repel'));
    expect(
      JSON.stringify(observe(propose(secret, sellItem('item:0:potion', 3)).state, 1)),
    ).not.toContain('item:0:hidden');
  });
});

describe('visibility: a deal is its two parties’ alone (§4.8, §5.4)', () => {
  test('the pair sees the records, events and question; a third seat sees none of it', () => {
    const before = social({ seats: 3 });
    const { proposed, agreed, confirmed } = deal(before, sellItem('item:0:potion', 5));
    const steps = [
      { from: before, result: proposed },
      { from: proposed.state, result: agreed },
      { from: agreed.state, result: confirmed },
    ];
    for (const { from, result } of steps) {
      for (const seat of [0, 1]) {
        const seen = eventsVisibleTo(from, result.events, seat);
        expect(seen.map((event) => event.kind)).toEqual(result.events.map((event) => event.kind));
        expect(actionVisibleTo(from, result.record, seat, 0)).not.toBeNull();
      }
      expect(eventsVisibleTo(from, result.events, 2)).toEqual([]);
      expect(actionVisibleTo(from, result.record, 2, 0)).toBeNull();
      expect(eventsVisibleToSpectator(from, result.events)).toEqual([]);
      expect(actionVisibleToSpectator(from, result.record, 0)).toBeNull();
    }
    expect(observe(proposed.state, 0).own.pendingResponse).toEqual(proposed.state.pendingResponse);
    // The AI answering also gets the engine's buckets for the deal (§5.4); the proposer never does.
    expect(observe(proposed.state, 1).own.pendingResponse).toEqual({
      ...proposed.state.pendingResponse,
      facts: dealFacts(proposed.state, 1),
    });
    expect(observe(proposed.state, 2).own).not.toHaveProperty('pendingResponse');
    // Nothing a third seat or spectator can observe names the deal, the item or the counterpart.
    const seen = JSON.stringify([
      observe(proposed.state, 2),
      observe(agreed.state, 2),
      observe(confirmed.state, 2),
      observeSpectator(proposed.state),
      observeSpectator(confirmed.state),
    ]);
    expect(seen).not.toMatch(
      /deal|pendingResponse|revealedItem|item:0:potion|"potion"|counterDepth/,
    );
  });

  test.each([3, 4] as const)(
    'a bystander in a %i-seat game sees the same feed, revision and IDs with or without a deal',
    (seats) => {
      const rest: Array<[string, object]> = [
        ['skip', {}],
        ['skip', {}],
      ];
      const dealt: Array<[string, object]> = [
        ['propose_deal', sellItem('item:0:potion', 4)],
        ['respond_deal', { answer: 'accept' }],
        ['confirm_deal', {}],
        ...rest,
      ];
      const countered: Array<[string, object]> = [
        ['propose_deal', buyPokemon('caught:1:a', 4)],
        ['counter_deal', { coins: 6 }],
        ['cancel_deal', {}],
        ...rest,
      ];
      const rejected: Array<[string, object]> = [
        ['propose_deal', sellPokemon('caught:0:a', 4)],
        ['respond_deal', { answer: 'reject' }],
        ...rest,
      ];
      const play = (steps: Array<[string, object]>) => {
        let state = social({ seats });
        const full: ActionRecord[] = [];
        const feeds = new Map<number, SeatActionRecord[]>(
          state.players.map((player) => [player.seatIndex, []]),
        );
        const spectator: unknown[] = [];
        for (const [kind, payload] of steps) {
          const result = accepted(state, kind, payload);
          full.push(result.record);
          for (const [seat, feed] of feeds) {
            const visible = actionVisibleTo(state, result.record, seat, feed.length);
            if (visible) feed.push(visible);
          }
          const watched = actionVisibleToSpectator(state, result.record, spectator.length);
          if (watched) spectator.push(watched);
          state = result.state;
        }
        return { state, full, feeds, spectator };
      };
      const baseline = play(rest);
      for (const steps of [dealt, countered, rejected]) {
        const played = play(steps);
        expect(played.full.length).toBe(steps.length);
        for (const seat of [2, ...(seats === 4 ? [3] : [])]) {
          const feed = played.feeds.get(seat)!;
          expect(feed).toEqual(baseline.feeds.get(seat));
          // No gap: numbered from 1, one record per visible step.
          expect(feed.map((record) => record.action.actionSeq)).toEqual([1, 2]);
          expect(feed.map((record) => record.action.stateRevisionBefore)).toEqual([0, 1]);
          expect(observe(played.state, seat).public.stateRevision).toBe(
            observe(baseline.state, seat).public.stateRevision,
          );
          expect(JSON.stringify(feed)).not.toMatch(/deal|potion|coins|targetSeatIndex/);
        }
        expect(played.spectator).toEqual(baseline.spectator);
        expect(observeSpectator(played.state).public.stateRevision).toBe(
          observeSpectator(baseline.state).public.stateRevision,
        );
        expect(publicRevision(played.state)).toBe(publicRevision(baseline.state));
        // The pair's own feeds do hold every step.
        expect(played.feeds.get(0)!).toHaveLength(steps.length);
        expect(played.feeds.get(1)!).toHaveLength(steps.length);
      }
    },
  );

  test('the third seat’s view of the public state shows the totals but never a deal record', () => {
    const before = social({ seats: 3 });
    const after = deal(before, sellPokemon('caught:0:a', 6)).confirmed.state;
    // Coins, teams and item counts are public by nature (§4.1); the record that moved them is not.
    expect(observe(after, 2).public.players[1]!.coins).toBe(14);
    expect(observe(after, 2).public.players[0]!.team).toHaveLength(1);
    expect(observe(after, 2).own).not.toHaveProperty('pendingResponse');
    expect(after.players[2]!.unseenRecords).toBe(3);
  });
});

describe('replay, save and resume reproduce a game with deals (§6.8, §6.9)', () => {
  function played() {
    const initial = social({ seats: 3 });
    const log = createGameLog(initial);
    let state = initial;
    const steps: Array<[string, object]> = [
      ['propose_deal', buyPokemon('caught:1:a', 4)],
      ['counter_deal', { coins: 6 }],
      ['confirm_deal', {}],
      ['skip', {}],
    ];
    const midpoints: GameState[] = [];
    for (const [kind, payload] of steps) {
      const result = accepted(state, kind, payload);
      log.actions.push({ action: result.record.action, events: result.events });
      state = result.state;
      midpoints.push(state);
    }
    return { initial, log, state, midpoints };
  }

  test('replay rebuilds the same state and the checker verifies it', () => {
    const { log, state } = played();
    expect(replay(log)).toEqual(state);
    expect(verifyReplay({ state, log })).toMatchObject({ pass: true });
  });

  test('a save in the middle of the question resumes on the right seat and finishes the same', () => {
    const { log, midpoints } = played();
    // After the proposal the AI owes the answer; after its counter the human owes the confirm.
    for (const [index, seat] of [
      [0, 1],
      [1, 0],
    ] as const) {
      const midpoint = midpoints[index]!;
      const partial = { ...log, actions: log.actions.slice(0, index + 1) };
      const game = { state: midpoint, log: partial };
      const loaded = deserialize(serialize(game));
      expect(loaded.state).toEqual(midpoint);
      expect(loaded.state.pendingResponse).toEqual(midpoint.pendingResponse);
      const resumed = resume(loaded);
      expect(resumed.waitingFor).toMatchObject({ kind: 'decision', seatIndex: seat });
      expect(resumed.waitingFor).toHaveProperty('legalActions', legalActions(midpoint, seat));
      expect(verifyReplay(loaded)).toMatchObject({ pass: true });
    }
    // Finishing the exchange after a reload equals finishing it without one.
    const loaded = deserialize(
      serialize({ state: midpoints[1]!, log: { ...log, actions: log.actions.slice(0, 2) } }),
    );
    expect(confirm(loaded.state).state).toEqual(midpoints[2]);
  });

  test('a save after the commit keeps the quota and the new holdings', () => {
    const { log, state } = played();
    const loaded = deserialize(serialize({ state, log }));
    expect(loaded.state.players[0]!.dealUsedLap).toBe(0);
    expect(holdings(loaded.state, 0).team).toContain('caught:1:a');
    expect(verifyReplay(loaded)).toMatchObject({ pass: true });
  });

  test('an old save is refused rather than migrated', () => {
    const { state, log } = played();
    const text = serialize({ state, log }).replaceAll(`"${ENGINE_VERSION}"`, '"0.22.0"');
    expect(() => deserialize(text)).toThrow(/engine version/);
  });
});

describe('the deals-atomic invariant (§8)', () => {
  const violations = (before: GameState, kind: string, result: ApplyActionResult) =>
    checkInvariants(before, command(before, kind), result)
      .filter((violation) => violation.invariant === 'deals-atomic')
      .map((violation) => violation.message);
  const agreed = () =>
    reply(propose(social({ seats: 3 }), sellPokemon('caught:0:a', 6)).state, 'accept').state;
  /** The real confirm, then `edit` applied to its state and events, as a broken engine might produce. */
  function broken(edit: (state: GameState, events: EngineEvent[]) => EngineEvent[] | void) {
    const before = agreed();
    const real = confirm(before);
    const state = structuredClone(real.state);
    const events = structuredClone(real.events);
    const edits = edit(state, events);
    const changed = Array.isArray(edits) ? edits : events;
    return {
      before,
      result: {
        ...real,
        state,
        events: changed,
        record: { ...real.record, events: structuredClone(changed) },
      } satisfies ApplyActionResult,
    };
  }

  test('is active and passes the real steps', () => {
    const before = agreed();
    const real = confirm(before);
    expect(violations(before, 'confirm_deal', real)).toEqual([]);
  });

  test('an asset changing owner outside a confirmed deal is reported', () => {
    const before = social({ seats: 3 });
    const result = attempt(before, 'skip');
    if (!('accepted' in result)) throw new Error('skip refused');
    const state = structuredClone(result.state);
    state.players[1]!.team.push(state.players[0]!.team.pop()!);
    const moved = { ...result, state };
    expect(violations(before, 'skip', moved).join()).toMatch(/outside a confirmed deal/);
  });

  test('a commit that moves the wrong asset, the wrong coins or no event is reported', () => {
    const wrongAsset = broken((state) => {
      // A second Pokémon changes hands besides the dealt one.
      state.players[1]!.team.push(state.players[0]!.team.shift()!);
    });
    expect(violations(wrongAsset.before, 'confirm_deal', wrongAsset.result).join()).toMatch(
      /did not move exactly its asset/,
    );
    const wrongCoins = broken((_state, events) =>
      events.map((event) => (event.kind === 'coin_transfer' ? { ...event, amount: 5 } : event)),
    );
    expect(violations(wrongCoins.before, 'confirm_deal', wrongCoins.result).join()).toMatch(
      /did not move exactly its coins/,
    );
    const noEvent = broken((_state, events) => events.filter((e) => e.kind !== 'deal_committed'));
    expect(violations(noEvent.before, 'confirm_deal', noEvent.result).join()).toMatch(
      /exactly one deal_committed/,
    );
    const noQuota = broken((state) => {
      delete state.players[0]!.dealUsedLap;
    });
    expect(violations(noQuota.before, 'confirm_deal', noQuota.result).join()).toMatch(/Lap quota/);
    const stillPending = broken((state) => {
      state.pendingResponse = agreed().pendingResponse!;
    });
    expect(violations(stillPending.before, 'confirm_deal', stillPending.result).join()).toMatch(
      /left its question pending/,
    );
  });

  test('a deal that changes a seat outside it is reported', () => {
    const third = broken((state) => {
      state.players[2]!.coins += 1;
    });
    expect(violations(third.before, 'confirm_deal', third.result).join()).toMatch(
      /seat outside it/,
    );
  });

  test("a bystander's unseen-record count or the global deal-record count drifting is reported (§4.8)", () => {
    // Restoring either counter to its pre-confirm value leaves every other field right but gives the bystander
    // and a spectator a revision with no feed entry behind it; only a replay would otherwise show it.
    const bystander = broken((state) => {
      state.players[2]!.unseenRecords = (state.players[2]!.unseenRecords ?? 0) - 1;
    });
    expect(violations(bystander.before, 'confirm_deal', bystander.result).join()).toMatch(
      /wrong unseen-record count/,
    );
    const party = broken((state) => {
      state.players[0]!.unseenRecords = (state.players[0]!.unseenRecords ?? 0) + 1;
    });
    expect(violations(party.before, 'confirm_deal', party.result).join()).toMatch(
      /wrong unseen-record count/,
    );
    const global = broken((state) => {
      state.dealRecords = (state.dealRecords ?? 0) - 1;
    });
    expect(violations(global.before, 'confirm_deal', global.result).join()).toMatch(
      /did not count exactly one deal record/,
    );
    // Every other deal step counts one record too: a proposal that forgets to hide itself is reported.
    const start = social({ seats: 3 });
    const action = command(start, 'propose_deal', sellPokemon('caught:0:a', 6));
    const real = applyAction(start, action);
    if (!('accepted' in real)) throw new Error('propose_deal refused');
    const unhidden = structuredClone(real.state);
    unhidden.players[2]!.unseenRecords = start.players[2]!.unseenRecords ?? 0;
    unhidden.dealRecords = start.dealRecords ?? 0;
    const found = checkInvariants(start, action, { ...real, state: unhidden })
      .filter((violation) => violation.invariant === 'deals-atomic')
      .map((violation) => violation.message)
      .join();
    expect(found).toMatch(/propose_deal left .* with the wrong unseen-record count/);
    expect(found).toMatch(/propose_deal did not count exactly one deal record/);
  });

  test('a confirm with no Deal Card pending, or a counter past depth 1, is reported', () => {
    const real = broken(() => undefined);
    const bare = social({ seats: 3 });
    expect(violations(bare, 'confirm_deal', real.result).join()).toMatch(/no Deal Card pending/);
    const countered = accepted(
      propose(social(), sellPokemon('caught:0:a', 3)).state,
      'counter_deal',
      {
        coins: 4,
      },
    );
    const deep = structuredClone(countered);
    if (deep.state.pendingResponse?.kind === 'deal') {
      (deep.state.pendingResponse as { counterDepth: number }).counterDepth = 2;
    }
    expect(
      violations(
        propose(social(), sellPokemon('caught:0:a', 3)).state,
        'counter_deal',
        deep,
      ).join(),
    ).toMatch(/counter depth/);
  });

  describe('before the commit nothing moves, and the terms only change as the step says', () => {
    /** The real step, then `edit` applied to its state and events, as a broken engine might produce. */
    function tampered(
      before: GameState,
      kind: string,
      payload: object,
      edit: (state: GameState, events: EngineEvent[]) => void,
    ) {
      const action = command(before, kind, payload);
      const real = applyAction(before, action);
      if (!('accepted' in real)) throw new Error(`${kind} refused`);
      const state = structuredClone(real.state);
      const events = structuredClone(real.events);
      edit(state, events);
      const result = { ...real, state, events } satisfies ApplyActionResult;
      return {
        real,
        found: checkInvariants(before, action, result)
          .filter((violation) => violation.invariant === 'deals-atomic')
          .map((violation) => violation.message)
          .join(),
        clean: checkInvariants(before, action, real).filter(
          (violation) => violation.invariant === 'deals-atomic',
        ),
      };
    }
    const proposed = () => propose(social({ seats: 3 }), sellPokemon('caught:0:a', 6)).state;
    const dealPending = (state: GameState) => {
      const pending = state.pendingResponse;
      if (pending?.kind !== 'deal') throw new Error('no Deal Card pending');
      return pending;
    };

    test('the real steps pass', () => {
      const start = social({ seats: 3 });
      const steps = [
        tampered(start, 'propose_deal', sellPokemon('caught:0:a', 6), () => undefined),
        tampered(proposed(), 'respond_deal', { answer: 'accept' }, () => undefined),
        tampered(proposed(), 'respond_deal', { answer: 'reject' }, () => undefined),
        tampered(proposed(), 'counter_deal', { coins: 4 }, () => undefined),
      ];
      for (const step of steps) expect(step.clean).toEqual([]);
      expect(tampered(agreedDeal(), 'cancel_deal', {}, () => undefined).clean).toEqual([]);
    });

    function agreedDeal() {
      return reply(proposed(), 'accept').state;
    }

    test('a proposal that sets the Lap quota is reported', () => {
      const { found } = tampered(
        social({ seats: 3 }),
        'propose_deal',
        sellPokemon('caught:0:a', 6),
        (state) => {
          state.players[0]!.dealUsedLap = state.players[0]!.creditedLap;
        },
      );
      expect(found).toMatch(/propose_deal changed the coins, deal quota or holdings/);
    });

    test('a proposal that moves one coin with a non-deal transfer event is reported', () => {
      const start = social({ seats: 3 });
      const { found } = tampered(
        start,
        'propose_deal',
        sellPokemon('caught:0:a', 6),
        (state, events) => {
          state.players[0]!.coins -= 1;
          state.players[1]!.coins += 1;
          events.push({
            kind: 'coin_transfer',
            source: { kind: 'player', actorId: state.players[0]!.actorId },
            destination: { kind: 'player', actorId: state.players[1]!.actorId },
            amount: 1,
            reason: 'tip',
          });
        },
      );
      expect(found).toMatch(/propose_deal changed the coins, deal quota or holdings/);
      expect(found).toMatch(/propose_deal logged a coin transfer/);
    });

    test('an accept that alters the terms is reported', () => {
      const { found } = tampered(proposed(), 'respond_deal', { answer: 'accept' }, (state) => {
        dealPending(state).terms.get.coins += 1;
      });
      expect(found).toMatch(/an accepted deal changed its terms/);
    });

    test('a counter that changes more than the coin amount is reported', () => {
      const swappedAsset = tampered(proposed(), 'counter_deal', { coins: 4 }, (state) => {
        dealPending(state).terms.give.pokemonInstanceIds = ['caught:0:b'];
      });
      expect(swappedAsset.found).toMatch(/a counter changed more than the coin amount/);
      const movedCoins = tampered(proposed(), 'counter_deal', { coins: 4 }, (state) => {
        state.players[1]!.coins -= 4;
      });
      expect(movedCoins.found).toMatch(/counter_deal changed the coins, deal quota or holdings/);
      const otherSide = tampered(proposed(), 'counter_deal', { coins: 4 }, (state) => {
        dealPending(state).terms.give.coins = 2;
      });
      expect(otherSide.found).toMatch(/a counter changed more than the coin amount/);
    });

    test('a Pokémon or an item that changes hands before the commit is reported', () => {
      const steps: [string, string, object, GameState][] = [
        ['propose_deal', 'propose_deal', sellPokemon('caught:0:a', 6), social({ seats: 3 })],
        ['respond_deal', 'respond_deal', { answer: 'accept' }, proposed()],
        ['counter_deal', 'counter_deal', { coins: 4 }, proposed()],
      ];
      for (const [name, kind, payload, before] of steps) {
        const pokemon = tampered(before, kind, payload, (state) => {
          state.players[1]!.team.push(state.players[0]!.team.pop()!);
        });
        expect(pokemon.found, `${name}: a Pokémon moved`).toMatch(
          /an asset changed owner outside a confirmed deal/,
        );
        expect(pokemon.found, `${name}: a Pokémon moved`).toMatch(
          new RegExp(`${kind} changed the coins, deal quota or holdings`),
        );
      }
      const withItem = social({ seats: 3 });
      const item = tampered(withItem, 'propose_deal', sellItem('item:0:potion', 3), (state) => {
        state.players[1]!.items.push(state.players[0]!.items.pop()!);
      });
      expect(item.found).toMatch(/an asset changed owner outside a confirmed deal/);
      expect(item.found).toMatch(/propose_deal changed the coins, deal quota or holdings/);
      // A copy that only appears (no owner change) is still a changed holding.
      const copied = tampered(proposed(), 'respond_deal', { answer: 'accept' }, (state) => {
        state.players[0]!.items = [];
      });
      expect(copied.found).toMatch(/respond_deal changed the coins, deal quota or holdings/);
    });

    test('a reject or a cancel that alters anything beyond closing the question is reported', () => {
      const tamperings: [string, (state: GameState) => void, RegExp][] = [
        [
          'a Pokémon moves',
          (state) => {
            state.players[1]!.team.push(state.players[0]!.team.pop()!);
          },
          /an asset changed owner outside a confirmed deal/,
        ],
        [
          'a coin moves',
          (state) => {
            state.players[0]!.coins -= 1;
            state.players[1]!.coins += 1;
          },
          /changed the coins, deal quota or holdings/,
        ],
        [
          'a Lap quota is used up',
          (state) => {
            state.players[1]!.dealUsedLap = state.players[1]!.creditedLap;
          },
          /changed the coins, deal quota or holdings/,
        ],
        [
          'the Deal Card is left pending',
          (state) => {
            state.pendingResponse = structuredClone(proposed().pendingResponse);
          },
          /left its question pending/,
        ],
      ];
      for (const [what, edit, expected] of tamperings) {
        const reject = tampered(proposed(), 'respond_deal', { answer: 'reject' }, edit);
        expect(reject.found, `reject: ${what}`).toMatch(expected);
        const cancel = tampered(agreedDeal(), 'cancel_deal', {}, edit);
        expect(cancel.found, `cancel: ${what}`).toMatch(expected);
      }
    });

    test('a commit that changes the asset it moves is reported, a Tired expiry re-count is not', () => {
      const secretPotion = () =>
        reply(propose(social({ seats: 3 }), sellItem('item:0:potion', 3)).state, 'accept').state;
      // The punkharb case: the transferred secret Potion arrives public, so the spectator could see it.
      const exposed = tampered(secretPotion(), 'confirm_deal', {}, (state) => {
        state.players[1]!.items.find((entry) => entry.instanceId === 'item:0:potion')!.visibility =
          'public';
      });
      expect(exposed.found).toMatch(/changed the asset item:0:potion as it moved/);
      const renamed = tampered(secretPotion(), 'confirm_deal', {}, (state) => {
        state.players[1]!.items.find((entry) => entry.instanceId === 'item:0:potion')!.itemId =
          'repel';
      });
      expect(renamed.found).toMatch(/changed the asset item:0:potion as it moved/);
      // A Pokémon's form or status changing as it moves.
      const evolved = tampered(agreedDeal(), 'confirm_deal', {}, (state) => {
        Object.assign(
          state.players[1]!.team.find((m) => m.instanceId === 'caught:0:a')!,
          {
            evolutionStage: 1,
          },
        );
      });
      expect(evolved.found).toMatch(/changed the asset caught:0:a as it moved/);
      const rested = tampered(agreedDeal(), 'confirm_deal', {}, (state) => {
        Object.assign(
          state.players[1]!.team.find((m) => m.instanceId === 'caught:0:a')!,
          {
            tired: true,
          },
        );
      });
      expect(rested.found).toMatch(/changed the asset caught:0:a as it moved/);
      // The real commit of a Tired Pokémon re-counts its expiry in the new owner's turns and passes.
      const tired = social({ seats: 3 });
      tired.players[0]!.ownTurnNo = 4;
      tired.players[1]!.ownTurnNo = 9;
      Object.assign(
        tired.players[0]!.team.find((m) => m.instanceId === 'caught:0:a')!,
        {
          tired: true,
          tiredExpiresOwnTurnNo: 5,
        },
      );
      const before = reply(propose(tired, sellPokemon('caught:0:a', 3)).state, 'accept').state;
      expect(tampered(before, 'confirm_deal', {}, () => undefined).clean).toEqual([]);
      // A wrong re-count is reported.
      const miscounted = tampered(before, 'confirm_deal', {}, (state) => {
        Object.assign(
          state.players[1]!.team.find((m) => m.instanceId === 'caught:0:a')!,
          {
            tiredExpiresOwnTurnNo: 11,
          },
        );
      });
      expect(miscounted.found).toMatch(/changed the asset caught:0:a as it moved/);
    });

    test('a commit that changes what a trader keeps is reported', () => {
      // The punkharb case: a retained secret Repel turned public on the same confirm.
      const retainedItem = tampered(agreedDeal(), 'confirm_deal', {}, (state) => {
        state.players[1]!.items.find((entry) => entry.instanceId === 'item:1:repel')!.visibility =
          'public';
      });
      expect(retainedItem.found).toMatch(/changed what player-1 keeps/);
      const giversItem = tampered(agreedDeal(), 'confirm_deal', {}, (state) => {
        state.players[0]!.items.find((entry) => entry.instanceId === 'item:0:potion')!.visibility =
          'public';
      });
      expect(giversItem.found).toMatch(/changed what player-0 keeps/);
      const retainedPokemon = tampered(agreedDeal(), 'confirm_deal', {}, (state) => {
        Object.assign(
          state.players[1]!.team.find((m) => m.instanceId === 'caught:1:a')!,
          {
            tired: true,
          },
        );
      });
      expect(retainedPokemon.found).toMatch(/changed what player-1 keeps/);
      const dropped = tampered(agreedDeal(), 'confirm_deal', {}, (state) => {
        state.players[1]!.items = [];
      });
      expect(dropped.found).toMatch(/changed what player-1 keeps/);
    });

    test('a commit that leaves a balance off is reported', () => {
      const wrongBalance = tampered(agreedDeal(), 'confirm_deal', {}, (state) => {
        // Receiver pays one coin too few, as a rounding slip would.
        state.players[1]!.coins += 1;
      });
      expect(wrongBalance.found).toMatch(/wrong coin balance/);
    });
  });

  test('a refused deal step that changed the state is reported', () => {
    const before = social();
    const changed = structuredClone(before);
    changed.players[0]!.coins += 1;
    const refused = { rejected: true as const, reason: 'illegal_action' as const, state: changed };
    expect(violations(before, 'confirm_deal', refused).join()).toMatch(/refused deal step/);
    expect(violations(before, 'skip', refused)).toEqual([]);
  });
});
