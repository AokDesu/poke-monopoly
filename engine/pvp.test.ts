/// <reference types="vite/client" />
import { expect, test } from 'vitest';
import { parseContent, toEngineContent } from '../content/schema.ts';
import {
  advanceAutomatically,
  applyAction,
  checkInvariants,
  createGame,
  createGameConfig,
  createGameLog,
  createRng,
  d6,
  deserialize,
  eventsVisibleTo,
  legalActions,
  observe,
  pendingDecision,
  replay,
  resolvePvp,
  resume,
  serialize,
  stateHash,
  verifyReplay,
  type Action,
  type GameState,
  type LegalAction,
  type SavedGame,
} from './index.ts';

const files = Object.fromEntries(
  Object.entries(
    import.meta.glob<unknown>('../content/*.json', { eager: true, import: 'default' }),
  ).map(([path, json]) => [path.split('/').at(-1)!.slice(0, -5), json]),
);
const content = toEngineContent(parseContent(files));

function game(seed = 1): GameState {
  const state = createGame(
    createGameConfig({
      seats: ['fisherman', 'bug-catcher', 'researcher'].map((classId, seatIndex) => ({
        actorId: `p${seatIndex}`,
        seatIndex,
        classId,
        controller: 'ai' as const,
      })),
      seed,
      lapTarget: 1,
    }),
    content,
  );
  state.phase = { kind: 'strategy' };
  state.activeSeatIndex = 0;
  state.globalTurnNo = 7;
  state.turnBudgets = { tacticalAction: 1, catchAttempt: 1, pokemonAbility: 1 };
  state.players.forEach((player, index) => {
    player.ownTurnNo = index === 0 ? 3 : 2;
    player.routeProgress = index * 9;
    player.team[0]!.speciesId = 'eevee';
  });
  return state;
}

function command(
  state: GameState,
  kind: Action['kind'],
  payload: unknown = {},
  actorId = pendingDecision(state)!.actorId,
): unknown {
  return {
    actorId,
    kind,
    payload,
    actionSeq: state.stateRevision + 1,
    stateRevisionBefore: state.stateRevision,
  };
}

function accept(state: GameState, kind: Action['kind'], payload: unknown = {}): GameState {
  const action = command(state, kind, payload);
  const result = applyAction(state, action);
  if ('rejected' in result) throw new Error(`Unexpected rejection: ${result.reason}`);
  expect(checkInvariants(state, action, result)).toEqual([]);
  return result.state;
}

function reject(state: GameState, action: unknown, reason: string): void {
  const hash = stateHash(state);
  const result = applyAction(state, action);
  expect(result).toMatchObject({ rejected: true, reason });
  expect(result.state).toBe(state);
  expect(stateHash(state)).toBe(hash);
}

function seedFor(outcome: 'win' | 'tie' | 'loss'): number {
  for (let seed = 0; seed < 100; seed++) {
    const attacker = d6(createRng(seed), 'a');
    const defender = d6(attacker.rng, 'b');
    if (
      (attacker.value > defender.value
        ? 'win'
        : attacker.value < defender.value
          ? 'loss'
          : 'tie') === outcome
    )
      return seed;
  }
  throw new Error('No matching seed');
}

function declared(seed = 1): GameState {
  return accept(game(seed), 'declare_pvp', { targetSeatIndex: 2 });
}
function confirmed(seed = 1): GameState {
  return accept(declared(seed), 'respond_pvp', { accept: true });
}
function rolled(seed: number): GameState {
  return advanceAutomatically(advanceAutomatically(confirmed(seed)).state).state;
}

test('any distant ready opponent is legal; declaration spends one tactical action and creates one public directed attempt (§4.2/4.4/4.8)', () => {
  const before = game();
  expect(
    legalActions(before, 0)
      .enabled.filter((choice) => choice.kind === 'declare_pvp')
      .map((choice) => choice.payload.targetSeatIndex),
  ).toEqual([1, 2]);
  const action = command(before, 'declare_pvp', { targetSeatIndex: 2 });
  const result = applyAction(before, action);
  if ('rejected' in result) throw new Error(result.reason);
  expect(result.state.turnBudgets).toEqual({
    tacticalAction: 0,
    catchAttempt: 1,
    pokemonAbility: 1,
  });
  const attempt = {
    kind: 'attack_attempt',
    attackId: 'pvp:1',
    actorId: 'p0',
    targetId: 'p2',
    source: 'pvp_declaration',
    actionSeq: 1,
    globalTurnNo: 7,
  };
  expect(result.state.attackHistory).toEqual([attempt]);
  expect(result.events.filter((event) => event.kind === 'attack_attempt')).toEqual([attempt]);
  for (const seat of [0, 1, 2]) {
    expect(observe(result.state, seat).public.attackHistory).toEqual([attempt]);
    expect(eventsVisibleTo(before, result.events, seat)).toContainEqual(attempt);
  }
  expect(before.attackHistory).toBeUndefined();
  expect(pendingDecision(result.state)).toEqual({ seatIndex: 2, actorId: 'p2' });
  expect(result.state.activeSeatIndex).toBe(0);
  expect(result.state.globalTurnNo).toBe(7);
  expect(result.state.players.map((player) => player.ownTurnNo)).toEqual([3, 2, 2]);
});

test.each([0, 2])(
  'an all-Tired team on seat %i blocks declaration with no budget/RNG change',
  (seatIndex) => {
    const state = game();
    state.players[seatIndex]!.team.forEach((pokemon) => {
      pokemon.tired = true;
    });
    expect(legalActions(state, 0).disabled).toContainEqual(
      expect.objectContaining({
        kind: 'declare_pvp',
        payload: { targetSeatIndex: 2 },
        reasonCode: 'NO_VALID_TARGET',
      }),
    );
    reject(state, command(state, 'declare_pvp', { targetSeatIndex: 2 }), 'illegal_action');
  },
);

test.each([0, 2])('an empty team on seat %i blocks declaration', (seatIndex) => {
  const state = game();
  state.players[seatIndex]!.team = [];
  reject(state, command(state, 'declare_pvp', { targetSeatIndex: 2 }), 'illegal_action');
});

test('self, unknown and out-of-Strategy declarations reject', () => {
  const state = game();
  for (const targetSeatIndex of [0, 12])
    reject(state, command(state, 'declare_pvp', { targetSeatIndex }), 'illegal_action');
  state.phase = { kind: 'move' };
  reject(state, command(state, 'declare_pvp', { targetSeatIndex: 2 }), 'illegal_action');
});

test('decline preserves the single attempt, spends no coins or RNG, and returns to the challenger’s Strategy', () => {
  const state = declared();
  expect(advanceAutomatically(state)).toEqual({ state, records: [], events: [] });
  const next = accept(state, 'respond_pvp', { accept: false });
  expect(next.phase).toEqual({ kind: 'strategy' });
  expect(next.players).toEqual(state.players);
  expect(next.rng).toEqual(state.rng);
  expect(next.attackHistory).toEqual(state.attackHistory);
  expect(pendingDecision(next)).toEqual({ seatIndex: 0, actorId: 'p0' });
  expect(next.activeSeatIndex).toBe(0);
  expect(next.turnBudgets.tacticalAction).toBe(0);
  reject(next, command(next, 'declare_pvp', { targetSeatIndex: 1 }), 'illegal_action');
  reject(next, command(next, 'respond_pvp', { accept: true }, 'p2'), 'wrong_actor');
});

test('item and PvP share the same tactical allowance in both orders', () => {
  const state = game();
  const item = {
    instanceId: 'lucky',
    itemId: 'lucky-egg',
    name: 'Lucky Egg',
    visibility: 'public' as const,
  };
  state.players[0]!.items.push(item, { ...item, instanceId: 'second-lucky' });
  const afterItem = accept(state, 'use_item', { itemInstanceId: item.instanceId });
  reject(afterItem, command(afterItem, 'declare_pvp', { targetSeatIndex: 2 }), 'illegal_action');
  const afterPvp = accept(accept(state, 'declare_pvp', { targetSeatIndex: 2 }), 'respond_pvp', {
    accept: false,
  });
  reject(
    afterPvp,
    command(afterPvp, 'use_item', { itemInstanceId: item.instanceId }),
    'illegal_action',
  );
  reject(
    afterItem,
    command(afterItem, 'use_item', { itemInstanceId: item.instanceId }),
    'illegal_action',
  );
});

test('only the defender can answer; stale/repeated/wrong answers preserve the exact state and RNG', () => {
  const state = declared();
  for (const actorId of ['p0', 'p1', 'unknown']) {
    expect(legalActions(state, actorId === 'p0' ? 0 : 1).enabled).toEqual([]);
    reject(state, command(state, 'respond_pvp', { accept: true }, actorId), 'wrong_actor');
  }
  const answer = command(state, 'respond_pvp', { accept: true });
  reject(state, { ...(answer as object), stateRevisionBefore: 0 }, 'stale_revision');
  const next = accept(state, 'respond_pvp', { accept: true });
  reject(next, answer, 'stale_revision');
  reject(next, command(next, 'respond_pvp', { accept: false }, 'p2'), 'wrong_actor');
});

test('confirmation freezes the shared snapshot, then draws attacker first and defender second (§C.3)', () => {
  const state = confirmed(seedFor('win'));
  if (state.phase.kind !== 'pvp' || state.phase.battle.step !== 'attacker_roll')
    throw new Error('Expected attacker roll');
  const snapshot = state.phase.battle.snapshot;
  expect(Object.isFrozen(snapshot.attacker.member)).toBe(true);
  expect(pendingDecision(state)).toBeNull();
  const first = advanceAutomatically(state);
  expect(first.records[0]!.action).toMatchObject({
    actorId: 'engine',
    kind: 'dice_result',
    payload: { purpose: 'pvp:1:attacker_roll' },
  });
  expect(first.state.rng.cursor).toBe(state.rng.cursor + 1);
  expect(first.state.phase).toMatchObject({
    kind: 'pvp',
    battle: { step: 'defender_roll', snapshot },
  });
  const second = advanceAutomatically(first.state);
  expect(second.records[0]!.action).toMatchObject({
    actorId: 'engine',
    kind: 'dice_result',
    payload: { purpose: 'pvp:1:defender_roll' },
  });
  expect(second.state.rng.cursor).toBe(state.rng.cursor + 2);
  const event = second.events.find((event) => event.kind === 'pvp_resolved')!;
  if (event.kind !== 'pvp_resolved') throw new Error('Expected result');
  expect(event).toMatchObject(resolvePvp(snapshot, event.attackerFace, event.defenderFace));
  reject(first.state, first.records[0]!.action, 'stale_revision');
  reject(
    state,
    command(state, 'dice_result', { purpose: 'pvp:1:defender_roll', value: 1 }, 'engine'),
    'illegal_action',
  );
});

test.each(['win', 'loss'] as const)(
  '%s: only the winner owns the exclusive reward; coins are sourced and retries cannot pay twice',
  (outcome) => {
    let state = game(seedFor(outcome));
    const winnerSeat = outcome === 'win' ? 0 : 2;
    const loserSeat = outcome === 'win' ? 2 : 0;
    state.players[loserSeat]!.coins = 4;
    state = accept(state, 'declare_pvp', { targetSeatIndex: 2 });
    state = accept(state, 'respond_pvp', { accept: true });
    state = advanceAutomatically(advanceAutomatically(state).state).state;
    expect(pendingDecision(state)).toEqual({ seatIndex: winnerSeat, actorId: `p${winnerSeat}` });
    expect(state.activeSeatIndex).toBe(0);
    for (const seat of [0, 1, 2].filter((seat) => seat !== winnerSeat)) {
      expect(legalActions(state, seat).enabled).toEqual([]);
      reject(state, command(state, 'choose_reward', { kind: 'coins' }, `p${seat}`), 'wrong_actor');
    }
    const action = command(state, 'choose_reward', { kind: 'coins' });
    const next = accept(state, 'choose_reward', { kind: 'coins' });
    expect(next.players[winnerSeat]!.coins).toBe(24);
    expect(next.players[loserSeat]!.coins).toBe(0);
    expect(next.resolvedRewardIds).toEqual(['pvp:1']);
    expect(next.phase).toEqual({ kind: 'strategy' });
    expect(next.players.map((player) => player.ownTurnNo)).toEqual([3, 2, 2]);
    expect(next.globalTurnNo).toBe(7);
    reject(next, action, 'stale_revision');
    reject(next, command(next, 'choose_reward', { kind: 'coins' }), 'illegal_action');
  },
);

test.each(['win', 'loss'] as const)(
  '%s: winner can evolve exactly one own UID instead, with no loser payment',
  (outcome) => {
    const state = rolled(seedFor(outcome));
    const winner = pendingDecision(state)!;
    const options = legalActions(state, winner.seatIndex).enabled;
    const evolve = options.find(
      (choice) => choice.kind === 'choose_reward' && choice.payload.kind === 'evolve',
    )!;
    expect(evolve).toBeDefined();
    const before = structuredClone(state.players);
    reject(
      state,
      command(state, 'choose_reward', {
        kind: 'evolve',
        instanceId: 'starter:1',
        nextFormId: 'vaporeon',
      }),
      'illegal_action',
    );
    const next = accept(state, evolve.kind, evolve.payload);
    expect(next.players.map((player) => player.coins)).toEqual(
      before.map((player) => player.coins),
    );
    expect(next.players[winner.seatIndex]!.team[0]).toMatchObject({
      instanceId: `starter:${winner.seatIndex}`,
      evolutionStage: 1,
    });
    expect(next.players[1]).toEqual(before[1]);
  },
);

test('a tie returns to Strategy without coins, evolution or a reward request', () => {
  const state = rolled(seedFor('tie'));
  expect(state.phase).toEqual({ kind: 'strategy' });
  expect(state.resolvedRewardIds).toBeUndefined();
  expect(state.players).toEqual(game().players);
  expect(state.attackHistory).toHaveLength(1);
  expect(state.rng.cursor).toBe(2);
  expect(state.turnBudgets.tacticalAction).toBe(0);
});

function checkpoint(saved: SavedGame, kind: string, actorId?: string): void {
  const snapshot = structuredClone(saved.state);
  const restored = deserialize(serialize(saved));
  expect(verifyReplay(restored)).toMatchObject({ pass: true });
  expect(replay(restored.log)).toEqual(snapshot);
  expect(resume(restored).waitingFor).toMatchObject({ kind, ...(actorId ? { actorId } : {}) });
  expect(restored.state).toEqual(snapshot);
}

test.each(['win', 'loss', 'tie', 'decline'] as const)(
  '%s: replay/resume at declaration, confirmation, each pending die and reward never draws again',
  (outcome) => {
    const initial = game(seedFor(outcome === 'decline' ? 'win' : outcome));
    const saved: SavedGame = { state: initial, log: createGameLog(initial) };
    const commit = (choice: Pick<LegalAction, 'kind' | 'payload'>) => {
      const action = command(saved.state, choice.kind, choice.payload);
      const result = applyAction(saved.state, action);
      if ('rejected' in result) throw new Error(result.reason);
      saved.state = result.state;
      saved.log.actions.push(result.record);
    };
    const automatic = () => {
      const result = advanceAutomatically(saved.state);
      expect(result.records).toHaveLength(1);
      expect(
        checkInvariants(saved.state, result.records[0]!.action, {
          accepted: true,
          state: result.state,
          events: result.events,
          record: result.records[0]!,
        }),
      ).toEqual([]);
      saved.state = result.state;
      saved.log.actions.push(...result.records);
    };
    commit({ kind: 'declare_pvp', payload: { targetSeatIndex: 2 } });
    checkpoint(saved, 'decision', 'p2');
    commit({ kind: 'respond_pvp', payload: { accept: outcome !== 'decline' } });
    if (outcome === 'decline') {
      checkpoint(saved, 'decision', 'p0');
      return;
    }
    checkpoint(saved, 'engine_result');
    automatic();
    checkpoint(saved, 'engine_result');
    automatic();
    if (outcome !== 'tie') {
      checkpoint(saved, 'decision', outcome === 'win' ? 'p0' : 'p2');
      commit({ kind: 'choose_reward', payload: { kind: 'coins' } });
    }
    checkpoint(saved, 'decision', 'p0');
  },
);

test('only the two pending PvP dice may advance RNG; declaration and reward cannot interleave generated work', () => {
  for (const state of [declared(), rolled(seedFor('win'))]) {
    reject(
      state,
      command(
        state,
        'dice_result',
        { purpose: 'unrelated', value: d6(state.rng, 'unrelated').value },
        'engine',
      ),
      'illegal_action',
    );
    reject(
      state,
      command(state, 'shuffle', { deckId: 'events', order: [] }, 'engine'),
      'illegal_action',
    );
    state.eventDeck.drawPile = ['e1'];
    reject(state, command(state, 'event_draw', { eventId: 'e1' }, 'engine'), 'illegal_action');
  }
  const state = confirmed();
  const purpose = 'pvp:1:attacker_roll';
  const expected = d6(state.rng, purpose).value;
  reject(
    state,
    command(state, 'dice_result', { purpose, value: expected === 6 ? 1 : expected + 1 }, 'engine'),
    'illegal_action',
  );
});

test('progress and attack invariants catch a stolen defender turn and missing or duplicated evidence', () => {
  const before = game();
  const action = command(before, 'declare_pvp', { targetSeatIndex: 2 });
  const result = applyAction(before, action);
  if ('rejected' in result) throw new Error(result.reason);
  const broken = structuredClone(result);
  broken.state.attackHistory = [];
  broken.state.activeSeatIndex = 2;
  broken.state.globalTurnNo++;
  broken.state.players[2]!.ownTurnNo++;
  const violations = checkInvariants(before, action, broken).map((entry) => entry.invariant);
  expect(violations).toContain('pvp-turn-ownership');
  expect(violations).toContain('attack-attempt-logged');
  const response = command(result.state, 'respond_pvp', { accept: false });
  const declined = applyAction(result.state, response);
  if ('rejected' in declined) throw new Error(declined.reason);
  declined.events.push(result.state.attackHistory![0]!);
  expect(
    checkInvariants(result.state, response, declined).map((entry) => entry.invariant),
  ).toContain('attack-attempt-logged');
});

test('an automatic singleton reward is recorded under the defender winner’s actor, preserving the active turn', () => {
  let state = game(seedFor('loss'));
  // Keep equal combat values but make the defender’s form final, leaving coins as its only reward.
  state.players[2]!.team[0]!.speciesId = 'flareon';
  state.players[0]!.team[0]!.speciesId = 'flareon';
  state = accept(state, 'declare_pvp', { targetSeatIndex: 2 });
  state = accept(state, 'respond_pvp', { accept: true });
  state = advanceAutomatically(advanceAutomatically(state).state).state;
  expect(pendingDecision(state)).toEqual({ seatIndex: 2, actorId: 'p2' });
  expect(legalActions(state, 2).enabled).toHaveLength(1);
  const automatic = advanceAutomatically(state);
  expect(automatic.records).toHaveLength(1);
  expect(automatic.records[0]).toMatchObject({
    auto: true,
    action: { kind: 'choose_reward', actorId: 'p2', payload: { kind: 'coins' } },
  });
  expect(automatic.state.activeSeatIndex).toBe(0);
  expect(automatic.state.globalTurnNo).toBe(7);
  expect(automatic.state.players.map((player) => player.ownTurnNo)).toEqual([3, 2, 2]);
});
