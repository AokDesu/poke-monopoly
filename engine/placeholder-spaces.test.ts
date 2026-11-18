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

test.each([2, 8, 14, 17, 22])(
  'landing on Event square %i draws and resolves a card (§4.1, §4.6)',
  (position) => {
    const state = resolvingAt(position);
    const result = advanceAutomatically(state);
    expect(result.events[0]).toEqual({ kind: 'space_resolved', seatIndex: 0, position });
    expect(result.events).toContainEqual({
      kind: 'event_drawn',
      seatIndex: 0,
      eventId: expect.any(String),
    });
    expect(result.events.some((event) => event.kind === 'event_resolved')).toBe(true);
    expect(result.state.eventDeck.drawPile).toHaveLength(5);
  },
);

test('pre-placeholder executable versions reject instead of replaying different events (§6.8)', () => {
  const state = resolvingAt(2);
  state.config.engineVersion = '0.7.0';
  expect(() => createGame(state.config, state.content)).toThrow(/unsupported/i);
  expect(() => createGameLog(state)).toThrow(/unsupported/i);
});
