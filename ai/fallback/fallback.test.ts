import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, expectTypeOf, test } from 'vitest';
import {
  parsePersonality,
  sellThreshold,
  type Personality,
} from '../../content/personality-schema.ts';
import {
  checkInvariants,
  fixtureSchema,
  type Action,
  type GameState,
  type LegalAction,
  type LegalActions,
  type Observation,
} from '../../engine/index.ts';
import encounterFixture from '../../engine/fixtures/encounter-with-balls.json';
import sellFixture from '../../engine/fixtures/sell-phase-three-pokemon.json';
import shopFixture from '../../engine/fixtures/shop-low-coins.json';
import strategyFixture from '../../engine/fixtures/strategy-with-items.json';
import { parseSimArgs } from '../../sim/args.ts';
import { realEngine } from '../../sim/engine.ts';
import { createPolicyRng, POLICIES, type PolicyFacts } from '../../sim/policy.ts';
import { DEFAULT_OPTIONS, runSim, type SimEngine } from '../../sim/runner.ts';
import {
  decideWithFallback,
  FallbackPolicy,
  FALLBACK_TUNING,
  PERSONALITIES,
  saleDesire,
  scoreOptions,
} from './index.ts';

const greedy = PERSONALITIES.greedy;
/** Greedy with only liquidity lowered, for directional tests (not a shipped personality). */
const hoarder = parsePersonality('hoarder', {
  ...(greedyJson() as object),
  weights: { ...greedy.weights, liquidity: 0.2 },
});

function greedyJson(): unknown {
  return JSON.parse(
    readFileSync(new URL('../../content/personalities/greedy.json', import.meta.url), 'utf8'),
  );
}

function seat0(fixture: unknown): { observation: Observation; legal: LegalActions } {
  const parsed = fixtureSchema.parse(fixture);
  return { observation: parsed.observation['0']!, legal: parsed.legalActions['0']! };
}

const decide = (
  personality: Personality,
  observation: Observation,
  legal: LegalActions,
  facts: PolicyFacts = {},
  seed = 1,
) => new FallbackPolicy(personality).decide(observation, legal, createPolicyRng(seed), facts);

describe('personality files (§5.5)', () => {
  const dir = new URL('../../content/personalities/', import.meta.url);

  test('every content/personalities/*.json validates and Greedy matches Appendix B', () => {
    const files = readdirSync(dir).filter((name) => name.endsWith('.json'));
    expect(files).toEqual(['greedy.json']);
    for (const file of files) {
      const json = JSON.parse(readFileSync(new URL(file, dir), 'utf8'));
      expect(() => parsePersonality(file.slice(0, -'.json'.length), json)).not.toThrow();
    }
    expect(greedy).toMatchObject({
      id: 'greedy',
      name: 'Greedy',
      description: 'Values cash now over long-term team building; avoids fights it may lose.',
      lineStyle: 'mercenary',
    });
  });

  const broken: [string, (draft: Record<string, unknown>) => void, string, string][] = [
    ['a missing description', (d) => delete d.description, 'description', 'description'],
    [
      'a weight above 1',
      (d) => ((d.weights as Record<string, number>).liquidity = 1.5),
      'Too big',
      'weights.liquidity',
    ],
    [
      'a missing weight',
      (d) => delete (d.weights as Record<string, number>).loyalty,
      'loyalty',
      'weights.loyalty',
    ],
    ['an unknown key', (d) => (d.betrayalRate = 0.3), 'betrayalRate', ''],
    ['a lineStyle that is not an id', (d) => (d.lineStyle = 'Mean!'), 'kebab-case', 'lineStyle'],
  ];

  test.each(broken)('rejects %s with a readable message', (_name, breakIt, message, path) => {
    const draft = greedyJson() as Record<string, unknown>;
    breakIt(draft);
    expect(() => parsePersonality('greedy', draft)).toThrow('Invalid personality "greedy"');
    expect(() => parsePersonality('greedy', draft)).toThrow(message);
    if (path) expect(() => parsePersonality('greedy', draft)).toThrow(`→ at ${path}`);
  });

  test('the sell threshold falls as liquidity rises', () => {
    expect(greedy.sellThreshold).toBe(0.56);
    expect(hoarder.sellThreshold).toBe(0.98);
    for (let step = 0; step < 10; step++) {
      const low = { ...greedy.weights, liquidity: step / 10 };
      const high = { ...greedy.weights, liquidity: (step + 1) / 10 };
      expect(sellThreshold(high)).toBeLessThan(sellThreshold(low));
    }
  });
});

describe('FallbackPolicy input (§5.2, house rule 3)', () => {
  test('decides from an Observation and cannot be handed the game state', () => {
    expectTypeOf<Parameters<FallbackPolicy['decide']>[0]>().toEqualTypeOf<Observation>();
    expectTypeOf<Observation>().not.toHaveProperty('rng');
    expectTypeOf<Observation>().not.toHaveProperty('eventDeck');
    expectTypeOf<PolicyFacts>().toEqualTypeOf<{
      catchChance?: Readonly<Partial<Record<'poke' | 'great' | 'ultra', number>>>;
      saleValue?: Readonly<Record<string, number>>;
    }>();
    const state = fixtureSchema.parse(sellFixture).state;
    const { legal } = seat0(sellFixture);
    const policy = new FallbackPolicy(greedy);
    // @ts-expect-error A GameState is not an Observation: the policy never sees full state.
    expect(() => policy.decide(state satisfies GameState, legal, createPolicyRng(1))).toThrow();
  });
});

describe('Sell Phase', () => {
  const { observation, legal } = seat0(sellFixture);
  const facts = { saleValue: { 'pokemon-0': 5, 'pokemon-2': 8, 'pokemon-3': 12 } };

  test('Greedy sells more eagerly than a less liquid personality', () => {
    expect(decide(greedy, observation, legal, facts)).toBe('sell:pokemon-3');
    expect(decide(hoarder, observation, legal, facts)).toBe('finish-sell');
  });

  test('whenever the less liquid personality sells, Greedy sells too', () => {
    for (const best of [1, 4, 9, 20]) {
      for (const other of [0, 1, 5, 20]) {
        const varied = { saleValue: { 'pokemon-0': other, 'pokemon-2': other, 'pokemon-3': best } };
        if (decide(hoarder, observation, legal, varied) !== 'finish-sell') {
          expect(decide(greedy, observation, legal, varied)).not.toBe('finish-sell');
        }
      }
    }
  });

  test('a ready Ability or an Original Starter holds some desire back', () => {
    const even = { saleValue: { 'pokemon-0': 10, 'pokemon-2': 10, 'pokemon-3': 10 } };
    const { keepFeature } = FALLBACK_TUNING;
    expect(saleDesire(observation, 'pokemon-0', even)).toBeCloseTo(1 - 2 * keepFeature);
    expect(saleDesire(observation, 'pokemon-2', even)).toBeCloseTo(1 - keepFeature);
  });

  test('keeps the team without engine sale values', () => {
    expect(decide(greedy, observation, legal)).toBe('finish-sell');
  });

  test('sells every qualifying Pokémon in one atomic batch and keeps the rest (§4.7, §5.3)', () => {
    // Desires 0.21, 0.5625 and 0.75 against Greedy's 0.56: the seed-1 two-seat shape.
    const two = { saleValue: { 'pokemon-0': 5, 'pokemon-2': 9, 'pokemon-3': 12 } };
    expect(saleDesire(observation, 'pokemon-2', two)).toBe(0.5625);
    expect(decide(greedy, observation, legal, two)).toEqual({
      sellUids: ['pokemon-2', 'pokemon-3'],
    });
    expect(decide(hoarder, observation, legal, two)).toBe('finish-sell');
  });

  test('the qualifying batch outscores each of its parts and any batch with a kept Pokémon', () => {
    const two = { saleValue: { 'pokemon-0': 5, 'pokemon-2': 9, 'pokemon-3': 12 } };
    const sale = (...ids: string[]): LegalAction => ({
      id: `sell:${ids.join('+')}`,
      kind: 'sell',
      payload: { pokemonInstanceIds: ids },
    });
    const options = [
      sale(),
      sale('pokemon-2'),
      sale('pokemon-3'),
      sale('pokemon-2', 'pokemon-3'),
      sale('pokemon-0', 'pokemon-2', 'pokemon-3'),
    ];
    const scores = [...scoreOptions(observation, options, greedy, two).values()];
    expect(Math.max(...scores)).toBe(scores[3]);
    expect(scores[4]).toBeLessThan(scores[3]!);
  });
});

describe('Encounter', () => {
  const { observation, legal } = seat0(encounterFixture);

  test('a Great Ball wins only when its extra chance outweighs its cost', () => {
    expect(decide(greedy, observation, legal, { catchChance: { poke: 0.5, great: 0.6 } })).toBe(
      'catch:poke',
    );
    expect(decide(greedy, observation, legal, { catchChance: { poke: 0.33, great: 0.67 } })).toBe(
      'catch:great',
    );
  });

  test('releases when every chance is below the risk-weighted bar', () => {
    expect(decide(greedy, observation, legal, { catchChance: { poke: 0.17, great: 0.17 } })).toBe(
      'release',
    );
  });

  test('without odds it throws the cheapest Ball', () => {
    expect(decide(greedy, observation, legal)).toBe('catch:poke');
  });
});

describe('Strategy', () => {
  const base = seat0(strategyFixture).observation;
  const observation: Observation = structuredClone(base);
  const third = { ...structuredClone(base.public.players[1]!), seatIndex: 2, actorId: 'player-2' };
  observation.public.players.push(third);
  observation.public.players[1]!.coins = 12;
  third.coins = 30;
  observation.own.items = ['pickpocket', 'repel'].map((itemId) => ({
    instanceId: `item-${itemId}`,
    itemId,
    name: itemId,
    visibility: 'secret' as const,
  }));
  const item = (itemId: string, seat: number): LegalAction => ({
    id: `use-item:item-${itemId}:seat-${seat}`,
    kind: 'use_item',
    payload: { itemInstanceId: `item-${itemId}`, targetSeatIndex: seat },
  });
  const legal: LegalActions = {
    enabled: [
      item('pickpocket', 1),
      item('pickpocket', 2),
      item('repel', 1),
      item('repel', 2),
      { id: 'skip', kind: 'skip', payload: {} },
    ],
    disabled: [],
  };

  test('Greedy pickpockets the richest opponent and never Repels', () => {
    expect(decide(greedy, observation, legal)).toBe('use-item:item-pickpocket:seat-2');
    const noPickpocket = {
      ...legal,
      enabled: legal.enabled.filter((option) => !option.id.includes('pickpocket')),
    };
    expect(decide(greedy, observation, noPickpocket)).toBe('skip');
  });

  test('an item with no implemented effect is never used', () => {
    const potion = seat0(strategyFixture);
    expect(decide(greedy, potion.observation, potion.legal)).toBe('skip');
  });

  test('identical input and seed give identical choices; exact ties use the seed', () => {
    const level: Observation = structuredClone(observation);
    level.public.players[1]!.coins = 30;
    const run = (seed: number) =>
      Array.from({ length: 20 }, (_, i) => decide(greedy, level, legal, {}, seed + i));
    expect(run(3)).toEqual(run(3));
    expect(new Set(run(3))).toEqual(
      new Set(['use-item:item-pickpocket:seat-1', 'use-item:item-pickpocket:seat-2']),
    );
  });
});

describe('Shop', () => {
  const { observation, legal } = seat0(shopFixture);

  test('keeps its last coin while it holds plenty of Balls', () => {
    expect(decide(greedy, observation, legal)).toBe('skip');
  });

  test('buys a Ball once it has none', () => {
    const empty: Observation = structuredClone(observation);
    empty.own.balls = { poke: 0, great: 0, ultra: 0 };
    expect(decide(greedy, empty, legal)).toBe('buy:offer-poke');
  });
});

describe('decideWithFallback (§5.6 Normal)', () => {
  const { observation, legal } = seat0(encounterFixture);
  const facts = { catchChance: { poke: 0.5, great: 0.67 } };
  const base = {
    personality: greedy,
    observation,
    legalActions: legal,
    facts,
    confidenceFloor: 0.6,
  };
  const answer = (confidence: number) => ({
    choice: 'release',
    probabilities: { release: 0.5, 'catch:poke': 0.3, 'catch:great': 0.2 },
    confidence,
  });

  test("applies Jev's choice at or above the floor", () => {
    const decision = decideWithFallback({ ...base, rng: createPolicyRng(1), jev: answer(0.6) });
    expect(decision).toEqual({ choice: 'release', fallbackReason: null });
  });

  test("below the floor, chooses between Jev's top two by personality weight", () => {
    const decision = decideWithFallback({ ...base, rng: createPolicyRng(1), jev: answer(0.4) });
    // Top two are release and catch:poke; catch:great scores best but is third.
    expect(decision).toEqual({ choice: 'catch:poke', fallbackReason: 'low_confidence' });
  });

  test('an unusable answer falls back to the whole policy', () => {
    expect(
      decideWithFallback({ ...base, rng: createPolicyRng(1), jev: { fallbackReason: 'timeout' } }),
    ).toEqual({ choice: 'catch:great', fallbackReason: 'timeout' });
    const stray = { ...answer(0.9), choice: 'catch:ultra' };
    expect(decideWithFallback({ ...base, rng: createPolicyRng(1), jev: stray })).toEqual({
      choice: 'catch:great',
      fallbackReason: 'schema_mismatch',
    });
  });
});

describe('sim registration (§1: games finish with Jev off)', () => {
  test('`--policy fallback` is accepted and registered', () => {
    expect(parseSimArgs(['--policy', 'fallback']).policy).toBe('fallback');
    expect(POLICIES.fallback!()).toBeInstanceOf(FallbackPolicy);
  });

  // The CLI's 100-game run is the full check; this keeps a smaller one with every invariant.
  test(
    'real games with the fallback in every seat finish legally with no invariant failures',
    {
      timeout: 30_000,
    },
    () => {
      const options = { ...DEFAULT_OPTIONS, games: 2, seed: 1, seats: 3, policy: 'fallback' };
      const { summary, failures } = runSim(realEngine, options, POLICIES, checkInvariants);
      expect(failures).toEqual([]);
      expect(summary).toMatchObject({
        aborted: 0,
        illegalAppliedActionCount: 0,
        invariantFailures: 0,
      });
      expect(runSim(realEngine, options).summary).toEqual(summary);
    },
  );

  test('each Sell Phase of a seed-1 two-seat Greedy game sells exactly the qualifying batch', () => {
    const sales: { sold: string[]; qualifying: string[] }[] = [];
    const engine: SimEngine = {
      ...realEngine,
      applyAction(state, action) {
        const command = action as Action;
        if (state.phase.kind === 'sell' && command.kind === 'sell') {
          const seat = state.activeSeatIndex;
          const observation = realEngine.observe(state, seat);
          const facts = realEngine.facts!(state, seat);
          const team = observation.public.players.find((player) => player.seatIndex === seat)!;
          sales.push({
            sold: [...command.payload.pokemonInstanceIds],
            qualifying: team.team
              .map((pokemon) => pokemon.instanceId)
              .filter((id) => saleDesire(observation, id, facts) >= greedy.sellThreshold),
          });
        }
        return realEngine.applyAction(state, action);
      },
    };
    const options = { ...DEFAULT_OPTIONS, games: 1, seed: 1, seats: 2, policy: 'fallback' };
    const { summary } = runSim(engine, options, POLICIES, checkInvariants);
    expect(summary).toMatchObject({ illegalAppliedActionCount: 0, invariantFailures: 0 });
    for (const { sold, qualifying } of sales) expect(sold).toEqual(qualifying);
    expect(sales.some(({ sold }) => sold.length > 1)).toBe(true);
  });
});
