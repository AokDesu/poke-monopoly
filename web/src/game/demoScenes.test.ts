import { expect, test } from 'vitest';
import {
  deserialize,
  legalActions,
  replay,
  serialize,
  stateHash,
  verifyReplay,
} from '../../../engine/index.ts';
import { t } from '../i18n/en.ts';
import { memoryEntries, trustShown } from './promises.ts';
import {
  buildScene,
  DEMO_SCENES,
  openScenes,
  sceneById,
  type DemoScene,
  type DemoStep,
} from './demoScenes.ts';
import { createGameStore } from './store.ts';

const withScript = (scene: DemoScene, script: readonly DemoStep[]): DemoScene => ({
  ...scene,
  script,
});
const scene = (id: string) => DEMO_SCENES.find((entry) => entry.id === id)!;

function opened(entry: DemoScene) {
  const store = createGameStore();
  const result = buildScene(store, entry);
  return { store, result };
}

test('two to four scenes are open, each with its words and no repeated id (issue #222)', () => {
  const open = openScenes();
  expect(open.length).toBeGreaterThanOrEqual(2);
  expect(open.length).toBeLessThanOrEqual(4);
  expect(new Set(open.map((entry) => entry.id)).size).toBe(open.length);
  for (const entry of open) {
    expect(t(entry.title).length).toBeGreaterThan(0);
    expect(t(entry.description).length).toBeGreaterThan(0);
  }
});

test.each(DEMO_SCENES.map((entry) => [entry.id, entry] as const))(
  'scene %s opens at its moment, twice to the same state hash, and its log replays',
  (_id, entry) => {
    const first = opened(entry);
    const second = opened(entry);
    expect(first.result).toEqual({ ok: true });
    expect(second.result).toEqual({ ok: true });
    const a = first.store.getSession()!;
    const b = second.store.getSession()!;
    expect(stateHash(a.state)).toBe(stateHash(b.state));
    expect(entry.atMoment(first.store.getView()!)).toBe(true);

    // The exported log is an ordinary action log: it survives export, deserialize and replay.
    const text = serialize(a);
    const loaded = deserialize(text);
    expect(verifyReplay(loaded)).toEqual({ pass: true, stateHash: stateHash(a.state) });
    expect(stateHash(replay(loaded.log))).toBe(stateHash(a.state));
    expect(loaded.log.actions).toEqual(a.log.actions);
    expect(first.store.getScene()).toBe(entry.id);
  },
);

test('the log of a scene holds only its scripted choices, the dice and sole choices (issue #222)', () => {
  const entry = scene('reward');
  const { store } = opened(entry);
  const { actions } = store.getSession()!.log;
  // Every action a seat chose, in order: the script's five choices and nothing else. The rest is
  // the engine's own results and the sole choices it applies itself, all marked `auto`.
  const chosen = actions.filter((record) => record.auto !== true);
  expect(chosen.map((record) => record.action.kind)).toEqual([
    'skip',
    'declare_pvp',
    'respond_pvp',
    'skip',
    'skip',
  ]);
  expect(chosen.map((record) => record.action.actorId)).toEqual([
    'human',
    'human',
    'ai-1',
    'human',
    'ai-1',
  ]);
  expect(JSON.stringify(store.getSession()!.log)).not.toContain('scene');
});

test('ball scene: two legal Balls are offered at the encounter (spec §11 step 2)', () => {
  const { store } = opened(scene('ball'));
  const { state } = store.getSession()!;
  const balls = legalActions(state, 0)
    .enabled.filter((choice) => choice.kind === 'catch')
    .map((choice) => choice.id);
  expect(balls).toEqual(['catch:poke', 'catch:great']);
});

test('pvp scene: a challenge and the Rival class’s forced challenge are both legal (spec §11 step 4)', () => {
  const { store } = opened(scene('pvp'));
  const ids = legalActions(store.getSession()!.state, 0).enabled.map((choice) => choice.id);
  expect(ids).toEqual(expect.arrayContaining(['declare-pvp:1', 'declare-pvp:1:rival']));
});

test('reward scene: a won battle offers the coins or an evolution (spec §11 step 5)', () => {
  const { store } = opened(scene('reward'));
  const ids = legalActions(store.getSession()!.state, 0).enabled.map((choice) => choice.id);
  expect(ids).toContain('reward:coins');
  expect(ids.some((id) => id.startsWith('reward:evolve:'))).toBe(true);
});

test('promise scene: a broken promise is in the seat’s memory with the trust it cost (spec §4.8, §11 step 6)', () => {
  const { store } = opened(scene('promise'));
  const view = store.getView()!;
  const broken = memoryEntries(view.observation, view.feed).filter(
    (entry) => entry.kind === 'broken',
  );
  expect(broken).toHaveLength(1);
  expect(broken[0]).toMatchObject({ promiserSeatIndex: 1, recipientSeatIndex: 0 });
  // The engine's own trust number is shown for the rival that broke its word.
  expect(trustShown(view.observation)).toEqual([{ seatIndex: 1, value: expect.any(Number) }]);
  expect(trustShown(view.observation)[0]!.value).toBeLessThan(0);
  // The game plays on: the seat may offer the rival a new promise now that the old one is closed.
  const ids = legalActions(store.getSession()!.state, 0).enabled.map((choice) => choice.id);
  expect(ids).toContain('offer-promise:seat-1:ask');
});

test('a script step the engine no longer allows fails the build and leaves no game', () => {
  const real = scene('reward');
  const illegal: DemoStep[][] = [
    // A choice that is not among the seat's legal actions.
    [{ engine: 1 }, { seat: 0, choose: 'no-such-action' }],
    // A legal action for a seat that is not the one deciding.
    [{ engine: 1 }, { seat: 1, choose: 'skip' }],
    // More engine steps than the game has pending.
    [{ engine: 1 }, { engine: 40 }],
  ];
  for (const script of illegal) {
    const { store, result } = opened(withScript(real, script));
    expect(result).toMatchObject({ ok: false, failure: { kind: 'step' } });
    expect(store.getSession()).toBeNull();
    expect(store.getScene()).toBeUndefined();
  }
  const { result } = opened(
    withScript(real, [{ engine: 1 }, { seat: 0, choose: 'no-such-action' }]),
  );
  expect(result).toEqual({ ok: false, failure: { kind: 'step', step: 2, total: 2 } });
});

test('a script that runs but ends away from its moment fails the build', () => {
  const real = scene('ball');
  const { store, result } = opened(withScript(real, real.script.slice(0, 2)));
  expect(result).toEqual({ ok: false, failure: { kind: 'moment' } });
  expect(store.getSession()).toBeNull();
});

test('a setup the engine refuses fails the build, and the failure carries no engine text', () => {
  const real = scene('ball');
  const broken: DemoScene = {
    ...real,
    setup: {
      ...real.setup,
      opponents: [{ ...real.setup.opponents[0]!, classId: 'main-character' }],
    },
  };
  const { store, result } = opened(broken);
  expect(result.ok).toBe(false);
  expect(!result.ok && result.failure).toEqual({ kind: 'engine' });
  expect(store.getSession()).toBeNull();
});

test('a scene whose class is not open is not listed', () => {
  const real = scene('ball');
  const closed: DemoScene = {
    ...real,
    id: 'closed',
    setup: { ...real.setup, human: { classId: 'not-a-class', starterSpeciesId: 'charmander' } },
  };
  expect(openScenes([real, closed]).map((entry) => entry.id)).toEqual(['ball']);
  expect(sceneById('closed')).toBeUndefined();
  expect(sceneById(undefined)).toBeUndefined();
  expect(sceneById('ball')?.id).toBe('ball');
});
