import { readdirSync } from 'node:fs';
import { expect, test } from 'vitest';
import { PERSONALITY_IDS } from '../../content/lines-schema.ts';
import { parseSimArgs } from '../../sim/args.ts';
import { realEngine } from '../../sim/engine.ts';
import { POLICIES } from '../../sim/policy.ts';
import { runSim } from '../../sim/runner.ts';
import { PERSONALITIES } from './index.ts';

// Spec §5.5: four personality files, each with a distinct weight profile.
test('every spec personality has a validated file and a registered personality', () => {
  const files = readdirSync(new URL('../../content/personalities/', import.meta.url))
    .filter((name) => name.endsWith('.json'))
    .map((name) => name.slice(0, -'.json'.length));
  expect(files.sort()).toEqual([...PERSONALITY_IDS].sort());
  expect(Object.keys(PERSONALITIES).sort()).toEqual([...PERSONALITY_IDS].sort());
});

test('weight profiles and line styles are all distinct', () => {
  const all = Object.values(PERSONALITIES);
  expect(new Set(all.map((p) => JSON.stringify(p.weights))).size).toBe(all.length);
  expect(new Set(all.map((p) => p.lineStyle)).size).toBe(all.length);
  expect(new Set(all.map((p) => p.sellThreshold)).size).toBe(all.length);
});

test('the profiles keep their documented order', () => {
  const { aggressive, cautious, opportunist, greedy } = PERSONALITIES;
  expect(aggressive.weights.aggression).toBeGreaterThan(opportunist.weights.aggression);
  expect(opportunist.weights.aggression).toBeGreaterThan(cautious.weights.aggression);
  expect(cautious.weights.loyalty).toBeGreaterThan(greedy.weights.loyalty);
  expect(aggressive.weights.risk).toBeGreaterThan(cautious.weights.risk);
  expect(greedy.weights.liquidity).toBeGreaterThan(aggressive.weights.liquidity);
});

test.each(['aggressive', 'cautious', 'opportunist'])(
  'a policy-only sim with %s finishes with no illegal action',
  async (name) => {
    const options = parseSimArgs(['--games', '4', '--seed', '7', '--policy', `fallback-${name}`]);
    expect(Object.hasOwn(POLICIES, options.policy)).toBe(true);
    const { summary, failures } = await runSim(realEngine, options, POLICIES);
    expect(failures).toEqual([]);
    expect(summary.illegalAppliedActionCount).toBe(0);
    expect(summary.invariantFailures).toBe(0);
  },
  120_000,
);
