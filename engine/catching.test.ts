import { expect, test } from 'vitest';
import {
  advanceAutomatically,
  applyAction,
  createGame,
  createGameConfig,
  fixtureSchema,
  type GameState,
} from './index.ts';
import fixture from './fixtures/start-of-game-2p.json';

function encounter(seed = 4): GameState {
  const scenario = fixtureSchema.parse(fixture).state;
  const state = createGame(
    createGameConfig({ seats: scenario.config.seats, seed, lapTarget: 3 }),
    scenario.content,
  );
  state.phase = {
    kind: 'encounter',
    pokemon: {
      instanceId: 'legacy-encounter',
      speciesId: 'caterpie',
      origin: 'caught',
      evolutionStage: 0,
      tired: false,
      abilityReady: true,
    },
  };
  state.globalTurnNo = 1;
  state.turnBudgets.catchAttempt = 1;
  return state;
}
function command(state: GameState, kind: string, payload = {}) {
  const result = applyAction(state, {
    actorId: state.players[state.activeSeatIndex]!.actorId,
    actionSeq: state.stateRevision + 1,
    stateRevisionBefore: state.stateRevision,
    kind,
    payload,
  });
  if ('rejected' in result) throw new Error(result.reason);
  return result;
}

test('confirming a catch spends one chosen Ball and budget before the logged roll, then creates a team UID (§4.3, §8)', () => {
  const state = encounter();
  const before = structuredClone(state);
  const confirmed = command(state, 'catch', { ballType: 'great' });
  expect(confirmed.state.players[0]!.balls).toEqual({ poke: 5, great: 0, ultra: 0 });
  expect(confirmed.state.turnBudgets.catchAttempt).toBe(0);
  expect(confirmed.state.players[0]!.team).toEqual(state.players[0]!.team);
  expect(confirmed.events).toEqual([]);
  expect(confirmed.state.rng).toEqual(state.rng);
  const rolled = advanceAutomatically(confirmed.state);
  expect(rolled.state.phase).toEqual({ kind: 'end' });
  expect(rolled.state.players[0]!.team).toHaveLength(2);
  const caught = rolled.state.players[0]!.team[1]!;
  expect(caught).toMatchObject({
    speciesId: 'caterpie',
    origin: 'caught',
    evolutionStage: 0,
    tired: false,
    abilityReady: true,
  });
  expect(rolled.events).toEqual([
    { kind: 'random_result', purpose: 'catch:0:1', result: 6, drawCounter: 1 },
    { kind: 'uid_created', instanceId: caught.instanceId, entity: 'pokemon', ownerId: 'player-0' },
    { kind: 'phase_changed', from: 'encounter', to: 'end' },
  ]);
  expect(state).toEqual(before);
});

test('Wild resolution draws a species with two logged RNG results and creates no UID (§4.5)', () => {
  const state = encounter(1);
  state.phase = { kind: 'resolve' };
  state.players[0]!.routeProgress = 1;
  const before = structuredClone(state);
  const resolved = command(state, 'skip');
  expect(resolved.state.phase).toEqual({ kind: 'encounter', pokemon: { speciesId: 'eevee' } });
  expect(resolved.events).toEqual([
    { kind: 'space_resolved', seatIndex: 0, position: 1 },
    { kind: 'random_result', purpose: 'encounter:rarity', result: 1, drawCounter: 1 },
    { kind: 'random_result', purpose: 'encounter:species', result: 0, drawCounter: 2 },
    { kind: 'phase_changed', from: 'resolve', to: 'encounter' },
  ]);
  expect(resolved.state.players).toEqual(state.players);
  expect(state).toEqual(before);
});

test('10,000 seed-1 Wild draws exclude starters/Porygon and preserve 50/33/17 rarity weights (§4.5, §8)', () => {
  let state = encounter(1);
  // Include each excluded species so exclusion is actually exercised.
  for (const id of ['charmander', 'squirtle', 'porygon']) {
    state.content.species.push({
      ...state.content.species.find((entry) => entry.id === 'bulbasaur')!,
      id,
    });
  }
  const counts = { common: 0, uncommon: 0, rare: 0 };
  const speciesCounts: Record<string, number> = {};
  for (let draw = 0; draw < 10_000; draw++) {
    state.phase = { kind: 'resolve' };
    state.players[0]!.routeProgress = 1;
    const result = command(state, 'skip');
    state = result.state;
    if (state.phase.kind !== 'encounter') throw new Error('Missing encounter');
    const id = state.phase.pokemon.speciesId;
    expect(['bulbasaur', 'charmander', 'squirtle', 'porygon']).not.toContain(id);
    const species = state.content.species.find((entry) => entry.id === id)!;
    counts[species.rarity]++;
    speciesCounts[id] = (speciesCounts[id] ?? 0) + 1;
    expect(result.events.filter((event) => event.kind === 'uid_created')).toEqual([]);
    expect(state.rng.cursor).toBe((draw + 1) * 2);
    state = command(state, 'release').state;
  }
  expect(counts.common / 10_000).toBeCloseTo(0.5, 1);
  expect(Math.abs(counts.common / 10_000 - 0.5)).toBeLessThanOrEqual(0.03);
  expect(Math.abs(counts.uncommon / 10_000 - 0.33)).toBeLessThanOrEqual(0.03);
  expect(Math.abs(counts.rare / 10_000 - 0.17)).toBeLessThanOrEqual(0.03);
  // The two common species must be picked uniformly, rather than by weight or DC.
  expect(Math.abs(speciesCounts.caterpie! / counts.common - 0.5)).toBeLessThanOrEqual(0.03);
  expect(Math.abs(speciesCounts.pidgey! / counts.common - 0.5)).toBeLessThanOrEqual(0.03);
  expect(state.players[0]!.team).toHaveLength(1);
});
