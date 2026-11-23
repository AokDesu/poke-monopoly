import { expect, test } from 'vitest';
import { realEngine } from './engine.ts';
import { POLICIES } from './policy.ts';
import { DEFAULT_OPTIONS, runSim } from './runner.ts';

// Random 4-seat games until every class passive and Ability primitive fires: ~21 s alone; budget for load (ET-05).
const FEATURES_MS = 120_000;

/**
 * §8 and Appendix A: every bonus must have a real chance to trigger, so a random game set cannot
 * pass by never exercising a class passive or an Ability primitive. `heal` (Heal Pulse needs a
 * Tired member while defending) is proven by the scenarios in engine/starter-abilities.test.ts.
 */
test(
  'random 4-seat games trigger all six core class passives and every content-reachable Ability primitive (§8)',
  async () => {
    const { summary } = await runSim(
      realEngine,
      { ...DEFAULT_OPTIONS, games: 60, seed: 1, seats: 4 },
      POLICIES,
      () => [],
    );
    expect(summary.aborted).toBe(0);
    const { classPassives, primitives, battles } = summary.features;
    for (const passive of [
      'lap_first_catch_bonus',
      'combat_bonus',
      'water_catch_bonus',
      'turn_start_team_heal',
      'bug_catch_sale_bonus',
      'lap_first_sale_bonus',
    ]) {
      expect([passive, classPassives[passive] ?? 0]).not.toEqual([passive, 0]);
    }
    for (const primitive of [
      'fixedMove',
      'moveDebuff',
      'rollBonus',
      'shield',
      'gainBall',
      'gainCoin',
      'peek',
      'forcePvP',
    ]) {
      expect([primitive, primitives[primitive] ?? 0]).not.toEqual([primitive, 0]);
    }
    expect(battles.pvp).toBeGreaterThan(0);
    expect(battles.forced).toBeGreaterThan(0);
    expect(battles.gym).toBeGreaterThan(0);
  },
  FEATURES_MS,
);
