import type {
  EngineEvent,
  GameState,
  LegalAction,
  LegalActions,
  NoAttackPromise,
  PendingResponse,
  PromiseOutcome,
  SeatPromise,
  Trust,
} from './contract/schema.ts';
import { ABILITY_EFFECTS, abilityChoices, abilityEffectOf } from './abilities.ts';
import { HOSTILE, itemChoices } from './items.ts';
import { hideFromBystanders, socialOpen } from './social.ts';

/** Trust is clamped to this range (§4.8). */
export const TRUST_MIN = -3;
export const TRUST_MAX = 3;
/** Trust gained from kept promises with a chance, at most this much per directed pair per game. */
export const TRUST_KEPT_GAIN_CAP = 2;

type Direction = 'offer' | 'ask';

function player(state: GameState, seatIndex: number) {
  return state.players.find((entry) => entry.seatIndex === seatIndex)!;
}

/** Roles of the two seats once the initiator's direction is known (§4.8 Promise `no_attack`). */
function roles(initiatorSeatIndex: number, otherSeatIndex: number, direction: Direction) {
  return direction === 'offer'
    ? { promiserSeatIndex: initiatorSeatIndex, recipientSeatIndex: otherSeatIndex }
    : { promiserSeatIndex: otherSeatIndex, recipientSeatIndex: initiatorSeatIndex };
}

/**
 * The promiser's turn whose end closes a promise confirmed now. The promise lasts "until the end of
 * the promiser's next turn" (§4.8), so it is their `ownTurnNo` at confirmation plus 1.
 */
export function closesOwnTurnNo(state: GameState, promiserSeatIndex: number): number {
  return player(state, promiserSeatIndex).ownTurnNo + 1;
}

/**
 * A promise is active from confirmation until the end of the promiser's turn `closesOwnTurnNo`:
 * before that turn, or during it. After it, the promiser's `ownTurnNo` stays equal while another
 * seat is active, and the promise is closed (settling it is a later slice's job).
 */
export function promiseActive(state: GameState, promise: NoAttackPromise): boolean {
  const promiser = player(state, promise.promiserSeatIndex);
  return (
    promiser.ownTurnNo < promise.closesOwnTurnNo ||
    (promiser.ownTurnNo === promise.closesOwnTurnNo &&
      state.activeSeatIndex === promise.promiserSeatIndex)
  );
}

/**
 * Read-only window status for §8 reporting; does not settle promises or change trust.
 * A finished game has ended its final turn, even if the last active seat is the promiser.
 */
export function promiseWindowStatus(
  state: GameState,
  promise: NoAttackPromise,
): 'active' | 'expired' | 'closed_by_game_end' {
  if (state.phase.kind === 'finished') {
    return player(state, promise.promiserSeatIndex).ownTurnNo >= promise.closesOwnTurnNo
      ? 'expired'
      : 'closed_by_game_end';
  }
  return promiseActive(state, promise) ? 'active' : 'expired';
}

/**
 * §4.8 limits: one active promise per directed pair, no renewal (a new promise cannot be offered
 * while the old one is still active, including on its closing turn), and none that would close
 * after the game ends (§4.2 Final Table Round: nobody plays an own turn past `targetOwnTurnNo`).
 */
function promiseAllowed(state: GameState, promiserSeatIndex: number, recipientSeatIndex: number) {
  const closes = closesOwnTurnNo(state, promiserSeatIndex);
  if (state.finalTableRound && closes > state.finalTableRound.targetOwnTurnNo) return false;
  return !(state.promises ?? []).some(
    (promise) =>
      promise.promiserSeatIndex === promiserSeatIndex &&
      promise.recipientSeatIndex === recipientSeatIndex &&
      promiseActive(state, promise),
  );
}

/**
 * The promise offers the active human may make: to each AI seat, in either direction, within the
 * limits. Nothing depends on what any seat holds, so the button leaks no card (§4.8 Privacy).
 */
export function promiseOfferChoices(state: GameState, seatIndex: number, result: LegalActions) {
  if (!socialOpen(state, seatIndex)) return;
  for (const target of state.config.seats) {
    if (target.seatIndex === seatIndex || target.controller !== 'ai') continue;
    for (const direction of ['offer', 'ask'] as const) {
      const { promiserSeatIndex, recipientSeatIndex } = roles(
        seatIndex,
        target.seatIndex,
        direction,
      );
      if (!promiseAllowed(state, promiserSeatIndex, recipientSeatIndex)) continue;
      const action: LegalAction = {
        id: `offer-promise:seat-${target.seatIndex}:${direction}`,
        kind: 'offer_promise',
        payload: { targetSeatIndex: target.seatIndex, direction },
      };
      result.enabled.push(action);
    }
  }
}

/**
 * The responder's choices while a question is pending: exactly accept and reject (§4.8). The seat
 * comes from `pendingDecision` (engine/decisions.ts), which is what makes the responder the only
 * seat to act; every other seat, the waiting active one included, is given none by `legalActions`.
 */
export function responseChoices(pending: PendingResponse, result: LegalActions): void {
  if (pending.kind !== 'promise_offer') return;
  result.enabled.push(
    { id: 'respond:accept', kind: 'respond', payload: { answer: 'accept' } },
    { id: 'respond:reject', kind: 'respond', payload: { answer: 'reject' } },
  );
}

/** Opens the question. Nothing changes but the pending record; the answer spends the interaction. */
export function offerPromise(
  next: GameState,
  payload: { targetSeatIndex: number; direction: Direction },
): EngineEvent[] {
  next.pendingResponse = {
    kind: 'promise_offer',
    initiatorSeatIndex: next.activeSeatIndex,
    responderSeatIndex: payload.targetSeatIndex,
    direction: payload.direction,
  };
  hideFromBystanders(next, next.activeSeatIndex, payload.targetSeatIndex);
  next.promiseRecords = (next.promiseRecords ?? 0) + 1;
  return [
    {
      kind: 'promise_offered',
      initiatorSeatIndex: next.activeSeatIndex,
      responderSeatIndex: payload.targetSeatIndex,
      direction: payload.direction,
    },
  ];
}

/**
 * Either answer uses up the turn's social interaction and clears the question; neither spends the
 * tactical action (§4.8 Activation). Accepting records the promise, rejecting records nothing.
 */
export function answerPromise(next: GameState, answer: 'accept' | 'reject'): EngineEvent[] {
  const pending = next.pendingResponse;
  if (pending?.kind !== 'promise_offer') throw new RangeError('No promise offer is pending');
  delete next.pendingResponse;
  next.turnBudgets.socialInteraction = (next.turnBudgets.socialInteraction ?? 0) - 1;
  const { promiserSeatIndex, recipientSeatIndex } = roles(
    pending.initiatorSeatIndex,
    pending.responderSeatIndex,
    pending.direction,
  );
  hideFromBystanders(next, pending.initiatorSeatIndex, pending.responderSeatIndex);
  next.promiseRecords = (next.promiseRecords ?? 0) + 1;
  if (answer === 'reject')
    return [{ kind: 'promise_rejected', promiserSeatIndex, recipientSeatIndex }];
  const closes = closesOwnTurnNo(next, promiserSeatIndex);
  (next.promises ??= []).push({
    promiserSeatIndex,
    recipientSeatIndex,
    createdGlobalTurnNo: next.globalTurnNo,
    closesOwnTurnNo: closes,
    // `stateRevision` already counts the accepting record, so only later attempts follow it.
    acceptedActionSeq: next.stateRevision,
  });
  return [
    { kind: 'promise_accepted', promiserSeatIndex, recipientSeatIndex, closesOwnTurnNo: closes },
  ];
}

/**
 * A promise as the seat sees it: its own two parties and dates, and a closed promise's coarse outcome. The
 * sequence, the opportunity flag and the kept-with/without-chance split stay engine-internal (§4.8 Privacy).
 */
function seatPromise(promise: NoAttackPromise): SeatPromise {
  const { promiserSeatIndex, recipientSeatIndex, createdGlobalTurnNo, closesOwnTurnNo } = promise;
  return {
    promiserSeatIndex,
    recipientSeatIndex,
    createdGlobalTurnNo,
    closesOwnTurnNo,
    ...(promise.settled && {
      closed: {
        outcome:
          promise.settled.outcome === 'broken' || promise.settled.outcome === 'closed_by_game_end'
            ? promise.settled.outcome
            : 'kept',
        globalTurnNo: promise.settled.globalTurnNo,
      },
    }),
  };
}

/** The promises a seat made or received; no other seat's (§4.8 Privacy, §5.4). */
export function promisesOf(state: GameState, seatIndex: number): SeatPromise[] {
  return (state.promises ?? [])
    .filter(
      (promise) =>
        promise.promiserSeatIndex === seatIndex || promise.recipientSeatIndex === seatIndex,
    )
    .map(seatPromise);
}

/** One seat's trust in each other seat (§4.8): the truster's view only, 0 where nothing has settled. */
export function trustOf(state: GameState, seatIndex: number) {
  return state.players
    .filter((other) => other.seatIndex !== seatIndex)
    .map((other) => ({
      seatIndex: other.seatIndex,
      value:
        (state.trust ?? []).find(
          (entry) => entry.fromSeatIndex === seatIndex && entry.toSeatIndex === other.seatIndex,
        )?.value ?? 0,
    }));
}

/**
 * Whether the promiser holds a **public** chance to break the promise now (Q3, docs/engine-contract.md). Only a
 * hostile item the promiser holds publicly or a hostile Ability of a Pokémon on the public team counts. A legal
 * PvP declaration does not: it is almost always available, so every kept promise would earn trust. A secret item
 * never counts either, so the chance, and so the trust it earns, depends on nothing the recipient cannot see.
 */
export function publicAttackChance(
  state: GameState,
  promiserSeatIndex: number,
  recipientSeatIndex: number,
) {
  const promiser = player(state, promiserSeatIndex);
  if (state.phase.kind !== 'strategy' || state.activeSeatIndex !== promiserSeatIndex) return false;
  const items: { enabled: LegalAction[]; disabled: LegalAction[] } = { enabled: [], disabled: [] };
  itemChoices(state, promiserSeatIndex, items as LegalActions);
  const publicHostile = items.enabled.some((action) => {
    if (action.kind !== 'use_item' || action.payload.targetSeatIndex !== recipientSeatIndex) {
      return false;
    }
    const held = promiser.items.find((item) => item.instanceId === action.payload.itemInstanceId);
    return held?.visibility === 'public' && HOSTILE.includes(held.itemId);
  });
  if (publicHostile) return true;
  return abilityChoices(state, promiserSeatIndex).some((action) => {
    if (
      action.kind !== 'activate_ability' ||
      action.payload.targetSeatIndex !== recipientSeatIndex
    ) {
      return false;
    }
    const pokemon = promiser.team.find((entry) => entry.instanceId === action.payload.instanceId);
    const effect = pokemon && abilityEffectOf(state, pokemon);
    return effect !== undefined && ABILITY_EFFECTS[effect].hostile;
  });
}

/**
 * Records, once per open promise, that its promiser had a public chance to attack the recipient. Called when
 * the promiser enters Strategy, the only phase an attack can be declared in, inside the promise's window.
 */
export function noteAttackChances(next: GameState): void {
  for (const promise of next.promises ?? []) {
    if (promise.settled || promise.chance || promise.promiserSeatIndex !== next.activeSeatIndex) {
      continue;
    }
    if (publicAttackChance(next, promise.promiserSeatIndex, promise.recipientSeatIndex)) {
      promise.chance = true;
    }
  }
}

/**
 * Whether the promiser attacked the recipient after the promise was confirmed. Judged from the recorded
 * attempt's actor and target (`attackHistory`: PvP declarations, hostile items and hostile Abilities),
 * so an attempt a Price Shield blocked still counts (§4.8, Appendix C.4). The promise never changes whether
 * the attempt was legal; this only reads it afterwards.
 */
export function promiseBroken(state: GameState, promise: NoAttackPromise): boolean {
  const promiser = player(state, promise.promiserSeatIndex).actorId;
  const recipient = player(state, promise.recipientSeatIndex).actorId;
  return (state.attackHistory ?? []).some(
    (attempt) =>
      attempt.actorId === promiser &&
      attempt.targetId === recipient &&
      attempt.actionSeq > promise.acceptedActionSeq,
  );
}

function trustEntry(next: GameState, truster: number, trustee: number): Trust {
  const trust = (next.trust ??= []);
  let entry = trust.find((one) => one.fromSeatIndex === truster && one.toSeatIndex === trustee);
  if (!entry) {
    entry = { fromSeatIndex: truster, toSeatIndex: trustee, value: 0, keptGain: 0 };
    trust.push(entry);
  }
  return entry;
}

/** Applies one outcome to the recipient's trust in the promiser (§4.8): −2, +1 (at most +2 a pair), 0, none. */
function applyTrust(next: GameState, promise: NoAttackPromise, outcome: PromiseOutcome): void {
  if (outcome === 'kept_without_chance' || outcome === 'closed_by_game_end') return;
  const entry = trustEntry(next, promise.recipientSeatIndex, promise.promiserSeatIndex);
  if (outcome === 'broken') {
    entry.value = Math.max(TRUST_MIN, entry.value - 2);
  } else if (entry.keptGain < TRUST_KEPT_GAIN_CAP) {
    entry.keptGain++;
    entry.value = Math.min(TRUST_MAX, entry.value + 1);
  }
}

function closePromise(
  next: GameState,
  promise: NoAttackPromise,
  outcome: PromiseOutcome,
): EngineEvent {
  promise.settled = { outcome, globalTurnNo: next.globalTurnNo };
  applyTrust(next, promise, outcome);
  return {
    kind: 'promise_closed',
    promiserSeatIndex: promise.promiserSeatIndex,
    recipientSeatIndex: promise.recipientSeatIndex,
    outcome: seatPromise(promise).closed!.outcome,
    globalTurnNo: next.globalTurnNo,
  };
}

/**
 * §4.2 step 7 (End): closes every promise whose promiser has just finished its `closesOwnTurnNo` turn.
 * Broken if the promiser attacked the recipient in the window, otherwise kept, with or without a chance.
 */
export function settleDuePromises(next: GameState): EngineEvent[] {
  const events: EngineEvent[] = [];
  const active = player(next, next.activeSeatIndex);
  for (const promise of next.promises ?? []) {
    if (
      promise.settled ||
      promise.promiserSeatIndex !== next.activeSeatIndex ||
      active.ownTurnNo !== promise.closesOwnTurnNo
    ) {
      continue;
    }
    const outcome = promiseBroken(next, promise)
      ? 'broken'
      : promise.chance
        ? 'kept_with_chance'
        : 'kept_without_chance';
    events.push(closePromise(next, promise, outcome));
  }
  return events;
}

/** The game ended inside a window: each still-open promise closes with no change in trust (§4.8). */
export function closePromisesAtGameEnd(next: GameState): EngineEvent[] {
  return (next.promises ?? [])
    .filter((promise) => !promise.settled)
    .map((promise) => closePromise(next, promise, 'closed_by_game_end'));
}
