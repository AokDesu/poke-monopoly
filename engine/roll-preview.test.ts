/// <reference types="vite/client" />
import { expect, test } from 'vitest';
import { parseContent, toEngineContent } from '../content/schema.ts';
import {
  advanceAutomatically,
  applyAction,
  createGame,
  createGameConfig,
  legalActions,
  pendingDecision,
  pendingDie,
  positionOf,
  type Action,
  type GameState,
} from './index.ts';

const files = Object.fromEntries(
  Object.entries(
    import.meta.glob<unknown>('../content/*.json', { eager: true, import: 'default' }),
  ).map(([path, json]) => [path.split('/').at(-1)!.slice(0, -5), json]),
);
const content = toEngineContent(parseContent(files));

/** Seat 0 holds Porygon (Calculate, Appendix C.6) and is active; seats 1 and 2 hold Pikachu. */
function game(): GameState {
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
    content,
  );
  state.activeSeatIndex = 0;
  state.globalTurnNo = 6;
  state.turnBudgets = { tacticalAction: 1, catchAttempt: 1, pokemonAbility: 1 };
  state.players.forEach((player, seat) => {
    player.ownTurnNo = 2;
    player.team = [
      { ...player.team[0]!, speciesId: seat === 0 ? 'porygon' : 'pikachu', abilityReady: true },
    ];
  });
  return state;
}

function act(state: GameState, kind: Action['kind'], payload: unknown = {}): GameState {
  const result = applyAction(state, {
    actorId: pendingDecision(state)!.actorId,
    kind,
    payload,
    actionSeq: state.stateRevision + 1,
    stateRevisionBefore: state.stateRevision,
  } as Action);
  if ('rejected' in result) throw new Error(`Unexpected rejection: ${result.reason}`);
  return result.state;
}

const keepDie = (state: GameState) => {
  const keep = legalActions(state, 0).enabled.find((action) => action.id === 'keep-die')!;
  return act(state, keep.kind, keep.payload);
};

test('a move window names the die and the square the kept die lands on (§4.2, Appendix C.6)', () => {
  const state = game();
  state.players[0]!.routeProgress = 22;
  state.phase = { kind: 'move', rolled: 5 };
  expect(pendingDie(state, 0)).toEqual({
    kind: 'move',
    die: 5,
    steps: 5,
    destination: positionOf(27),
  });
  // Another seat has no window, and reading it spends nothing.
  expect(pendingDie(state, 1)).toBeUndefined();
  const kept = keepDie(state);
  expect(positionOf(kept.players[0]!.routeProgress)).toBe(3);
});

test('a move window counts pending slows in its landing square without clearing them (§4.6)', () => {
  const state = game();
  state.players[0]!.routeProgress = 4;
  state.players[0]!.pendingSlows = ['repel'];
  state.phase = { kind: 'move', rolled: 5 };
  expect(pendingDie(state, 0)).toMatchObject({ die: 5, steps: 3, destination: 7 });
  expect(state.players[0]!.pendingSlows).toEqual(['repel']);
  expect(keepDie(state).players[0]!.routeProgress).toBe(7);
});

test('a catch window gives the die, the total against the DC and whether the kept die catches (§4.3)', () => {
  const reach = (face: number) => {
    const state = game();
    state.phase = { kind: 'encounter', pokemon: { speciesId: 'machop' } };
    const thrown = advanceAutomatically(act(state, 'catch', { ballType: 'poke' })).state;
    if (thrown.phase.kind !== 'encounter') throw new Error('no catch window');
    thrown.phase.face = face;
    return thrown;
  };
  const low = pendingDie(reach(1), 0);
  const high = pendingDie(reach(6), 0);
  expect(low).toMatchObject({ kind: 'catch', die: 1 });
  expect(high).toMatchObject({ kind: 'catch', die: 6 });
  if (low?.kind !== 'catch' || high?.kind !== 'catch') throw new Error('expected catch windows');
  expect(high.total - low.total).toBe(5);
  expect(high.dc).toBe(low.dc);
  expect(high.succeeds).toBe(high.total >= high.dc);
  // The preview agrees with the engine once the die is kept.
  const caught = keepDie(reach(6)).players[0]!.team.length > 1;
  expect(caught).toBe(high.succeeds);
  const missed = keepDie(reach(1)).players[0]!.team.length > 1;
  expect(missed).toBe(low.succeeds);
});

test('no window is open outside a reroll', () => {
  const state = game();
  state.phase = { kind: 'move' };
  expect(pendingDie(state, 0)).toBeUndefined();
});
