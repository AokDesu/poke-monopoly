import { expect, test } from 'vitest';
import { engineContent } from './content.ts';
import { firstPlayerRoll, rollForFirstPlayer } from './firstPlayer.ts';
import type { GameSetup, OpponentChoice } from './setup.ts';
import { configForSetup, createGameStore, opponentSettings } from './store.ts';

const opponent = (classId: string, starterSpeciesId: string): OpponentChoice => ({
  classId,
  starterSpeciesId,
  personality: 'greedy',
  difficulty: 'easy',
});
const twoSeats: GameSetup = {
  mode: 'quick',
  human: { classId: 'researcher', starterSpeciesId: 'porygon' },
  opponents: [opponent('main-character', 'bulbasaur')],
};
// Three seats are not offered in setup yet (cycle 3), but the roll screen must already show
// that only tied seats re-roll (spec §3), which needs a third seat to stay out.
const threeSeats: GameSetup = {
  ...twoSeats,
  opponents: [...twoSeats.opponents, opponent('rival', 'eevee')],
};

function startedStore(setup: GameSetup, seed: number) {
  const store = createGameStore();
  store.start(configForSetup(setup, seed), engineContent, opponentSettings(setup));
  return store;
}

test('before anyone rolls, every seat is a contender and the human is asked to roll', () => {
  const view = startedStore(twoSeats, 7).getView()!;
  expect(firstPlayerRoll(view)).toEqual({
    attempts: [{ contenders: [0, 1], rolls: [] }],
    humanToRoll: true,
  });
});

test('seed 7 gives the same first-player result every time (§3)', () => {
  const play = () => {
    const store = startedStore(twoSeats, 7);
    rollForFirstPlayer(store);
    rollForFirstPlayer(store);
    return firstPlayerRoll(store.getView()!);
  };
  const first = play();
  expect(first.firstSeat).toBeDefined();
  expect(play()).toEqual(first);
  expect(play()).toEqual(first);
});

test('a scripted tie re-rolls only the tied seats, and the AIs roll on their own (§3)', () => {
  // Seed 15, three seats: the human rolls 2 and both AIs roll 3, then only the AIs re-roll.
  const store = startedStore(threeSeats, 15);
  rollForFirstPlayer(store);

  const result = firstPlayerRoll(store.getView()!);
  expect(result.attempts).toEqual([
    {
      contenders: [0, 1, 2],
      rolls: [
        { seatIndex: 0, value: 2 },
        { seatIndex: 1, value: 3 },
        { seatIndex: 2, value: 3 },
      ],
    },
    {
      contenders: [1, 2],
      rolls: [
        { seatIndex: 1, value: 3 },
        { seatIndex: 2, value: 2 },
      ],
    },
  ]);
  expect(result.firstSeat).toBe(1);
  expect(result.humanToRoll).toBe(false);
  expect(store.getView()!.observation.public.phase.kind).toBe('start');
});

test('when the human ties for the top roll, the human re-rolls by choice, never automatically', () => {
  // Seed 6, three seats: the human and seat 2 both roll 4, seat 1 rolls 1.
  const store = startedStore(threeSeats, 6);
  rollForFirstPlayer(store);

  let result = firstPlayerRoll(store.getView()!);
  expect(result.humanToRoll).toBe(true);
  expect(result.firstSeat).toBeUndefined();
  expect(result.attempts.map((attempt) => attempt.contenders)).toEqual([
    [0, 1, 2],
    [0, 2],
  ]);
  expect(result.attempts[1]!.rolls).toEqual([]);
  // Nothing moves until the human rolls.
  expect(store.advance()).toBe(false);

  rollForFirstPlayer(store);
  result = firstPlayerRoll(store.getView()!);
  expect(result.attempts[1]!.rolls.map((roll) => roll.seatIndex)).toEqual([0, 2]);
  expect(result.firstSeat).toBe(2);
});
