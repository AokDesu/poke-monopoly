import { expect, test, vi } from 'vitest';
import {
  createGameConfig,
  fixtureSchema,
  replay,
  stateHash,
  type GameConfig,
} from '../../../engine/index.ts';
import fixture from '../../../engine/fixtures/start-of-game-2p.json';
import { createGameStore } from './store.ts';

const content = fixtureSchema.parse(fixture).state.content;
const config: GameConfig = createGameConfig({
  seats: ['main-character', 'rival'].map((classId, seatIndex) => ({
    actorId: `player-${seatIndex}`,
    seatIndex,
    classId,
    controller: seatIndex === 0 ? ('human' as const) : ('ai' as const),
  })),
  seed: 7,
  lapTarget: 3,
});

test('the store keeps a log that replays to its current state (§6.1, §6.8)', () => {
  const store = createGameStore();
  const listener = vi.fn();
  store.subscribe(listener);
  store.start(config, content);
  expect(store.getSession()?.log.actions).toEqual([]);

  const result = store.submit({ actorId: 'player-0', kind: 'roll', payload: {} });
  expect('accepted' in result).toBe(true);
  expect(store.advance()).toBe(true); // the engine's first-player die result
  const session = store.getSession()!;
  expect(session.state.stateRevision).toBe(2);
  expect(session.log.actions.map((record) => record.action.kind)).toEqual(['roll', 'dice_result']);
  expect(stateHash(replay(session.log))).toBe(stateHash(session.state));
  expect(listener).toHaveBeenCalledTimes(3);
});

test('a rejected command changes neither state nor log and notifies no one', () => {
  const store = createGameStore();
  store.start(config, content);
  const before = store.getSession();
  const listener = vi.fn();
  store.subscribe(listener);

  const result = store.submit({ actorId: 'player-1', kind: 'roll', payload: {} });
  expect(result).toMatchObject({ rejected: true, reason: 'wrong_actor' });
  expect(store.getSession()).toBe(before);
  expect(listener).not.toHaveBeenCalled();
});
