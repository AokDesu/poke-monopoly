/// <reference types="vite/client" />
import { expect, test } from 'vitest';
import { parseContent, toEngineContent } from '../content/schema.ts';
import {
  applyAction,
  checkInvariants,
  createGame,
  createGameConfig,
  eventsVisibleTo,
  legalActions,
  observe,
  pendingDecision,
  type Action,
  type GameState,
} from './index.ts';

const files = Object.fromEntries(
  Object.entries(
    import.meta.glob<unknown>('../content/*.json', { eager: true, import: 'default' }),
  ).map(([path, json]) => [path.split('/').at(-1)!.slice(0, -5), json]),
);
const content = toEngineContent(parseContent(files));

/** Seat 0 (human, Bulbasaur) in Social with the window open; seats 1 and 2 are AIs. */
function social(): GameState {
  const state = createGame(
    createGameConfig({
      seats: ['main-character', 'fisherman', 'bug-catcher'].map((classId, seatIndex) => ({
        actorId: `p${seatIndex}`,
        seatIndex,
        classId,
        ...(seatIndex === 0 ? { starterSpeciesId: 'bulbasaur' } : {}),
        controller: seatIndex === 0 ? ('human' as const) : ('ai' as const),
      })),
      seed: 4,
      lapTarget: 3,
      socialWindow: true,
    }),
    content,
  );
  state.phase = { kind: 'social' };
  state.globalTurnNo = 9;
  state.turnBudgets = { tacticalAction: 1, catchAttempt: 1, pokemonAbility: 1 };
  state.turnBudgets.socialInteraction = 1;
  for (const player of state.players) player.ownTurnNo = 3;
  state.players.forEach((player, index) => (player.routeProgress = index * 9));
  return state;
}

/** The deciding seat's command, numbered with the revision that seat observes (§4.8). */
function run(state: GameState, kind: Action['kind'], payload: unknown = {}) {
  const decider = pendingDecision(state)!;
  const revision = observe(state, decider.seatIndex).public.stateRevision;
  const action = {
    actorId: decider.actorId,
    kind,
    payload,
    actionSeq: revision + 1,
    stateRevisionBefore: revision,
  } as Action;
  const result = applyAction(state, action);
  if ('rejected' in result) throw new Error(`${kind} rejected: ${result.reason}`);
  expect(checkInvariants(state, action, result)).toEqual([]);
  return result;
}

/**
 * The same position twice, in Strategy: once after seat 0 skipped Social, once after it chatted
 * seat 1. Seat 2 is outside the chat. `prepare` applies the same setup to both.
 */
function pair(prepare: (state: GameState) => void): [GameState, GameState] {
  const base = social();
  const chatted = run(base, 'chat', { targetSeatIndex: 1, topic: 'truce' }).state;
  return [base, chatted].map((state) => {
    const next = structuredClone(state);
    next.phase = { kind: 'strategy' };
    prepare(next);
    return next;
  }) as [GameState, GameState];
}

/** Applies one command to both games; seat 2 must observe identical games and events. */
function both(games: [GameState, GameState], kind: Action['kind'], payload: unknown = {}) {
  const [left, right] = games.map((state) => ({ before: state, ...run(state, kind, payload) }));
  expect(right!.state.stateRevision).toBe(left!.state.stateRevision + 1);
  expect(observe(right!.state, 2)).toEqual(observe(left!.state, 2));
  expect(eventsVisibleTo(right!.before, right!.events, 2)).toEqual(
    eventsVisibleTo(left!.before, left!.events, 2),
  );
  return [left!, right!] as const;
}

const battleId = (state: GameState) =>
  state.phase.kind === 'pvp' || state.phase.kind === 'gym' ? state.phase.battle.battleId : null;

test('a PvP battle ID and its attack ID are unchanged by a chat seat 2 was not part of (§4.8, §6.3)', () => {
  const games = pair((state) => {
    for (const player of state.players) player.team[0]!.abilityReady = false;
  });
  expect(legalActions(games[1], 0).enabled.map((choice) => choice.id)).toContain('declare-pvp:2');
  const [left, right] = both(games, 'declare_pvp', { targetSeatIndex: 2 });
  expect(battleId(right.state)).toMatch(/^pvp:\d+$/);
  expect(battleId(right.state)).toBe(battleId(left.state));
  const attackIds = (state: GameState) =>
    observe(state, 2).public.attackHistory?.map((attempt) => attempt.attackId);
  expect(attackIds(right.state)).toEqual([battleId(right.state)]);
  expect(attackIds(right.state)).toEqual(attackIds(left.state));
  // The internal sequence counts every record, the chat included; no seat is shown it.
  expect(right.state.attackHistory![0]!.actionSeq).toBe(
    left.state.attackHistory![0]!.actionSeq + 1,
  );
  expect(JSON.stringify(observe(right.state, 2))).not.toContain('actionSeq');
});

test('a hostile Ability attack ID its target sees is unchanged by a chat it was not part of (§4.8, §6.3)', () => {
  const [left, right] = both(
    pair(() => {}),
    'activate_ability',
    {
      instanceId: 'starter:0',
      targetSeatIndex: 2,
    },
  );
  const attackId = (step: typeof left) =>
    eventsVisibleTo(step.before, step.events, 2).find((event) => event.kind === 'attack_attempt')
      ?.attackId;
  expect(attackId(right)).toMatch(/^ability:\d+$/);
  expect(attackId(right)).toBe(attackId(left));
});

test('a Lucky Splash roll ID is unchanged by a chat seat 2 was not part of (§4.8, §6.3)', () => {
  const [left, right] = both(
    pair((state) => {
      state.players[0]!.team[0]!.speciesId = 'magikarp';
    }),
    'activate_ability',
    { instanceId: 'starter:0' },
  );
  const rollId = (state: GameState) => {
    const { phase } = observe(state, 2).public;
    return phase.kind === 'chance_roll' ? phase.rollId : null;
  };
  expect(rollId(right.state)).toMatch(/^ability:\d+$/);
  expect(rollId(right.state)).toBe(rollId(left.state));
});

test('a Gym battle ID is unchanged by a chat seat 2 was not part of (§4.8, §6.3)', () => {
  const [left, right] = both(
    pair((state) => {
      state.phase = { kind: 'resolve' };
      state.players[0]!.routeProgress = 6;
    }),
    'skip',
  );
  expect(battleId(right.state)).toMatch(/^gym:\d+$/);
  expect(battleId(right.state)).toBe(battleId(left.state));
});
