import { expect, test } from 'vitest';
import {
  createGame,
  createGameConfig,
  createGameLog,
  type GameState,
} from '../../../engine/index.ts';
import { engineContent } from './content.ts';
import { createGameStore, type GameStore, type Person } from './store.ts';

/**
 * Spec §3, §4.1 (local multiplayer, M2): the store's viewing seat is the person who currently
 * holds the device. Seats 0 and 1 are people (Ton, Mai); seat 2, when present, is an AI.
 */

const PEOPLE: readonly Person[] = [
  { seatIndex: 0, name: 'Ton' },
  { seatIndex: 1, name: 'Mai' },
];
const CLASSES = ['main-character', 'researcher', 'fisherman'];

function table(humans: number, seats = 3): { store: GameStore; state: GameState } {
  const state = createGame(
    createGameConfig({
      seats: CLASSES.slice(0, seats).map((classId, seatIndex) => ({
        actorId: `p${seatIndex}`,
        seatIndex,
        classId,
        ...(classId === 'main-character' ? { starterSpeciesId: 'bulbasaur' } : {}),
        controller: seatIndex < humans ? ('human' as const) : ('ai' as const),
      })),
      seed: 1,
      lapTarget: 2,
      socialWindow: true,
    }),
    engineContent,
  );
  state.phase = { kind: 'strategy' };
  state.globalTurnNo = 7;
  state.turnBudgets = { tacticalAction: 1, catchAttempt: 1, pokemonAbility: 1 };
  for (const player of state.players) player.ownTurnNo = 3;
  const store = createGameStore();
  store.restore(
    { state, log: createGameLog(state) },
    seats > humans ? [{ seatIndex: 2, personality: 'greedy', difficulty: 'normal' }] : [],
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    PEOPLE.slice(0, humans),
  );
  return { store, state };
}

test('a one-person game never asks to pass the device and reads the one human seat (§3)', () => {
  const { store } = table(1);
  expect(store.getPass()).toBeNull();
  expect(store.getView()?.seatIndex).toBe(0);
});

test('with several people, no board is readable until the person whose turn it is takes the device (§3, §4.1)', () => {
  const { store } = table(2);
  expect(store.getPass()).toEqual({ seatIndex: 0, kind: 'turn' });
  expect(store.getView()).toBeNull();
  store.confirmPass();
  expect(store.getPass()).toBeNull();
  expect(store.getView()?.seatIndex).toBe(0);
  expect(store.getView()?.observation.own.seatIndex).toBe(0);
});

test('a command is refused while a hand-over is owed, even one the seat could make (§4.1)', () => {
  const { store } = table(2);
  store.confirmPass();
  const id = store.getView()!.legalActions.enabled[0]!.id;
  // The game is saved at Mai's turn and reopened: the device has not reached her yet.
  const { state } = store.getSession()!;
  state.activeSeatIndex = 1;
  const fresh = createGameStore();
  fresh.restore(
    { state, log: createGameLog(state) },
    [],
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    PEOPLE,
  );
  expect(fresh.getPass()).toEqual({ seatIndex: 1, kind: 'turn' });
  expect(fresh.choose(id)).toMatchObject({ rejected: true });
});

test('when the turn passes to the other person the board is withheld until they take the device (§3)', () => {
  const { store } = table(2);
  store.confirmPass();
  const end = store.getView()!.legalActions.enabled.find((choice) => choice.kind === 'skip');
  expect(end).toBeDefined();
  // Ton finishes Strategy; the engine carries the turn through to Mai without a screen between.
  let guard = 0;
  while (store.getView() && guard++ < 60) {
    const view = store.getView()!;
    const next =
      view.legalActions.enabled.find((choice) => choice.kind === 'skip') ??
      view.legalActions.enabled[0];
    if (!next) {
      if (!store.advance({ human: true })) break;
      continue;
    }
    store.choose(next.id);
  }
  expect(store.getPass()).toEqual({ seatIndex: 1, kind: 'turn' });
  expect(store.getView()).toBeNull();
  store.confirmPass();
  expect(store.getView()?.seatIndex).toBe(1);
  expect(store.getView()?.observation.own.seatIndex).toBe(1);
});

test('a defender who is a person answers on their own pass screen and the turn then returns (§4.4, §6.4)', () => {
  const { store } = table(2);
  store.confirmPass();
  const declared = store.submit({
    actorId: 'p0',
    kind: 'declare_pvp',
    payload: { targetSeatIndex: 1 },
  });
  expect('accepted' in declared).toBe(true);
  expect(store.getPass()).toEqual({ seatIndex: 1, kind: 'answer', fromSeatIndex: 0 });
  expect(store.getView()).toBeNull();
  store.confirmPass();
  expect(store.getView()?.seatIndex).toBe(1);
  expect(store.getView()?.decision).toMatchObject({ seatIndex: 1, point: 'pvp_response' });
});

test('an AI turn between two people keeps the device with the person who has it (§3)', () => {
  const { store, state } = table(2);
  store.confirmPass();
  state.activeSeatIndex = 2;
  const ai = createGameStore();
  ai.restore(
    { state, log: createGameLog(state) },
    [{ seatIndex: 2, personality: 'greedy', difficulty: 'normal' }],
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    PEOPLE,
  );
  // Nobody has taken the device yet, so the first person in seat order is asked to.
  expect(ai.getPass()).toEqual({ seatIndex: 0, kind: 'turn' });
  ai.confirmPass();
  expect(ai.getPass()).toBeNull();
  expect(ai.getView()?.seatIndex).toBe(0);
});

test('a resumed game asks the right person to take the device, whoever held it before (§3.1, §6.9)', () => {
  const { state } = table(2);
  state.activeSeatIndex = 1;
  const resumed = createGameStore();
  resumed.restore(
    { state, log: createGameLog(state) },
    [],
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    PEOPLE,
  );
  expect(resumed.getPass()).toEqual({ seatIndex: 1, kind: 'turn' });
  expect(resumed.getPeople()).toEqual(PEOPLE);
  expect(resumed.getView()).toBeNull();
});

test('the public table is readable by nobody in particular, with no seat named (§4.1)', () => {
  const { store } = table(2);
  const open = store.getTableView()!;
  expect(open.seatIndex).toBeUndefined();
  expect('own' in open.observation).toBe(false);
  expect(store.getTableView()).toBe(open);
});

test('only a table of two or more people ever owes a hand-over', () => {
  const solo = table(1);
  solo.state.activeSeatIndex = 2;
  expect(solo.store.getPass()).toBeNull();
  const watched = createGameStore();
  const state = table(2).state;
  for (const seat of state.config.seats) seat.controller = 'ai';
  watched.restore({ state, log: createGameLog(state) });
  expect(watched.getPass()).toBeNull();
  expect(watched.getSpectatorView()).not.toBeNull();
});
