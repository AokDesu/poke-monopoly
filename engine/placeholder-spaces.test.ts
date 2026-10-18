import { expect, test } from 'vitest';
import {
  advanceAutomatically,
  createGame,
  createGameConfig,
  createGameLog,
  fixtureSchema,
  type GameState,
} from './index.ts';
import fixture from './fixtures/start-of-game-2p.json';

/** Seat 0 standing on `position`, about to resolve it. */
function resolvingAt(position: number): GameState {
  const scenario = fixtureSchema.parse(fixture).state;
  const state = createGame(
    createGameConfig({ seats: scenario.config.seats, seed: 4, lapTarget: 2 }),
    scenario.content,
  );
  state.phase = { kind: 'resolve' };
  state.globalTurnNo = 1;
  state.players[0]!.routeProgress = position;
  return state;
}

test.each([2, 8, 14, 17, 22, 6, 12, 18])(
  'landing on Event/Gym square %i is a logged no-op until cycles 3–4 (§4.1, §10 C2)',
  (position) => {
    const state = resolvingAt(position);
    const result = advanceAutomatically(state);
    expect(result.events).toEqual([
      { kind: 'space_resolved', seatIndex: 0, position, effect: 'none_yet' },
      { kind: 'phase_changed', from: 'resolve', to: 'end' },
    ]);
    expect(result.state.players).toEqual(state.players);
    expect(result.state.rng).toEqual(state.rng);
  },
);

test('pre-placeholder executable versions reject instead of replaying different events (§6.8)', () => {
  const state = resolvingAt(2);
  state.config.engineVersion = '0.7.0';
  expect(() => createGame(state.config, state.content)).toThrow(/unsupported/i);
  expect(() => createGameLog(state)).toThrow(/unsupported/i);
});
