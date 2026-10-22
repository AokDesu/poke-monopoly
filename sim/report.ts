import type { SimSummary } from './runner.ts';

const BALLS = ['poke', 'great', 'ultra'] as const;

/** A short human-readable view of `summary`, printed after its JSON line. */
export function formatSummary(summary: SimSummary): string[] {
  const { catching, shop, salesByLap } = summary;
  const row = (label: string, value: string) => `  ${label.padEnd(22)}${value}`;
  const lines = [
    `Sim: ${summary.games} games, ${summary.seats} seats, seed set ${summary.seedSet}`,
    row('Turns per game', String(summary.averageTurns)),
    row('Average final coins', String(summary.averageFinalCoins)),
    row('Tie rate', `${summary.tieRate} (${summary.ties} ${summary.ties === 1 ? 'tie' : 'ties'})`),
    row(
      'Catching',
      `${catching.encounters} encounters, ${catching.attempts} attempts, ` +
        `${catching.catches} catches, ${catching.releases} releases`,
    ),
    row('Shop', list(shop.purchases) || 'no purchases'),
    row(
      'Sales by Lap',
      Object.entries(salesByLap)
        .map(([lap, sales]) => `Lap ${lap}: ${sales.sold} sold for ${sales.coins}`)
        .join('; ') || 'none',
    ),
    row(
      'Class in seat',
      Object.entries(summary.classInSeat)
        .map(([classId, seats]) => `${classId} ${seats.join('/')}`)
        .join(', '),
    ),
  ];
  const dcLaps = catching.byBallDcLap.filter((entry) => entry.ballType === BALLS[0]);
  if (dcLaps.length > 0) {
    lines.push('  catchAttempt / encounter by DC and Lap (Poké / Great / Ultra):');
    for (const { dc, lap, encounters } of dcLaps) {
      const rates = BALLS.map(
        (ballType) =>
          catching.byBallDcLap.find(
            (entry) => entry.ballType === ballType && entry.dc === dc && entry.lap === lap,
          )!.attemptsPerEncounter,
      );
      lines.push(`    DC ${dc} Lap ${lap}  n=${String(encounters).padEnd(5)} ${rates.join(' / ')}`);
    }
  }
  return lines;
}

function list(counts: Record<string, number>): string {
  return Object.entries(counts)
    .map(([key, n]) => `${key} ${n}`)
    .join(', ');
}
