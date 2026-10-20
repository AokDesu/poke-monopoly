import { summarizeObservation } from '../../engine/index.ts';
import type { Observation } from '../../engine/index.ts';
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

/** Explicit projection rather than spreading observations (spec §1, §5.4, §9). */
export function buildJevState(observation: Observation) {
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
  assertNoComparableNumbers(state);
  assertStateTokenBudget(state);
  return state;
}

export type JevState = ReturnType<typeof buildJevState>;
