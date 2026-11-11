import { expect, test } from 'vitest';
import {
  advanceAutomatically,
  applyAction,
  applyStatus,
  battleReadyMembers,
  checkInvariants,
  createGame,
  createGameConfig,
  createGameLog,
  deserialize,
  fixtureSchema,
  healStatus,
  legalActions,
  replay,
  resume,
  serialize,
  verifyReplay,
  type GameState,
} from './index.ts';
import fixture from './fixtures/start-of-game-2p.json';

function scenario(nurse = false): GameState {
  const historical = fixtureSchema.parse(fixture).state;
  const content = structuredClone(historical.content);
  if (nurse) content.classes[1]!.passive = 'turn_start_team_heal';
  const state = createGame(
    createGameConfig({ seats: historical.config.seats, seed: 4, lapTarget: 3 }),
    content,
  );
  state.phase = { kind: 'strategy' };
  state.globalTurnNo = 5;
  state.players[0]!.ownTurnNo = 3;
  state.players[1]!.ownTurnNo = 2;
  state.turnBudgets = { tacticalAction: 1, catchAttempt: 1, pokemonAbility: 1 };
  return state;
}

function command(state: GameState, kind: string, payload = {}) {
  return applyAction(state, {
    actorId: state.players[state.activeSeatIndex]!.actorId,
    actionSeq: state.stateRevision + 1,
    stateRevisionBefore: state.stateRevision,
    kind,
    payload,
  });
}

function end(state: GameState) {
  state.phase = { kind: 'end' };
  const result = command(state, 'skip');
  if ('rejected' in result) throw new Error(result.reason);
  return result;
}

test.each([0, 1])(
  'Tired applied during seat %i turn survives until owner next End (§4.4)',
  (active) => {
    let state = scenario();
    state.activeSeatIndex = active;
    const owner = state.players[0]!;
    const uid = owner.team[0]!.instanceId;
    expect(applyStatus(owner, uid, 'tired', 'test_effect')).toEqual([
      {
        kind: 'status_changed',
        ownerId: owner.actorId,
        instanceId: uid,
        status: 'tired',
        operation: 'applied',
        expiresOwnTurnNo: 4,
        reason: 'test_effect',
      },
    ]);
    expect(battleReadyMembers(owner)).toEqual([]);
    if (active === 0) state = end(state).state;
    expect(state.players[0]!.team[0]!.tired).toBe(true);
    state = end(state).state; // Owner next Start: counter advances to 4.
    expect(state.players[0]!.ownTurnNo).toBe(4);
    expect(state.players[0]!.team[0]!.tired).toBe(true);
    const cleared = end(state);
    expect(cleared.state.players[0]!.team[0]!.tired).toBe(false);
    expect(cleared.state.players[0]!.team[0]!.tiredExpiresOwnTurnNo).toBeUndefined();
    expect(cleared.events[0]).toMatchObject({
      kind: 'status_changed',
      operation: 'cleared',
      instanceId: uid,
      reason: 'expired',
    });
    expect(battleReadyMembers(cleared.state.players[0]!)).toHaveLength(1);
  },
);

test('reapplication retains later expiry and extends it on the next own turn (§4.4)', () => {
  let state = scenario();
  const uid = state.players[0]!.team[0]!.instanceId;
  applyStatus(state.players[0]!, uid, 'tired', 'effect');
  const repeated = applyStatus(state.players[0]!, uid, 'tired', 'effect');
  expect(repeated[0]).toMatchObject({ operation: 'reapplied', expiresOwnTurnNo: 4 });
  state.players[0]!.team[0]!.tiredExpiresOwnTurnNo = 8;
  applyStatus(state.players[0]!, uid, 'tired', 'effect');
  expect(state.players[0]!.team[0]!.tiredExpiresOwnTurnNo).toBe(8);
  state.players[0]!.team[0]!.tiredExpiresOwnTurnNo = 4;
  state = end(end(state).state).state;
  applyStatus(state.players[0]!, uid, 'tired', 'effect');
  expect(state.players[0]!.team[0]!.tiredExpiresOwnTurnNo).toBe(5);
  state = end(state).state;
  expect(state.players[0]!.team[0]!.tired).toBe(true);
});

test('Nurse Joy clears every team UID only on entering own Start (§4.2, Appendix A)', () => {
  const state = scenario(true);
  const owner = state.players[1]!;
  owner.team.push({ ...owner.team[0]!, instanceId: 'caught:extra', origin: 'caught' });
  for (const pokemon of owner.team) applyStatus(owner, pokemon.instanceId, 'tired', 'effect');
  state.phase = { kind: 'end' };
  const log = createGameLog(state);
  const result = command(state, 'skip');
  if ('rejected' in result) throw new Error(result.reason);
  expect(owner.team.every((pokemon) => pokemon.tired)).toBe(true);
  expect(result.state.phase.kind).toBe('start');
  expect(result.state.players[1]!.ownTurnNo).toBe(3);
  expect(result.state.players[1]!.team.every((pokemon) => !pokemon.tired)).toBe(true);
  expect(result.events.filter((event) => event.kind === 'status_changed')).toHaveLength(2);
  log.actions.push(result.record);
  expect(replay(log)).toEqual(result.state);
  expect(checkInvariants(state, result.record.action, result)).toEqual([]);
  const broken = structuredClone(result);
  broken.state.players[1]!.team[0] = structuredClone(owner.team[0]!);
  expect(
    checkInvariants(state, result.record.action, broken).some(
      (violation) => violation.invariant === 'tired-and-nurse-joy-useful',
    ),
  ).toBe(true);
});

test('Potion heals one selected UID, spends item and action, and save/resume preserves other expiry', () => {
  const state = scenario();
  const owner = state.players[0]!;
  owner.team.push({ ...owner.team[0]!, instanceId: 'caught:extra', origin: 'caught' });
  for (const pokemon of owner.team) applyStatus(owner, pokemon.instanceId, 'tired', 'effect');
  owner.items.push({
    instanceId: 'potion:1',
    itemId: 'potion',
    name: 'Potion',
    visibility: 'secret',
  });
  const log = createGameLog(state);
  const payload = {
    itemInstanceId: 'potion:1',
    targetPokemonInstanceId: owner.team[0]!.instanceId,
    status: 'tired',
  };
  expect(
    legalActions(state, 0).enabled.filter((choice) => choice.kind === 'use_item'),
  ).toHaveLength(2);
  const result = command(state, 'use_item', payload);
  if ('rejected' in result) throw new Error(result.reason);
  expect(result.state.players[0]!.team.map((pokemon) => pokemon.tired)).toEqual([false, true]);
  expect(result.state.players[0]!.items).toEqual([]);
  expect(result.state.turnBudgets.tacticalAction).toBe(0);
  expect(result.events).toContainEqual({
    kind: 'uid_destroyed',
    instanceId: 'potion:1',
    entity: 'item',
    reason: 'used',
  });
  log.actions.push(result.record);
  const saved = deserialize(serialize({ state: result.state, log }));
  expect(resume(saved).state).toEqual(result.state);
  expect(saved.state.players[0]!.team[1]!.tiredExpiresOwnTurnNo).toBe(4);
  expect(verifyReplay(saved).pass).toBe(true);
});

test('invalid Potion targets and stale commands leave state and inventory unchanged (§8)', () => {
  const state = scenario();
  const owner = state.players[0]!;
  applyStatus(owner, owner.team[0]!.instanceId, 'tired', 'effect');
  owner.items.push({
    instanceId: 'potion:1',
    itemId: 'potion',
    name: 'Potion',
    visibility: 'secret',
  });
  const before = structuredClone(state);
  for (const target of [undefined, 'missing', state.players[1]!.team[0]!.instanceId]) {
    expect(
      command(state, 'use_item', {
        itemInstanceId: 'potion:1',
        targetPokemonInstanceId: target,
        status: 'tired',
      }),
    ).toMatchObject({ rejected: true });
  }
  state.turnBudgets.tacticalAction = 0;
  expect(legalActions(state, 0).disabled[0]?.reasonCode).toBe('ALREADY_USED_THIS_TURN');
  state.turnBudgets.tacticalAction = 1;
  expect(state).toEqual(before);
  expect(healStatus(owner, 'missing', 'tired', 'effect')).toEqual([]);
  expect(applyStatus(owner, 'missing', 'tired', 'effect')).toEqual([]);
  expect(state).toEqual(before);
});

test('actual Tired sale pays the existing rounded ×0.8 price (§4.4, §4.7)', () => {
  const state = scenario();
  state.phase = { kind: 'sell', destinationPosition: 0 };
  const owner = state.players[0]!;
  const uid = owner.team[0]!.instanceId;
  applyStatus(owner, uid, 'tired', 'effect');
  const result = command(state, 'sell', { pokemonInstanceIds: [uid] });
  if ('rejected' in result) throw new Error(result.reason);
  expect(result.state.players[0]!.coins - owner.coins).toBe(4);
  expect(result.events).toContainEqual(
    expect.objectContaining({ kind: 'coin_transfer', amount: 4 }),
  );
});

test('first selected Nurse Joy turn heals before any Strategy decision', () => {
  const state = scenario(true);
  state.activeSeatIndex = 1;
  state.phase = { kind: 'first_player_roll', contenders: [1], rolls: [], awaitingResult: true };
  const owner = state.players[1]!;
  applyStatus(owner, owner.team[0]!.instanceId, 'tired', 'effect');
  const result = advanceAutomatically(state);
  expect(result.state.phase.kind).toBe('start');
  expect(result.state.players[1]!.team[0]!.tired).toBe(false);
  expect(result.events).toContainEqual(
    expect.objectContaining({ kind: 'status_changed', operation: 'cleared', reason: 'nurse_joy' }),
  );
});

test('saved due expiry resumes and replays before final liquidation (§4.2 step 7)', () => {
  const state = scenario();
  const owner = state.players[0]!;
  owner.ownTurnNo = 2;
  applyStatus(owner, owner.team[0]!.instanceId, 'tired', 'effect');
  owner.ownTurnNo = 3;
  state.players[1]!.ownTurnNo = 3;
  state.finalTableRound = { triggerSeatIndex: 0, targetOwnTurnNo: 3 };
  state.phase = { kind: 'end' };
  const log = createGameLog(state);
  const saved = deserialize(serialize({ state, log }));
  const result = command(resume(saved).state, 'skip');
  if ('rejected' in result) throw new Error(result.reason);
  expect(result.state.phase.kind).toBe('finished');
  expect(result.state.players[0]!.coins).toBe(23);
  expect(result.events[0]).toMatchObject({ kind: 'status_changed', reason: 'expired' });
  saved.log.actions.push(result.record);
  expect(replay(saved.log)).toEqual(result.state);
});

test('healthy Potion targets and stale healing commands reject unchanged', () => {
  const state = scenario();
  const player = state.players[0]!;
  player.items.push({
    instanceId: 'potion:1',
    itemId: 'potion',
    name: 'Potion',
    visibility: 'secret',
  });
  const payload = {
    itemInstanceId: 'potion:1',
    targetPokemonInstanceId: player.team[0]!.instanceId,
    status: 'tired',
  };
  const before = structuredClone(state);
  expect(command(state, 'use_item', payload)).toEqual({
    rejected: true,
    reason: 'illegal_action',
    state,
  });
  expect(healStatus(player, player.team[0]!.instanceId, 'tired', 'potion')).toEqual([]);
  expect(state).toEqual(before);
  applyStatus(player, player.team[0]!.instanceId, 'tired', 'effect');
  const stale = structuredClone(state);
  expect(
    applyAction(state, {
      actorId: player.actorId,
      actionSeq: 1,
      stateRevisionBefore: 1,
      kind: 'use_item',
      payload,
    }),
  ).toEqual({
    rejected: true,
    reason: 'stale_revision',
    state,
  });
  expect(state).toEqual(stale);
});
