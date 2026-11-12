import { expect, test } from 'vitest';
import {
  advanceAutomatically,
  applyAction,
  createGame,
  createGameConfig,
  createGameLog,
  CONTENT_VERSION,
  ENGINE_VERSION,
  deserialize,
  fixtureSchema,
  legalActions,
  pendingDecision,
  resume,
  verifyReplay,
  serialize,
  stateHash,
  type GameLog,
  type GameState,
} from './index.ts';
import fixture from './fixtures/start-of-game-2p.json';

type Game = { state: GameState; log: GameLog };

function newGame(seed: number): Game {
  const scenario = fixtureSchema.parse(fixture).state;
  const state = createGame(
    createGameConfig({ seats: scenario.config.seats, seed, lapTarget: 2 }),
    scenario.content,
  );
  return { state, log: createGameLog(state) };
}

/**
 * One accepted action. Choices depend only on the state, so a game continued from a loaded save
 * makes the same choices as the uninterrupted game.
 */
function step(game: Game): Game {
  const automatic = advanceAutomatically(game.state);
  if (automatic.records.length === 1) {
    return {
      state: automatic.state,
      log: { ...game.log, actions: [...game.log.actions, ...automatic.records] },
    };
  }
  const { state } = game;
  const choices = legalActions(
    state,
    pendingDecision(state)?.seatIndex ?? state.activeSeatIndex,
  ).enabled;
  const choice = choices[(state.stateRevision * 7 + 3) % choices.length]!;
  const result = applyAction(state, {
    actorId: pendingDecision(state)!.actorId,
    actionSeq: state.stateRevision + 1,
    stateRevisionBefore: state.stateRevision,
    kind: choice.kind,
    payload: choice.payload,
  } as never);
  if ('rejected' in result) throw new Error(`Rejected ${choice.kind}: ${result.reason}`);
  return {
    state: result.state,
    log: { ...game.log, actions: [...game.log.actions, result.record] },
  };
}

function playToEnd(game: Game): Game {
  let current = game;
  for (let steps = 0; current.state.phase.kind !== 'finished'; steps++) {
    if (steps > 5000) throw new Error('Game did not finish');
    current = step(current);
  }
  return current;
}

test('a game saved and loaded at 20 points hashes like the live game and finishes the same (§6.7, §8)', () => {
  const finished = playToEnd(newGame(11));
  const total = finished.log.actions.length;
  expect(total).toBeGreaterThan(40);
  const points = Array.from({ length: 20 }, (_, i) => Math.floor((i * total) / 20));
  let live = newGame(11);
  for (const revision of points) {
    while (live.state.stateRevision < revision) live = step(live);
    const loaded = deserialize(serialize(live));
    expect(stateHash(loaded.state)).toBe(stateHash(live.state));
    expect(stateHash(playToEnd(loaded).state)).toBe(stateHash(finished.state));
  }
});

test('a save after a dice result resumes with the same result, waiting for the same decision (§3.1, §6.9)', () => {
  let live = newGame(11);
  const isMoveResult = (game: Game) => {
    const last = game.log.actions.at(-1)?.action;
    return (
      last?.kind === 'dice_result' &&
      last.payload.purpose.startsWith('move:') &&
      legalActions(game.state, game.state.activeSeatIndex).enabled.length > 1
    );
  };
  while (!isMoveResult(live)) live = step(live);
  const die = live.log.actions.at(-1)!;

  const resumed = resume(deserialize(serialize(live)));

  expect(resumed.state).toEqual(live.state);
  expect(resumed.lastAction).toEqual(die);
  expect(resumed.waitingFor).toEqual({
    kind: 'decision',
    seatIndex: live.state.activeSeatIndex,
    actorId: `player-${live.state.activeSeatIndex}`,
    phase: live.state.phase.kind,
    legalActions: legalActions(live.state, live.state.activeSeatIndex),
  });
  expect(resumed.state.stateRevision).toBe(live.state.stateRevision);
});

test('a save waiting on a die resumes without rolling it (§6.9, §8)', () => {
  let live = newGame(11);
  while (live.state.phase.kind !== 'move' || !live.state.phase.awaitingResult) live = step(live);

  const resumed = resume(deserialize(serialize(live)));

  expect(resumed.waitingFor).toEqual({
    kind: 'engine_result',
    purpose: `move:${live.state.activeSeatIndex}:${live.state.globalTurnNo}`,
  });
  expect(resumed.state).toEqual(live.state);
});

test('saves from another engine or content version are rejected with a clear message', () => {
  const save = JSON.parse(serialize(newGame(3)));
  const restamp = (field: 'engineVersion' | 'contentVersion', value: string) => {
    const copy = structuredClone(save);
    copy[field] = value;
    copy.log[field] = value;
    copy.log.initialConfig[field] = value;
    copy.log.initialState.config[field] = value;
    copy.state.config[field] = value;
    return JSON.stringify(copy);
  };
  expect(() => deserialize(restamp('engineVersion', '0.0.1-old'))).toThrow(
    `This save was made with engine version 0.0.1-old; this game runs engine version ${ENGINE_VERSION}. Old saves cannot be loaded yet.`,
  );
  expect(() => deserialize(restamp('contentVersion', 'content-old'))).toThrow(
    `This save was made with content version content-old; this game runs content version ${CONTENT_VERSION}. Old saves cannot be loaded yet.`,
  );
});

/** Every object key in a JSON value, at any depth. */
function keysOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keysOf);
  if (value === null || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, entry]) => [key, ...keysOf(entry)]);
}

test('a save file has state and log as siblings, no log inside state and no key field (§6.7)', () => {
  let game = newGame(11);
  for (let i = 0; i < 60; i++) game = step(game);
  const save = JSON.parse(serialize(game));

  expect(Object.keys(save).sort()).toEqual(
    ['contentVersion', 'engineVersion', 'log', 'rngVersion', 'saveVersion', 'state'].sort(),
  );
  expect(keysOf(save).filter((key) => /key|token|secret|password/i.test(key))).toEqual([]);
  expect(keysOf(save.state).filter((key) => /^(log|actions|initialState)$/.test(key))).toEqual([]);

  const nested = structuredClone(save);
  nested.state.log = save.log;
  expect(() => deserialize(JSON.stringify(nested))).toThrow();
  const keyed = structuredClone(save);
  keyed.apiKey = 'placeholder';
  expect(() => deserialize(JSON.stringify(keyed))).toThrow();
});

test('a save whose state and log disagree is rejected', () => {
  let game = newGame(11);
  for (let i = 0; i < 30; i++) game = step(game);
  const save = JSON.parse(serialize(game));
  const truncated = structuredClone(save);
  truncated.log.actions.pop();
  expect(() => deserialize(JSON.stringify(truncated))).toThrow(/state and log/i);
  expect(() => serialize({ state: game.state, log: newGame(11).log })).toThrow(/state and log/i);
});

test('replaying a save confirms its state hash and fails a tampered save (§6.8, §8)', () => {
  let game = newGame(11);
  for (let i = 0; i < 80; i++) game = step(game);
  expect(verifyReplay(deserialize(serialize(game)))).toEqual({
    pass: true,
    stateHash: stateHash(game.state),
  });

  const richer = structuredClone(game);
  richer.state.players[0]!.coins += 5;
  expect(verifyReplay(richer)).toMatchObject({
    pass: false,
    reason: expect.stringMatching(/hash/),
  });

  const reRolled = structuredClone(game);
  const die = reRolled.log.actions.find((record) => record.action.kind === 'dice_result')!;
  if (die.action.kind !== 'dice_result') throw new Error('unreachable');
  die.action.payload.value = (die.action.payload.value % 6) + 1;
  expect(verifyReplay(reRolled)).toMatchObject({ pass: false });
});
