/// <reference types="vite/client" />
import { expect, test } from 'vitest';
import { fc } from '@fast-check/vitest';
import { parseContent, toEngineContent } from '../content/schema.ts';
import {
  applyAction,
  combatSnapshot,
  createGame,
  createGameConfig,
  gymOdds,
  gymSnapshot,
  gymSnapshotSchema,
  highestBattleMember,
  pvpOdds,
  pvpSnapshot,
  pvpSnapshotSchema,
  resolveGym,
  resolvePvp,
  type CombatModifiers,
  type CombatOdds,
  type CombatOutcome,
  type GameState,
  type PokemonInstance,
} from './index.ts';
import { classBonus } from './classes.ts';

const files = Object.fromEntries(
  Object.entries(
    import.meta.glob<unknown>('../content/*.json', { eager: true, import: 'default' }),
  ).map(([path, json]) => [path.split('/').at(-1)!.slice(0, -5), json]),
);
const content = toEngineContent(parseContent(files));

function member(instanceId: string, speciesId: string, tired = false): PokemonInstance {
  return {
    instanceId,
    speciesId,
    origin: 'caught',
    evolutionStage: 0,
    tired,
    abilityReady: true,
  };
}

function game(): GameState {
  const state = createGame(
    createGameConfig({
      seats: [
        { actorId: 'a', seatIndex: 0, classId: 'rival', controller: 'human' },
        { actorId: 'b', seatIndex: 1, classId: 'researcher', controller: 'ai' },
      ],
      seed: 5,
      lapTarget: 2,
    }),
    content,
  );
  // Equal teams without combat passives, retaining seat 0's usable Lucky Egg.
  state.players[0]!.classId = 'fisherman';
  state.players[1]!.classId = 'bug-catcher';
  state.players[0]!.team = [member('a:eevee', 'eevee')];
  state.players[1]!.team = [member('b:eevee', 'eevee')];
  state.activeSeatIndex = 0;
  state.globalTurnNo = 1;
  state.phase = { kind: 'strategy' };
  state.turnBudgets.tacticalAction = 1;
  return state;
}

test('highest healthy current-form battle wins; evolved fallback stats participate (§4.4/4.5)', () => {
  const state = game();
  const player = state.players[0]!;
  player.team = [
    member('tired', 'gyarados', true),
    member('scyther', 'scyther'),
    { ...member('evolved', 'pidgeot'), evolutionStage: 2 },
  ];
  expect(highestBattleMember(state.content, player)).toEqual({
    instanceId: 'evolved',
    speciesId: 'pidgeot',
    printedBattle: 5,
    battleBonus: 0,
    debuffs: 0,
    effectiveBattle: 5,
  });
  expect(
    combatSnapshot(state, 0, { members: [{ instanceId: 'evolved', debuffs: 3 }] }).member,
  ).toMatchObject({ instanceId: 'scyther', printedBattle: 4, effectiveBattle: 4 });
  player.team.push(member('boosted', 'charmander'));
  expect(
    combatSnapshot(state, 0, { members: [{ instanceId: 'boosted', battleBonus: 5 }] }).member,
  ).toMatchObject({ instanceId: 'boosted', printedBattle: 2, effectiveBattle: 7 });
});

test('equal effective stats use UID order independently of team order; totals are not clamped', () => {
  const state = game();
  const player = state.players[0]!;
  player.team = [member('z', 'eevee'), member('a', 'charmander')];
  expect(combatSnapshot(state, 0).member.instanceId).toBe('a');
  player.team.reverse();
  expect(combatSnapshot(state, 0).member.instanceId).toBe('a');
  const snapshot = gymSnapshot(state, 0, 6, {
    members: [
      { instanceId: 'a', debuffs: 5 },
      { instanceId: 'z', debuffs: 6 },
    ],
    debuffs: 2,
  });
  expect(snapshot.challenger.member).toMatchObject({ printedBattle: 2, effectiveBattle: -3 });
  expect(resolveGym(snapshot, 1)).toMatchObject({ total: -4, outcome: 'loss' });
});

test.each([{ team: [] }, { team: [member('tired', 'gyarados', true)] }])(
  'empty or all-Tired teams cannot produce a legal fight snapshot (§4.4)',
  ({ team }) => {
    const state = game();
    state.players[0]!.team = team;
    expect(highestBattleMember(state.content, state.players[0]!)).toBeUndefined();
    expect(() => combatSnapshot(state, 0)).toThrow(/No battle-ready/);
    expect(() => pvpSnapshot(state, 0, 1)).toThrow(/No battle-ready/);
    expect(() => pvpSnapshot(state, 1, 0)).toThrow(/No battle-ready/);
    expect(() => gymSnapshot(state, 0, 6)).toThrow(/No battle-ready/);
  },
);

test('Rival combat hook works attacking and defending in PvP, not at the Gym (Appendix A, D14)', () => {
  const state = game();
  state.players[0]!.classId = 'rival';
  expect(state.content.classes.find((entry) => entry.id === 'rival')!.passive).toBe('combat_bonus');
  const attack = pvpSnapshot(state, 0, 1);
  expect(attack.attacker.classBonus).toBe(1);
  expect(resolvePvp(attack, 3, 3)).toMatchObject({ outcome: 'win', rewardSeatIndex: 0 });
  expect(pvpOdds(attack).win.outcomes).toBe(21);
  const defence = pvpSnapshot(state, 1, 0);
  expect(defence.defender.classBonus).toBe(1);
  expect(resolvePvp(defence, 3, 3)).toMatchObject({ outcome: 'loss', rewardSeatIndex: 0 });
  expect(pvpOdds(defence).loss.outcomes).toBe(21);
  const gym = gymSnapshot(state, 0, 12);
  expect(gym.challenger.classBonus).toBe(0);
  expect(gymOdds(gym).win.outcomes).toBe(2);
  state.players[0]!.classId = 'fisherman';
  expect(gymOdds(gymSnapshot(state, 0, 12)).win.outcomes).toBe(2);
  expect(
    classBonus(state.content, 'rival', {
      kind: 'catch',
      player: state.players[0]!,
      speciesTags: [],
    }),
  ).toBe(0);
  const pokemon = state.players[0]!.team[0]!;
  expect(
    classBonus(state.content, 'rival', { kind: 'sale', pokemon, batch: [{ pokemon, basis: 12 }] }),
  ).toBe(0);
});

test('Rescue Starter teams keep trainer combat passives pending S00, with no new suppression', () => {
  const state = game();
  state.players[0]!.classId = 'rival';
  state.players[0]!.team[0]!.origin = 'rescue_starter';
  expect(combatSnapshot(state, 0).classBonus).toBe(1);
});

test('using Lucky Egg supplies combat +1 only to its active owner in either PvP role and at Gym', () => {
  const state = game();
  const before = gymOdds(gymSnapshot(state, 0, 12));
  const used = applyAction(state, {
    actorId: 'a',
    actionSeq: 1,
    stateRevisionBefore: state.stateRevision,
    kind: 'use_item',
    payload: { itemInstanceId: 'class-item:0' },
  });
  if ('rejected' in used) throw new Error(used.reason);
  expect(used.state.players[0]!.items).toHaveLength(0);
  expect(used.state.turnBudgets.tacticalAction).toBe(0);
  expect(pvpSnapshot(used.state, 0, 1).attacker.itemBonus).toBe(1);
  expect(pvpSnapshot(used.state, 0, 1).defender.itemBonus).toBe(0);
  expect(pvpSnapshot(used.state, 1, 0).defender.itemBonus).toBe(1);
  expect(pvpSnapshot(used.state, 1, 0).attacker.itemBonus).toBe(0);
  const gym = gymSnapshot(used.state, 0, 12);
  expect(resolveGym(gym, 4)).toMatchObject({ total: 7, outcome: 'win' });
  expect(gymOdds(gym).win.outcomes).toBe(before.win.outcomes + 1);
  // Turn-start clears turnEffects; a later turn/other owner gets no carried bonus.
  used.state.activeSeatIndex = 1;
  expect(combatSnapshot(used.state, 0).itemBonus).toBe(0);
});

test('team slots combine with member slots, Rival and item bonuses through one formula', () => {
  const state = game();
  state.players[0]!.classId = 'rival';
  state.turnEffects = { itemBonus: 1 };
  const snapshot = pvpSnapshot(state, 0, 1, {
    attacker: {
      abilityBonus: 2,
      debuffs: 1,
      members: [{ instanceId: 'a:eevee', battleBonus: 3, debuffs: 1 }],
    },
    defender: { abilityBonus: 1, debuffs: 2 },
  });
  // Attack: 2 + (printed 2 + 3 - 1) + Rival 1 + Ability 2 + Egg 1 - debuff 1 = 9.
  // Defence: 6 + printed 2 + Ability 1 - debuff 2 = 7.
  expect(resolvePvp(snapshot, 2, 6)).toEqual({
    outcome: 'win',
    attackerTotal: 9,
    defenderTotal: 7,
    rewardSeatIndex: 0,
  });
});

test('confirmed snapshots detach and freeze every modifier; no late changes (§4.4, §8)', () => {
  const state = game();
  const modifiers = {
    abilityBonus: 1,
    debuffs: 1,
    members: [{ instanceId: 'a:eevee', battleBonus: 1 }],
  };
  const before = structuredClone(state);
  const snapshot = pvpSnapshot(state, 0, 1, { attacker: modifiers });
  const result = resolvePvp(snapshot, 3, 3);
  const odds = pvpOdds(snapshot);
  const gym = gymSnapshot(state, 0, 12, modifiers);
  const gymResult = resolveGym(gym, 3);
  expect(state).toEqual(before);
  modifiers.abilityBonus = 99;
  modifiers.debuffs = 99;
  modifiers.members[0]!.battleBonus = 99;
  state.players[0]!.team[0]!.tired = true;
  state.players[0]!.team[0]!.speciesId = 'gyarados';
  state.players[0]!.classId = 'rival';
  state.turnEffects = { itemBonus: 99 };
  for (const target of [snapshot.attacker, snapshot.defender]) {
    for (const field of ['classBonus', 'abilityBonus', 'itemBonus', 'debuffs']) {
      expect(() => Object.assign(target, { [field]: 99 })).toThrow(TypeError);
    }
    for (const field of ['printedBattle', 'effectiveBattle', 'battleBonus', 'debuffs']) {
      expect(() => Object.assign(target.member, { [field]: 99 })).toThrow(TypeError);
    }
  }
  expect(() => Object.assign(snapshot, { attacker: snapshot.defender })).toThrow(TypeError);
  expect(() => Object.assign(gym.challenger, { abilityBonus: 99 })).toThrow(TypeError);
  expect(() => Object.assign(gym, { dc: 1 })).toThrow(TypeError);
  expect(resolvePvp(snapshot, 3, 3)).toEqual(result);
  expect(pvpOdds(snapshot)).toEqual(odds);
  expect(resolveGym(gym, 3)).toEqual(gymResult);
  const restored = pvpSnapshotSchema.parse(JSON.parse(JSON.stringify(snapshot)));
  expect(Object.isFrozen(restored.attacker.member)).toBe(true);
  expect(resolvePvp(restored, 3, 3)).toEqual(result);
  expect(gymSnapshotSchema.parse(JSON.parse(JSON.stringify(gym)))).toEqual(gym);
});

function checkOdds(odds: CombatOdds, outcomes: CombatOutcome[]) {
  expect(odds.totalOutcomes).toBe(outcomes.length);
  for (const outcome of ['win', 'tie', 'loss'] as const) {
    const count = outcomes.filter((entry) => entry === outcome).length;
    expect(odds[outcome]).toEqual({
      outcomes: count,
      probability: count / outcomes.length,
      percent: Math.round((100 * count) / outcomes.length),
    });
  }
}

test('all 36 equal-team pairs agree with exact odds; ties have no reward or side effects', () => {
  const state = game();
  const before = structuredClone(state);
  const snapshot = pvpSnapshot(state, 0, 1);
  const outcomes: CombatOutcome[] = [];
  for (let a = 1; a <= 6; a++) {
    for (let b = 1; b <= 6; b++) {
      const result = resolvePvp(snapshot, a, b);
      expect(result).toEqual({
        outcome: a > b ? 'win' : a < b ? 'loss' : 'tie',
        attackerTotal: a + 2,
        defenderTotal: b + 2,
        rewardSeatIndex: a === b ? null : a > b ? 0 : 1,
      });
      outcomes.push(result.outcome);
    }
  }
  const odds = pvpOdds(snapshot);
  expect(odds.win.outcomes).toBe(15);
  expect(odds.tie.outcomes).toBe(6);
  expect(odds.loss.outcomes).toBe(15);
  checkOdds(odds, outcomes);
  expect(state).toEqual(before);
});

test('all 36 pairs agree with displayed odds for varied confirmed modifiers and effective forms', () => {
  const state = game();
  fc.assert(
    fc.property(
      fc.constantFrom('eevee', 'pidgeot', 'gyarados', 'caterpie'),
      fc.integer({ min: 0, max: 12 }),
      fc.integer({ min: 0, max: 12 }),
      fc.integer({ min: 0, max: 12 }),
      fc.integer({ min: 0, max: 12 }),
      (form, aBonus, aDebuff, bBonus, bDebuff) => {
        state.players[0]!.team[0]!.speciesId = form;
        const snapshot = pvpSnapshot(state, 0, 1, {
          attacker: { abilityBonus: aBonus, debuffs: aDebuff },
          defender: { abilityBonus: bBonus, debuffs: bDebuff },
        });
        const outcomes: CombatOutcome[] = [];
        for (let a = 1; a <= 6; a++) {
          for (let b = 1; b <= 6; b++) outcomes.push(resolvePvp(snapshot, a, b).outcome);
        }
        checkOdds(pvpOdds(snapshot), outcomes);
      },
    ),
    { numRuns: 100 },
  );
});

test.each([
  [6, 5],
  [12, 7],
  [18, 9],
])('Gym %i uses DC %i; every face and equality boundary agrees with exact odds', (position, dc) => {
  const state = game();
  for (let bonus = 0; bonus <= 10; bonus++) {
    for (let debuffs = 0; debuffs <= 10; debuffs++) {
      const snapshot = gymSnapshot(state, 0, position!, { abilityBonus: bonus, debuffs });
      const outcomes: CombatOutcome[] = [];
      for (let face = 1; face <= 6; face++) {
        const total = face + 2 + bonus - debuffs;
        const won = total >= dc!;
        expect(resolveGym(snapshot, face)).toEqual({
          outcome: won ? 'win' : 'loss',
          total,
          dc,
          rewardSeatIndex: won ? 0 : null,
        });
        outcomes.push(won ? 'win' : 'loss');
      }
      checkOdds(gymOdds(snapshot), outcomes);
      expect(gymOdds(snapshot).tie.outcomes).toBe(0);
    }
  }
});

test('invalid seats, self battles, Gym squares, modifiers and dice reject without changing state', () => {
  const state = game();
  const before = structuredClone(state);
  expect(() => pvpSnapshot(state, 0, 0)).toThrow(/yourself/);
  expect(() => pvpSnapshot(state, 0, 99)).toThrow(/Unknown combat seat/);
  expect(() => gymSnapshot(state, 99, 6)).toThrow(/Unknown combat seat/);
  expect(() => gymSnapshot(state, 0, 5)).toThrow(/Not a Gym/);
  const invalid: CombatModifiers[] = [
    { abilityBonus: -1 },
    { debuffs: 0.5 },
    { abilityBonus: NaN },
    { debuffs: Infinity },
    { abilityBonus: Number.MAX_SAFE_INTEGER + 1 },
    { members: [{ instanceId: 'a:eevee', battleBonus: -1 }] },
    { members: [{ instanceId: 'a:eevee', debuffs: 0.5 }] },
    { members: [{ instanceId: 'foreign' }] },
    { members: [{ instanceId: 'a:eevee' }, { instanceId: 'a:eevee' }] },
  ];
  for (const modifiers of invalid)
    expect(() => combatSnapshot(state, 0, modifiers)).toThrow(RangeError);
  const pvp = pvpSnapshot(state, 0, 1);
  const gym = gymSnapshot(state, 0, 6);
  expect(gymSnapshotSchema.safeParse({ ...gym, dc: 9 }).success).toBe(false);
  expect(pvpSnapshotSchema.safeParse({ ...pvp, defender: pvp.attacker }).success).toBe(false);
  expect(
    pvpSnapshotSchema.safeParse({
      ...pvp,
      attacker: { ...pvp.attacker, member: { ...pvp.attacker.member, effectiveBattle: 99 } },
    }).success,
  ).toBe(false);
  for (const face of [0, 7, 1.5, NaN, Infinity]) {
    expect(() => resolvePvp(pvp, face, 1)).toThrow(/d6/);
    expect(() => resolvePvp(pvp, 1, face)).toThrow(/d6/);
    expect(() => resolveGym(gym, face)).toThrow(/d6/);
  }
  expect(state).toEqual(before);
});
