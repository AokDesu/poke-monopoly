/// <reference types="vite/client" />
import { expect, test } from 'vitest';
import { parseContent, toEngineContent } from '../content/schema.ts';
import {
  actionVisibleTo,
  actionVisibleToSpectator,
  advanceAutomatically,
  applyAction,
  checkInvariants,
  createGame,
  createGameConfig,
  createGameLog,
  createRng,
  d6,
  eventsVisibleTo,
  legalActions,
  observe,
  observeSpectator,
  pendingDecision,
  replay,
  type Action,
  type ActionRecord,
  type GameState,
} from './index.ts';

const files = Object.fromEntries(
  Object.entries(
    import.meta.glob<unknown>('../content/*.json', { eager: true, import: 'default' }),
  ).map(([path, json]) => [path.split('/').at(-1)!.slice(0, -5), json]),
);
const content = toEngineContent(parseContent(files));

/** Seat 0 Fisherman (Magikarp) is in Strategy, with another human at seat 1 (§6.8). */
function game(seed: number): GameState {
  const state = createGame(
    createGameConfig({
      seats: ['fisherman', 'researcher', 'bug-catcher'].map((classId, seatIndex) => ({
        actorId: `p${seatIndex}`,
        seatIndex,
        classId,
        controller: seatIndex < 2 ? ('human' as const) : ('ai' as const),
      })),
      seed,
      lapTarget: 2,
    }),
    content,
  );
  state.phase = { kind: 'strategy' };
  state.globalTurnNo = 5;
  state.turnBudgets = { tacticalAction: 1, catchAttempt: 1, pokemonAbility: 1 };
  for (const player of state.players) player.ownTurnNo = 2;
  return state;
}

function seedFor(face: (value: number) => boolean): number {
  for (let seed = 0; ; seed++) if (face(d6(createRng(seed), 'x').value)) return seed;
}

function step(state: GameState, kind: Action['kind'], payload: unknown = {}) {
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
  return result;
}

test.each([
  [5, 1],
  [6, 1],
  [4, 0],
  [1, 0],
])(
  'Lucky Splash rolls a logged d6: %i gains %i Great Ball, told only to its owner; the costs stay spent (C.1 chanceBall, D10)',
  (face, gained) => {
    const state = game(seedFor((value) => value === face));
    const activated = step(state, 'activate_ability', { instanceId: 'starter:0' });
    expect(activated.state.phase.kind).toBe('chance_roll');
    expect(pendingDecision(activated.state)).toBeNull();
    const rolled = advanceAutomatically(activated.state);
    const after = rolled.state;
    expect(after.phase.kind).toBe('strategy');
    expect(after.players[0]!.balls).toEqual({ poke: 5, great: 1 + gained, ultra: 0 });
    expect(after.players[0]!.abilityUsedGlobalTurnNo).toBe(5);
    expect(after.players[0]!.team[0]!.abilityReady).toBe(false);
    const ownKinds = eventsVisibleTo(activated.state, rolled.events, 0).map((event) => event.kind);
    const otherKinds = eventsVisibleTo(activated.state, rolled.events, 1).map(
      (event) => event.kind,
    );
    expect(ownKinds.includes('ball_gained')).toBe(gained === 1);
    expect(otherKinds).not.toContain('ball_gained');
    const ownDie = eventsVisibleTo(activated.state, rolled.events, 0).find(
      (event) => event.kind === 'random_result' && event.purpose.endsWith(':chance'),
    );
    expect(ownDie).toMatchObject({ kind: 'random_result', result: face });
    expect(
      eventsVisibleTo(activated.state, rolled.events, 1).some(
        (event) => event.kind === 'random_result' && event.purpose.endsWith(':chance'),
      ),
    ).toBe(false);
    const dieRecord = rolled.records.find((record) => record.action.kind === 'dice_result')!;
    expect(dieRecord.action.payload).toEqual({
      purpose: expect.stringMatching(/:chance$/),
      value: face,
    });
    expect(actionVisibleTo(activated.state, dieRecord, 0, 0)!.action.payload).toEqual(
      dieRecord.action.payload,
    );
    expect(actionVisibleTo(activated.state, dieRecord, 1, 0)!.action.payload).not.toHaveProperty(
      'value',
    );
    expect(
      actionVisibleTo(activated.state, activated.record, 1, 0)!.events.map((event) => event.kind),
    ).toContain('ability_activated');
    // The same Lap and globalTurnNo offer no second activation.
    expect(legalActions(after, 0).enabled.map((choice) => choice.id)).not.toContain(
      'ability:starter:0',
    );
  },
);

test.each([
  { face: 2, shielded: false, cap: true },
  { face: 3, shielded: false, cap: false },
  { face: 4, shielded: true, cap: false },
])('Thunder Shock on $face (shielded: $shielded) applies cap: $cap', ({ face, shielded, cap }) => {
  const state = game(seedFor((value) => value === face));
  const user = state.players[0]!;
  user.team[0]!.speciesId = 'pikachu';
  const target = state.players[1]!;
  target.pendingSlows = ['repel'];
  if (shielded) target.armedShield = { scope: 'price', visibility: 'secret' };
  const log = createGameLog(state);
  const activated = step(state, 'activate_ability', {
    instanceId: user.team[0]!.instanceId,
    targetSeatIndex: target.seatIndex,
  });
  expect(activated.state.players[1]!.armedShield).toBeUndefined();
  expect(activated.state.players[0]!.team[0]!.abilityReady).toBe(false);
  expect(activated.events).toContainEqual(expect.objectContaining({ kind: 'attack_attempt' }));
  expect(activated.events.some((event) => event.kind === 'protection_applied')).toBe(shielded);
  expect(observe(activated.state, 2).public.phase).toEqual({
    kind: 'chance_roll',
    rollId: 'ability:1',
    seatIndex: 0,
    effect: { kind: 'thunder_shock' },
  });
  expect(observeSpectator(activated.state).public.phase).toEqual(
    observe(activated.state, 2).public.phase,
  );

  const rolled = advanceAutomatically(activated.state);
  expect(rolled.state.phase.kind).toBe('strategy');
  expect(rolled.state.players[1]!.pendingSlows).toEqual(
    cap ? ['repel', 'thunder_shock'] : ['repel'],
  );
  expect(
    actionVisibleTo(activated.state, rolled.records[0]!, 2, 1)!.action.payload,
  ).not.toHaveProperty('value');
  log.actions.push(activated.record, ...rolled.records);
  expect(replay(log)).toEqual(rolled.state);

  const moving = rolled.state;
  moving.activeSeatIndex = 1;
  moving.phase = { kind: 'move' };
  moving.rng = createRng(seedFor((value) => value === 6));
  moving.players[1]!.team[0]!.abilityReady = false;
  const moved = advanceAutomatically(step(moving, 'roll').state).state;
  expect(moved.players[1]!.routeProgress).toBe(cap ? 3 : 4);
  expect(moved.players[1]!.pendingSlows).toBeUndefined();
});

test('Thunder Shock cannot target a player with Sticky Web already pending (C.5 D8)', () => {
  const state = game(1);
  state.players[0]!.team[0]!.speciesId = 'pikachu';
  state.players[1]!.pendingSlows = ['sticky_web'];
  expect(legalActions(state, 0).disabled).toContainEqual(
    expect.objectContaining({ id: 'ability:starter:0:1', reasonCode: 'NO_VALID_TARGET' }),
  );
});

test.each([2, 3])('Scavenge awards one bank coin only on an even face (%i)', (face) => {
  const state = game(seedFor((value) => value === face));
  state.players[0]!.team[0]!.speciesId = 'rattata';
  const before = state.players[0]!.coins;
  const activated = step(state, 'activate_ability', { instanceId: 'starter:0' });
  const result = advanceAutomatically(activated.state);
  expect(result.state.players[0]!.coins).toBe(before + (face === 2 ? 1 : 0));
  expect(result.events.filter((event) => event.kind === 'coin_transfer')).toEqual(
    face === 2
      ? [
          {
            kind: 'coin_transfer',
            source: { kind: 'bank' },
            destination: { kind: 'player', actorId: 'p0' },
            amount: 1,
            reason: 'scavenge',
          },
        ]
      : [],
  );
});

function poison(): GameState {
  const state = game(seedFor((value) => value % 2 === 0));
  state.players[0]!.team[0]!.speciesId = 'weedle';
  const activated = step(state, 'activate_ability', {
    instanceId: 'starter:0',
    targetSeatIndex: 1,
    targetPokemonInstanceId: 'starter:1',
  });
  const bystander = actionVisibleTo(state, activated.record, 2, 0);
  expect(bystander?.action.payload).toEqual({ instanceId: 'starter:0' });
  expect(observeSpectator(activated.state).public.phase).not.toHaveProperty(
    'effect.targetPokemonInstanceId',
  );
  const rolled = advanceAutomatically(activated.state);
  expect(rolled.state.players[1]!.team[0]!.combatDebuffed).toBe(true);
  expect(observe(rolled.state, 1).own.combatDebuffedPokemonIds).toEqual(['starter:1']);
  expect(observe(rolled.state, 2).public.players[1]!.team[0]).not.toHaveProperty('combatDebuffed');
  expect(eventsVisibleTo(activated.state, rolled.events, 2)).toEqual([
    { kind: 'phase_changed', from: 'chance_roll', to: 'strategy' },
  ]);
  return rolled.state;
}

test('Poison Sting is spent by the selected combatant after the next PvP snapshot freezes', () => {
  const state = poison();
  const first = step(state, 'declare_pvp', { targetSeatIndex: 1 });
  const declined = step(first.state, 'respond_pvp', { accept: false }).state;
  expect(declined.players[1]!.team[0]!.combatDebuffed).toBe(true);
  declined.turnBudgets.tacticalAction = 1;
  const second = step(declined, 'declare_pvp', { targetSeatIndex: 1 });
  const accepted = step(second.state, 'respond_pvp', { accept: true });
  expect(accepted.state.phase).toMatchObject({
    kind: 'pvp',
    battle: { snapshot: { defender: { member: { instanceId: 'starter:1', debuffs: 1 } } } },
  });
  expect(accepted.state.players[1]!.team[0]!.combatDebuffed).toBeUndefined();
});

test('a Gym snapshot applies Poison Sting to the affected combatant and clears it', () => {
  const state = poison();
  state.activeSeatIndex = 1;
  state.phase = { kind: 'resolve' };
  state.players[1]!.routeProgress = 6;
  const gym = step(state, 'skip').state;
  const accepted = step(gym, 'challenge_gym');
  expect(accepted.state.phase).toMatchObject({
    kind: 'gym',
    battle: { snapshot: { challenger: { member: { debuffs: 1 } } } },
  });
  expect(accepted.state.players[1]!.team[0]!.combatDebuffed).toBeUndefined();
});

test('a second Poison Sting leaves one status and Potion clears it without clearing Tired', () => {
  const state = poison();
  state.globalTurnNo++;
  state.turnBudgets.pokemonAbility = 1;
  state.players[0]!.team[0]!.abilityReady = true;
  state.rng = createRng(seedFor((value) => value % 2 === 0));
  const activated = step(state, 'activate_ability', {
    instanceId: 'starter:0',
    targetSeatIndex: 1,
    targetPokemonInstanceId: 'starter:1',
  });
  const second = advanceAutomatically(activated.state);
  expect(second.events.some((event) => event.kind === 'status_changed')).toBe(false);
  const potionState = second.state;
  potionState.activeSeatIndex = 1;
  potionState.players[1]!.team[0]!.tired = true;
  const potion = potionState.players[1]!.items.find((item) => item.itemId === 'potion')!;
  const choices = legalActions(potionState, 1).enabled.filter(
    (choice) => choice.kind === 'use_item',
  );
  expect(choices.map((choice) => choice.payload)).toEqual([
    { itemInstanceId: potion.instanceId, targetPokemonInstanceId: 'starter:1', status: 'tired' },
    {
      itemInstanceId: potion.instanceId,
      targetPokemonInstanceId: 'starter:1',
      status: 'combat_debuff',
    },
  ]);
  const healed = step(potionState, 'use_item', choices[1]!.payload);
  expect(healed.state.players[1]!.team[0]).toMatchObject({ tired: true });
  expect(healed.state.players[1]!.team[0]!.combatDebuffed).toBeUndefined();
  expect(healed.state.players[1]!.items).toEqual([]);
  expect(healed.state.turnBudgets.tacticalAction).toBe(0);
  expect(healed.events).toContainEqual(
    expect.objectContaining({
      kind: 'status_changed',
      reason: 'potion',
      status: 'combat_debuff',
      operation: 'cleared',
    }),
  );
});

test.each([false, true])(
  'Confusion applies a logged replacement die after movement selection (fixed: %s)',
  (fixed) => {
    const state = game(seedFor((value) => value % 2 === 0));
    state.players[0]!.team[0]!.speciesId = 'psyduck';
    const activated = step(state, 'activate_ability', {
      instanceId: 'starter:0',
      targetSeatIndex: 1,
    });
    const moving = advanceAutomatically(activated.state).state;
    expect(moving.players[1]!.confused).toBe(true);
    moving.activeSeatIndex = 1;
    moving.globalTurnNo++;
    moving.turnBudgets.pokemonAbility = fixed ? 0 : 1;
    moving.phase = { kind: 'move' };
    if (fixed) moving.turnEffects = { fixedMove: 3 };
    const initial = step(moving, 'roll').state;
    const beforeForced = fixed ? initial : advanceAutomatically(initial).state;
    const forced = advanceAutomatically(beforeForced);
    const die = forced.records[0]!.action;
    if (die.kind !== 'dice_result') throw new Error('Expected Confusion replacement die');
    expect(die.payload.purpose).toMatch(/:confusion$/);
    if (fixed) {
      expect(forced.state.players[1]!.routeProgress).toBe(die.payload.value);
      expect(forced.state.players[1]!.confused).toBeUndefined();
    } else {
      expect(forced.state.phase).toMatchObject({ kind: 'move', rolled: die.payload.value });
      const rerolling = step(forced.state, 'activate_ability', { instanceId: 'starter:1' });
      const finished = advanceAutomatically(rerolling.state);
      expect(finished.records[0]!.action.payload).toMatchObject({
        purpose: expect.stringMatching(/:reroll$/),
        value: finished.state.players[1]!.routeProgress,
      });
      expect(finished.state.players[1]!.confused).toBeUndefined();
    }
  },
);

test.each([false, true])(
  'Pickpocket reaction belongs to Snorlax’s owner and protects private details (block: %s)',
  (block) => {
    const state = game(1);
    state.players[0]!.items = [
      {
        instanceId: 'secret-pickpocket',
        itemId: 'pickpocket',
        name: 'Pickpocket',
        visibility: 'secret',
      },
    ];
    state.players[1]!.team[0]!.speciesId = 'snorlax';
    const log = createGameLog(state);
    const started = step(state, 'use_item', {
      itemInstanceId: 'secret-pickpocket',
      targetSeatIndex: 1,
    });
    expect(pendingDecision(started.state)?.seatIndex).toBe(1);
    expect(observe(started.state, 1).own.pickpocketReaction).toBe(true);
    expect(observe(started.state, 2).own.pickpocketReaction).toBeUndefined();
    expect(actionVisibleToSpectator(state, started.record, 0)?.action.payload).toEqual({});
    const reaction = block
      ? step(started.state, 'activate_ability', { instanceId: 'starter:1' })
      : step(started.state, 'skip');
    log.actions.push(started.record, reaction.record);
    expect(replay(log)).toEqual(reaction.state);
    expect(reaction.state.pendingPickpocket).toBeUndefined();
    expect(reaction.state.players[1]!.coins).toBe(state.players[1]!.coins - (block ? 0 : 5));
    expect(reaction.state.players[0]!.items).toEqual([]);
    expect(reaction.state.turnBudgets.tacticalAction).toBe(0);
    if (block) {
      const seen = actionVisibleTo(started.state, reaction.record, 2, 1);
      expect(seen?.events).toEqual([
        expect.objectContaining({ kind: 'ability_activated', effect: 'block' }),
        { kind: 'block_triggered', ownerId: 'p1' },
      ]);
      expect(actionVisibleToSpectator(started.state, reaction.record, 1)?.events).toEqual(
        seen?.events,
      );
    } else {
      expect(actionVisibleTo(started.state, reaction.record, 2, 1)).toBeNull();
      expect(actionVisibleToSpectator(started.state, reaction.record, 1)).toBeNull();
      expect(observe(reaction.state, 2).public.stateRevision).toBe(1);
    }
  },
);

test('Track peeks the top Event card privately: a logged first shuffle fills the deck, nothing is drawn or reordered, and other seats see no card or order (§4.5 peek, §5.4)', () => {
  const initial = game(3);
  initial.players[0]!.team = [{ ...initial.players[0]!.team[0]!, speciesId: 'growlithe' }];
  expect(initial.eventDeck).toEqual({ drawPile: [], discardPile: [] });
  expect(initial.rng.cursor).toBe(0); // setup draws no RNG (§6.8)
  const log = createGameLog(structuredClone(initial));
  const peeked = step(initial, 'activate_ability', { instanceId: 'starter:0' });
  log.actions.push(peeked.record);
  const after = peeked.state;
  expect([...after.eventDeck.drawPile].sort()).toEqual(['e1', 'e2', 'e3', 'e4', 'e5', 'e6']);
  const top = after.eventDeck.drawPile[0]!;
  expect(after.players[0]!.privateResults).toEqual([{ kind: 'peek', eventId: top }]);
  expect(observe(after, 0).own.privateResults).toEqual([{ kind: 'peek', eventId: top }]);
  for (const seat of [1, 2]) {
    const seen = JSON.stringify([
      observe(after, seat),
      legalActions(after, seat),
      actionVisibleTo(initial, peeked.record as ActionRecord, seat, 0),
    ]);
    for (const card of after.eventDeck.drawPile) expect(seen).not.toContain(`"${card}"`);
  }
  expect(replay(JSON.parse(JSON.stringify(log)))).toEqual(after);

  // A later peek on a new Lap sees the same top card: peeking never draws or reorders.
  const later = structuredClone(after);
  later.globalTurnNo = 8;
  later.turnBudgets.pokemonAbility = 1;
  later.players[0]!.team[0]!.abilityReady = true;
  const again = step(later, 'activate_ability', { instanceId: 'starter:0' }).state;
  expect(again.eventDeck).toEqual(after.eventDeck);
  expect(again.players[0]!.privateResults.at(-1)).toEqual({ kind: 'peek', eventId: top });
});

test('an empty draw pile reshuffles the discard pile before a peek (§3.1, §4.6)', () => {
  const state = game(3);
  state.players[0]!.team = [{ ...state.players[0]!.team[0]!, speciesId: 'growlithe' }];
  state.eventDeck = { drawPile: [], discardPile: ['e2', 'e5'] };
  const after = step(state, 'activate_ability', { instanceId: 'starter:0' }).state;
  expect([...after.eventDeck.drawPile].sort()).toEqual(['e2', 'e5']);
  expect(after.eventDeck.discardPile).toEqual([]);
});

test('Confusion then Calculate: the first die is replaced by the mandatory Confusion die, Calculate then replaces that revealed die, and only the last one moves (C.3 move order)', () => {
  const state = game(seedFor((value) => value % 2 === 0));
  state.players[0]!.team[0]!.speciesId = 'psyduck';
  const confused = advanceAutomatically(
    step(state, 'activate_ability', { instanceId: 'starter:0', targetSeatIndex: 1 }).state,
  ).state;
  expect(confused.players[1]!.confused).toBe(true);
  confused.activeSeatIndex = 1;
  confused.globalTurnNo++;
  confused.turnBudgets = { tacticalAction: 1, catchAttempt: 1, pokemonAbility: 1 };
  confused.phase = { kind: 'move' };
  const startedAt = confused.players[1]!.routeProgress;

  const dice: { purpose: string; value: number }[] = [];
  let current = step(confused, 'roll').state;
  const drain = () => {
    const advanced = advanceAutomatically(current);
    for (const record of advanced.records) {
      if (record.action.kind === 'dice_result') {
        const { purpose, value } = record.action.payload as { purpose: string; value: number };
        dice.push({ purpose, value });
      }
    }
    current = advanced.state;
  };
  drain(); // the first die; Confusion then discards it and asks for a replacement
  drain(); // the Confusion die, which Calculate may now replace
  expect(dice.map((die) => die.purpose)).toEqual([
    expect.stringMatching(/^move:\d+:\d+$/),
    expect.stringMatching(/:confusion$/),
  ]);
  expect(current.phase).toMatchObject({ kind: 'move', rolled: dice.at(-1)!.value });
  expect(current.players[1]!.confused).toBe(true);
  expect(current.players[1]!.routeProgress).toBe(startedAt);

  current = step(current, 'activate_ability', { instanceId: 'starter:1' }).state;
  drain(); // Calculate's replacement die
  expect(dice.map((die) => die.purpose.split(':').at(-1))).toEqual([
    dice[0]!.purpose.split(':').at(-1),
    'confusion',
    'reroll',
  ]);
  expect(current.players[1]!.confused).toBeUndefined();
  expect(current.players[1]!.routeProgress - startedAt).toBe(dice.at(-1)!.value);
});

test('checkStatuses reports a combat debuff changed without its UID log, and Confusion cleared without its actual move (§8)', () => {
  // A real consumption: the confirmed PvP spends the debuff and logs it.
  const state = poison();
  const declared = step(state, 'declare_pvp', { targetSeatIndex: 1 }).state;
  const action = {
    actorId: pendingDecision(declared)!.actorId,
    kind: 'respond_pvp',
    payload: { accept: true },
    actionSeq: declared.stateRevision + 1,
    stateRevisionBefore: declared.stateRevision,
  } as Action;
  const result = applyAction(declared, action);
  if ('rejected' in result) throw new Error(result.reason);
  expect(checkInvariants(declared, action, result)).toEqual([]);
  const silent = structuredClone(result);
  silent.events = silent.events.filter((event) => event.kind !== 'status_changed');
  expect(
    checkInvariants(declared, action, silent).filter(
      (violation) => violation.invariant === 'tired-and-nurse-joy-useful',
    ),
  ).toEqual([
    expect.objectContaining({ message: expect.stringMatching(/Combat debuff change lacks/) }),
  ]);

  // Confusion lives until the target's own movement: ending a turn must not clear it.
  const confused = game(1);
  confused.phase = { kind: 'end' };
  confused.players[2]!.confused = true;
  const skip = {
    actorId: 'p0',
    kind: 'skip',
    payload: {},
    actionSeq: confused.stateRevision + 1,
    stateRevisionBefore: confused.stateRevision,
  } as Action;
  const ended = applyAction(confused, skip);
  if ('rejected' in ended) throw new Error(ended.reason);
  expect(ended.state.players[2]!.confused).toBe(true);
  expect(checkInvariants(confused, skip, ended)).toEqual([]);
  const cleared = structuredClone(ended);
  delete cleared.state.players[2]!.confused;
  expect(
    checkInvariants(confused, skip, cleared).map((violation) => violation.invariant),
  ).toContain('move-debuff-until-next-move');
});
