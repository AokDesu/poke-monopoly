import {
  createGameLog,
  legalActions,
  pendingDecision,
  type GameState,
} from '../../../engine/index.ts';
import type { Command, GameStore } from '../game/store.ts';
import { socialGame } from './socialGame.ts';

/** Test helpers for promises (spec §4.8): a human at seat 0 against `socialGame`'s rivals. */

const PASS = ['skip', 'roll', 'keep-die', 'finish-sell', 'skip-shop', 'release'];

/** The human's quietest choice: it moves the turn on and never attacks, offers or buys. */
function pass(store: GameStore): void {
  const options = store.getView()!.legalActions.enabled;
  const choice =
    PASS.map((id) => options.find((entry) => entry.id === id)).find(Boolean) ?? options[0]!;
  store.choose(choice.id);
}

/**
 * Plays on until `done` holds: automatic steps first, then the human's quietest choice, then the
 * rival's answer from the (faked) server. Returns false if the game finishes or stalls first.
 */
export async function playUntil(
  store: GameStore,
  done: (state: GameState) => boolean,
): Promise<boolean> {
  for (let step = 0; step < 1500; step++) {
    const { state } = store.getSession()!;
    if (done(state)) return true;
    if (state.phase.kind === 'finished') return false;
    if (store.advance({ human: true })) continue;
    if (pendingDecision(state)?.seatIndex === 0) pass(store);
    else await store.playOpponent(new AbortController().signal);
  }
  return false;
}

/** The human's next Social window, as `toHumanSocial` reaches the first one. */
export const atHumanSocial = (state: GameState) =>
  state.activeSeatIndex === 0 && state.phase.kind === 'social' && !state.pendingResponse;

/** Settles one promise's closing: the End of the promiser's own turn is over once `settled` is set. */
export const promiseSettled = (state: GameState) =>
  (state.promises ?? []).length > 0 && (state.promises ?? []).every((promise) => promise.settled);

/** Applies one of `seat`'s enabled choices by its ID, as that seat's own command. */
export function chooseAs(store: GameStore, seatIndex: number, choiceId: string): void {
  const { state } = store.getSession()!;
  const choice = legalActions(state, seatIndex).enabled.find((entry) => entry.id === choiceId);
  if (!choice) throw new Error(`Seat ${seatIndex} has no choice ${choiceId}`);
  const actorId = state.players.find((player) => player.seatIndex === seatIndex)!.actorId;
  const result = store.submit({ actorId, kind: choice.kind, payload: choice.payload } as Command);
  if ('rejected' in result) throw new Error(`Rejected ${choiceId}: ${result.reason}`);
}

/**
 * A game on the human's first Social window, as the engine's own tests set one up: the human has
 * played own turn 1, every rival is on own turn 0, and `edit` may change the state before it is sealed
 * into the log (a log starts at revision zero, so a state is edited only here, as the dev gallery does).
 * Every later command still runs through the engine.
 */
export function socialGameWith(
  rivals: 1 | 2,
  edit: (state: GameState) => void = () => {},
  seed?: string | number,
): GameStore {
  const store = socialGame(rivals, seed);
  const state = structuredClone(store.getSession()!.state);
  state.phase = { kind: 'social' };
  state.activeSeatIndex = 0;
  state.globalTurnNo = 1;
  state.players[0]!.ownTurnNo = 1;
  state.turnBudgets = {
    tacticalAction: 1,
    catchAttempt: 1,
    pokemonAbility: 1,
    socialInteraction: 1,
  };
  edit(state);
  store.restore({ state, log: createGameLog(state) }, store.getOpponents());
  return store;
}

/** The human offers or asks, and the rival's answer comes from the faked server. */
export async function makePromise(
  store: GameStore,
  seatIndex: number,
  direction: 'offer' | 'ask',
): Promise<void> {
  chooseAs(store, 0, `offer-promise:seat-${seatIndex}:${direction}`);
  await store.playOpponent(new AbortController().signal);
}
