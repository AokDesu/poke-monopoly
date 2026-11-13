/// <reference types="vite/client" />
import { expect, test } from 'vitest';
import { parseContent, toEngineContent } from '../content/schema.ts';
import {
  createGame,
  createGameConfig,
  createGameLog,
  deserialize,
  effectiveForm,
  engineEventSchema,
  evolvePokemon,
  gameStateSchema,
  replay,
  resolveReward,
  resume,
  rewardChoices,
  serialize,
  type Action,
  type ApplyActionResult,
  type GameState,
  type RewardChoice,
  type RewardRequest,
} from './index.ts';
import { saleBasis, salePrices } from './selling.ts';
import { finishGame } from './game-end.ts';
import { createInvariantChecker } from './invariants.ts';

const content = toEngineContent(
  parseContent(
    Object.fromEntries(
      Object.entries(
        import.meta.glob<unknown>('../content/*.json', { eager: true, import: 'default' }),
      ).map(([path, json]) => [path.split('/').at(-1)!.slice(0, -5), json]),
    ),
  ),
);

function game(speciesId = 'caterpie'): GameState {
  const state = createGame(
    createGameConfig({
      seats: [
        { actorId: 'a', seatIndex: 0, classId: 'bug-catcher', controller: 'human' },
        { actorId: 'b', seatIndex: 1, classId: 'rival', controller: 'ai' },
      ],
      seed: 4,
      lapTarget: 2,
    }),
    content,
  );
  state.players[0]!.team[0]!.speciesId = speciesId;
  return state;
}

function request(state: GameState, gym = false): RewardRequest {
  return {
    rewardId: 'reward:combat:1',
    winnerId: state.players[0]!.actorId,
    source: gym
      ? { kind: 'gym' }
      : {
          kind: 'pvp',
          loserId: state.players[1]!.actorId,
          coinLossBlocked: false,
        },
  };
}

function evolution(state: GameState, nextFormId: string): RewardChoice {
  return { kind: 'evolve', instanceId: state.players[0]!.team[0]!.instanceId, nextFormId };
}

test('one-stage mutation retains UID, origin, status and both cooldowns; Gyarados replaces stats/Ability', () => {
  const state = game('magikarp');
  const owner = state.players[0]!;
  const pokemon = owner.team[0]!;
  Object.assign(pokemon, { tired: true, tiredExpiresOwnTurnNo: 7, abilityReady: false });
  owner.abilityUsedGlobalTurnNo = state.globalTurnNo;
  const before = structuredClone(state);
  const events = evolvePokemon(state.content, owner, pokemon.instanceId, 'gyarados');
  const expected = structuredClone(before);
  Object.assign(expected.players[0]!.team[0]!, { speciesId: 'gyarados', evolutionStage: 1 });
  expect(state).toEqual(expected);
  expect(owner.team[0]).toBe(pokemon);
  expect(events).toEqual([
    {
      kind: 'pokemon_evolved',
      ownerId: owner.actorId,
      instanceId: pokemon.instanceId,
      fromFormId: 'magikarp',
      toFormId: 'gyarados',
      evolutionStage: 1,
    },
  ]);
  expect(effectiveForm(content, pokemon.speciesId)).toMatchObject({
    battle: 5,
    base: 20,
    ability: { name: 'Intimidate' },
  });
  expect(saleBasis(content, pokemon)).toBe(20);
});

test.each([
  ['caterpie', 'metapod', 'butterfree', 2, 6, 4, 9],
  ['pidgey', 'pidgeotto', 'pidgeot', 3, 8, 5, 12],
] as const)(
  'fallback %s advances from each current form with per-stage half-up rounding',
  (base, middle, final, battle1, sale1, battle2, sale2) => {
    const state = game(base);
    const owner = state.players[0]!;
    const pokemon = owner.team[0]!;
    const inherited = effectiveForm(content, base);
    evolvePokemon(content, owner, pokemon.instanceId, middle);
    expect(effectiveForm(content, pokemon.speciesId)).toMatchObject({
      battle: battle1,
      base: sale1,
    });
    evolvePokemon(content, owner, pokemon.instanceId, final);
    expect(effectiveForm(content, pokemon.speciesId)).toMatchObject({
      battle: battle2,
      base: sale2,
      ability: inherited.ability,
      tags: inherited.tags,
      dc: inherited.dc,
      rarity: inherited.rarity,
    });
    expect(pokemon.evolutionStage).toBe(2);
    expect(() => evolvePokemon(content, owner, pokemon.instanceId, final)).toThrow(
      /Invalid evolution/,
    );
  },
);

test('Eevee offers each explicit branch once, and cannot take another branch or stage', () => {
  for (const nextFormId of ['vaporeon', 'jolteon', 'flareon']) {
    const state = game('eevee');
    const reward = request(state);
    expect(rewardChoices(state, reward)).toEqual([
      { kind: 'coins' },
      ...['vaporeon', 'jolteon', 'flareon'].map((id) => evolution(state, id)),
    ]);
    expect(resolveReward(state, reward, evolution(state, nextFormId))).toHaveProperty(
      'accepted',
      true,
    );
    const before = structuredClone(state);
    expect(resolveReward(state, reward, evolution(state, 'jolteon'))).toEqual({
      rejected: true,
      reason: 'already_resolved',
    });
    expect(rewardChoices(state, { ...reward, rewardId: 'next-battle' })).toEqual([
      { kind: 'coins' },
    ]);
    expect(
      resolveReward(state, { ...reward, rewardId: 'next-battle' }, evolution(state, 'flareon')),
    ).toHaveProperty('rejected', true);
    expect(state).toEqual(before);
  }
});

test.each(['chansey', 'gyarados', 'snorlax', 'scyther', 'porygon'])(
  '%s has no evolution reward option',
  (speciesId) => {
    const state = game(speciesId);
    expect(rewardChoices(state, request(state))).toEqual([{ kind: 'coins' }]);
  },
);

test('skipped stage, absent/foreign UID, invalid branch and combined outcomes reject atomically', () => {
  const state = game();
  const reward = request(state);
  for (const choice of [
    evolution(state, 'butterfree'),
    evolution(state, 'gyarados'),
    { kind: 'evolve', instanceId: 'missing', nextFormId: 'metapod' },
    { kind: 'evolve', instanceId: state.players[1]!.team[0]!.instanceId, nextFormId: 'jolteon' },
    { ...evolution(state, 'metapod'), coins: true },
    { kind: 'coins', nextFormId: 'metapod' },
    [{ kind: 'coins' }, evolution(state, 'metapod')],
  ]) {
    const before = structuredClone(state);
    expect(resolveReward(state, reward, choice)).toHaveProperty('rejected', true);
    expect(state).toEqual(before);
  }
  const owner = state.players[0]!;
  expect(() => evolvePokemon(content, owner, 'missing', 'metapod')).toThrow(/Unknown/);
  expect(() => evolvePokemon(content, owner, owner.team[0]!.instanceId, 'butterfree')).toThrow(
    /Invalid/,
  );
  expect(state.resolvedRewardIds).toBeUndefined();
});

test('evolved Original Starter loses base normalization; evolved Rescue retains zero sale/final value', () => {
  for (const rescue of [false, true]) {
    const state = game();
    const owner = state.players[0]!;
    const pokemon = owner.team[0]!;
    if (rescue) Object.assign(pokemon, { origin: 'rescue_starter', tradeable: false });
    expect(saleBasis(content, pokemon)).toBe(rescue ? 0 : 5);
    evolvePokemon(content, owner, pokemon.instanceId, 'metapod');
    evolvePokemon(content, owner, pokemon.instanceId, 'butterfree');
    expect(saleBasis(content, pokemon)).toBe(rescue ? 0 : 9);
    pokemon.tired = true;
    expect(salePrices(state, owner, [pokemon])).toEqual([
      { basePrice: rescue ? 0 : 7, classBonus: rescue ? 0 : 2 },
    ]);
    const coins = owner.coins;
    finishGame(state);
    expect(owner.coins - coins).toBe(rescue ? 0 : 5);
    expect(pokemon.origin).toBe(rescue ? 'rescue_starter' : 'original_starter');
    if (rescue) expect(pokemon.tradeable).toBe(false);
  }
});

test.each([0, 1, 5, 6, 9, 20])(
  'PvP coins are sourced from loser balance %i, never the bank',
  (coins) => {
    const state = game();
    state.players[1]!.coins = coins;
    const before = structuredClone(state);
    const reward = request(state);
    const result = resolveReward(state, reward, { kind: 'coins' });
    if ('rejected' in result) throw new Error(result.reason);
    const amount = Math.min(6, coins);
    expect(state.players.map((p) => p.coins)).toEqual([20 + amount, coins - amount]);
    expect(state.players.flatMap((p) => p.team)).toEqual(before.players.flatMap((p) => p.team));
    expect(result.events.filter((e) => e.kind === 'coin_transfer')).toEqual(
      amount
        ? [
            {
              kind: 'coin_transfer',
              source: { kind: 'player', actorId: 'b' },
              destination: { kind: 'player', actorId: 'a' },
              amount,
              reason: 'pvp_reward',
              rewardId: reward.rewardId,
            },
          ]
        : [],
    );
    const committed = structuredClone(state);
    expect(resolveReward(state, reward, evolution(state, 'metapod'))).toEqual({
      rejected: true,
      reason: 'already_resolved',
    });
    expect(state).toEqual(committed);
  },
);

test.each([false, true])(
  'blocked PvP coins do not mint assets, and evolution charges no loser (evolve=%s)',
  (evolve) => {
    const state = game();
    const reward = request(state);
    if (reward.source.kind !== 'pvp') throw new Error('Expected PvP');
    reward.source.coinLossBlocked = true;
    const before = structuredClone(state);
    const result = resolveReward(
      state,
      reward,
      evolve ? evolution(state, 'metapod') : { kind: 'coins' },
    );
    if ('rejected' in result) throw new Error(result.reason);
    expect(result.events.some((event) => event.kind === 'coin_transfer')).toBe(false);
    expect(state.players.map((p) => p.coins)).toEqual(before.players.map((p) => p.coins));
    expect(state.players[1]).toEqual(before.players[1]);
    expect(state.players[0]!.team[0]!.evolutionStage).toBe(evolve ? 1 : 0);
  },
);

test.each([false, true])(
  'Gym gives bank coins or evolution without changing badges or continuation (evolve=%s)',
  (evolve) => {
    const state = game();
    state.players[0]!.badges = 2; // Badge is already granted by the future Gym caller.
    const before = structuredClone(state);
    const reward = request(state, true);
    const result = resolveReward(
      state,
      reward,
      evolve ? evolution(state, 'metapod') : { kind: 'coins' },
    );
    if ('rejected' in result) throw new Error(result.reason);
    expect(state.players.map((p) => p.coins)).toEqual([evolve ? 20 : 26, 20]);
    expect(state.players[0]!.badges).toBe(2);
    expect(result.events.filter((event) => event.kind === 'coin_transfer')).toEqual(
      evolve
        ? []
        : [
            {
              kind: 'coin_transfer',
              source: { kind: 'bank' },
              destination: { kind: 'player', actorId: 'a' },
              amount: 6,
              reason: 'gym_reward',
              rewardId: reward.rewardId,
            },
          ],
    );
    expect(state.phase).toEqual(before.phase);
    expect(state.turnBudgets).toEqual(before.turnBudgets);
    expect(state.rng).toEqual(before.rng);
    for (const event of result.events) expect(engineEventSchema.parse(event)).toEqual(event);
    expect(gameStateSchema.parse(state)).toEqual(state);
  },
);

test('unblocked PvP evolution charges nothing; defender winner is independent of active seat', () => {
  const state = game();
  const reward: RewardRequest = {
    rewardId: 'defender-win',
    winnerId: 'b',
    source: { kind: 'pvp', loserId: 'a', coinLossBlocked: false },
  };
  const before = structuredClone(state);
  const result = resolveReward(state, reward, {
    kind: 'evolve',
    instanceId: state.players[1]!.team[0]!.instanceId,
    nextFormId: 'jolteon',
  });
  expect(result).toHaveProperty('accepted', true);
  expect(state.players[0]).toEqual(before.players[0]);
  expect(state.players.map((p) => p.coins)).toEqual([20, 20]);
  expect(state.players[1]!.team[0]!.speciesId).toBe('jolteon');
  expect(state.activeSeatIndex).toBe(before.activeSeatIndex);
});

test('invalid context and unsafe coin balance reject before mutating; quotes are pure', () => {
  const state = game();
  const reward = request(state);
  const before = structuredClone(state);
  rewardChoices(state, reward).pop();
  expect(state).toEqual(before);
  for (const invalid of [
    { ...reward, winnerId: 'missing' },
    { ...reward, source: { kind: 'pvp', loserId: 'a', coinLossBlocked: false } },
    { ...reward, source: { kind: 'pvp', loserId: 'missing', coinLossBlocked: false } },
    { ...reward, source: { kind: 'pvp', loserId: 'b' } },
  ]) {
    expect(resolveReward(state, invalid, { kind: 'coins' })).toHaveProperty('rejected', true);
    expect(state).toEqual(before);
  }
  state.players[0]!.coins = Number.MAX_SAFE_INTEGER;
  const overflow = structuredClone(state);
  expect(rewardChoices(state, reward).some((c) => c.kind === 'coins')).toBe(false);
  expect(resolveReward(state, reward, { kind: 'coins' })).toHaveProperty('rejected', true);
  expect(state).toEqual(overflow);
});

test.each([false, true])(
  'receipt survives serialization/resume and prevents either outcome on retry (evolve=%s)',
  (evolve) => {
    const state = game();
    const reward = request(state);
    const choice = evolve ? evolution(state, 'metapod') : { kind: 'coins' as const };
    const result = resolveReward(state, reward, choice);
    expect(result).toHaveProperty('accepted', true);
    // A revision-zero scenario snapshots the internal helper result. Command-level reward
    // replay is owned by S06/S09, once those callers expose a reward action.
    const log = createGameLog(state);
    const saved = deserialize(serialize({ state, log }));
    const restored = resume(saved).state;
    expect(replay(log)).toEqual(restored);
    const before = structuredClone(restored);
    expect(resolveReward(restored, reward, { kind: 'coins' })).toEqual({
      rejected: true,
      reason: 'already_resolved',
    });
    expect(resolveReward(restored, reward, evolution(restored, 'butterfree'))).toHaveProperty(
      'rejected',
      true,
    );
    expect(rewardChoices(restored, reward)).toEqual([]);
    expect(restored).toEqual(before);
  },
);

/** Model a future command boundary to exercise active invariants without adding S06 actions. */
function step(before: GameState, choice: RewardChoice) {
  const state = structuredClone(before);
  const resolution = resolveReward(state, request(state), choice);
  if ('rejected' in resolution) throw new Error(resolution.reason);
  const action: Action = {
    actorId: 'a',
    actionSeq: 1,
    stateRevisionBefore: 0,
    kind: 'skip',
    payload: {},
  };
  state.stateRevision = 1;
  const result: Extract<ApplyActionResult, { accepted: true }> = {
    accepted: true,
    state,
    events: resolution.events,
    record: { action, events: resolution.events },
  };
  return { result, violations: () => createInvariantChecker(() => result)(before, action, result) };
}

test('evolution/reward invariant checkers accept correct resolution and catch adversarial mutations', () => {
  const before = game();
  const valid = step(before, evolution(before, 'metapod'));
  expect(valid.violations()).toEqual([]);
  const mutations: [string, (result: typeof valid.result) => void][] = [
    [
      'evolution-keeps-cooldowns',
      (r) => {
        r.state.players[0]!.team[0]!.abilityReady = false;
      },
    ],
    [
      'evolution-keeps-cooldowns',
      (r) => {
        r.state.players[0]!.abilityUsedGlobalTurnNo = 9;
      },
    ],
    [
      'evolution-keeps-cooldowns',
      (r) => {
        r.state.players[0]!.team[0]!.origin = 'caught';
      },
    ],
    [
      'evolution-keeps-cooldowns',
      (r) => {
        r.state.players[0]!.team[0]!.tired = true;
      },
    ],
    [
      'evolution-one-stage-same-uid',
      (r) => {
        r.state.players[0]!.team[0]!.evolutionStage = 2;
      },
    ],
    [
      'evolution-one-stage-same-uid',
      (r) => {
        r.state.players[0]!.team[0]!.instanceId = 'new-uid';
      },
    ],
    [
      'evolution-one-stage-same-uid',
      (r) => {
        r.events.splice(0, 1);
      },
    ],
    [
      'battle-reward-coins-or-evolution',
      (r) => {
        r.state.players[1]!.coins -= 6;
      },
    ],
    [
      'battle-reward-coins-or-evolution',
      (r) => {
        r.state.players[0]!.coins += 6;
      },
    ],
    [
      'battle-reward-coins-or-evolution',
      (r) => {
        delete r.state.resolvedRewardIds;
      },
    ],
  ];
  for (const [invariant, mutate] of mutations) {
    const broken = step(before, evolution(before, 'metapod'));
    mutate(broken.result);
    expect(
      broken.violations().some((v) => v.invariant === invariant),
      invariant,
    ).toBe(true);
  }
});

test('reward invariant rejects bank minting, excess transfer, both outcomes and duplicate retries', () => {
  const before = game();
  const valid = step(before, { kind: 'coins' });
  expect(valid.violations()).toEqual([]);
  for (const mutate of [
    (r: typeof valid.result) => {
      const e = r.events[0];
      if (e?.kind === 'coin_transfer') e.source = { kind: 'bank' };
    },
    (r: typeof valid.result) => {
      const e = r.events[0];
      if (e?.kind === 'coin_transfer') e.amount = 7;
    },
    (r: typeof valid.result) => {
      r.events.push(
        ...evolvePokemon(
          content,
          r.state.players[0]!,
          r.state.players[0]!.team[0]!.instanceId,
          'metapod',
        ),
      );
    },
    (r: typeof valid.result) => {
      r.events.push(structuredClone(r.events.at(-1)!));
    },
  ]) {
    const broken = step(before, { kind: 'coins' });
    mutate(broken.result);
    expect(
      broken.violations().some((v) => v.invariant === 'battle-reward-coins-or-evolution'),
    ).toBe(true);
  }
  const prior = structuredClone(before);
  prior.resolvedRewardIds = ['reward:combat:1'];
  const action = valid.result.record.action;
  expect(
    createInvariantChecker(() => valid.result)(prior, action, valid.result).some(
      (v) => v.invariant === 'battle-reward-coins-or-evolution',
    ),
  ).toBe(true);
});
