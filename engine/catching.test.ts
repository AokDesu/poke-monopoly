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
