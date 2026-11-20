import { describe, expect, it } from 'vitest';
import { PERSONALITIES } from '../../ai/fallback/index.ts';
import { runOffline } from './index.ts';

// Issue #59, spec §5.3: a Sell Noul is scored at the personality's own sell threshold.
describe('Sell scoring', () => {
  it('scores each Sell answer at the personality sell threshold, not 0.5', async () => {
    const rows = await runOffline();
    const row = (fixture: string, question: string) =>
      rows.find((entry) => entry.fixture === fixture && entry.question === question)!;
    // Aggressive Noul 0.59 is below 0.92, so it keeps (the set expects keep).
    expect(PERSONALITIES.aggressive.sellThreshold).toBeGreaterThan(0.59);
    expect(row('aggressive-sell-magikarp-low-sale-high-keep', 'sell_team_1')).toMatchObject({
      answer: 'false',
      correct: true,
    });
    // Aggressive Noul 0.86 is below 0.92, so it would not sell on the last phase: a real miss.
    expect(row('aggressive-sell-last-phase-final-round', 'sell_team_2')).toMatchObject({
      answer: 'false',
      correct: false,
    });
  });
});
