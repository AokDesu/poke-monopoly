import { expect, test } from 'vitest';
import {
  applyAction,
  createGame,
  createGameConfig,
  fixtureSchema,
  legalActions,
  advanceAutomatically,
  createGameLog,
  replay,
  stateHash,
  gameStateSchema,
  type GameState,
} from './index.ts';
import fixture from './fixtures/start-of-game-2p.json';

function sellState(): GameState {
  const scenario = fixtureSchema.parse(fixture).state;
  const state = createGame(
    createGameConfig({ seats: scenario.config.seats, seed: 4, lapTarget: 3 }),
    scenario.content,
  );
  state.phase = { kind: 'sell', destinationPosition: 2 };
  state.players[0]!.team.push({
    instanceId: 'caught-eevee',
    speciesId: 'eevee',
    origin: 'caught',
    evolutionStage: 0,
    tired: false,
    abilityReady: true,
  });
  return state;
}

function sell(state: GameState, pokemonInstanceIds: string[]) {
  return applyAction(state, {
    actorId: 'player-0',
    actionSeq: state.stateRevision + 1,
    stateRevisionBefore: state.stateRevision,
    kind: 'sell',
    payload: { pokemonInstanceIds },
  });
}

test('one atomic batch pays each sale from the bank, destroys its UID, and finishes Sell (§4.7, §8)', () => {
  const state = sellState();
  const before = structuredClone(state);
  const result = sell(state, ['caught-eevee']);
  expect(result).toMatchObject({ accepted: true });
  if ('rejected' in result) throw new Error(result.reason);
  expect(result.state.players[0]!.coins).toBe(32);
  expect(result.state.players[0]!.team.map((pokemon) => pokemon.instanceId)).toEqual(['starter:0']);
  expect(result.events).toEqual([
    {
      kind: 'coin_transfer',
      source: { kind: 'bank' },
      destination: { kind: 'player', actorId: 'player-0' },
      amount: 12,
      reason: 'pokemon_sale',
      sale: { basePrice: 12, classBonus: 0 },
    },
    { kind: 'uid_destroyed', instanceId: 'caught-eevee', entity: 'pokemon', reason: 'sold' },
    { kind: 'phase_changed', from: 'sell', to: 'resolve' },
  ]);
  expect(result.state.stateRevision).toBe(1);
  expect(result.state.phase).toEqual({ kind: 'resolve' });
  expect(result.state.players[1]).toEqual(before.players[1]);
  expect(result.state.rng).toEqual(before.rng);
  expect(state).toEqual(before);
});

test.each(['bulbasaur', 'eevee', 'caterpie', 'pidgey'])(
  'a base Original Starter %s sells for 5 regardless of species (§4.5)',
  (speciesId) => {
    const state = sellState();
    state.players[0]!.team[0]!.speciesId = speciesId;
    const result = sell(state, ['starter:0']);
    expect('accepted' in result).toBe(true);
    expect(result.state.players[0]!.coins).toBe(25);
  },
);

test.each([
  { id: 'starter:0', expected: 24 },
  { id: 'caught-eevee', expected: 30 },
])('tired sale $id rounds the basis before class bonuses (§4.7 step 2)', ({ id, expected }) => {
  const state = sellState();
  state.players[0]!.team.find((pokemon) => pokemon.instanceId === id)!.tired = true;
  const result = sell(state, [id]);
  expect('accepted' in result).toBe(true);
  expect(result.state.players[0]!.coins).toBe(expected);
});

test('an empty sell selection commits once without payments, destruction or rescue (§4.7)', () => {
  const state = sellState();
  const result = sell(state, []);
  expect('accepted' in result).toBe(true);
  expect(result.state.players).toEqual(state.players);
  expect(result.state.phase).toEqual({ kind: 'resolve' });
  if ('rejected' in result) throw new Error(result.reason);
  expect(result.events).toEqual([{ kind: 'phase_changed', from: 'sell', to: 'resolve' }]);
});

test('selling the whole team grants exactly one new class-base rescue after destruction (§3.1, §4.5)', () => {
  const state = sellState();
  const result = sell(state, ['starter:0', 'caught-eevee']);
  expect('accepted' in result).toBe(true);
  if ('rejected' in result) throw new Error(result.reason);
  expect(result.state.players[0]!.coins).toBe(37);
  expect(result.state.players[0]!.team).toHaveLength(1);
  const rescue = result.state.players[0]!.team[0]!;
  expect(rescue).toMatchObject({
    speciesId: 'bulbasaur',
    origin: 'rescue_starter',
    evolutionStage: 0,
    tired: false,
    abilityReady: true,
    tradeable: false,
  });
  expect(['starter:0', 'caught-eevee', 'starter:1']).not.toContain(rescue.instanceId);
  expect(result.events.map((event) => event.kind)).toEqual([
    'coin_transfer',
    'uid_destroyed',
    'coin_transfer',
    'uid_destroyed',
    'uid_created',
    'phase_changed',
  ]);
  expect(result.events[4]).toEqual({
    kind: 'uid_created',
    instanceId: rescue.instanceId,
    entity: 'pokemon',
    ownerId: 'player-0',
  });
  const repeated = sell(result.state, [rescue.instanceId]);
  expect(repeated).toMatchObject({ rejected: true, reason: 'illegal_action' });
  expect(repeated.state).toBe(result.state);
});

test('rescue origin retains zero sale value after evolution, tired status and later sales (§4.5, §8)', () => {
  const state = sellState();
  const first = sell(state, ['starter:0', 'caught-eevee']);
  if ('rejected' in first) throw new Error(first.reason);
  let next = first.state;
  const seen = new Set(['starter:0', 'caught-eevee']);
  for (let phase = 0; phase < 12; phase++) {
    const rescue = next.players[0]!.team[0]!;
    expect(seen.has(rescue.instanceId)).toBe(false);
    seen.add(rescue.instanceId);
    expect(rescue.origin).toBe('rescue_starter');
    expect(rescue.tradeable).toBe(false);
    // Build a later-phase/evolved scenario; evolution and Tired application are deferred.
    next.phase = { kind: 'sell', destinationPosition: 2 };
    rescue.speciesId = 'eevee';
    rescue.evolutionStage = 2;
    rescue.tired = true;
    const result = sell(next, [rescue.instanceId]);
    expect('accepted' in result).toBe(true);
    if ('rejected' in result) throw new Error(result.reason);
    expect(result.state.players[0]!.coins).toBe(37);
    expect(result.state.players[0]!.team).toHaveLength(1);
    expect(result.events.filter((event) => event.kind === 'coin_transfer')).toEqual([
      {
        kind: 'coin_transfer',
        source: { kind: 'bank' },
        destination: { kind: 'player', actorId: 'player-0' },
        amount: 0,
        reason: 'pokemon_sale',
        sale: { basePrice: 0, classBonus: 0 },
      },
    ]);
    next = result.state;
  }
});

test('legal Sell choices expose individual sales and the canonical empty batch (§4.7)', () => {
  const state = sellState();
  expect(legalActions(state, 0).enabled).toEqual([
    { id: 'sell:starter:0', kind: 'sell', payload: { pokemonInstanceIds: ['starter:0'] } },
    { id: 'sell:caught-eevee', kind: 'sell', payload: { pokemonInstanceIds: ['caught-eevee'] } },
    { id: 'finish-sell', kind: 'sell', payload: { pokemonInstanceIds: [] } },
  ]);
  expect(advanceAutomatically(state)).toEqual({ state, events: [], records: [] });
});

test.each([
  ['caught-eevee', 'missing'],
  ['missing', 'caught-eevee'],
  ['caught-eevee', 'starter:1'],
  ['caught-eevee', 'caught-eevee'],
])('invalid or duplicated sale UIDs reject the entire batch %j (§8)', (...ids) => {
  const state = sellState();
  const before = structuredClone(state);
  const result = sell(state, ids);
  expect(result).toMatchObject({ rejected: true, reason: 'illegal_action' });
  expect(result.state).toBe(state);
  expect(state).toEqual(before);
});

test('a batch of distinct UIDs pays and destroys every selected instance once (§4.7, §8)', () => {
  const state = sellState();
  state.players[0]!.coins = 0;
  state.players[0]!.team.push({
    ...state.players[0]!.team[1]!,
    instanceId: 'second-eevee',
    tired: true,
  });
  const result = sell(state, ['caught-eevee', 'second-eevee']);
  expect('accepted' in result).toBe(true);
  if ('rejected' in result) throw new Error(result.reason);
  expect(result.state.players[0]!.coins).toBe(22);
  expect(result.state.players[0]!.team.map((pokemon) => pokemon.instanceId)).toEqual(['starter:0']);
  expect(result.events.filter((event) => event.kind === 'coin_transfer')).toEqual([
    {
      kind: 'coin_transfer',
      source: { kind: 'bank' },
      destination: { kind: 'player', actorId: 'player-0' },
      amount: 12,
      reason: 'pokemon_sale',
      sale: { basePrice: 12, classBonus: 0 },
    },
    {
      kind: 'coin_transfer',
      source: { kind: 'bank' },
      destination: { kind: 'player', actorId: 'player-0' },
      amount: 10,
      reason: 'pokemon_sale',
      sale: { basePrice: 10, classBonus: 0 },
    },
  ]);
  expect(
    result.events
      .filter((event) => event.kind === 'uid_destroyed')
      .map((event) => event.instanceId),
  ).toEqual(['caught-eevee', 'second-eevee']);
});

test('an evolved Original Starter uses the current form Base Sale (§4.5, §4.7)', () => {
  const state = sellState();
  state.content.species.push({
    id: 'ivysaur',
    name: 'Ivysaur',
    rarity: 'uncommon',
    dc: 3,
    battle: 4,
    base: 18,
    tags: ['grass'],
  });
  state.players[0]!.team[0]!.speciesId = 'ivysaur';
  state.players[0]!.team[0]!.evolutionStage = 1;
  const result = sell(state, ['starter:0']);
  expect('accepted' in result).toBe(true);
  expect(result.state.players[0]!.coins).toBe(38);
});

test('a rescue UID avoids both destroyed UIDs and other players’ Pokémon/item UIDs (§8)', () => {
  const state = sellState();
  state.players[0]!.team[0]!.instanceId = 'rescue:0:1';
  state.players[1]!.team[0]!.instanceId = 'rescue:0:1:1';
  state.players[1]!.items[0]!.instanceId = 'rescue:0:1:2';
  const result = sell(state, ['rescue:0:1', 'caught-eevee']);
  expect('accepted' in result).toBe(true);
  expect(result.state.players[0]!.team[0]!.instanceId).toBe('rescue:0:1:3');
});

test.each(['sell', 'finish_sell'] as const)(
  '%s grants one rescue even when the team enters Sell empty (§3.1, §4.5)',
  (kind) => {
    const state = sellState();
    state.players[0]!.team = [];
    const result = applyAction(state, {
      actorId: 'player-0',
      actionSeq: 1,
      stateRevisionBefore: 0,
      kind,
      payload: kind === 'sell' ? { pokemonInstanceIds: [] } : {},
    });
    expect('accepted' in result).toBe(true);
    if ('rejected' in result) throw new Error(result.reason);
    expect(result.state.players[0]!.team).toHaveLength(1);
    expect(result.state.players[0]!.team[0]!.origin).toBe('rescue_starter');
    expect(result.state.players[0]!.coins).toBe(20);
    expect(result.events.map((event) => event.kind)).toEqual(['uid_created', 'phase_changed']);
  },
);

test('the rescue uses the configured class base Starter choice (§4.5)', () => {
  const state = sellState();
  state.content.classes[0]!.starterSpeciesIds.push('pidgey');
  state.config.seats[0]!.starterSpeciesId = 'pidgey';
  const result = sell(state, ['starter:0', 'caught-eevee']);
  expect('accepted' in result).toBe(true);
  expect(result.state.players[0]!.team[0]).toMatchObject({
    speciesId: 'pidgey',
    evolutionStage: 0,
  });
});

test('pre-sale executable versions reject instead of silently replaying different rules (§6.8)', () => {
  const state = sellState();
  state.config.engineVersion = '0.2.0';
  expect(() => createGame(state.config, state.content)).toThrow(/unsupported/i);
  expect(() => createGameLog(state)).toThrow(/unsupported/i);
});

test('income, atomic sale, rescue, destination and resume replay without extra assets (§4.7, §6.8, §8)', () => {
  const initial = sellState();
  initial.phase = { kind: 'move' };
  initial.players[0]!.routeProgress = 20;
  const log = createGameLog(initial);
  const roll = applyAction(initial, {
    actorId: 'player-0',
    actionSeq: 1,
    stateRevisionBefore: 0,
    kind: 'roll',
    payload: {},
  });
  if ('rejected' in roll) throw new Error(roll.reason);
  log.actions.push(roll.record);
  const moved = advanceAutomatically(roll.state); // Seed 4 yields six, crosses Start to position 2.
  log.actions.push(...moved.records);
  const committed = sell(moved.state, ['starter:0', 'caught-eevee']);
  if ('rejected' in committed) throw new Error(committed.reason);
  log.actions.push(committed.record);
  expect(committed.state.players[0]!.coins).toBe(42);
  expect(committed.state.players[0]!.team).toHaveLength(1);
  expect(gameStateSchema.parse(committed.state)).toEqual(committed.state);
  expect(committed.events.some((event) => event.kind === 'space_resolved')).toBe(false);
  const saved = JSON.parse(JSON.stringify(log));
  const resumed = replay(saved);
  expect(stateHash(resumed)).toBe(stateHash(committed.state));
  expect(resumed).toEqual(committed.state);
  const destination = advanceAutomatically(resumed);
  expect(destination.events).toEqual([
    { kind: 'space_resolved', seatIndex: 0, position: 2 },
    { kind: 'phase_changed', from: 'resolve', to: 'end' },
  ]);
  log.actions.push(...destination.records);
  expect(replay(JSON.parse(JSON.stringify(log)))).toEqual(destination.state);
  expect(replay(log)).toEqual(destination.state);
  expect(destination.state.rng).toEqual(moved.state.rng);
  expect(destination.state.players[1]).toEqual(initial.players[1]);
  expect(log.actions.flatMap((record) => record.events).map((event) => event.kind)).toEqual([
    'random_result',
    'coin_transfer',
    'phase_changed',
    'coin_transfer',
    'uid_destroyed',
    'coin_transfer',
    'uid_destroyed',
    'uid_created',
    'phase_changed',
    'space_resolved',
    'phase_changed',
  ]);
});

test('wrong actors, stale commands, malformed batches and resubmits leave state unchanged (§8)', () => {
  const state = sellState();
  const command = {
    actorId: 'player-0',
    actionSeq: 1,
    stateRevisionBefore: 0,
    kind: 'sell',
    payload: { pokemonInstanceIds: ['caught-eevee'] },
  };
  for (const input of [
    { ...command, actorId: 'player-1' },
    { ...command, actorId: 'engine' },
    { ...command, stateRevisionBefore: 3 },
    { ...command, actionSeq: 3 },
    { ...command, payload: { pokemonInstanceIds: ['caught-eevee', ''] } },
    { ...command, payload: { pokemonInstanceIds: 'caught-eevee' } },
  ]) {
    const before = structuredClone(state);
    const result = applyAction(state, input);
    expect('rejected' in result).toBe(true);
    expect(result.state).toBe(state);
    expect(state).toEqual(before);
  }
  const committed = sell(state, ['caught-eevee']);
  if ('rejected' in committed) throw new Error(committed.reason);
  expect(applyAction(committed.state, command)).toMatchObject({
    rejected: true,
    reason: 'stale_revision',
  });
  expect(sell(committed.state, ['starter:0'])).toMatchObject({
    rejected: true,
    reason: 'illegal_action',
  });
});

test('a sale that exceeds the supported coin range rejects atomically (§8)', () => {
  const state = sellState();
  state.players[0]!.coins = Number.MAX_SAFE_INTEGER;
  const before = structuredClone(state);
  const result = sell(state, ['caught-eevee']);
  expect(result).toMatchObject({ rejected: true, reason: 'illegal_action' });
  expect(result.state).toBe(state);
  expect(state).toEqual(before);
});

test('legal actions never offer sales that would overflow the coin range (§8)', () => {
  const state = sellState();
  state.players[0]!.coins = Number.MAX_SAFE_INTEGER;
  expect(legalActions(state, 0).enabled).toEqual([
    { id: 'finish-sell', kind: 'sell', payload: { pokemonInstanceIds: [] } },
  ]);
});
