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
import { readdirSync } from 'node:fs';
import { PERSONALITY_IDS, SLOTS, fillSlots } from '../content/lines-schema.ts';
import { PERSONALITIES } from './fallback/index.ts';
import { LINES, selectLine, type Situation } from './lines.ts';

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
      (_, seed) => selectLine('taunt_leader', 'greedy', 'neutral', createRng(seed)).lineId,
    ),
  );
  expect([...picked].sort()).toEqual([
    'taunt-leader-greedy-neutral-1',
    'taunt-leader-greedy-neutral-2',
    'taunt-leader-greedy-neutral-3',
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

test('the registry holds exactly the situation files in content/lines/en', () => {
  const files = readdirSync(new URL('../content/lines/en/', import.meta.url))
    .filter((name) => name.endsWith('.json'))
    .map((name) => name.slice(0, -'.json'.length));
  expect(Object.keys(LINES).sort()).toEqual(files.sort());
});

test('every registered personality is one the line bank covers', () => {
  expect(
    Object.keys(PERSONALITIES).filter((id) => !(PERSONALITY_IDS as readonly string[]).includes(id)),
  ).toEqual([]);
});

test.each(Object.keys(LINES) as Situation[])(
  'selectLine returns a fillable line for every personality at neutral trust: %s',
  (situation) => {
    const values = Object.fromEntries(SLOTS.map((slot) => [slot, slot]));
    for (const personality of PERSONALITY_IDS) {
      const picked = selectLine(
        situation,
        personality,
        'neutral',
        createRng(`${situation}:${personality}`),
      );
      expect(LINES[situation].find((l) => l.id === picked.lineId)?.personality).toBe(personality);
      expect(fillSlots(picked.template, values)).not.toMatch(/[{}]/);
    }
  },
);
