import { expect, test } from 'vitest';
import {
  advanceAutomatically,
  applyAction,
  createGame,
  createGameConfig,
  d6,
  fixtureSchema,
  legalActions,
  pendingDecision,
  shuffle,
  stateHash,
  type GameState,
} from './index.ts';
import fixture from './fixtures/start-of-game-2p.json';

/**
 * Spec §7 (agent boundaries), §8 (rejected actions change nothing; RNG and deck order stay hidden),
 * Engine contract "Command log and replay": a seat that submits an `engine` command gets no
 * answer about the next die or the deck order, and spends none of it.
 */

function liveGame(): GameState {
  const content = fixtureSchema.parse(fixture).state.content;
  const config = createGameConfig({
    seats: [
      { actorId: 'player-0', seatIndex: 0, classId: 'main-character', controller: 'human' },
      { actorId: 'player-1', seatIndex: 1, classId: 'rival', controller: 'human' },
    ],
    seed: 11,
    lapTarget: 1,
  });
  let state = createGame(config, content);
  // Play the first-player roll, then take the first enabled choice until a seat is deciding in Strategy.
  for (let step = 0; step < 40 && state.phase.kind !== 'strategy'; step++) {
    const automatic = advanceAutomatically(state);
    if (automatic.records.length === 1) {
      state = automatic.state;
      continue;
    }
    const seat = pendingDecision(state)!;
    const choice = legalActions(state, seat.seatIndex).enabled[0]!;
    const result = applyAction(state, {
      actorId: seat.actorId,
      actionSeq: state.stateRevision + 1,
      stateRevisionBefore: state.stateRevision,
      kind: choice.kind,
      payload: choice.payload,
    });
    if ('rejected' in result) throw new Error(result.reason);
    state = result.state;
  }
  if (state.phase.kind !== 'strategy') throw new Error('Expected a Strategy decision');
  return state;
}

function asEngine(state: GameState, kind: string, payload: unknown) {
  return applyAction(state, {
    actorId: 'engine',
    actionSeq: state.stateRevision + 1,
    stateRevisionBefore: state.stateRevision,
    kind,
    payload,
  });
}

test('mid-game, an engine die with no roll pending is refused even with the right face, so the next die cannot be probed or burned (§6.3, §8)', () => {
  const state = liveGame();
  const hash = stateHash(state);
  for (const purpose of ['probe', 'move:0:1', 'event:e4:item']) {
    const next = d6(state.rng, purpose).value;
    for (const value of [next, (next % 6) + 1]) {
      const result = asEngine(state, 'dice_result', { purpose, value });
      expect(result, `${purpose} ${value}`).toEqual({
        rejected: true,
        reason: 'illegal_action',
        state,
      });
    }
  }
  expect(stateHash(state)).toBe(hash);
});

test('mid-game, an engine shuffle or draw is refused even when it names the real deck order, so the Event deck cannot be probed (§4.6, §8)', () => {
  const state = liveGame();
  state.eventDeck = { drawPile: ['e1', 'e2', 'e3'], discardPile: [] };
  const order = shuffle(state.rng, state.eventDeck.drawPile, 'shuffle:events').value;
  const hash = stateHash(state);
  expect(asEngine(state, 'shuffle', { deckId: 'events', order })).toEqual({
    rejected: true,
    reason: 'illegal_action',
    state,
  });
  expect(asEngine(state, 'event_draw', { eventId: 'e1' })).toEqual({
    rejected: true,
    reason: 'illegal_action',
    state,
  });
  expect(stateHash(state)).toBe(hash);
});
