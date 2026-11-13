import { expect, test } from 'vitest';
import {
  advanceAutomatically,
  applyAction,
  createGame,
  createGameConfig,
  createGameLog,
  fixtureSchema,
  legalActions,
  observe,
  replay,
  type Content,
  type GameState,
} from './index.ts';
import fixture from './fixtures/start-of-game-2p.json';

function researcherContent(): Content {
  const content = structuredClone(fixtureSchema.parse(fixture).state.content);
  content.species.push({
    id: 'porygon',
    name: 'Porygon',
    rarity: 'uncommon',
    dc: 3,
    battle: 2,
    base: 10,
    tags: ['normal'],
  });
  content.classes.push({
    id: 'researcher',
    name: 'Researcher',
    starterSpeciesIds: ['porygon'],
    classItemId: 'potion',
    passive: 'lap_first_sale_bonus',
  });
  return content;
}

function researcherGame(): GameState {
  return createGame(
    createGameConfig({
      seats: [
        { actorId: 'player-0', seatIndex: 0, classId: 'researcher', controller: 'human' },
        { actorId: 'player-1', seatIndex: 1, classId: 'rival', controller: 'ai' },
      ],
      seed: 30,
      lapTarget: 3,
    }),
    researcherContent(),
  );
}

test('the Researcher starts with 20 coins, Porygon, 5 Poké Balls and a public Potion (§4.1, Appendix A)', () => {
  const researcher = researcherGame().players[0]!;
  expect(researcher.coins).toBe(20);
  expect(researcher.team).toEqual([
    {
      instanceId: 'starter:0',
      speciesId: 'porygon',
      origin: 'original_starter',
      evolutionStage: 0,
      tired: false,
      abilityReady: true,
    },
  ]);
  expect(researcher.balls).toEqual({ poke: 5, great: 0, ultra: 0 });
  expect(researcher.items).toEqual([
    { instanceId: 'class-item:0', itemId: 'potion', name: 'Potion', visibility: 'public' },
  ]);
});

function caught(instanceId: string, speciesId: string) {
  return {
    instanceId,
    speciesId,
    origin: 'caught' as const,
    evolutionStage: 0,
    tired: false,
    abilityReady: true,
  };
}

function researcherSellState(): GameState {
  const state = researcherGame();
  state.players[0]!.team.push(
    caught('caught:caterpie', 'caterpie'),
    caught('caught:eevee', 'eevee'),
    caught('caught:pidgey', 'pidgey'),
  );
  state.phase = { kind: 'sell', destinationPosition: 2 };
  return state;
}

function sell(state: GameState, pokemonInstanceIds: string[]) {
  const result = applyAction(state, {
    actorId: state.players[state.activeSeatIndex]!.actorId,
    actionSeq: state.stateRevision + 1,
    stateRevisionBefore: state.stateRevision,
    kind: 'sell',
    payload: { pokemonInstanceIds },
  });
  if ('rejected' in result) throw new Error(result.reason);
  return result;
}

function saleTransfers(events: ReturnType<typeof sell>['events']) {
  return events.filter((event) => event.kind === 'coin_transfer');
}

test('a Researcher selling three Pokémon gets +3 once, on the highest sale basis, shown in the sale event (§4.7)', () => {
  const result = sell(researcherSellState(), ['caught:caterpie', 'starter:0', 'caught:eevee']);
  // Caterpie 4, base Porygon Original Starter 5, Eevee 12 + 3.
  expect(result.state.players[0]!.coins).toBe(44);
  expect(saleTransfers(result.events)).toEqual([
    {
      kind: 'coin_transfer',
      source: { kind: 'bank' },
      destination: { kind: 'player', actorId: 'player-0' },
      amount: 4,
      reason: 'pokemon_sale',
      sale: { basePrice: 4, classBonus: 0 },
    },
    {
      kind: 'coin_transfer',
      source: { kind: 'bank' },
      destination: { kind: 'player', actorId: 'player-0' },
      amount: 5,
      reason: 'pokemon_sale',
      sale: { basePrice: 5, classBonus: 0 },
    },
    {
      kind: 'coin_transfer',
      source: { kind: 'bank' },
      destination: { kind: 'player', actorId: 'player-0' },
      amount: 15,
      reason: 'pokemon_sale',
      sale: { basePrice: 12, classBonus: 3 },
    },
  ]);
});

/** Reach the next Sell Phase through a real owner move across Start. */
function crossStart(state: GameState): GameState {
  const scenario = structuredClone(state);
  scenario.activeSeatIndex = 0;
  scenario.phase = { kind: 'move' };
  scenario.players[0]!.routeProgress = 24 * scenario.players[0]!.creditedLap + 23;
  const rolled = applyAction(scenario, {
    actorId: 'player-0',
    actionSeq: scenario.stateRevision + 1,
    stateRevisionBefore: scenario.stateRevision,
    kind: 'roll',
    payload: {},
  });
  if ('rejected' in rolled) throw new Error(rolled.reason);
  const moved = advanceAutomatically(rolled.state).state;
  expect(moved.phase.kind).toBe('sell');
  return moved;
}

test('the bonus returns after the owner passes Start again (§4.7)', () => {
  const firstLap = sell(crossStart(researcherSellState()), ['caught:eevee']);
  expect(saleTransfers(firstLap.events)[0]!.sale).toEqual({ basePrice: 12, classBonus: 3 });
  const nextLap = sell(crossStart(firstLap.state), ['caught:caterpie']);
  expect(saleTransfers(nextLap.events)[0]!.sale).toEqual({ basePrice: 4, classBonus: 3 });
});

test('selling nothing does not consume the bonus for a later sale (§4.7)', () => {
  const kept = sell(crossStart(researcherSellState()), []);
  expect(kept.state.players[0]!.coins).toBe(25);
  const later = sell(crossStart(kept.state), ['caught:pidgey']);
  expect(saleTransfers(later.events)[0]!.sale).toEqual({ basePrice: 5, classBonus: 3 });
});

test('a sold Rescue Starter never receives the Researcher bonus (§4.5)', () => {
  const state = researcherSellState();
  state.players[0]!.team = [
    { ...caught('rescue:0:1', 'porygon'), origin: 'rescue_starter', tradeable: false },
    caught('caught:eevee', 'eevee'),
  ];
  const rescueOnly = sell(state, ['rescue:0:1']);
  expect(saleTransfers(rescueOnly.events)).toMatchObject([
    { amount: 0, sale: { basePrice: 0, classBonus: 0 } },
  ]);
  const whole = sell(state, ['rescue:0:1', 'caught:eevee']);
  expect(saleTransfers(whole.events).map((event) => event.sale)).toEqual([
    { basePrice: 0, classBonus: 0 },
    { basePrice: 12, classBonus: 3 },
  ]);
});

test.each([
  [['caught:b', 'caught:a', 'caught:pidgey']],
  [['caught:pidgey', 'caught:a', 'caught:b']],
])(
  'equal sale bases give the bonus to the lowest instance ID whatever the order %j (§4.7)',
  (ids) => {
    const state = researcherSellState();
    state.players[0]!.team.push(caught('caught:b', 'eevee'), caught('caught:a', 'eevee'));
    const result = sell(state, ids);
    const bonusByInstance = Object.fromEntries(
      ids.map((id, index) => [id, saleTransfers(result.events)[index]!.sale!.classBonus]),
    );
    expect(bonusByInstance).toEqual({ 'caught:a': 3, 'caught:b': 0, 'caught:pidgey': 0 });
  },
);

test('a tired Pokémon competes on its untired sale basis and takes the bonus after rounding (§4.7 step 2)', () => {
  const state = researcherSellState();
  state.players[0]!.team.find((pokemon) => pokemon.instanceId === 'caught:eevee')!.tired = true;
  const result = sell(state, ['caught:pidgey', 'caught:eevee']);
  expect(saleTransfers(result.events).map((event) => event.sale)).toEqual([
    { basePrice: 5, classBonus: 0 },
    { basePrice: 10, classBonus: 3 },
  ]);
});

test('the Researcher passive adds nothing to a catch snapshot (§4.3, Appendix A)', () => {
  const state = researcherGame();
  state.globalTurnNo = 1;
  state.turnBudgets.catchAttempt = 1;
  state.phase = { kind: 'encounter', pokemon: { speciesId: 'caterpie' } };
  const result = applyAction(state, {
    actorId: 'player-0',
    actionSeq: 1,
    stateRevisionBefore: 0,
    kind: 'catch',
    payload: { ballType: 'poke' },
  });
  if ('rejected' in result) throw new Error(result.reason);
  expect(result.state.phase).toMatchObject({ catchRoll: { classBonus: 0, catchDC: 2 } });
});

test('a Potion is a public Strategy item disabled with NO_VALID_TARGET while no own Pokémon is tired (§3.1, §4.6)', () => {
  const state = researcherGame();
  state.globalTurnNo = 1;
  state.phase = { kind: 'strategy' };
  state.turnBudgets.tacticalAction = 1;
  state.players[1]!.team[0]!.tired = true;
  expect({
    ...legalActions(state, 0),
    enabled: legalActions(state, 0).enabled.filter((choice) => choice.kind !== 'declare_pvp'),
    disabled: legalActions(state, 0).disabled.filter((choice) => choice.kind !== 'declare_pvp'),
  }).toEqual({
    enabled: [{ id: 'skip', kind: 'skip', payload: {} }],
    disabled: [
      {
        id: 'use-item:class-item:0',
        kind: 'use_item',
        payload: { itemInstanceId: 'class-item:0' },
        reasonCode: 'NO_VALID_TARGET',
        reasonText: 'No tired or debuffed Pokémon to heal',
      },
    ],
  });
  expect(observe(state, 1).public.players[0]!.knownItems).toEqual([
    { instanceId: 'class-item:0', itemId: 'potion', name: 'Potion', visibility: 'public' },
  ]);
  expect(advanceAutomatically(state).state.phase).toEqual({ kind: 'move' });
});

test('a Researcher crossing Start and selling replays with the same bonus events (§6.8, §8)', () => {
  const initial = researcherSellState();
  initial.phase = { kind: 'move' };
  initial.players[0]!.routeProgress = 23;
  const log = createGameLog(initial);
  const rolled = applyAction(initial, {
    actorId: 'player-0',
    actionSeq: 1,
    stateRevisionBefore: 0,
    kind: 'roll',
    payload: {},
  });
  if ('rejected' in rolled) throw new Error(rolled.reason);
  const moved = advanceAutomatically(rolled.state);
  const sold = sell(moved.state, ['caught:caterpie', 'caught:eevee']);
  log.actions.push(rolled.record, ...moved.records, sold.record);
  expect(saleTransfers(sold.events).map((event) => event.sale)).toEqual([
    { basePrice: 4, classBonus: 0 },
    { basePrice: 12, classBonus: 3 },
  ]);
  expect(replay(JSON.parse(JSON.stringify(log)))).toEqual(sold.state);
});

test('pre-class-bonus executable versions reject instead of replaying without the Researcher bonus (§6.8)', () => {
  const state = researcherGame();
  state.config.engineVersion = '0.5.0';
  expect(() => createGame(state.config, state.content)).toThrow(/unsupported/i);
  expect(() => createGameLog(state)).toThrow(/unsupported/i);
});
