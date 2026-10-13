import { test as fcTest } from '@fast-check/vitest';
import fc from 'fast-check';
import { expect, test } from 'vitest';
import {
  applyAction,
  advanceAutomatically,
  fixtureSchema,
  createRng,
  RNG_VERSION,
  ENGINE_VERSION,
  stateHash,
  createGameLog,
  replay,
  createGameConfig,
  d6,
  gameLogSchema,
} from './index.ts';
import fixture from './fixtures/start-of-game-2p.json';
import shopFixture from './fixtures/shop-low-coins.json';

function initialState() {
  return fixtureSchema.parse(fixture).state;
}

test('stale commands return the original immutable state with a reason (§6.3, §8)', () => {
  const state = initialState();
  const before = structuredClone(state);
  expect(
    applyAction(state, {
      actorId: 'player-0',
      actionSeq: 1,
      stateRevisionBefore: 99,
      kind: 'roll',
      payload: {},
    }),
  ).toEqual({ rejected: true, reason: 'stale_revision', state });
  expect(state).toEqual(before);
});

test('only the active configured actor can submit player commands (§6.1)', () => {
  const state = initialState();
  for (const actorId of ['player-1', 'unknown']) {
    const result = applyAction(state, {
      actorId,
      actionSeq: 1,
      stateRevisionBefore: 0,
      kind: 'roll',
      payload: {},
    });
    expect(result).toMatchObject({ rejected: true, reason: 'wrong_actor' });
    expect('state' in result && result.state).toBe(state);
  }
});

test('malformed untrusted commands are rejected without throwing or mutation (§6.1)', () => {
  const state = initialState();
  for (const action of [
    null,
    undefined,
    [],
    {},
    {
      actorId: 'player-0',
      actionSeq: 1,
      stateRevisionBefore: 0,
      kind: 'roll',
      payload: { value: 6 },
    },
    { actorId: 'player-0', actionSeq: 1.5, stateRevisionBefore: 0, kind: 'roll', payload: {} },
    { actorId: 'player-0', actionSeq: 1, stateRevisionBefore: 0, kind: 'unknown', payload: {} },
  ]) {
    const result = applyAction(state, action as never);
    expect(result).toMatchObject({ rejected: true, reason: 'malformed_action' });
    expect('state' in result && result.state).toBe(state);
  }
});

test('membership validates the enabled payload, not just its action kind (§6.1)', () => {
  const state = fixtureSchema.parse(shopFixture).state;
  const result = applyAction(state, {
    actorId: 'player-0',
    actionSeq: state.stateRevision + 1,
    stateRevisionBefore: state.stateRevision,
    kind: 'buy',
    payload: { offerId: 'not-offered' },
  });
  expect(result).toMatchObject({ rejected: true, reason: 'illegal_action' });
  expect('state' in result && result.state).toBe(state);
});

test('acceptance returns a detached state and a contiguous action record (§6.3)', () => {
  const state = initialState();
  const before = structuredClone(state);
  const action = {
    actorId: 'player-0',
    actionSeq: 1,
    stateRevisionBefore: 0,
    kind: 'roll' as const,
    payload: {},
  };
  const result = applyAction(state, action);
  expect(result).toMatchObject({
    accepted: true,
    state: { stateRevision: 1 },
    events: [],
    record: { action, events: [] },
  });
  expect(state).toEqual(before);
  if ('accepted' in result) {
    result.state.players[0]!.coins = 0;
    expect(state.players[0]!.coins).toBe(20);
  }
});

test('a skipped or repeated actionSeq is rejected without advancing revision (§6.3)', () => {
  const state = initialState();
  for (const actionSeq of [2, 200]) {
    const result = applyAction(state, {
      actorId: 'player-0',
      actionSeq,
      stateRevisionBefore: 0,
      kind: 'roll',
      payload: {},
    });
    expect(result).toMatchObject({ rejected: true, reason: 'invalid_sequence' });
    expect(result.state).toBe(state);
  }
});

test('automatic advancement applies exactly one choice once and marks its record (§3.1)', () => {
  const state = initialState();
  const result = advanceAutomatically(state);
  expect(result.state.stateRevision).toBe(1);
  expect(result.records).toHaveLength(1);
  expect(result.records[0]).toMatchObject({
    auto: true,
    action: {
      actorId: 'player-0',
      kind: 'roll',
      actionSeq: 1,
      stateRevisionBefore: 0,
    },
  });
  expect(state.stateRevision).toBe(0);
  const multiple = fixtureSchema.parse(shopFixture).state;
  expect(advanceAutomatically(multiple)).toEqual({ state: multiple, records: [], events: [] });
  const none = { ...state, phase: { kind: 'finished' as const } };
  expect(advanceAutomatically(none).state).toBe(none);
});

function randomState() {
  const state = initialState();
  state.config.engineVersion = ENGINE_VERSION;
  state.config.rngVersion = RNG_VERSION;
  state.config.seed = 1;
  state.rng = createRng(1);
  return state;
}

test('engine dice results count as actions and retain counted RNG events (§6.3, §6.8)', () => {
  const state = randomState();
  const result = applyAction(state, {
    actorId: 'engine',
    actionSeq: 1,
    stateRevisionBefore: 0,
    kind: 'dice_result',
    payload: { purpose: 'test-die', value: 4 },
  });
  expect(result).toMatchObject({
    accepted: true,
    state: { stateRevision: 1, rng: { cursor: 1 } },
    events: [{ kind: 'random_result', purpose: 'test-die', result: 4, drawCounter: 1 }],
  });
  expect(state.rng.cursor).toBe(0);
  expect(state.stateRevision).toBe(0);
});

test('an engine shuffle is one accepted action with a separate event per draw (§6.8)', () => {
  const state = randomState();
  state.eventDeck = { drawPile: ['a', 'b', 'c'], discardPile: [] };
  const result = applyAction(state, {
    actorId: 'engine',
    actionSeq: 1,
    stateRevisionBefore: 0,
    kind: 'shuffle',
    payload: { deckId: 'events', order: ['c', 'a', 'b'] },
  });
  expect(result).toMatchObject({
    accepted: true,
    state: {
      stateRevision: 1,
      rng: { cursor: 2 },
      eventDeck: { drawPile: ['c', 'a', 'b'], discardPile: [] },
    },
    events: [
      { kind: 'random_result', purpose: 'shuffle:events', result: 1, drawCounter: 1 },
      { kind: 'random_result', purpose: 'shuffle:events', result: 0, drawCounter: 2 },
    ],
  });
  expect(state.eventDeck.drawPile).toEqual(['a', 'b', 'c']);
});

test.each([{ drawPile: [] }, { drawPile: ['a'] }])(
  'no-draw shuffle snapshots isolate RNG mutations for $drawPile (§6.3, §6.8)',
  ({ drawPile }) => {
    const state = randomState();
    state.eventDeck.drawPile = drawPile;
    const before = stateHash(state);
    const result = applyAction(state, {
      actorId: 'engine',
      actionSeq: 1,
      stateRevisionBefore: 0,
      kind: 'shuffle',
      payload: { deckId: 'events', order: drawPile },
    });
    if (!('accepted' in result)) throw new Error(result.reason);
    expect(result.state.stateRevision).toBe(1);
    expect(result.state.eventDeck.drawPile).toEqual(drawPile);
    expect(result.state.rng).toEqual({ state: '1', cursor: 0 });
    expect(result.events).toEqual([]);
    expect(result.record.events).toEqual([]);

    result.state.rng.cursor = 7;
    result.state.rng.state = '2';
    expect(state.rng).toEqual({ state: '1', cursor: 0 });
    expect(stateHash(state)).toBe(before);

    const after = stateHash(result.state);
    state.rng.cursor = 9;
    state.rng.state = '3';
    expect(result.state.rng).toEqual({ state: '2', cursor: 7 });
    expect(stateHash(result.state)).toBe(after);
  },
);

test('engine event draws record the current top card without applying event effects (§6.3)', () => {
  const state = randomState();
  state.eventDeck = { drawPile: ['a', 'b'], discardPile: [] };
  const result = applyAction(state, {
    actorId: 'engine',
    actionSeq: 1,
    stateRevisionBefore: 0,
    kind: 'event_draw',
    payload: { eventId: 'a' },
  });
  expect(result).toMatchObject({
    accepted: true,
    state: { stateRevision: 1, eventDeck: { drawPile: ['b'], discardPile: ['a'] } },
    events: [],
  });
  expect(state.eventDeck.drawPile).toEqual(['a', 'b']);
});

test('stateHash is stable across object key order and includes private RNG and assets (§6.8)', () => {
  const state = randomState();
  const reordered = Object.fromEntries(Object.entries(state).reverse()) as typeof state;
  reordered.rng = { state: state.rng.state, cursor: state.rng.cursor };
  const hash = stateHash(state);
  expect(hash).toMatch(/^[0-9a-f]{8}$/);
  expect(stateHash(reordered)).toBe(hash);
  const changed = structuredClone(state);
  changed.rng.cursor++;
  expect(stateHash(changed)).not.toBe(hash);
  changed.rng.cursor--;
  changed.players[0]!.coins--;
  expect(stateHash(changed)).not.toBe(hash);
});

test('a versioned log replays player and generated records to the live state (§6.8)', () => {
  function play() {
    const start = randomState();
    const log = createGameLog(start);
    const auto = advanceAutomatically(start);
    log.actions.push(...auto.records);
    const die = applyAction(auto.state, {
      actorId: 'engine',
      actionSeq: 2,
      stateRevisionBefore: 1,
      kind: 'dice_result',
      payload: { purpose: 'move:0:1', value: 4 },
    });
    expect('accepted' in die).toBe(true);
    if (!('accepted' in die)) throw new Error('die rejected');
    log.actions.push(die.record);
    expect(log).toMatchObject({
      logVersion: 'command-log-v1',
      seed: 1,
      rngVersion: RNG_VERSION,
      initialConfig: start.config,
      initialState: start,
    });
    expect(stateHash(replay(JSON.parse(JSON.stringify(log))))).toBe(stateHash(die.state));
    expect(log.initialState.rng.cursor).toBe(0);
    return stateHash(die.state);
  }
  expect(play()).toBe(play());
});

test('replay rejects mismatched headers, unsupported executors and unverified initial RNG (§6.8)', () => {
  const log = createGameLog(randomState());
  for (const change of [
    (copy: typeof log) => {
      copy.seed = 9;
    },
    (copy: typeof log) => {
      copy.initialState.config.contentVersion = 'other';
    },
    (copy: typeof log) => {
      copy.initialState.rng.cursor = 1;
    },
    (copy: typeof log) => {
      copy.initialState.rng.state = '2';
    },
    (copy: typeof log) => {
      copy.engineVersion = 'unknown';
      copy.initialConfig.engineVersion = 'unknown';
      copy.initialState.config.engineVersion = 'unknown';
    },
  ]) {
    const copy = structuredClone(log);
    change(copy);
    expect(() => replay(copy)).toThrow();
  }
});

test('replay rejects altered or missing random results before returning a state (§6.8)', () => {
  const state = randomState();
  const log = createGameLog(state);
  const result = applyAction(state, {
    actorId: 'engine',
    actionSeq: 1,
    stateRevisionBefore: 0,
    kind: 'dice_result',
    payload: { purpose: 'test-die', value: 4 },
  });
  if (!('accepted' in result)) throw new Error('die rejected');
  log.actions.push(result.record);
  const altered = structuredClone(log);
  altered.actions[0]!.events = [
    { kind: 'random_result', purpose: 'test-die', result: 6, drawCounter: 1 },
  ];
  expect(() => replay(altered)).toThrow(/events/i);
  altered.actions[0]!.events = [];
  expect(() => replay(altered)).toThrow(/events/i);
});

test('an auto marker is valid only for the sole enabled player choice (§3.1)', () => {
  const state = randomState();
  state.phase = fixtureSchema.parse(shopFixture).state.phase;
  state.players[0]!.items.push({
    instanceId: 'owned',
    itemId: 'repel',
    name: 'Repel',
    visibility: 'public',
  });
  const log = createGameLog(state);
  const result = applyAction(state, {
    actorId: 'player-0',
    actionSeq: 1,
    stateRevisionBefore: 0,
    kind: 'skip',
    payload: {},
  });
  if (!('accepted' in result)) throw new Error('skip rejected');
  log.actions.push({ ...result.record, auto: true });
  expect(() => replay(log)).toThrow(/auto/i);
});

test('the reserved engine actor cannot be configured as a player (§6.3)', () => {
  const state = randomState();
  state.config.seats[0]!.actorId = 'engine';
  expect(() => createGameConfig({ seats: state.config.seats, seed: 1, lapTarget: 3 })).toThrow();
});

fcTest.prop([
  fc.integer({ min: 0, max: 1000000 }),
  fc.integer({ min: 1, max: 1000000 }),
  fc.string().filter((actor) => actor !== 'player-0'),
])(
  'random stale or wrong-actor actions preserve identity, hash and all counters (§8)',
  (revision, offset, actorId) => {
    const state = randomState();
    state.stateRevision = revision;
    const before = stateHash(state);
    for (const action of [
      { actorId: 'player-0', stateRevisionBefore: revision + offset },
      { actorId, stateRevisionBefore: revision },
    ]) {
      const result = applyAction(state, {
        ...action,
        actionSeq: revision + 1,
        kind: 'roll',
        payload: {},
      });
      expect('rejected' in result).toBe(true);
      expect(result.state).toBe(state);
      expect(stateHash(result.state)).toBe(before);
    }
  },
);

fcTest.prop([fc.jsonValue()])(
  'arbitrary malformed roll payloads never mutate state (§8)',
  (payload) => {
    fc.pre(
      payload === null ||
        typeof payload !== 'object' ||
        Array.isArray(payload) ||
        Object.keys(payload).length > 0,
    );
    const state = randomState();
    const before = stateHash(state);
    const result = applyAction(state, {
      actorId: 'player-0',
      actionSeq: 1,
      stateRevisionBefore: 0,
      kind: 'roll',
      payload,
    });
    expect(result).toMatchObject({ rejected: true, reason: 'malformed_action' });
    expect(result.state).toBe(state);
    expect(stateHash(result.state)).toBe(before);
  },
);

test('200 accepted player and generated records have no sequence gaps and replay deterministically (§6.3, §6.8)', () => {
  function play() {
    let state = randomState();
    state.phase = { kind: 'shop', offers: [] };
    state.eventDeck = { drawPile: ['a', 'b', 'c'], discardPile: [] };
    const log = createGameLog(state);
    function accept(body: { actorId: string; kind: string; payload: unknown }) {
      const previous = state.stateRevision;
      const result = applyAction(state, {
        ...body,
        actionSeq: previous + 1,
        stateRevisionBefore: previous,
      });
      if (!('accepted' in result)) throw new Error(result.reason);
      expect(result.state.stateRevision).toBe(previous + 1);
      expect(result.record.action.actionSeq).toBe(previous + 1);
      log.actions.push(result.record);
      state = result.state;
    }
    accept({
      actorId: 'engine',
      kind: 'shuffle',
      payload: { deckId: 'events', order: ['c', 'a', 'b'] },
    });
    accept({ actorId: 'engine', kind: 'event_draw', payload: { eventId: 'c' } });
    for (let i = 0; i < 99; i++) {
      accept({ actorId: 'player-0', kind: 'skip', payload: {} });
      accept({
        actorId: 'engine',
        kind: 'dice_result',
        payload: { purpose: 'synthetic-die', value: d6(state.rng).value },
      });
    }
    expect(log.actions).toHaveLength(200);
    expect(state.stateRevision).toBe(200);
    expect(state.rng.cursor).toBe(101);
    expect(stateHash(replay(log))).toBe(stateHash(state));
    expect(stateHash(replay(log))).toBe(stateHash(state));
    return stateHash(state);
  }
  expect(play()).toBe(play());
});

test('GameLog schema preserves header equality with the initial config (§6.8)', () => {
  const log = createGameLog(randomState());
  expect(gameLogSchema.safeParse({ ...log, seed: 2 }).success).toBe(false);
  expect(gameLogSchema.safeParse({ ...log, contentVersion: 'other' }).success).toBe(false);
});
