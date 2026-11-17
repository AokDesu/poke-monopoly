/// <reference types="vite/client" />
import { expect, test } from 'vitest';
import { parseContent, toEngineContent } from '../content/schema.ts';
import { ABILITY_EFFECTS } from './abilities.ts';
import {
  advanceAutomatically,
  applyAction,
  checkInvariants,
  createGame,
  createGameConfig,
  createRng,
  d6,
  effectiveForm,
  expireStatuses,
  legalActions,
  pendingDecision,
  saleQuote,
  type AbilityEffectId,
  type Action,
  type Content,
  type GameState,
} from './index.ts';

const files = Object.fromEntries(
  Object.entries(
    import.meta.glob<unknown>('../content/*.json', { eager: true, import: 'default' }),
  ).map(([path, json]) => [path.split('/').at(-1)!.slice(0, -5), json]),
);
const content = toEngineContent(parseContent(files));

/** Representative C4 bindings for the two primitives no core Starter carries (S14 scope). */
const representative: Content = structuredClone(content);
representative.species.find((entry) => entry.id === 'machop')!.ability!.effect = 'challenge';
representative.species.find((entry) => entry.id === 'growlithe')!.ability!.effect = 'track';

/** Seat 0 owns one `formId`; seats 1 and 2 hold Pikachu (no bound Ability). */
function game(formId: string, active = 0): GameState {
  const state = createGame(
    createGameConfig({
      seats: ['fisherman', 'bug-catcher', 'researcher'].map((classId, seatIndex) => ({
        actorId: `p${seatIndex}`,
        seatIndex,
        classId,
        controller: 'ai' as const,
      })),
      seed: 2,
      lapTarget: 2,
    }),
    representative,
  );
  state.phase = { kind: 'strategy' };
  state.activeSeatIndex = active;
  state.globalTurnNo = 6;
  state.turnBudgets = { tacticalAction: 1, catchAttempt: 1, pokemonAbility: 1 };
  state.players.forEach((player, seat) => {
    player.ownTurnNo = 2;
    player.team = [
      { ...player.team[0]!, speciesId: seat === 0 ? formId : 'pikachu', abilityReady: true },
    ];
  });
  return state;
}

function act(state: GameState, kind: Action['kind'], payload: unknown = {}) {
  const action = {
    actorId: pendingDecision(state)!.actorId,
    kind,
    payload,
    actionSeq: state.stateRevision + 1,
    stateRevisionBefore: state.stateRevision,
  } as Action;
  const result = applyAction(state, action);
  if ('rejected' in result) throw new Error(`Unexpected rejection: ${result.reason}`);
  expect(checkInvariants(state, action, result)).toEqual([]);
  return result.state;
}

type Window = 'strategy' | 'attacker' | 'defender' | 'reroll';

/** Reach the owner's legal activation window for its timing (Appendix C.3). */
function reach(formId: string, window: Window): GameState {
  if (window === 'strategy') return game(formId);
  if (window === 'attacker') {
    const declared = act(game(formId), 'declare_pvp', { targetSeatIndex: 1 });
    return act(declared, 'respond_pvp', { accept: true });
  }
  if (window === 'defender') {
    const state = game(formId, 1);
    state.players[0]!.team.push({
      instanceId: 'caught:0:9',
      speciesId: 'pikachu',
      origin: 'caught',
      evolutionStage: 0,
      tired: true,
      tiredExpiresOwnTurnNo: 3,
      abilityReady: false,
    });
    const declared = act(state, 'declare_pvp', { targetSeatIndex: 0 });
    return act(declared, 'respond_pvp', { accept: true });
  }
  const state = game(formId);
  state.phase = { kind: 'encounter', pokemon: { speciesId: 'machop' } };
  return advanceAutomatically(act(state, 'catch', { ballType: 'poke' })).state;
}

const ROWS: [AbilityEffectId, Window, string[], (after: GameState) => void][] = [
  [
    'vine_pull',
    'strategy',
    ['bulbasaur', 'ivysaur', 'venusaur'],
    (s) => expect(s.players[1]!.routeProgress).toBe(-2),
  ],
  [
    'blaze',
    'attacker',
    ['charmander', 'charmeleon', 'charizard'],
    (s) =>
      expect(s.phase).toMatchObject({ battle: { snapshot: { attacker: { abilityBonus: 1 } } } }),
  ],
  [
    'shell_guard',
    'defender',
    ['squirtle', 'wartortle', 'blastoise'],
    (s) =>
      expect(s.players[0]!.armedShield).toEqual({
        scope: 'battle_coin_loss',
        visibility: 'public',
      }),
  ],
  [
    'adaptability',
    'attacker',
    ['eevee', 'vaporeon', 'jolteon', 'flareon'],
    (s) =>
      expect(s.phase).toMatchObject({ battle: { snapshot: { attacker: { abilityBonus: 1 } } } }),
  ],
  ['lucky_splash', 'strategy', ['magikarp'], (s) => expect(s.phase.kind).toBe('chance_roll')],
  [
    'intimidate',
    'attacker',
    ['gyarados'],
    (s) => expect(s.phase).toMatchObject({ battle: { snapshot: { defender: { debuffs: 1 } } } }),
  ],
  ['heal_pulse', 'defender', ['chansey'], (s) => expect(s.players[0]!.team[1]!.tired).toBe(false)],
  [
    'string_shot',
    'strategy',
    ['caterpie', 'metapod', 'butterfree'],
    (s) => expect(s.players[1]!.pendingSlows).toEqual(['string_shot']),
  ],
  [
    'calculate',
    'reroll',
    ['porygon'],
    (s) => expect(s.phase).toMatchObject({ kind: 'encounter', rerolling: true }),
  ],
  ['quick_flight', 'strategy', ['pidgey'], (s) => expect(s.turnEffects?.fixedMove).toBe(3)],
  [
    'dragon_rush',
    'attacker',
    ['dratini'],
    (s) =>
      expect(s.phase).toMatchObject({
        battle: {
          snapshot: { attacker: { abilityBonus: 2 } },
          afterResolution: [{ seatIndex: 0 }],
        },
      }),
  ],
  [
    'challenge',
    'strategy',
    ['machop'],
    (s) => expect(s.phase).toMatchObject({ kind: 'pvp', battle: { forced: true } }),
  ],
  ['track', 'strategy', ['growlithe'], (s) => expect(s.players[0]!.privateResults).toHaveLength(1)],
];

test.each(
  ROWS.flatMap(([effect, window, forms, check]) =>
    forms.map((form) => [form, effect, window, check] as const),
  ),
)(
  '%s reaches its %s activation (%s window) with an observable effect (Appendix C.2)',
  (form, effect, window, check) => {
    expect(effectiveForm(representative, form).ability?.effect).toBe(effect);
    const state = reach(form, window);
    expect(pendingDecision(state)?.seatIndex).toBe(0);
    const choice = legalActions(state, 0).enabled.find(
      (option) =>
        option.kind === 'activate_ability' &&
        (option.payload.targetSeatIndex ?? 1) === 1 &&
        (option.payload.scope ?? 'combat') === 'combat',
    );
    expect(choice).toBeDefined();
    const after = act(state, 'activate_ability', choice!.payload);
    check(after);
    expect(after.players[0]!.abilityUsedGlobalTurnNo).toBe(6);
  },
);

test('the engine maps every effect to exactly the eight §4.5 primitives, and each is exercised above (no ninth system)', () => {
  const primitives = new Set(Object.values(ABILITY_EFFECTS).map((effect) => effect.primitive));
  expect([...primitives].sort()).toEqual(
    [
      'fixedMove',
      'moveDebuff',
      'rollBonus',
      'forcePvP',
      'shield',
      'heal',
      'gainBall',
      'peek',
    ].sort(),
  );
  const exercised = new Set(ROWS.map(([effect]) => ABILITY_EFFECTS[effect].primitive));
  expect(exercised).toEqual(primitives);
  // Authored timing (Appendix A legend) agrees with the engine's for every bound effect.
  for (const species of content.species) {
    const effect = species.ability?.effect;
    if (effect)
      expect([species.id, species.ability!.timing]).toEqual([
        species.id,
        ABILITY_EFFECTS[effect].timing,
      ]);
  }
  // Real content binds every core Starter line plus Pidgey and Dratini, and nothing else.
  const bound = content.species.filter((entry) => entry.ability?.effect).map((entry) => entry.id);
  expect(bound.sort()).toEqual(
    [
      'bulbasaur',
      'caterpie',
      'chansey',
      'charmander',
      'dratini',
      'eevee',
      'gyarados',
      'magikarp',
      'pidgey',
      'porygon',
      'squirtle',
    ].sort(),
  );
});

test('Magikarp → Gyarados changes the Ability to Intimidate without refreshing a spent cooldown (§4.5, C.2)', () => {
  const state = game('magikarp');
  const splashed = act(state, 'activate_ability', { instanceId: 'starter:0' });
  const evolved = structuredClone(advanceAutomatically(splashed).state);
  evolved.players[0]!.team[0]!.speciesId = 'gyarados'; // as the S04 evolution seam leaves it
  evolved.players[0]!.team[0]!.evolutionStage = 1;
  expect(effectiveForm(content, 'gyarados').ability?.effect).toBe('intimidate');
  expect(evolved.players[0]!.team[0]!.abilityReady).toBe(false);
  evolved.globalTurnNo = 7;
  const declared = act(evolved, 'declare_pvp', { targetSeatIndex: 1 });
  expect(act(declared, 'respond_pvp', { accept: true }).phase).toMatchObject({
    battle: { step: 'attacker_roll' },
  });
});

test('Squirtle’s Shell Guard is scoped to battle coin losses: unlike Price Shield it does not block a Pickpocket (C.4 D7; Gym coverage in gym.test.ts)', () => {
  const guarded = game('squirtle', 1);
  guarded.players[0]!.armedShield = { scope: 'battle_coin_loss', visibility: 'public' };
  guarded.players[1]!.items = [
    { instanceId: 'pick:1', itemId: 'pickpocket', name: 'Pickpocket', visibility: 'secret' },
  ];
  const picked = act(guarded, 'use_item', { itemInstanceId: 'pick:1', targetSeatIndex: 0 });
  expect(picked.players[0]!.coins).toBe(15);
  expect(picked.players[0]!.armedShield).toBeDefined();
});

test('an actually caught Dratini uses Dragon Rush, becomes Tired (not battle-ready, ×0.8 sale), then recovers by expiry, Nurse Joy, Chansey or Potion (§4.4, D13)', () => {
  let seed = 0;
  for (; ; seed++) {
    let rng = createRng(seed);
    const faces = [0, 0, 0].map(() => {
      const draw = d6(rng, 'x');
      rng = draw.rng;
      return draw.value;
    });
    // Catch roll ≥ 5 (DC 5, Poké Ball), then a PvP the Dratini side wins.
    if (faces[0]! >= 5 && faces[1]! + 5 > faces[2]! + 2) break;
  }
  const state = game('pikachu');
  state.config.seed = seed;
  state.rng = createRng(seed);
  state.phase = { kind: 'encounter', pokemon: { speciesId: 'dratini' } };
  const caught = advanceAutomatically(act(state, 'catch', { ballType: 'poke' })).state;
  const dratini = caught.players[0]!.team.find((pokemon) => pokemon.speciesId === 'dratini')!;
  caught.phase = { kind: 'strategy' };
  caught.players[0]!.team[0]!.abilityReady = false;
  let battle = act(caught, 'declare_pvp', { targetSeatIndex: 1 });
  battle = act(battle, 'respond_pvp', { accept: true });
  battle = act(battle, 'activate_ability', { instanceId: dratini.instanceId });
  battle = advanceAutomatically(advanceAutomatically(battle).state).state;
  const after = act(battle, 'choose_reward', { kind: 'coins' });
  const tired = after.players[0]!.team.find(
    (pokemon) => pokemon.instanceId === dratini.instanceId,
  )!;
  expect(tired).toMatchObject({ tired: true, tiredExpiresOwnTurnNo: 3 });
  const sell = structuredClone(after);
  sell.phase = { kind: 'sell', destinationPosition: 0 };
  expect(saleQuote(sell, 0, [dratini.instanceId]).total).toBe(Math.round(26 * 0.8));
  // Not battle-ready: Pikachu (2) now fights instead of the higher Dratini (3).
  const next = structuredClone(after);
  next.globalTurnNo = 7;
  next.turnBudgets = { tacticalAction: 1, catchAttempt: 1, pokemonAbility: 1 };
  const rematch = act(act(next, 'declare_pvp', { targetSeatIndex: 1 }), 'respond_pvp', {
    accept: true,
  });
  expect(rematch.phase).toMatchObject({
    battle: { snapshot: { attacker: { member: { speciesId: 'pikachu' } } } },
  });
  // Recovery: expiry at the end of the owner's next turn, or a Potion now.
  const owner = structuredClone(after.players[0]!);
  owner.ownTurnNo = 3;
  expect(expireStatuses(owner)).toEqual([expect.objectContaining({ operation: 'cleared' })]);
  const potion = structuredClone(after);
  potion.turnBudgets.tacticalAction = 1; // a later turn: the PvP spent this one
  potion.players[0]!.items = [
    { instanceId: 'potion:0', itemId: 'potion', name: 'Potion', visibility: 'secret' },
  ];
  const healed = act(potion, 'use_item', {
    itemInstanceId: 'potion:0',
    targetPokemonInstanceId: dratini.instanceId,
    status: 'tired',
  });
  expect(
    healed.players[0]!.team.find((entry) => entry.instanceId === dratini.instanceId)!.tired,
  ).toBe(false);
});
