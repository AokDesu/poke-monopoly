import type {
  LegalAction,
  LegalActions,
  Observation,
  SeatEvent,
  SeatPromise,
} from '../../../engine/index.ts';
import type { SeatFeedEntry, SeatView } from './store.ts';

/**
 * What the screens show about `no_attack` promises (spec §4.8). Every fact here is read from the
 * human seat's own observation or its seat-visible feed: no state, outcome, expiry or availability is
 * worked out in the browser, and nothing is read that the seat could not see.
 */

export type PromiseOffer = Extract<LegalAction, { kind: 'offer_promise' }>;
type EventOf<K extends SeatEvent['kind']> = Extract<SeatEvent, { kind: K }>;

/** The promise offers the engine lists now; availability never depends on anything a seat holds. */
export const promiseOffers = (legal: LegalActions): PromiseOffer[] =>
  legal.enabled.filter((action): action is PromiseOffer => action.kind === 'offer_promise');

/** The offer's own words: `offer` is "I won't attack you", `ask` is "promise not to attack me". */
export type PromiseDirection = PromiseOffer['payload']['direction'];

/** A question the human asked that its rival has not answered yet: not a promise, not active. */
export interface PendingOffer {
  readonly rivalSeatIndex: number;
  readonly direction: PromiseDirection;
}

/** The open question, or null. Only the initiator and the responder ever hold it (engine contract). */
export function pendingOffer(observation: Observation): PendingOffer | null {
  const pending = observation.own.pendingResponse;
  if (pending?.kind !== 'promise_offer') return null;
  const you = observation.own.seatIndex;
  return {
    rivalSeatIndex:
      pending.initiatorSeatIndex === you ? pending.responderSeatIndex : pending.initiatorSeatIndex,
    direction: pending.direction,
  };
}

/**
 * Whether a rival owes the answer to the human's promise question: the engine's pending decision
 * belongs to another seat while the human's window waits. Nothing else may move the game then.
 */
export const rivalOwesAnswer = (view: Pick<SeatView, 'observation' | 'decision' | 'seatIndex'>) =>
  pendingOffer(view.observation) !== null &&
  view.decision !== null &&
  view.decision.seatIndex !== view.seatIndex;

/** `closed` is the engine's settlement; a promise without it is still open. */
export type PromiseStatus = 'active' | 'kept' | 'broken' | 'closed_by_game_end';

export interface PromiseRow {
  readonly promiserSeatIndex: number;
  readonly recipientSeatIndex: number;
  /** The global turn it was accepted on. */
  readonly createdTurn: number;
  /** The promiser's own turn number whose end closes it, as the engine recorded it. */
  readonly closesOwnTurnNo: number;
  readonly status: PromiseStatus;
  /** The global turn the engine settled it on; absent while it is open. */
  readonly closedTurn?: number;
}

const rowOf = (promise: SeatPromise): PromiseRow => ({
  promiserSeatIndex: promise.promiserSeatIndex,
  recipientSeatIndex: promise.recipientSeatIndex,
  createdTurn: promise.createdGlobalTurnNo,
  closesOwnTurnNo: promise.closesOwnTurnNo,
  status: promise.closed?.outcome ?? 'active',
  ...(promise.closed && { closedTurn: promise.closed.globalTurnNo }),
});

/** Every promise the seat made or received, oldest first, with the engine's own status. */
export const promiseRows = (observation: Observation): PromiseRow[] =>
  (observation.own.promises ?? []).map(rowOf);

/** Whether the promise's directed pair already has an open promise (engine data, not a rule). */
export const hasOpenPromise = (
  rows: readonly PromiseRow[],
  promiserSeatIndex: number,
  recipientSeatIndex: number,
) =>
  rows.some(
    (row) =>
      row.status === 'active' &&
      row.promiserSeatIndex === promiserSeatIndex &&
      row.recipientSeatIndex === recipientSeatIndex,
  );

/** One attack the seat saw the engine record: the evidence a broken promise points at. */
export interface AttackEvidence {
  readonly attackId: string;
  readonly actorSeatIndex: number;
  readonly targetSeatIndex: number;
  readonly source: EventOf<'attack_attempt'>['source'];
  readonly turn: number;
  /** The seat's own feed number of the record that carried the event. */
  readonly record: number;
}

export type MemoryEntry =
  | {
      readonly kind: 'accepted' | 'refused';
      readonly promiserSeatIndex: number;
      readonly recipientSeatIndex: number;
      readonly turn: number;
      readonly record: number;
    }
  | {
      readonly kind: 'kept' | 'closed_by_game_end';
      readonly promiserSeatIndex: number;
      readonly recipientSeatIndex: number;
      readonly turn: number;
      readonly record: number;
    }
  | {
      readonly kind: 'broken';
      readonly promiserSeatIndex: number;
      readonly recipientSeatIndex: number;
      /** The turn of the first attack the seat saw, which is the turn the promise was broken on. */
      readonly turn: number;
      readonly settledTurn: number;
      readonly record: number;
      readonly evidence: readonly AttackEvidence[];
    };

/**
 * Memory, read from the seat's own feed and nothing else: the accepted, refused and closed promise
 * events and the attack attempts it saw. A message sent in chat is never an entry (words are not
 * evidence), and an outcome appears only once the engine's `promise_closed` event says so. A broken
 * promise lists the attacks the engine recorded by its promiser on its recipient after it was
 * accepted, in the order the seat's feed holds them. Newest first.
 */
export function memoryEntries(
  observation: Observation,
  feed: readonly SeatFeedEntry[],
): MemoryEntry[] {
  const seatOf = new Map(
    observation.public.players.map((player) => [player.actorId, player.seatIndex]),
  );
  const entries: MemoryEntry[] = [];
  const attacks: { order: number; evidence: AttackEvidence }[] = [];
  const accepted = new Map<string, number>();
  feed.forEach((entry, order) => {
    const record = entry.record.action.actionSeq;
    const turn = entry.before.globalTurnNo;
    for (const event of entry.record.events) {
      if (event.kind === 'attack_attempt') {
        const actor = seatOf.get(event.actorId);
        const target = seatOf.get(event.targetId);
        if (actor === undefined || target === undefined) continue;
        attacks.push({
          order,
          evidence: {
            attackId: event.attackId,
            actorSeatIndex: actor,
            targetSeatIndex: target,
            source: event.source,
            turn: event.globalTurnNo,
            record,
          },
        });
      } else if (event.kind === 'promise_accepted') {
        accepted.set(`${event.promiserSeatIndex}>${event.recipientSeatIndex}`, order);
        entries.push({
          kind: 'accepted',
          promiserSeatIndex: event.promiserSeatIndex,
          recipientSeatIndex: event.recipientSeatIndex,
          turn,
          record,
        });
      } else if (event.kind === 'promise_rejected') {
        entries.push({
          kind: 'refused',
          promiserSeatIndex: event.promiserSeatIndex,
          recipientSeatIndex: event.recipientSeatIndex,
          turn,
          record,
        });
      } else if (event.kind === 'promise_closed') {
        const { promiserSeatIndex, recipientSeatIndex } = event;
        if (event.outcome === 'broken') {
          const from = accepted.get(`${promiserSeatIndex}>${recipientSeatIndex}`) ?? -1;
          const evidence = attacks
            .filter(
              (attack) =>
                attack.evidence.actorSeatIndex === promiserSeatIndex &&
                attack.evidence.targetSeatIndex === recipientSeatIndex &&
                attack.order > from &&
                attack.order <= order,
            )
            .map((attack) => attack.evidence);
          entries.push({
            kind: 'broken',
            promiserSeatIndex,
            recipientSeatIndex,
            turn: evidence[0]?.turn ?? event.globalTurnNo,
            settledTurn: event.globalTurnNo,
            record,
            evidence,
          });
        } else {
          entries.push({
            kind: event.outcome,
            promiserSeatIndex,
            recipientSeatIndex,
            turn: event.globalTurnNo,
            record,
          });
        }
      }
    }
  });
  return entries.reverse();
}

/**
 * How the seat's last promise question this turn ended, from its own feed: the rival's explicit
 * answer. Null while nothing has been answered in this turn's window.
 */
export interface PromiseAnswer {
  readonly kind: 'accepted' | 'refused';
  readonly promiserSeatIndex: number;
  readonly recipientSeatIndex: number;
  readonly closesOwnTurnNo?: number;
}

export function answerThisTurn(
  feed: readonly SeatFeedEntry[],
  globalTurnNo: number,
): PromiseAnswer | null {
  for (const entry of feed.toReversed()) {
    if (entry.before.globalTurnNo !== globalTurnNo) return null;
    for (const event of entry.record.events.toReversed()) {
      if (event.kind === 'promise_accepted') {
        return {
          kind: 'accepted',
          promiserSeatIndex: event.promiserSeatIndex,
          recipientSeatIndex: event.recipientSeatIndex,
          closesOwnTurnNo: event.closesOwnTurnNo,
        };
      }
      if (event.kind === 'promise_rejected') {
        return {
          kind: 'refused',
          promiserSeatIndex: event.promiserSeatIndex,
          recipientSeatIndex: event.recipientSeatIndex,
        };
      }
    }
  }
  return null;
}

/**
 * The seat's trust in a rival, the engine's number from `own.trust`. Trust moves only for the
 * recipient of a promise, so it is listed only for rivals whose promise to this seat the engine has
 * closed as kept or broken. A promise closed by the end of the game changes no trust, and a promise
 * the seat made itself changes the rival's trust, which no seat can see. A table with no such history
 * shows no numbers.
 */
export function trustShown(observation: Observation): { seatIndex: number; value: number }[] {
  const you = observation.own.seatIndex;
  const moved = new Set(
    promiseRows(observation)
      .filter(
        (row) =>
          row.recipientSeatIndex === you && (row.status === 'kept' || row.status === 'broken'),
      )
      .map((row) => row.promiserSeatIndex),
  );
  return (observation.own.trust ?? []).filter((entry) => moved.has(entry.seatIndex));
}

/**
 * Why the engine lists no offer in this direction to this rival: words only, chosen from what the
 * seat already sees. Availability itself is never decided here; this only picks the sentence for an
 * offer the engine did not list.
 */
export function unavailableReason(
  observation: Observation,
  rivalSeatIndex: number,
  direction: PromiseDirection,
): 'active' | 'gameEnd' | 'unavailable' {
  const you = observation.own.seatIndex;
  const [promiser, recipient] =
    direction === 'offer' ? [you, rivalSeatIndex] : [rivalSeatIndex, you];
  if (hasOpenPromise(promiseRows(observation), promiser, recipient)) return 'active';
  return observation.public.finalTableRound ? 'gameEnd' : 'unavailable';
}
