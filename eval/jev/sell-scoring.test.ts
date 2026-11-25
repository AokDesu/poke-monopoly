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
    // Aggressive Noul 0.86 is below 0.92: asked, it would not sell on the last phase. It is not
    // asked there any more (spec §5.6), so the row is the applied sale of everything, which is right.
    expect(row('aggressive-sell-last-phase-final-round', 'sell_team_2')).toMatchObject({
      answer: 'true',
      correct: true,
      rule: true,
    });
    // A Sell Jev is still asked about keeps the threshold: Aggressive Noul 0.66 stays a keep.
    expect(row('aggressive-sell-snorlax-high-sale-low-keep', 'sell_team_1')).toMatchObject({
      answer: 'false',
    });
  });
});
