import type { Observation } from '../engine/index.ts';

/**
 * What a responder's own observation says about the `no_attack` promise it is asked to answer
 * (spec §4.8, §5.4): who promises whom, the seat's trust in the asker, and what it remembers of
 * earlier promises between the two. Read only from `observation.own` and `observation.public`,
 * so nothing from a seat outside the pair, and nothing hidden, can enter (§4.8 Privacy, #143).
 */

/** The named buckets a trust value is shown as to Jev: never the integer (spec §5.4). */
export const TRUST_BUCKETS = ['low', 'neutral', 'high'] as const;
export type TrustBucket = (typeof TRUST_BUCKETS)[number];

/**
 * Trust (the engine's `own.trust`, −3..3) as a word: `low` below 0 (a promise to this seat was
 * broken), `neutral` at 0 (nothing settled, or broken and kept evened out) and `high` above 0.
 * A presentation threshold, like the other buckets in the Jev state; the line bank's trust
 * buckets use the same words (§5.7).
 */
export function bucketTrust(value: number): TrustBucket {
  if (!Number.isInteger(value)) throw new RangeError('Trust must be a whole number');
  if (value < 0) return 'low';
  return value === 0 ? 'neutral' : 'high';
}

/** One settled promise between this seat and the asker, as the seat itself saw it. */
export interface PromiseMemory {
  promiserSeatIndex: number;
  outcome: 'kept' | 'broken';
  /** The turn the promise was confirmed. */
  createdGlobalTurnNo: number;
  /** For a broken promise, the turn of the first attack on the recipient inside the window. */
  brokenOnGlobalTurnNo?: number;
}

export interface PromiseQuestion {
  initiatorSeatIndex: number;
  promiserSeatIndex: number;
  recipientSeatIndex: number;
  /** This seat's part in the promise: it is asked to make it, or to accept one made to it. */
  role: 'promiser' | 'recipient';
  /** The seat's trust in the asker, from `own.trust`; 0 where nothing has settled. */
  trust: number;
  /** Settled promises between the two, oldest first. */
  memory: PromiseMemory[];
}

function actorOf(observation: Observation, seatIndex: number): string {
  const player = observation.public.players.find((entry) => entry.seatIndex === seatIndex);
  if (!player) throw new RangeError(`Observation has no player in seat ${seatIndex}`);
  return player.actorId;
}

/**
 * The promise question this seat owes an answer to, or `undefined` when its observation holds no
 * such question (another seat's, none, or a deal).
 */
export function pendingPromise(observation: Observation): PromiseQuestion | undefined {
  const pending = observation.own.pendingResponse;
  const me = observation.own.seatIndex;
  if (pending?.kind !== 'promise_offer' || pending.responderSeatIndex !== me) return undefined;
  const initiator = pending.initiatorSeatIndex;
  const offered = pending.direction === 'offer';
  const trust = observation.own.trust?.find((entry) => entry.seatIndex === initiator)?.value ?? 0;
  return {
    initiatorSeatIndex: initiator,
    promiserSeatIndex: offered ? initiator : me,
    recipientSeatIndex: offered ? me : initiator,
    role: offered ? 'recipient' : 'promiser',
    trust,
    memory: promiseMemory(observation, initiator),
  };
}

/**
 * The seat's settled promises with one counterpart, from the promises it made or received. A
 * promise closed by the end of the game is no evidence either way, and an open one is not yet.
 */
export function promiseMemory(observation: Observation, otherSeatIndex: number): PromiseMemory[] {
  const me = observation.own.seatIndex;
  const attacks = observation.public.attackHistory ?? [];
  return (observation.own.promises ?? [])
    .filter(
      (promise) =>
        promise.closed !== undefined &&
        promise.closed.outcome !== 'closed_by_game_end' &&
        ((promise.promiserSeatIndex === me && promise.recipientSeatIndex === otherSeatIndex) ||
          (promise.promiserSeatIndex === otherSeatIndex && promise.recipientSeatIndex === me)),
    )
    .map((promise): PromiseMemory => {
      const closed = promise.closed!;
      if (closed.outcome === 'kept') {
        return {
          promiserSeatIndex: promise.promiserSeatIndex,
          outcome: 'kept',
          createdGlobalTurnNo: promise.createdGlobalTurnNo,
        };
      }
      const promiser = actorOf(observation, promise.promiserSeatIndex);
      const recipient = actorOf(observation, promise.recipientSeatIndex);
      const attempt = attacks.find(
        (entry) =>
          entry.actorId === promiser &&
          entry.targetId === recipient &&
          entry.globalTurnNo >= promise.createdGlobalTurnNo &&
          entry.globalTurnNo <= closed.globalTurnNo,
      );
      return {
        promiserSeatIndex: promise.promiserSeatIndex,
        outcome: 'broken',
        createdGlobalTurnNo: promise.createdGlobalTurnNo,
        brokenOnGlobalTurnNo: attempt?.globalTurnNo ?? closed.globalTurnNo,
      };
    })
    .sort((a, b) => a.createdGlobalTurnNo - b.createdGlobalTurnNo);
}
