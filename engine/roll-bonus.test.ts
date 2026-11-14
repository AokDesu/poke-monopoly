/// <reference types="vite/client" />
import { expect, test } from 'vitest';
import { parseContent, toEngineContent } from '../content/schema.ts';
import {
  advanceAutomatically,
  applyAction,
  catchOdds,
  checkInvariants,
  createGame,
  createGameConfig,
  createGameLog,
  createRng,
  d6,
  gymOdds,
  legalActions,
  pendingDecision,
  pvpOdds,
  replay,
  type Action,
  type EngineEvent,
  type GameLog,
  type GameState,
} from './index.ts';

const files = Object.fromEntries(
  Object.entries(
    import.meta.glob<unknown>('../content/*.json', { eager: true, import: 'default' }),
  ).map(([path, json]) => [path.split('/').at(-1)!.slice(0, -5), json]),
);
const content = toEngineContent(parseContent(files));

function game(classes: string[], starters: Record<number, string> = {}): GameState {
  const state = createGame(
    createGameConfig({
      seats: classes.map((classId, seatIndex) => ({
        actorId: `p${seatIndex + 1}`,
        seatIndex,
        classId,
        ...(starters[seatIndex] ? { starterSpeciesId: starters[seatIndex] } : {}),
        controller: 'ai' as const,
      })),
      seed: 1,
      lapTarget: 2,
    }),
    content,
  );
  state.phase = { kind: 'strategy' };
  state.globalTurnNo = 7;
  state.turnBudgets = { tacticalAction: 1, catchAttempt: 1, pokemonAbility: 1 };
  for (const player of state.players) player.ownTurnNo = 3;
  return state;
}

/** The next engine d6 draws show `faces`, in order. */
function rig(state: GameState, ...faces: number[]): GameState {
  for (let seed = 0; seed < 20_000; seed++) {
    let rng = createRng(seed);
    const ok = faces.every((face) => {
      const draw = d6(rng, 'rig');
      rng = draw.rng;
      return draw.value === face;
    });
    if (ok) {
      // The log header's seed must produce the initial RNG (§6.8).
      state.config.seed = seed;
      state.rng = createRng(seed);
      return state;
    }
  }
  throw new Error('No seed for faces');
}

/** Records every accepted step so the log can be replayed at any point. */
class Play {
  readonly log: GameLog;
  state: GameState;
  readonly events: EngineEvent[] = [];
  constructor(initial: GameState) {
    this.state = initial;
    this.log = createGameLog(structuredClone(initial));
  }
  act(kind: Action['kind'], payload: unknown = {}) {
    const action = {
      actorId: pendingDecision(this.state)!.actorId,
      kind,
      payload,
      actionSeq: this.state.stateRevision + 1,
      stateRevisionBefore: this.state.stateRevision,
    } as Action;
    const result = applyAction(this.state, action);
    if ('rejected' in result) throw new Error(`Unexpected rejection: ${result.reason}`);
    expect(checkInvariants(this.state, action, result)).toEqual([]);
    this.log.actions.push(result.record);
    this.events.push(...result.events);
    this.state = result.state;
    return this;
  }
  /** Engine dice until a player decision is pending. */
  roll() {
    for (;;) {
      const step = advanceAutomatically(this.state);
      if (!step.records.length || !step.records[0]!.action.kind.startsWith('dice')) return this;
      this.log.actions.push(...step.records);
      this.events.push(...step.events);
      this.state = step.state;
    }
  }
  choices(seat = pendingDecision(this.state)!.seatIndex) {
    return legalActions(this.state, seat).enabled.map((choice) => choice.id);
  }
}

test('AC-1: Blaze in the attacker window, Adaptability seen and answered in the defender window; odds 10/5/21 of 36; only the defender allowance is spent (§4.4, C.3, C.8)', () => {
  const state = game(['main-character', 'rival'], { 0: 'charmander' });
  state.players[1]!.coins = 9;
  const play = new Play(rig(state, 6, 3));
  play.act('declare_pvp', { targetSeatIndex: 1 }).act('respond_pvp', { accept: true });
  expect(play.choices()).toEqual(['ability:starter:0', 'pass-window']);
  play.act('activate_ability', { instanceId: 'starter:0' });
  expect(pendingDecision(play.state)?.seatIndex).toBe(1);
  expect(play.choices()).toEqual([
    'ability:starter:1:catch',
    'ability:starter:1:combat',
    'pass-window',
  ]);
  play.act('activate_ability', { instanceId: 'starter:1', scope: 'combat' });
  const confirmed = play.events.find((event) => event.kind === 'pvp_confirmed')!;
  if (confirmed.kind !== 'pvp_confirmed') throw new Error('unreachable');
  const odds = pvpOdds(confirmed.snapshot);
  expect([odds.win.outcomes, odds.tie.outcomes, odds.loss.outcomes]).toEqual([10, 5, 21]);
  expect(play.state.turnBudgets).toEqual({ tacticalAction: 0, catchAttempt: 1, pokemonAbility: 0 });
  expect(play.state.players.map((player) => player.abilityUsedGlobalTurnNo)).toEqual([7, 7]);
  // No die was drawn before both windows closed.
  expect(play.events.findIndex((event) => event.kind === 'random_result')).toBe(-1);
  play.roll();
  expect(play.events).toContainEqual(
    expect.objectContaining({ kind: 'pvp_resolved', attackerTotal: 9, defenderTotal: 7 }),
  );
  play.act('choose_reward', { kind: 'evolve', instanceId: 'starter:0', nextFormId: 'charmeleon' });
  expect(play.state.players[0]!.team[0]).toMatchObject({
    speciesId: 'charmeleon',
    abilityReady: false,
  });
  // Back in Strategy the turn-7 allowance is spent: no Ability, no second PvP.
  expect(play.choices()).toEqual(['skip']);
  expect(replay(JSON.parse(JSON.stringify(play.log)))).toEqual(play.state);
});

test('Adaptability (catch) raises the real catch roll and the odds API by the same +1 for this globalTurnNo (§4.3, D2)', () => {
  const state = game(['rival', 'fisherman']);
  state.phase = { kind: 'encounter', pokemon: { speciesId: 'machop' } };
  rig(state, 2); // DC 3: a 2 fails without the bonus
  expect(catchOdds(state, 0, 'poke').successFaces).toBe(4);
  const play = new Play(state);
  expect(play.choices()).toContain('ability:starter:0:catch');
  play.act('activate_ability', { instanceId: 'starter:0', scope: 'catch' });
  expect(catchOdds(play.state, 0, 'poke').successFaces).toBe(5);
  play.act('catch', { ballType: 'poke' }).roll();
  expect(play.state.players[0]!.team).toHaveLength(2);
});

test('AC-5: Dragon Rush at a Gym adds +2 (5/6 odds), and after the win and evolution its UID becomes Tired, losing readiness and sale value (§4.4, D5, D13)', () => {
  const state = game(['main-character', 'fisherman'], { 0: 'bulbasaur' });
  state.players[0]!.team.push({
    instanceId: 'caught:0:1',
    speciesId: 'dratini',
    origin: 'caught',
    evolutionStage: 0,
    tired: false,
    abilityReady: true,
  });
  state.players[0]!.team[0]!.abilityReady = false;
  state.phase = { kind: 'resolve' };
  state.players[0]!.routeProgress = 12;
  const play = new Play(rig(state, 4));
  play.act('skip').act('challenge_gym');
  expect(play.choices()).toEqual(['ability:caught:0:1', 'pass-window']);
  play.act('activate_ability', { instanceId: 'caught:0:1' });
  const confirmed = play.events.find((event) => event.kind === 'gym_confirmed')!;
  if (confirmed.kind !== 'gym_confirmed') throw new Error('unreachable');
  expect(gymOdds(confirmed.snapshot).win.outcomes).toBe(5);
  play.roll();
  expect(play.state.players[0]!.badges).toBe(1);
  play.act('choose_reward', { kind: 'evolve', instanceId: 'caught:0:1', nextFormId: 'dragonair' });
  const kinds = play.events.map((event) => event.kind);
  expect(kinds.indexOf('status_changed')).toBeGreaterThan(kinds.indexOf('battle_reward_resolved'));
  expect(play.state.players[0]!.team[1]).toMatchObject({
    speciesId: 'dragonair',
    tired: true,
    tiredExpiresOwnTurnNo: 4,
  });
  expect(play.state.phase.kind).toBe('end');
});

test('Dragon Rush in PvP tires its source after a tie too, attacker first (D13)', () => {
  const state = game(['fisherman', 'bug-catcher']);
  state.players[0]!.team[0] = { ...state.players[0]!.team[0]!, speciesId: 'dratini' };
  state.players[1]!.team[0] = { ...state.players[1]!.team[0]!, speciesId: 'scyther' };
  // Dratini 3 + 2 + face 3 against Scyther 4 + face 4 (Quick Slash is unbound): a tie.
  const play = new Play(rig(state, 3, 4));
  play.act('declare_pvp', { targetSeatIndex: 1 }).act('respond_pvp', { accept: true });
  play.act('activate_ability', { instanceId: 'starter:0' }).roll();
  expect(play.events).toContainEqual(expect.objectContaining({ outcome: 'tie' }));
  expect(play.state.phase.kind).toBe('strategy');
  expect(play.state.players[0]!.team[0]!.tired).toBe(true);
});

test('Intimidate is hostile even for a defender: it records an attack on the challenger and debuffs that snapshot; a Price Shield blocks it whole (D2, D6)', () => {
  const setup = (shielded: boolean) => {
    const state = game(['fisherman', 'bug-catcher']);
    state.players[1]!.team[0] = { ...state.players[1]!.team[0]!, speciesId: 'gyarados' };
    if (shielded) state.players[0]!.armedShield = { scope: 'price', visibility: 'secret' };
    const play = new Play(state);
    play.act('declare_pvp', { targetSeatIndex: 1 }).act('respond_pvp', { accept: true });
    expect(play.choices()).toEqual(['ability:starter:1:0', 'pass-window']);
    return play.act('activate_ability', { instanceId: 'starter:1', targetSeatIndex: 0 });
  };
  const open = setup(false);
  expect(open.state.attackHistory?.at(-1)).toMatchObject({
    actorId: 'p2',
    targetId: 'p1',
    source: 'hostile_ability',
  });
  expect(open.state.phase).toMatchObject({ battle: { snapshot: { attacker: { debuffs: 1 } } } });
  const blocked = setup(true);
  expect(blocked.state.players[0]!.armedShield).toBeUndefined();
  expect(blocked.state.phase).toMatchObject({ battle: { snapshot: { attacker: { debuffs: 0 } } } });
  expect(blocked.state.players[1]!.abilityUsedGlobalTurnNo).toBe(7); // cost stays spent (D10)
});

test('AC-3: Porygon rerolls a failed catch die once; the new die decides, no second Ball is spent, and a worse die stays (D11)', () => {
  const attempt = (faces: number[]) => {
    const state = game(['researcher', 'fisherman']);
    state.phase = { kind: 'encounter', pokemon: { speciesId: 'machop' } };
    const play = new Play(rig(state, ...faces));
    play.act('catch', { ballType: 'poke' }).roll();
    expect(play.choices()).toEqual(['ability:starter:0', 'keep-die']);
    expect(play.state.players[0]!.team).toHaveLength(1); // nothing resolved before the decision
    play.act('activate_ability', { instanceId: 'starter:0' }).roll();
    expect(play.state.players[0]!.balls.poke).toBe(4);
    expect(play.state.players[0]!.abilityUsedGlobalTurnNo).toBe(7);
    expect(replay(JSON.parse(JSON.stringify(play.log)))).toEqual(play.state);
    return play.state;
  };
  expect(attempt([2, 5]).players[0]!.team).toHaveLength(2);
  expect(attempt([2, 1]).players[0]!.team).toHaveLength(1);
});

test('no A window opens once the turn’s allowance is spent, and keeping the die applies it unchanged (AC-3 variant, D11)', () => {
  const spent = game(['researcher', 'fisherman']);
  spent.phase = { kind: 'encounter', pokemon: { speciesId: 'machop' } };
  spent.players[0]!.abilityUsedGlobalTurnNo = 7;
  const auto = new Play(rig(spent, 2)).act('catch', { ballType: 'poke' }).roll();
  expect(auto.state.phase.kind).toBe('end');

  const keep = game(['researcher', 'fisherman']);
  keep.phase = { kind: 'encounter', pokemon: { speciesId: 'machop' } };
  const kept = new Play(rig(keep, 4)).act('catch', { ballType: 'poke' }).roll().act('skip');
  expect(kept.state.players[0]!.team).toHaveLength(2);
  expect(kept.state.players[0]!.abilityUsedGlobalTurnNo).toBeNull();
});

test('in PvP the challenger rerolls first and the defender second, each seeing both dice; no result applies before (D4 step 9)', () => {
  const state = game(['researcher', 'fisherman']);
  state.players[1]!.team.push({
    instanceId: 'caught:1:1',
    speciesId: 'porygon',
    origin: 'caught',
    evolutionStage: 0,
    tired: false,
    abilityReady: true,
  });
  const play = new Play(rig(state, 1, 6, 6, 1));
  play.act('declare_pvp', { targetSeatIndex: 1 }).act('respond_pvp', { accept: true }).roll();
  expect(pendingDecision(play.state)?.seatIndex).toBe(0);
  expect(play.state.phase).toMatchObject({
    battle: { step: 'reroll', attackerFace: 1, defenderFace: 6 },
  });
  play.act('activate_ability', { instanceId: 'starter:0' }).roll();
  expect(pendingDecision(play.state)?.seatIndex).toBe(1);
  expect(play.state.phase).toMatchObject({
    battle: { side: 'defender', attackerFace: 6, defenderFace: 6 },
  });
  expect(play.events.some((event) => event.kind === 'pvp_resolved')).toBe(false);
  play.act('activate_ability', { instanceId: 'caught:1:1' }).roll();
  expect(play.events).toContainEqual(
    expect.objectContaining({ kind: 'pvp_resolved', attackerFace: 6, defenderFace: 1 }),
  );
  expect(replay(JSON.parse(JSON.stringify(play.log)))).toEqual(play.state);
});

test('Porygon may reroll its own Gym and move dice; pending slows apply to the final move value (C.3, D8, D11)', () => {
  const gym = game(['researcher', 'fisherman']);
  gym.phase = { kind: 'resolve' };
  gym.players[0]!.routeProgress = 6;
  const atGym = new Play(rig(gym, 1, 5)).act('skip').act('challenge_gym').roll();
  expect(atGym.choices()).toEqual(['ability:starter:0', 'keep-die']);
  atGym.act('activate_ability', { instanceId: 'starter:0' }).roll();
  expect(atGym.events).toContainEqual(expect.objectContaining({ kind: 'gym_resolved', face: 5 }));

  const move = game(['researcher', 'fisherman']);
  move.phase = { kind: 'move' };
  move.players[0]!.routeProgress = 1;
  move.players[0]!.pendingSlows = ['repel'];
  const moved = new Play(rig(move, 2, 6)).act('roll').roll();
  expect(moved.choices()).toEqual(['ability:starter:0', 'keep-die']);
  moved.act('activate_ability', { instanceId: 'starter:0' }).roll();
  expect(moved.state.players[0]!.routeProgress).toBe(5); // max(1, 6 − 2)
  expect(moved.state.players[0]!.pendingSlows).toBeUndefined();
});

test('no modifier can be added after a die is revealed except the reroll (§4.4)', () => {
  const state = game(['main-character', 'researcher'], { 0: 'charmander' });
  const play = new Play(state);
  play.act('declare_pvp', { targetSeatIndex: 1 }).act('respond_pvp', { accept: true });
  play.act('skip').roll();
  // Only Porygon's own reroll window remains; Blaze is no longer offered.
  expect(play.choices()).toEqual(['ability:starter:1', 'keep-die']);
  expect(pendingDecision(play.state)?.seatIndex).toBe(1);
});
