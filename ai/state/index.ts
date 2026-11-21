import { summarizeObservation } from '../../engine/index.ts';
import type { Observation } from '../../engine/index.ts';
import { recentChat } from '../chat.ts';
import { assertNoComparableNumbers, assertStateTokenBudget } from './guards.ts';

export {
  assertNoComparableNumbers,
  assertStateTokenBudget,
  estimateStateTokens,
  STATE_TOKEN_BUDGET,
} from './guards.ts';
export {
  STATE_BUCKET_CONFIG,
  bucketCoinsRelative,
  bucketCount,
  bucketSquaresToStart,
} from '../../engine/index.ts';

/**
 * What only the engine's later slices can say: trust toward each opponent as a named bucket (S07),
 * keyed by the opponent's actor ID. Absent until S07 provides it; ai/ never computes trust.
 */
export interface SocialExtras {
  trust?: Readonly<Record<string, string>>;
}

/**
 * The seat's role-scoped social context (spec §4.8, §5.4): only what `observation.own` already
 * holds for this seat, which is its own promises, its own pending question and the attack record
 * it may see. A third party's promise, deal or chat is never in an observation, so never here.
 * Present only when the Social window is on (`own.promises` exists).
 */
function socialState(observation: Observation, extras: SocialExtras) {
  const { promises, pendingResponse } = observation.own;
  if (promises === undefined && pendingResponse === undefined) return undefined;
  const { players, attackHistory = [] } = observation.public;
  const me = observation.own.seatIndex;
  const actor = (seatIndex: number) => {
    const player = players.find((entry) => entry.seatIndex === seatIndex);
    if (!player) throw new RangeError('Observation has no player for a social seat');
    return player.actorId;
  };
  const mine = (promises ?? []).filter(
    (promise) => promise.promiserSeatIndex === me || promise.recipientSeatIndex === me,
  );
  const active = (promise: (typeof mine)[number]) => {
    const promiser = players.find((entry) => entry.seatIndex === promise.promiserSeatIndex);
    return (
      promiser !== undefined &&
      (promiser.ownTurnNo < promise.closesOwnTurnNo ||
        (promiser.ownTurnNo === promise.closesOwnTurnNo &&
          observation.public.activeSeatIndex === promise.promiserSeatIndex))
    );
  };
  // Memory evidence: a promiser's attack on its recipient after confirmation breaks `no_attack`.
  const broken = mine.flatMap((promise) =>
    attackHistory
      .filter(
        (attempt) =>
          attempt.actorId === actor(promise.promiserSeatIndex) &&
          attempt.targetId === actor(promise.recipientSeatIndex) &&
          attempt.globalTurnNo >= promise.createdGlobalTurnNo,
      )
      .slice(0, 1)
      .map((attempt) => ({
        by_id: attempt.actorId,
        toward_id: attempt.targetId,
        text: `${attempt.actorId === actor(me) ? 'you' : attempt.actorId} broke no_attack on turn ${attempt.globalTurnNo}`,
      })),
  );
  const result = {
    promises: mine.filter(active).map((promise) => ({
      kind: 'no_attack',
      promiser_id: actor(promise.promiserSeatIndex),
      recipient_id: actor(promise.recipientSeatIndex),
      yours_to_keep: promise.promiserSeatIndex === me,
    })),
    broken_promises: broken,
    trust: players
      .filter((player) => player.seatIndex !== me && extras.trust?.[player.actorId] !== undefined)
      .map((player) => ({ id: player.actorId, bucket: extras.trust![player.actorId]! })),
    ...(pendingResponse && pendingResponse.responderSeatIndex === me
      ? {
          pending_card: {
            kind: pendingResponse.kind,
            from_id: actor(pendingResponse.initiatorSeatIndex),
            terms:
              pendingResponse.direction === 'offer'
                ? 'they promise not to attack you'
                : 'they ask you to promise not to attack them',
          },
        }
      : {}),
  };
  // Nothing to say: no key at all, so a quiet game's state and token count are unchanged.
  const quiet =
    result.promises.length === 0 &&
    result.broken_promises.length === 0 &&
    result.trust.length === 0 &&
    !('pending_card' in result);
  return quiet ? undefined : result;
}

/** Explicit projection rather than spreading observations (spec §1, §5.4, §9). */
export function buildJevState(observation: Observation, extras: SocialExtras = {}) {
  const state = baseState(observation, recentChat(observation));
  const social = socialState(observation, extras);
  const full: typeof state & { social?: NonNullable<typeof social> } = social
    ? { ...state, social }
    : state;
  assertNoComparableNumbers(full);
  assertStateTokenBudget(full);
  return full;
}

/**
 * The role-scoped state without the chat and social blocks, for a question that builds its own
 * scoped versions of them (the promise response, spec §5.4). It runs no guard: the caller runs
 * `assertNoComparableNumbers` and `assertStateTokenBudget` on the state it finally sends.
 */
export function buildJevBaseState(observation: Observation) {
  return baseState(observation, []);
}

function baseState(observation: Observation, recent: ReturnType<typeof recentChat>) {
  const summary = summarizeObservation(observation);
  const you = observation.public.players.find(
    (player) => player.seatIndex === observation.own.seatIndex,
  );
  if (!you) throw new RangeError('Observation has no player for its own seat');
  const team = (player: typeof you) =>
    player.team.map((pokemon) => ({
      id: pokemon.instanceId,
      species_id: pokemon.speciesId,
      origin: pokemon.origin,
      tired: pokemon.tired,
      ability_ready: pokemon.abilityReady,
    }));
  const item = (entry: Observation['own']['items'][number]) => ({
    id: entry.instanceId,
    item_id: entry.itemId,
    name: entry.name,
  });
  const state = {
    phase: observation.public.phase.kind,
    active_seat_id: observation.public.activeSeatIndex,
    ...(recent.length > 0 && { recent_chat: recent }),
    final_table_round: observation.public.finalTableRound !== null,
    board: observation.public.board.map((space) => ({
      space_id: space.position,
      kind: space.kind,
      name: space.name,
    })),
    you: {
      id: you.actorId,
      seat_id: you.seatIndex,
      class_id: you.classId,
      ...summary.you,
      ability_ready: you.abilityReady,
      team: team(you),
      items: observation.own.items.map(item),
      balls: summary.balls,
      private_results: observation.own.privateResults.map((result) => ({
        kind: result.kind,
        event_id: result.eventId,
      })),
    },
    opponents: summary.opponents.map((opponent) => {
      const player = observation.public.players.find(
        (candidate) => candidate.actorId === opponent.id,
      );
      if (!player) throw new RangeError('Observation has no opponent player');
      return {
        ...opponent,
        seat_id: player.seatIndex,
        class_id: player.classId,
        ability_ready: player.abilityReady,
        team: team(player),
        known_items: player.knownItems.map(item),
      };
    }),
  };
  return state;
}

export type JevState = ReturnType<typeof buildJevState>;
