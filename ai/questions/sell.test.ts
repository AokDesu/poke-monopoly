import { describe, expect, test } from 'vitest';
import {
  applyAction,
  createGame,
  createGameConfig,
  observe,
  type GameState,
  type PokemonInstance,
} from '../../engine/index.ts';
import { toEngineContent } from '../../content/schema.ts';
import { PERSONALITIES } from '../fallback/index.ts';
import type { JevAnswer, JevResult } from '../jev/client.ts';
import { createFakeJevClient } from '../jev/fake.ts';
import { assertNoComparableNumbers, assertStateTokenBudget } from '../state/index.ts';
import { CONTENT } from './content.ts';
import {
  bucketSellValue,
  buildSellQuestions,
  decideSales,
  REQUESTS_PER_TURN,
  sellAnswers,
  type SaleFact,
  type SellFacts,
} from './index.ts';

const greedy = PERSONALITIES.greedy;

/** A live current-version game in seat 0's Sell Phase; seat 0 is a Researcher (+3 once per Lap). */
function sellPhase(team: PokemonInstance[], classId = 'researcher'): GameState {
  const state = createGame(
    createGameConfig({
      seats: [{ classId }, { classId: 'rival' }, { classId: 'nurse-joy' }].map(
        (seat, seatIndex) => ({
          ...seat,
          actorId: `P${seatIndex + 1}`,
          seatIndex,
          controller: seatIndex === 0 ? 'ai' : 'human',
        }),
      ),
      seed: 11,
      lapTarget: 3,
    }),
    toEngineContent(CONTENT),
  );
  state.phase = { kind: 'sell', destinationPosition: 0 };
  state.globalTurnNo = 4;
  state.players[0]!.creditedLap = 1;
  state.players[0]!.team = team;
  return state;
}

const caught = (n: number, speciesId: string, extra: Partial<PokemonInstance> = {}) => ({
  instanceId: `caught:0:${n}`,
  speciesId,
  origin: 'caught' as const,
  evolutionStage: 0,
  tired: false,
  abilityReady: true,
  tradeable: true,
  ...extra,
});

const rescue: PokemonInstance = {
  instanceId: 'rescue:0:9',
  speciesId: 'bulbasaur',
  origin: 'rescue_starter',
  evolutionStage: 0,
  tired: false,
  abilityReady: true,
  tradeable: false,
};

/** The engine's own sale prices, read from `applyAction` on a copy, as the sim's facts do. */
function salePrices(state: GameState, ids: string[]) {
  const result = applyAction(state, {
    actorId: 'P1',
    actionSeq: state.stateRevision + 1,
    stateRevisionBefore: state.stateRevision,
    kind: 'sell',
    payload: { pokemonInstanceIds: ids },
  });
  if ('rejected' in result) throw new Error(`Sale rejected: ${result.reason}`);
  const sales = result.events.flatMap((event) =>
    event.kind === 'coin_transfer' && event.reason === 'pokemon_sale' && event.sale
      ? [event.sale]
      : [],
  );
  return new Map(ids.map((id, index) => [id, sales[index]!]));
}

function engineFacts(state: GameState, keepValue: (id: string) => number = () => 2): SellFacts {
  const ids = state.players[0]!.team.map((pokemon) => pokemon.instanceId);
  const together = salePrices(state, ids);
  return {
    pokemon: ids.map((instanceId) => ({
      instanceId,
      salePrice: together.get(instanceId)!.basePrice,
      classBonusAlone: salePrices(state, [instanceId]).get(instanceId)!.classBonus,
      classBonusTogether: together.get(instanceId)!.classBonus,
      keepValue: keepValue(instanceId),
    })),
  };
}

const fiveTeam = () => [
  caught(1, 'pidgey'),
  caught(2, 'eevee', { tired: true }),
  caught(3, 'dratini'),
  caught(4, 'magikarp'),
  caught(5, 'snorlax', { abilityReady: false }),
];

function ask(state: GameState, facts = engineFacts(state), requestsLeft?: number) {
  return buildSellQuestions(observe(state, 0), facts, greedy, requestsLeft);
}

const noul = (value: number): JevAnswer => ({ type: 'noul', noul: value });

describe('a team of five (spec §5.3)', () => {
  const state = sellPhase(fiveTeam());
  const { requests, fallbackIds } = ask(state);
  const [request] = requests;

  test('exact question text (spec §5.4: wording changes are reviewed)', () => {
    expect(request).toMatchSnapshot();
  });

  test('one request with exactly five Noul questions, one per Pokémon', () => {
    expect(requests).toHaveLength(1);
    expect(fallbackIds).toEqual([]);
    const questions = Object.values(request!.questions);
    expect(questions).toHaveLength(5);
    for (const question of questions) expect(question.type).toBe('noul');
    expect(Object.values(request!.options)).toEqual(
      state.players[0]!.team.map((pokemon) => pokemon.instanceId),
    );
  });

  test('each question names its Pokémon by a stable team label, not its raw ID', () => {
    const labels = Object.keys(request!.questions);
    expect(labels).toEqual([
      'sell_team_0',
      'sell_team_1',
      'sell_team_2',
      'sell_team_3',
      'sell_team_4',
    ]);
    expect(Object.keys(request!.options)).toEqual(labels);
    expect(Object.keys(request!.state.sell_phase.offers)).toEqual(labels);
    for (const [label, question] of Object.entries(request!.questions)) {
      const id = request!.options[label]!;
      expect(label).not.toContain(id.split(':').at(-1));
      expect(JSON.stringify(question)).not.toContain(id);
    }
    // The same observation and facts always give the same labels.
    expect(ask(state)).toEqual(ask(state));
  });

  test('state passes the §5.4 numeric guard and the 4,000-token estimate', () => {
    expect(() => assertNoComparableNumbers(request!.state)).not.toThrow();
    expect(() => assertStateTokenBudget(request!.state)).not.toThrow();
  });

  test('sale value, keep value and class bonus are separate buckets; badges are never values', () => {
    for (const offer of Object.values(request!.state.sell_phase.offers)) {
      expect(Object.keys(offer)).toEqual([
        'pokemon',
        'sale_value_now',
        'keep_value',
        'class_bonus',
      ]);
      expect(['low', 'medium', 'high']).toContain(offer.sale_value_now);
      expect(['low', 'medium', 'high']).toContain(offer.keep_value);
      expect(JSON.stringify(offer)).not.toMatch(/\d/);
    }
    state.players[0]!.badges = 4;
    const text = JSON.stringify(ask(state).requests);
    expect(text).not.toMatch(/badge/i);
    expect(ask(state)).toEqual(ask(sellPhase(fiveTeam())));
  });

  test('the engine prices map to buckets: tired Eevee, Dratini with the bonus, Snorlax without', () => {
    const offers = request!.state.sell_phase.offers;
    expect(offers.sell_team_0).toEqual({
      pokemon: 'Pidgey',
      sale_value_now: 'low',
      keep_value: 'low',
      class_bonus: 'only if you do not also sell a Pokémon that takes it instead',
    });
    // Eevee's base 12 becomes 10 when tired: still medium.
    expect(offers.sell_team_1!.sale_value_now).toBe('medium');
    expect(offers.sell_team_2).toMatchObject({ sale_value_now: 'high', class_bonus: 'yes' });
    expect(offers.sell_team_4!.class_bonus).not.toBe('yes');
  });

  test('a class without a sale bonus says no for every Pokémon', () => {
    const plain = sellPhase(fiveTeam(), 'team-rocket');
    for (const offer of Object.values(ask(plain).requests[0]!.state.sell_phase.offers)) {
      expect(offer.class_bonus).toBe('no');
    }
  });
});

describe('decideSales (spec §5.3: noul ≥ threshold(personality))', () => {
  test('sells exactly the Pokémon at or above the threshold, equality included', () => {
    expect(greedy.sellThreshold).toBe(0.56);
    const answers = {
      a: noul(0.56),
      b: noul(0.5599),
      c: noul(0.9),
      d: noul(0),
      e: noul(1),
    };
    expect(decideSales(answers, greedy)).toEqual(['a', 'c', 'e']);
    expect(decideSales(answers, { sellThreshold: 0.9 })).toEqual(['c', 'e']);
    expect(decideSales({}, greedy)).toEqual([]);
  });

  test('never reads a confidence field and ignores answers that are not a Noul', () => {
    const tricky = noul(0.7);
    Object.defineProperty(tricky, 'confidence', {
      enumerable: true,
      get() {
        throw new Error('confidence was read');
      },
    });
    const choice: JevAnswer = { type: 'choice', choice: 'yes', confidence: 1, probabilities: {} };
    expect(decideSales({ a: tricky, b: choice }, greedy)).toEqual(['a']);
  });

  test('recorded answers round-trip through the request options to instance IDs', () => {
    const state = sellPhase(fiveTeam());
    const [request] = ask(state).requests;
    const recorded: Record<string, JevAnswer> = {
      sell_team_0: noul(0.8),
      sell_team_1: noul(0.2),
      sell_team_2: noul(0.56),
      sell_team_3: noul(0.55),
      sell_team_4: noul(0.1),
      sell_team_9: noul(1),
    };
    expect(decideSales(sellAnswers(request!, recorded), greedy)).toEqual([
      'caught:0:1',
      'caught:0:3',
    ]);
  });
});

describe('large teams (spec §5.3: ≤ 12 per request, ≤ 3 requests per AI turn)', () => {
  const species = ['pidgey', 'rattata', 'eevee', 'machop', 'psyduck', 'growlithe', 'chansey'];
  const team = Array.from({ length: 14 }, (_, n) => caught(n, species[n % species.length]!));

  test('a team of 14 splits into requests of 12 and 2 within the request budget', async () => {
    const state = sellPhase(team);
    const { requests, fallbackIds } = ask(state);
    expect(requests.map((request) => Object.keys(request.questions).length)).toEqual([12, 2]);
    expect(fallbackIds).toEqual([]);
    expect(Object.keys(requests[1]!.questions)).toEqual(['sell_team_12', 'sell_team_13']);
    for (const request of requests) {
      expect(Object.keys(request.state.sell_phase.offers)).toEqual(Object.keys(request.questions));
      expect(() => assertStateTokenBudget(request.state)).not.toThrow();
    }

    let sent = 0;
    const client = createFakeJevClient((request): JevResult => {
      sent++;
      const answers = Object.fromEntries(
        Object.keys(request.questions).map((name) => [name, noul(1)]),
      );
      return {
        ok: true,
        answers,
        requestId: `fake_${sent}`,
        model: 'jev-1.13.0',
        latencyMs: 0,
        usage: { inputTokens: 1, outputTokens: 1 },
      };
    });
    const sold: string[] = [];
    for (const request of requests) {
      const result = await client.ask(request, { decisionSignal: new AbortController().signal });
      if (!result.ok) throw new Error('Expected an answer');
      sold.push(...decideSales(sellAnswers(request, result.answers), greedy));
    }
    expect(sent).toBe(2);
    expect(sent).toBeLessThanOrEqual(REQUESTS_PER_TURN);
    expect(sold).toEqual(team.map((pokemon) => pokemon.instanceId));
  });

  test('with fewer requests left this turn, the rest go to the fallback', () => {
    const state = sellPhase(team);
    const one = ask(state, undefined, 1);
    expect(one.requests.map((request) => Object.keys(request.questions).length)).toEqual([12]);
    expect(one.fallbackIds).toEqual(['caught:0:12', 'caught:0:13']);
    const none = ask(state, undefined, 0);
    expect(none.requests).toEqual([]);
    expect(none.fallbackIds).toEqual(team.map((pokemon) => pokemon.instanceId));
  });
});

describe('Rescue Starters (spec §4.7)', () => {
  test('are never offered, so no question or decision touches one', () => {
    const state = sellPhase([caught(1, 'pidgey'), rescue, caught(2, 'eevee')]);
    const facts = engineFacts(state);
    expect(facts.pokemon.map((fact) => fact.instanceId)).toContain(rescue.instanceId);
    const { requests, fallbackIds } = ask(state, facts);
    const [request] = requests;
    expect(Object.keys(request!.questions)).toEqual(['sell_team_0', 'sell_team_2']);
    expect(Object.values(request!.options)).not.toContain(rescue.instanceId);
    expect(fallbackIds).not.toContain(rescue.instanceId);
    const everyYes = Object.fromEntries(
      ['sell_team_0', 'sell_team_1', 'sell_team_2'].map((label) => [label, noul(1)]),
    );
    expect(decideSales(sellAnswers(request!, everyYes), greedy)).toEqual([
      'caught:0:1',
      'caught:0:2',
    ]);
  });

  test('a team of only a Rescue Starter asks nothing', () => {
    const state = sellPhase([rescue]);
    expect(ask(state)).toEqual({ requests: [], fallbackIds: [] });
  });
});

describe('buckets (spec §5.4, §5.6)', () => {
  test('sale and keep values are low up to 5, medium 6–12 and high from 13', () => {
    expect([0, 5, 6, 12, 13, 26].map(bucketSellValue)).toEqual([
      'low',
      'low',
      'medium',
      'medium',
      'high',
      'high',
    ]);
    for (const bad of [-1, 2.5, NaN]) expect(() => bucketSellValue(bad)).toThrow(RangeError);
  });

  test('keep value comes from the facts, apart from the sale value', () => {
    const state = sellPhase([caught(1, 'dratini')]);
    const facts = engineFacts(state, () => 3);
    const offer = ask(state, facts).requests[0]!.state.sell_phase.offers.sell_team_0!;
    expect(offer).toMatchObject({ sale_value_now: 'high', keep_value: 'low' });
  });

  test('Laps remaining and the last Sell Phase follow the Lap target and the Final Table Round', () => {
    const state = sellPhase(fiveTeam());
    expect(ask(state).requests[0]!.state.sell_phase).toMatchObject({
      laps_remaining: 'few',
      last_sell_phase: false,
    });
    state.players[0]!.creditedLap = 2;
    expect(ask(state).requests[0]!.state.sell_phase.laps_remaining).toBe('one');
    state.finalTableRound = { triggerSeatIndex: 1, targetOwnTurnNo: 3 };
    expect(ask(state).requests[0]!.state.sell_phase).toMatchObject({
      laps_remaining: 'none',
      last_sell_phase: true,
    });
  });

  test('a fact for a Pokémon outside the team, or outside a Sell Phase, is an error', () => {
    const state = sellPhase(fiveTeam());
    const stray: SaleFact = {
      instanceId: 'caught:1:1',
      salePrice: 4,
      classBonusAlone: 0,
      classBonusTogether: 0,
      keepValue: 2,
    };
    expect(() => ask(state, { pokemon: [stray] })).toThrow('not in your team');
    const facts = engineFacts(state);
    state.phase = { kind: 'strategy' };
    expect(() => ask(state, facts)).toThrow('Sell Phase');
  });
});
