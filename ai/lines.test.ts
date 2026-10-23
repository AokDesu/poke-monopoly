import { expect, test } from 'vitest';
import {
  createRng,
  advanceAutomatically,
  createGame,
  createGameConfig,
  createGameLog,
  fixtureSchema,
  serialize,
  deserialize,
  verifyReplay,
} from '../engine/index.ts';
import fixture from '../engine/fixtures/start-of-game-2p.json';
import { selectLine } from './lines.ts';

test('selectLine picks the same line for the same seed and logs the pick with its line ID', () => {
  const first = selectLine('catch_success', 'greedy', 'neutral', createRng(42));
  const again = selectLine('catch_success', 'greedy', 'neutral', createRng(42));
  expect(again).toEqual(first);
  expect(first.lineId).toMatch(/^catch-success-greedy-neutral-\d+$/);
  expect(first.events).toContainEqual({
    kind: 'line_selected',
    situation: 'catch_success',
    personalityId: 'greedy',
    trustBucket: 'neutral',
    lineId: first.lineId,
  });
});

test('selectLine reaches every Greedy neutral line across seeds', () => {
  const picked = new Set(
    Array.from(
      { length: 30 },
      (_, seed) => selectLine('game_start', 'greedy', 'neutral', createRng(seed)).lineId,
    ),
  );
  expect([...picked].sort()).toEqual([
    'game-start-greedy-neutral-1',
    'game-start-greedy-neutral-2',
    'game-start-greedy-neutral-3',
  ]);
});

test('selectLine refuses a personality or trust bucket the line bank does not cover', () => {
  expect(() => selectLine('game_start', 'greedy', 'high', createRng(1))).toThrow(/greedy at high/);
});

test('line selection events survive a real save and load without changing command replay', () => {
  const scenario = fixtureSchema.parse(fixture).state;
  const state = createGame(
    createGameConfig({ seats: scenario.config.seats, seed: 42, lapTarget: 2 }),
    scenario.content,
  );
  const selection = selectLine('game_start', 'greedy', 'neutral', createRng('dialogue:42'));
  const advanced = advanceAutomatically(state);
  expect(advanced.records).toHaveLength(1);
  const log = {
    ...createGameLog(state),
    actions: advanced.records,
    dialogueEvents: selection.events,
  };
  const loaded = deserialize(serialize({ state: advanced.state, log }));
  expect(loaded.log).toMatchObject({ dialogueEvents: selection.events });
  expect(JSON.parse(serialize(loaded)).log.dialogueEvents).toContainEqual({
    kind: 'line_selected',
    situation: 'game_start',
    personalityId: 'greedy',
    trustBucket: 'neutral',
    lineId: selection.lineId,
  });
  expect(verifyReplay(loaded)).toMatchObject({ pass: true });
});
