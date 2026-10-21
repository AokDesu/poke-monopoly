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

test('advance never plays the human seat, even when it has a single legal choice (§3.1)', () => {
  const store = createGameStore();
  store.start(config, content);
  const before = store.getSession();
  expect(store.getView()!.legalActions.enabled.map((choice) => choice.kind)).toEqual(['roll']);

  expect(store.advance()).toBe(false);
  expect(store.getSession()).toBe(before);

  // The human's roll goes through `choose`; the AI's sole roll is then the engine's to apply.
  expect('accepted' in store.choose('roll')).toBe(true);
  expect(store.advance()).toBe(true); // human's die result
  expect(store.advance()).toBe(true); // AI's roll
  expect(store.getSession()!.log.actions.map((record) => record.action.actorId)).toEqual([
    'player-0',
    'engine',
    'player-1',
  ]);
});

test('the view holds only what the human seat may see: no seed, RNG or opponent pouch (§4.1)', () => {
  const store = createGameStore();
  const secretSeed = 'sentinel-seed-do-not-show';
  store.start({ ...config, seed: secretSeed }, content);
  store.choose('roll');
  while (store.getView()!.observation.public.phase.kind === 'first_player_roll' && store.advance());

  const view = store.getView()!;
  const text = JSON.stringify(view);
  expect(view.seatIndex).toBe(0);
  expect(view.observation.own.seatIndex).toBe(0);
  expect(text).not.toContain(secretSeed);
  expect(text).not.toContain(store.getSession()!.state.rng.state);
  expect(view.observation.public.players[1]).not.toHaveProperty('balls');
  expect(view.feed.map((entry) => entry.record.action.kind)).toEqual(
    store.getSession()!.log.actions.map((record) => record.action.kind),
  );
  // Stable between changes, as useSyncExternalStore requires.
  expect(store.getView()).toBe(view);
});

test('choose rejects an ID that is not one of the human seat enabled choices', () => {
  const store = createGameStore();
  store.start(config, content);
  const before = store.getSession();
  expect(store.choose('skip')).toMatchObject({ rejected: true, reason: 'illegal_action' });
  expect(store.getSession()).toBe(before);
});
