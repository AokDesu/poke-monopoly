/// <reference types="vite/client" />
import { expect, test } from 'vitest';
import { parseContent, toEngineContent } from '../content/schema.ts';
import {
  advanceAutomatically,
  applyAction,
  checkInvariants,
  createGame,
  createGameConfig,
  createRng,
  d6,
  gymOdds,
  legalActions,
  pendingDecision,
  winner,
  type Action,
  type EngineEvent,
  type GameState,
} from './index.ts';

const files = Object.fromEntries(
  Object.entries(
    import.meta.glob<unknown>('../content/*.json', { eager: true, import: 'default' }),
  ).map(([path, json]) => [path.split('/').at(-1)!.slice(0, -5), json]),
);
const content = toEngineContent(parseContent(files));

/** Seat 0 (`classId`) is in Resolve on the Gym at `position`, with one member of `speciesId`. */
function atGym(position: 6 | 12 | 18, speciesId = 'gyarados', classId = 'fisherman'): GameState {
  const state = createGame(
    createGameConfig({
      seats: [classId, 'bug-catcher'].map((id, seatIndex) => ({
        actorId: `p${seatIndex}`,
        seatIndex,
        classId: id,
        controller: 'ai' as const,
      })),
      seed: 1,
      lapTarget: 2,
    }),
    content,
  );
  state.phase = { kind: 'resolve' };
  state.globalTurnNo = 3;
  state.turnBudgets = { tacticalAction: 1, catchAttempt: 1, pokemonAbility: 1 };
  state.players[0]!.ownTurnNo = 2;
  state.players[0]!.routeProgress = position;
  state.players[0]!.team[0]!.speciesId = speciesId;
  return state;
}

/** Make the next engine d6 show `face`; the Gym die is the first draw after entry. */
function rig(state: GameState, face: number): GameState {
  for (let seed = 0; seed < 200; seed++) {
    const rng = createRng(seed);
    if (d6(rng, 'gym').value === face) {
      state.rng = rng;
      return state;
    }
  }
  throw new Error('No seed for face');
}

function accept(state: GameState, kind: Action['kind'], payload: unknown = {}) {
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

/** Land, challenge and roll; returns the state after the die and every event on the way. */
function challenge(state: GameState, face: number) {
  const landed = accept(state, 'skip');
  expect(landed.state.phase).toMatchObject({ kind: 'gym', battle: { step: 'entry' } });
  const confirmed = accept(landed.state, 'challenge_gym');
  const rolled = advanceAutomatically(rig(confirmed.state, face));
  return {
    state: rolled.state,
    events: [...landed.events, ...confirmed.events, ...rolled.events] as EngineEvent[],
  };
}

const kinds = (events: EngineEvent[]) => events.map((event) => event.kind);

test.each([
  [6, 'magikarp', 5, 'win'],
  [6, 'magikarp', 4, 'loss'],
  [12, 'gyarados', 2, 'win'],
  [12, 'gyarados', 1, 'loss'],
  [18, 'gyarados', 4, 'win'],
  [18, 'gyarados', 3, 'loss'],
] as const)(
  'Gym %i with %s rolling %i is a %s: DC 5/7/9 in space order, equality wins (§4.4, D5)',
  (position, speciesId, face, outcome) => {
    const { state, events } = challenge(atGym(position, speciesId), face);
    expect(events).toContainEqual(
      expect.objectContaining({
        kind: 'gym_resolved',
        outcome,
        dc: { 6: 5, 12: 7, 18: 9 }[position],
      }),
    );
    if (outcome === 'win') {
      // Exactly one badge, granted before the reward choice opens.
      expect(state.players[0]!.badges).toBe(1);
      expect(kinds(events).indexOf('badge_awarded')).toBeGreaterThan(
        kinds(events).indexOf('gym_resolved'),
      );
      expect(pendingDecision(state)?.seatIndex).toBe(0);
      expect(state.phase).toMatchObject({ kind: 'gym', battle: { step: 'reward' } });
    } else {
      expect(state.players[0]!.badges).toBe(0);
      expect(state.players[0]!.coins).toBe(17);
      expect(state.phase.kind).toBe('end');
    }
  },
);

test('a Gym win pays 6 coins from the bank or evolves one stage, never both (§4.4 Battle Reward)', () => {
  const coins = accept(challenge(atGym(6, 'magikarp'), 6).state, 'choose_reward', {
    kind: 'coins',
  });
  expect(coins.state.players[0]!.coins).toBe(26);
  expect(coins.events).toContainEqual(
    expect.objectContaining({ kind: 'coin_transfer', source: { kind: 'bank' }, amount: 6 }),
  );
  expect(coins.state.phase.kind).toBe('end');

  const evolve = accept(challenge(atGym(6, 'magikarp'), 6).state, 'choose_reward', {
    kind: 'evolve',
    instanceId: 'starter:0',
    nextFormId: 'gyarados',
  });
  expect(evolve.state.players[0]!.coins).toBe(20);
  expect(evolve.state.players[0]!.team[0]!.speciesId).toBe('gyarados');
  expect(kinds(evolve.events)).not.toContain('coin_transfer');
});

test('a Gym loss pays min(3, coins) to the bank: low and zero coins (§4.4)', () => {
  const low = atGym(18, 'magikarp');
  low.players[0]!.coins = 2;
  const lowLoss = challenge(low, 1);
  expect(lowLoss.state.players[0]!.coins).toBe(0);
  expect(lowLoss.events).toContainEqual(
    expect.objectContaining({ kind: 'coin_transfer', destination: { kind: 'bank' }, amount: 2 }),
  );

  const broke = atGym(18, 'magikarp');
  broke.players[0]!.coins = 0;
  const brokeLoss = challenge(broke, 1);
  expect(brokeLoss.state.players[0]!.coins).toBe(0);
  expect(kinds(brokeLoss.events)).not.toContain('coin_transfer');
});

test('only a battle-scoped shield covers a Gym loss; Price Shield and Nurse Joy do not (C.4 D6/D7)', () => {
  const shell = atGym(18, 'magikarp');
  shell.players[0]!.armedShield = { scope: 'battle_coin_loss', visibility: 'public' };
  const guarded = challenge(shell, 1);
  expect(guarded.state.players[0]!.coins).toBe(20);
  expect(guarded.state.players[0]!.armedShield).toBeUndefined();
  expect(guarded.events).toContainEqual(
    expect.objectContaining({ kind: 'protection_applied', source: 'gym_coin_loss' }),
  );

  const price = atGym(18, 'magikarp');
  price.players[0]!.armedShield = { scope: 'price', visibility: 'secret' };
  const priced = challenge(price, 1);
  expect(priced.state.players[0]!.coins).toBe(17);
  expect(priced.state.players[0]!.armedShield).toBeDefined();

  const joy = challenge(atGym(18, 'chansey', 'nurse-joy'), 1);
  expect(joy.state.players[0]!.coins).toBe(17);
});

test('an armed Block does not stop a Gym coin loss and is not used up by it (C.4, C.2 Block)', () => {
  const block = atGym(18, 'magikarp');
  block.players[0]!.armedShield = { scope: 'pvp_pickpocket', visibility: 'public' };
  const lost = challenge(block, 1);
  expect(lost.state.players[0]!.coins).toBe(17);
  expect(lost.state.players[0]!.armedShield).toEqual({
    scope: 'pvp_pickpocket',
    visibility: 'public',
  });
  expect(kinds(lost.events)).not.toContain('protection_applied');
  expect(kinds(lost.events)).not.toContain('block_triggered');
});

test("Rival's +1 never applies at a Gym; the shared odds agree with the real resolver (D14, §3 odds)", () => {
  const rival = atGym(12, 'eevee', 'rival');
  rival.players[0]!.team[0]!.abilityReady = false; // no Adaptability window
  const landed = accept(rival, 'skip').state;
  const confirmed = accept(landed, 'challenge_gym');
  const event = confirmed.events.find((entry) => entry.kind === 'gym_confirmed')!;
  if (event.kind !== 'gym_confirmed') throw new Error('unreachable');
  expect(event.snapshot.challenger.classBonus).toBe(0);
  // Eevee battle 2 against DC 7 wins on 5–6.
  expect(gymOdds(event.snapshot).win.outcomes).toBe(2);
});

test('without a battle-ready Pokémon only skip is legal and is applied automatically (D5 step 1)', () => {
  const state = atGym(6);
  state.players[0]!.team[0]!.tired = true;
  const entry = accept(state, 'skip').state;
  const choices = legalActions(entry, 0);
  expect(choices.enabled.map((choice) => choice.id)).toEqual(['skip']);
  expect(choices.disabled).toContainEqual(
    expect.objectContaining({ id: 'challenge-gym', reasonText: 'No battle-ready Pokémon' }),
  );
  expect(advanceAutomatically(entry).state.phase.kind).toBe('end');
});

test('a Gym can be re-challenged on a later landing; there is no cleared-Gym state (§4.4)', () => {
  const won = accept(challenge(atGym(6, 'magikarp'), 6).state, 'choose_reward', { kind: 'coins' });
  const again = structuredClone(won.state);
  again.phase = { kind: 'resolve' };
  const second = accept(challenge(again, 6).state, 'choose_reward', { kind: 'coins' });
  expect(second.state.players[0]!.badges).toBe(2);
  expect(second.state.players[0]!.coins).toBe(32);
});

test('badges only break coin ties and are never converted to coins (§4.4, §4.7)', () => {
  const won = accept(challenge(atGym(6, 'magikarp'), 6).state, 'choose_reward', {
    kind: 'evolve',
    instanceId: 'starter:0',
    nextFormId: 'gyarados',
  }).state;
  expect(won.players.map((player) => [player.coins, player.badges])).toEqual([
    [20, 1],
    [20, 0],
  ]);
  expect(winner(won)).toEqual({ winners: ['p0'], reason: 'badges' });
  won.players[1]!.coins = 21;
  expect(winner(won)).toEqual({ winners: ['p1'], reason: 'coins' });
});

test('a Gym reached after a Start-crossing Sell uses the team that Sell left, including a Rescue Starter (§4.7, D5)', () => {
  const state = atGym(6, 'magikarp');
  state.phase = { kind: 'sell', destinationPosition: 6 };
  const sold = accept(state, 'sell', { pokemonInstanceIds: ['starter:0'] }).state;
  expect(sold.phase.kind).toBe('resolve');
  const rescue = sold.players[0]!.team;
  expect(rescue).toHaveLength(1);
  expect(rescue[0]!.origin).toBe('rescue_starter');
  const entry = accept(sold, 'skip').state;
  const confirmed = accept(entry, 'challenge_gym');
  expect(confirmed.events).toContainEqual(
    expect.objectContaining({
      kind: 'gym_confirmed',
      snapshot: expect.objectContaining({
        challenger: expect.objectContaining({
          member: expect.objectContaining({ instanceId: rescue[0]!.instanceId }),
        }),
      }),
    }),
  );
});
