import type { Observation } from './contract/schema.ts';

/** Presentation thresholds, not changes to gameplay rules (spec §5.2, §5.4). */
export const STATE_BUCKET_CONFIG = Object.freeze({
  coins: Object.freeze({ levelDifference: 0, farDifference: 10 }),
  squaresToStart: Object.freeze({ nearMax: 6, middleMax: 12 }),
  count: Object.freeze({ noneMax: 0, oneMax: 1, fewMax: 3 }),
});

function assertCount(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError('Expected a nonnegative safe integer');
  }
}

export function bucketCoinsRelative(opponentCoins: number, yourCoins: number) {
  assertCount(opponentCoins);
  assertCount(yourCoins);
  const difference = opponentCoins - yourCoins;
  const { levelDifference, farDifference } = STATE_BUCKET_CONFIG.coins;
  if (difference >= farDifference) return 'far ahead';
  if (difference > levelDifference) return 'ahead';
  if (difference >= -levelDifference) return 'level';
  if (difference > -farDifference) return 'behind';
  return 'far behind';
}

export function bucketSquaresToStart(squares: number) {
  assertCount(squares);
  const { nearMax, middleMax } = STATE_BUCKET_CONFIG.squaresToStart;
  if (squares <= nearMax) return 'near';
  if (squares <= middleMax) return 'middle';
  return 'far';
}

export function bucketCount(count: number) {
  assertCount(count);
  const { noneMax, oneMax, fewMax } = STATE_BUCKET_CONFIG.count;
  if (count <= noneMax) return 'none';
  if (count <= oneMax) return 'one';
  if (count <= fewMax) return 'few';
  return 'many';
}

function ordinal(value: number): string {
  const lastTwo = value % 100;
  const suffix =
    lastTwo >= 11 && lastTwo <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[value % 10] ?? 'th');
  return `${value}${suffix}`;
}

/** Only role-visible observations enter these derivations; never snapshots or logs. */
export function summarizeObservation(observation: Observation) {
  const { players, board, lapTarget } = observation.public;
  const you = players.find((player) => player.seatIndex === observation.own.seatIndex);
  if (!you) throw new RangeError('Observation has no player for its own seat');
  const rank = 1 + players.filter((player) => player.coins > you.coins).length;
  const summary = (player: (typeof players)[number]) => ({
    lap: `${Math.min(player.creditedLap + 1, lapTarget)} of ${lapTarget}`,
    squares_to_start: bucketSquaresToStart((board.length - player.position) % board.length),
    team_count: bucketCount(player.team.length),
    item_count: bucketCount(player.itemCount),
  });
  return {
    you: { ...summary(you), coins_rank: `${ordinal(rank)} of ${players.length}` },
    opponents: players
      .filter((player) => player.seatIndex !== you.seatIndex)
      .map((player) => ({
        id: player.actorId,
        ...summary(player),
        coins_vs_you: bucketCoinsRelative(player.coins, you.coins),
      })),
    balls: {
      poke: bucketCount(observation.own.balls.poke),
      great: bucketCount(observation.own.balls.great),
      ultra: bucketCount(observation.own.balls.ultra),
    },
  };
}
