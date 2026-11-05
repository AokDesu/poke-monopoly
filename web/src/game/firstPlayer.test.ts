import { expect, test } from 'vitest';
import { deserialize, replay, verifyReplay } from '../../../engine/index.ts';
import { saveText } from './save.ts';
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

test('before automatic advancement, every seat is a contender with a pending roll', () => {
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

test('human top-roll ties re-roll automatically and stop before the first turn (§3.1)', () => {
  // Seed 6: the human and seat 2 both roll 4, seat 1 rolls 1.
  const store = startedStore(threeSeats, 6);
  rollForFirstPlayer(store);
  const result = firstPlayerRoll(store.getView()!);
  expect(result.humanToRoll).toBe(false);
  expect(result.attempts.map((attempt) => attempt.contenders)).toEqual([
    [0, 1, 2],
    [0, 2],
  ]);
  expect(result.attempts[1]!.rolls.map((roll) => roll.seatIndex)).toEqual([0, 2]);
  expect(result.firstSeat).toBe(2);
  expect(store.getSession()!.log.actions.every((record) => record.auto === true)).toBe(true);
  expect(store.getSession()!.state.phase.kind).toBe('start');
});

test('exported first-player rolls are automatic, contribute no meaningful choices, and replay (§3.1; protocol §6)', () => {
  const store = startedStore(twoSeats, 101);
  rollForFirstPlayer(store);
  const loaded = deserialize(saveText(store.getSession()!));
  expect(loaded.log.actions[0]).toMatchObject({
    auto: true,
    action: { actorId: 'human', kind: 'roll', actionSeq: 1 },
  });
  expect(loaded.log.actions.every((record) => record.auto === true)).toBe(true);
  expect(
    loaded.log.actions.filter((record) => record.action.actorId === 'human' && !record.auto),
  ).toHaveLength(0);
  expect(replay(loaded.log)).toEqual(loaded.state);
  expect(verifyReplay(loaded).pass).toBe(true);
});

test('an existing unmarked first-player roll saves, resumes, and replays unchanged (§6.8)', () => {
  const original = startedStore(threeSeats, 6);
  // A pre-fix log saved after the deliberate click, before its die result.
  expect('accepted' in original.choose('roll')).toBe(true);
  const loaded = deserialize(saveText(original.getSession()!));
  expect(loaded.log.actions[0]!.auto).toBeUndefined();
  expect(verifyReplay(loaded).pass).toBe(true);
  const restored = createGameStore();
  restored.restore(loaded);
  rollForFirstPlayer(original);
  rollForFirstPlayer(restored);
  expect(restored.getSession()).toEqual(original.getSession());
  expect(restored.getSession()!.log.actions[0]!.auto).toBeUndefined();
  expect(verifyReplay(deserialize(saveText(restored.getSession()!))).pass).toBe(true);
});
