import { describe, expect, test } from 'vitest';
import {
  createGame,
  createGameConfig,
  legalActions,
  observe,
  oddsForAllBalls,
  type GameState,
  type LegalAction,
} from '../../engine/index.ts';
import { toEngineContent } from '../../content/schema.ts';
import { assertNoComparableNumbers, assertStateTokenBudget } from '../state/index.ts';
import { CONTENT } from './content.ts';
import {
  actionIdFor,
  ballCountWords,
  bucketCatchChance,
  buildEncounterQuestion,
  buildStrategyQuestion,
  shortlistActions,
  type Decision,
  type Personality,
} from './index.ts';

// Test personalities, not content files: content/personalities/ arrives with issue #40.
const greedy: Personality = {
  name: 'Greedy',
  description: 'values cash now over long-term team building; avoids fights it may lose.',
  weights: { risk: 0.3, aggression: 0.4, liquidity: 0.9, loyalty: 0.2 },
};
const loyal: Personality = {
  name: 'Loyal',
  description: 'keeps its word and avoids hurting other players.',
  weights: { risk: 0, aggression: 0.1, liquidity: 0.5, loyalty: 0.9 },
};

const SEATS = [
  { classId: 'main-character', starterSpeciesId: 'charmander' },
  { classId: 'rival' },
  { classId: 'nurse-joy' },
  { classId: 'researcher' },
];

/** A live current-version game; seat 0 is the AI being asked. */
function game(players: number, seed = 7): GameState {
  return createGame(
    createGameConfig({
      seats: SEATS.slice(0, players).map((seat, seatIndex) => ({
        ...seat,
        actorId: `P${seatIndex + 1}`,
        seatIndex,
        controller: seatIndex === 0 ? 'ai' : 'human',
      })),
      seed,
      lapTarget: 3,
    }),
    toEngineContent(CONTENT),
  );
}

function give(state: GameState, seat: number, itemId: string, visibility: 'public' | 'secret') {
  const player = state.players[seat]!;
  player.items.push({
    instanceId: `bought:${seat}:${player.items.length}`,
    itemId,
    name: CONTENT.items.find((item) => item.id === itemId)!.name,
    visibility,
  });
}

function strategy(players: number, items: string[]): GameState {
  const state = game(players);
  state.phase = { kind: 'strategy' };
  state.globalTurnNo = 1;
  state.players[0]!.ownTurnNo = 1;
  state.turnBudgets = { tacticalAction: 1, catchAttempt: 1, pokemonAbility: 1 };
  for (const itemId of items) give(state, 0, itemId, 'secret');
  return state;
}

function encounter(speciesId: string, balls: GameState['players'][number]['balls']): GameState {
  const state = game(2);
  state.phase = { kind: 'encounter', pokemon: { speciesId } };
  state.globalTurnNo = 1;
  state.turnBudgets = { tacticalAction: 1, catchAttempt: 1, pokemonAbility: 1 };
  state.players[0]!.balls = balls;
  return state;
}

function askStrategy(state: GameState, personality = greedy) {
  return buildStrategyQuestion(observe(state, 0), legalActions(state, 0).enabled, personality);
}

function askEncounter(state: GameState, personality = greedy) {
  return buildEncounterQuestion(
    observe(state, 0),
    legalActions(state, 0).enabled,
    { odds: oddsForAllBalls(state, 0) },
    personality,
  );
}

function asked<State extends object>(decision: Decision<State>) {
  if (decision.kind !== 'ask') throw new Error(`Expected a question, got ${decision.kind}`);
  return decision;
}

const fixtures = {
  'strategy: 2 players, Repel and Pickpocket against the Rival': () =>
    askStrategy(strategy(2, ['repel', 'pickpocket'])),
  'strategy: 4 players, four items, a public Price Shield and secret items': () => {
    const state = strategy(4, ['repel', 'pickpocket', 'lucky-egg', 'repel']);
    give(state, 1, 'pickpocket', 'secret');
    return askStrategy(state);
  },
  'strategy: Lucky Egg only': () => askStrategy(strategy(2, ['lucky-egg'])),
  'encounter: Eevee with Poke Balls and one Great Ball': () =>
    askEncounter(encounter('eevee', { poke: 5, great: 1, ultra: 0 })),
  'encounter: Dratini with every Ball type': () =>
    askEncounter(encounter('dratini', { poke: 1, great: 3, ultra: 4 })),
};

describe.each(Object.entries(fixtures))('%s', (_name, build) => {
  const decision = asked(build());

  test('exact question text (spec §5.4: wording changes are reviewed)', () => {
    expect({ state: decision.state, questions: decision.questions }).toMatchSnapshot();
  });

  test('state passes the §5.4 numeric guard and the 4,000-token estimate', () => {
    expect(() => assertNoComparableNumbers(decision.state)).not.toThrow();
    expect(() => assertStateTokenBudget(decision.state)).not.toThrow();
  });

  test('criteria are English and every option round-trips to one engine action', () => {
    const [question] = Object.values(decision.questions);
    if (question?.type !== 'choice') throw new Error('Expected one Choice question');
    const labels = Object.keys(question.criteria);
    expect(Object.keys(decision.options)).toEqual(labels);
    for (const text of Object.values(question.criteria)) {
      expect(text).toMatch(/^[A-Z][^฀-๿]+\.$/);
    }
    const ids = labels.map((label) => actionIdFor(decision, label));
    expect(new Set(ids).size).toBe(labels.length);
    for (const id of ids) expect(id).toEqual(expect.any(String));
    for (const label of ['a99', 'nope', 'toString', '__proto__', 'constructor']) {
      expect(actionIdFor(decision, label)).toBeUndefined();
    }
  });
});

test('round trip returns the original engine action ID for every option (spec §5.3)', () => {
  const state = strategy(4, ['repel', 'pickpocket', 'lucky-egg']);
  const enabled = legalActions(state, 0).enabled;
  const decision = asked(askStrategy(state));
  for (const [label, id] of Object.entries(decision.options)) {
    expect(actionIdFor(decision, label)).toBe(id);
    expect(enabled.some((action) => action.id === id)).toBe(true);
  }
  expect(actionIdFor({ kind: 'autoApply', actionId: 'skip' }, 'skip')).toBeUndefined();
});

test('temporary S06 capability filter keeps engine PvP legal but preserves only item/skip Strategy options until Stream B integration', () => {
  const state = strategy(2, ['repel', 'pickpocket']);
  const enabled = legalActions(state, 0).enabled;
  const declarations = enabled.filter((action) => action.kind === 'declare_pvp');
  expect(declarations).toHaveLength(1);
  const decision = asked(askStrategy(state));
  const offered = Object.values(decision.options);
  expect(offered).toEqual(
    enabled.filter((action) => action.kind !== 'declare_pvp').map((action) => action.id),
  );
  expect(offered).toContain('skip');
  expect(
    enabled
      .filter((action) => action.kind === 'use_item')
      .every((action) => offered.includes(action.id)),
  ).toBe(true);
  expect(declarations.every((action) => !offered.includes(action.id))).toBe(true);
  expect(legalActions(state, 0).enabled).toEqual(enabled);
});

test('Strategy criteria never mention Price Shield while the engine defers it (spec §4.6)', () => {
  const state = strategy(4, ['repel', 'pickpocket']);
  give(state, 1, 'pickpocket', 'secret');
  const [question] = Object.values(asked(askStrategy(state)).questions);
  if (question?.type !== 'choice') throw new Error('Expected one Choice question');
  for (const text of Object.values(question.criteria)) expect(text).not.toMatch(/shield/i);
});

describe('spec §3.1 decisions you never made', () => {
  test('one enabled action is applied automatically and builds no question', () => {
    const state = strategy(2, []);
    expect(
      legalActions(state, 0).enabled.filter((action) => action.kind !== 'declare_pvp'),
    ).toHaveLength(1);
    expect(askStrategy(state)).toEqual({ kind: 'autoApply', actionId: 'skip' });
    const noBall = encounter('eevee', { poke: 0, great: 0, ultra: 0 });
    expect(askEncounter(noBall)).toEqual({ kind: 'autoApply', actionId: 'release' });
  });

  test('no enabled action (cannot happen in play) reports skip', () => {
    const state = strategy(2, ['repel']);
    expect(buildStrategyQuestion(observe(state, 0), [], greedy)).toEqual({ kind: 'skip' });
    const caught = encounter('eevee', { poke: 1, great: 0, ultra: 0 });
    expect(buildEncounterQuestion(observe(caught, 0), [], { odds: [] }, greedy)).toEqual({
      kind: 'skip',
    });
  });
});

describe('shortlist (spec §3.1, §5.3)', () => {
  const state = strategy(4, ['repel', 'pickpocket', 'lucky-egg']);
  const observation = observe(state, 0);
  const item = (itemId: string) =>
    observation.own.items.find((entry) => entry.itemId === itemId)!.instanceId;
  const use = (itemId: string, seat?: number): LegalAction => ({
    id: seat === undefined ? `use-item:${item(itemId)}` : `use-item:${item(itemId)}:seat-${seat}`,
    kind: 'use_item',
    payload:
      seat === undefined
        ? { itemInstanceId: item(itemId) }
        : { itemInstanceId: item(itemId), targetSeatIndex: seat },
  });
  const ball = (ballType: 'poke' | 'great' | 'ultra'): LegalAction => ({
    id: `catch:${ballType}`,
    kind: 'catch',
    payload: { ballType },
  });
  const ability = (n: number): LegalAction => ({
    id: `ability:${n}`,
    kind: 'ability',
    payload: {},
  });
  const skip: LegalAction = { id: 'skip', kind: 'skip', payload: {} };
  const kindOf = (action: LegalAction) =>
    action.kind === 'use_item' ? action.id.split(':').slice(0, 3).join(':') : action.kind;

  test('a 14-action input gives 12 with skip and at least one of each kind', () => {
    const actions = [
      ...[1, 2, 3].map((seat) => use('repel', seat)),
      ...[1, 2, 3].map((seat) => use('pickpocket', seat)),
      use('lucky-egg'),
      ball('poke'),
      ball('great'),
      ball('ultra'),
      ability(1),
      ability(2),
      ability(3),
      skip,
    ];
    expect(actions).toHaveLength(14);
    const shortlist = shortlistActions(actions, greedy, observation);
    expect(shortlist).toHaveLength(12);
    expect(shortlist).toContainEqual(skip);
    expect(new Set(shortlist.map(kindOf))).toEqual(new Set(actions.map(kindOf)));
    // The engine's order is kept.
    const order = shortlist.map((action) => actions.indexOf(action));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  test('a filter that removes every Ball option still keeps one per action kind', () => {
    const actions = [ball('poke'), ball('great'), ball('ultra'), use('repel', 1), skip];
    // Throwing a Ball costs liquidity and Loyal has no risk appetite: it leans away from catch.
    const shortlist = shortlistActions(actions, loyal, observation);
    expect(shortlist.filter((action) => action.kind === 'catch')).toHaveLength(1);
    expect(shortlist.map((action) => action.id)).toEqual([
      'catch:poke',
      'use-item:bought:0:0:seat-1',
      'skip',
    ]);
  });

  test('the filter drops disliked targets but keeps the leader as the kind representative', () => {
    state.players[2]!.coins = 30;
    const richest = observe(state, 0);
    const actions = [1, 2, 3].map((seat) => use('repel', seat)).concat(skip);
    expect(shortlistActions(actions, greedy, richest)).toEqual(actions);
    expect(shortlistActions(actions, loyal, richest).map((action) => action.id)).toEqual([
      `use-item:${item('repel')}:seat-2`,
      'skip',
    ]);
  });

  test('Strategy without a legal skip is an engine contract error', () => {
    expect(() =>
      buildStrategyQuestion(observation, [use('repel', 1), use('repel', 2)], greedy),
    ).toThrow('skip');
  });
});

describe('buckets (spec §5.4)', () => {
  test('catch chance has one word for every d6 result the engine can report', () => {
    expect([0, 1, 2, 3, 4, 5, 6].map(bucketCatchChance)).toEqual([
      'very low',
      'very low',
      'low',
      'even',
      'high',
      'very high',
      'very high',
    ]);
    for (const bad of [-1, 7, 2.5, NaN]) expect(() => bucketCatchChance(bad)).toThrow(RangeError);
  });

  test('Ball counts are none, one, a few or many', () => {
    expect([0, 1, 2, 3, 4, 9].map(ballCountWords)).toEqual([
      'none',
      'one',
      'a few',
      'a few',
      'many',
      'many',
    ]);
  });

  test('encounter criteria use the engine odds, not a recomputation', () => {
    const state = encounter('eevee', { poke: 2, great: 0, ultra: 0 });
    const decision = asked(
      buildEncounterQuestion(
        observe(state, 0),
        legalActions(state, 0).enabled,
        { odds: [{ ballType: 'poke', successFaces: 6 }] },
        greedy,
      ),
    );
    const question = decision.questions.encounter!;
    if (question.type !== 'choice') throw new Error('Expected a Choice');
    expect(question.criteria.poke_ball).toContain('Catch chance with this Ball: very high.');
    expect(question.criteria.poke_ball).toContain(
      'Poké Balls you hold now, counting this one: a few.',
    );
  });
});

describe('leak harness (spec §1, §5.4, §9)', () => {
  const builds = {
    strategy: (state: GameState) => askStrategy(state),
    encounter: (state: GameState) => askEncounter(state),
  };
  const scenarios = {
    strategy: () => strategy(4, ['repel', 'pickpocket', 'lucky-egg']),
    encounter: () => encounter('eevee', { poke: 3, great: 1, ultra: 1 }),
  };

  test.each(Object.keys(builds) as (keyof typeof builds)[])(
    '%s request contains no other seat secret and ignores hidden changes',
    (name) => {
      const poisoned = scenarios[name]();
      for (const player of poisoned.players.slice(1)) {
        player.items.push({
          instanceId: `hidden-${player.seatIndex}`,
          itemId: 'pickpocket',
          name: `SECRET_ITEM_SEAT_${player.seatIndex}`,
          visibility: 'secret',
        });
        player.privateResults = [
          { kind: 'peek', eventId: `PRIVATE_PEEK_SEAT_${player.seatIndex}` },
        ];
        player.balls = { poke: 1, great: 2, ultra: 3 };
      }
      poisoned.rng = { state: 'PRIVATE_RNG_SENTINEL', cursor: 987654321 };
      poisoned.eventDeck = {
        drawPile: ['PRIVATE_EVENT_ORDER_SENTINEL'],
        discardPile: ['PRIVATE_DISCARD_SENTINEL'],
      };
      const decision = asked(builds[name](poisoned));
      const text = JSON.stringify({ state: decision.state, questions: decision.questions });
      for (const sentinel of [
        'SECRET_ITEM_SEAT',
        'hidden-',
        'PRIVATE_PEEK_SEAT',
        'PRIVATE_RNG_SENTINEL',
        '987654321',
        'PRIVATE_EVENT_ORDER_SENTINEL',
        'PRIVATE_DISCARD_SENTINEL',
      ]) {
        expect(text).not.toContain(sentinel);
      }
      expect(text).not.toMatch(/"(?:rng|seed|cursor|drawPile|discardPile|eventDeck)"\s*:/);

      const changed = structuredClone(poisoned);
      for (const player of changed.players.slice(1)) {
        player.items.at(-1)!.name = 'DIFFERENT_HIDDEN_ITEM';
        player.privateResults = [{ kind: 'peek', eventId: 'DIFFERENT_PEEK' }];
        player.balls = { poke: 0, great: 0, ultra: 9 };
      }
      changed.rng = { state: 'DIFFERENT_RNG', cursor: 123 };
      changed.eventDeck.drawPile.reverse();
      expect(builds[name](changed)).toEqual(decision);
    },
  );
});
