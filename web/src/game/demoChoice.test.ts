import { expect, test } from 'vitest';
import { legalActions, observe, type LegalAction } from '../../../engine/index.ts';
import { decisionDetailSchema, decisionResponseSchema } from '../../../engine/contract/decision.ts';
import encounterNoBall from '../../../engine/fixtures/encounter-no-ball.json';
import sellPhaseThree from '../../../engine/fixtures/sell-phase-three-pokemon.json';
import shopLowCoins from '../../../engine/fixtures/shop-low-coins.json';
import shopNoCoins from '../../../engine/fixtures/shop-no-coins.json';
import { createScenes } from '../gallery/scenes.ts';
import { t } from '../i18n/en.ts';
import { itemName } from '../i18n/names.ts';
import type { OpponentAnswer } from './ai.ts';
import { engineContent } from './content.ts';
import { demoChoiceOf } from './demoChoice.ts';
import { fakeJevAnswer } from './fakeJevAnswer.ts';
import { readJevDetail } from './jevDetailAdapter.ts';
import { createFixtureStore, type SeatView } from './store.ts';

const scenes = createScenes({
  'encounter-no-ball': encounterNoBall,
  'sell-phase-three-pokemon': sellPhaseThree,
  'shop-low-coins': shopLowCoins,
  'shop-no-coins': shopNoCoins,
});

const demoOf = (view: SeatView) => view.feed.find((entry) => entry.decision?.demo)!.decision!.demo!;

/** Seat 1 at a wild Pokémon with three Poké Balls and one Great Ball: the options the browser sends. */
function encounterContext() {
  const store = createFixtureStore(encounterNoBall, engineContent, (state) => {
    state.activeSeatIndex = 1;
    state.players[1]!.balls = { poke: 3, great: 1, ultra: 0 };
  });
  const { state } = store.getSession()!;
  const enabledActions = legalActions(state, 1).enabled;
  return {
    enabledActions,
    observation: observe(state, 1),
    viewerSeat: 0,
    decisionPoint: 'encounter',
  };
}

const answerOf = (choice: string, options: { id: string; probability: number }[]) => {
  const fake = fakeJevAnswer({ choice, options });
  return {
    answer: { source: 'jev', choice } satisfies OpponentAnswer,
    detail: readJevDetail(fake),
  };
};

test('rows are labelled with the catalogue names of the seat’s own options, most likely first, the pick marked', () => {
  const demo = demoOf(scenes.rivalChoseBall().view);
  expect(demo).toMatchObject({ source: 'jev', confidence: 0.58, perPokemon: false });
  expect(demo.rows.map(({ label, probability, chosen }) => [label, probability, chosen])).toEqual([
    [t('demo.option.catch', { ball: t('board.ball.great') }), 0.65, true],
    [t('demo.option.catch', { ball: t('board.ball.poke') }), 0.25, false],
    [t('demo.option.release', { pokemon: 'Caterpie' }), 0.1, false],
  ]);
});

test('a rival’s private items are named from its own observation, and a skip says so', () => {
  const labels = demoOf(scenes.rivalChoseItem().view).rows.map(({ label }) => label);
  expect(labels).toEqual([
    t('demo.option.useItem', { item: itemName('price-shield') }),
    t('demo.option.useItemOn', { item: itemName('repel'), target: t('seat.you') }),
    t('demo.option.skip'),
  ]);
});

test('the Sell Phase shows one chance per Pokémon, and the Pokémon sold are the ones marked', () => {
  const demo = demoOf(scenes.rivalChoseSale().view);
  expect(demo.perPokemon).toBe(true);
  expect(demo.rows.map(({ label, chosen }) => [label, chosen])).toEqual([
    [t('demo.option.sell', { pokemon: 'Caterpie' }), true],
    [t('demo.option.sell', { pokemon: 'Pidgey' }), false],
    [t('demo.option.sell', { pokemon: 'Eevee' }), false],
  ]);
});

test('a backup-bot decision keeps its reason and no rows', () => {
  expect(demoOf(scenes.rivalBackupAtEncounter().view)).toEqual({
    source: 'fallback',
    fallbackReason: 'timeout',
    perPokemon: false,
    rows: [],
  });
});

test('equal chances keep the order Jev sent them in', () => {
  const context = encounterContext();
  const [a, b, c] = context.enabledActions;
  const { answer, detail } = answerOf(a!.id, [
    { id: b!.id, probability: 0.3 },
    { id: a!.id, probability: 0.4 },
    { id: c!.id, probability: 0.3 },
  ]);
  const demo = demoChoiceOf({ ...context, answer, detail })!;
  expect(demo.rows.map(({ id }) => id)).toEqual([a!.id, b!.id, c!.id]);
});

test('nothing is shown when no Jev question was asked or the browser has no detail', () => {
  const context = encounterContext();
  const first = context.enabledActions[0]!.id;
  for (const fallbackReason of ['auto', 'unsupported_decision_point', undefined]) {
    expect(
      demoChoiceOf({
        ...context,
        answer: { source: 'fallback', choice: first, fallbackReason },
        detail: undefined,
      }),
    ).toBeUndefined();
  }
  expect(
    demoChoiceOf({ ...context, answer: { source: 'jev', choice: first }, detail: undefined }),
  ).toBeUndefined();
});

test('a detail that names an option the browser did not send is dropped whole, never trimmed or invented', () => {
  const context = encounterContext();
  const [a, b] = context.enabledActions;
  const unknown = answerOf(a!.id, [
    { id: a!.id, probability: 0.9 },
    { id: 'catch:master', probability: 0.1 },
  ]);
  expect(demoChoiceOf({ ...context, ...unknown })).toBeUndefined();
  const repeated = answerOf(a!.id, [
    { id: a!.id, probability: 0.5 },
    { id: a!.id, probability: 0.5 },
  ]);
  expect(demoChoiceOf({ ...context, ...repeated })).toBeUndefined();
  // Jev's pick must be one of the options it is shown with.
  const stray = answerOf(a!.id, [{ id: b!.id, probability: 1 }]);
  expect(demoChoiceOf({ ...context, ...stray })).toBeUndefined();
});

test('at the Sell Phase only Pokémon the engine offers can appear', () => {
  const { store } = scenes.rivalChoseSale();
  const { state } = store.getSession()!;
  const context = {
    enabledActions: legalActions(state, 1).enabled,
    observation: observe(state, 1),
    viewerSeat: 0,
    decisionPoint: 'sell',
  };
  const foreign = fakeJevAnswer({
    sellUids: [],
    options: [{ id: 'pokemon-0', probability: 0.4 }],
  });
  expect(
    demoChoiceOf({
      ...context,
      answer: { source: 'jev', sellUids: [] },
      detail: readJevDetail(foreign),
    }),
  ).toBeUndefined();
});

const good = {
  questionId: 'strategy',
  confidence: 0.5,
  options: [{ id: 'skip', probability: 1 }],
};
const bad = [
  { ...good, model: 'jev-1.13.0' },
  { ...good, confidence: 1.2 },
  { ...good, confidence: Number.NaN },
  { ...good, questionId: '' },
  { ...good, options: [] },
  { ...good, options: Array.from({ length: 256 }, (_, n) => ({ id: `o${n}`, probability: 0 })) },
  { ...good, options: [{ id: 'skip', probability: -0.1 }] },
  { ...good, options: [{ id: '', probability: 1 }] },
  { ...good, options: [{ id: 'skip', probability: 1, raw: 'x' }] },
  'x',
  null,
  [],
];

test('the proposed detail is strict: unknown keys, odd numbers and a fallback carrying one are all refused', () => {
  expect(decisionDetailSchema.safeParse(good).success).toBe(true);
  for (const detail of bad) expect(decisionDetailSchema.safeParse(detail).success).toBe(false);
  const telemetry = { choice: 'skip', requestId: 'r', latencyMs: 1, detail: good };
  expect(decisionResponseSchema.safeParse({ ...telemetry, source: 'jev' }).success).toBe(true);
  expect(
    decisionResponseSchema.safeParse({
      ...telemetry,
      source: 'fallback',
      fallbackReason: 'timeout',
    }).success,
  ).toBe(false);
  // Without a detail an answer is exactly what it was before this field was proposed.
  const plain = { choice: 'skip', requestId: 'r', latencyMs: 1, source: 'jev' };
  expect(decisionResponseSchema.parse(plain)).toEqual(plain);
});

test('the browser adapter accepts and refuses exactly what the contract schema does', () => {
  expect(readJevDetail({ detail: good })).toEqual(good);
  expect(readJevDetail({})).toBeUndefined();
  for (const detail of bad)
    expect(readJevDetail({ detail }), JSON.stringify(detail)).toBeUndefined();
  // The typed fake is a valid answer, and the adapter reads back what it holds.
  const fake = fakeJevAnswer({ choice: 'skip', options: good.options, confidence: 0.5 });
  expect(decisionResponseSchema.parse(fake)).toEqual(fake);
  expect(readJevDetail(fake)).toEqual({ ...good, questionId: 'strategy' });
});

test('the browser adapter reads a Sell Phase detail whose confidence is null', () => {
  const sellDetail = {
    questionId: 'sell',
    confidence: null,
    options: [
      { id: 'pokemon-1', probability: 0.9 },
      { id: 'pokemon-2', probability: 0.2 },
    ],
  };
  expect(decisionDetailSchema.parse(sellDetail)).toEqual(sellDetail);
  expect(readJevDetail({ detail: sellDetail })).toEqual(sellDetail);
  expect(readJevDetail({ detail: { ...sellDetail, confidence: undefined } })).toBeUndefined();
  expect(readJevDetail({ detail: { ...sellDetail, confidence: '0.5' } })).toBeUndefined();
});

test('an Ability option is named with its Pokémon and scope, never left as an ID', () => {
  const context = encounterContext();
  const abilities: LegalAction[] = (['catch', 'combat', undefined] as const).map((scope) => ({
    id: `ability:${scope}`,
    kind: 'activate_ability',
    payload: { instanceId: 'pokemon-1', ...(scope && { scope }) },
  }));
  const { answer, detail } = answerOf(
    abilities[0]!.id,
    abilities.map(({ id }, index) => ({ id, probability: [0.5, 0.3, 0.2][index]! })),
  );
  const demo = demoChoiceOf({ ...context, enabledActions: abilities, answer, detail })!;
  const labels = demo.rows.map(({ label }) => label);
  expect(labels).toHaveLength(3);
  for (const label of labels) {
    expect(label).toContain('Eevee');
    expect(label).not.toContain('ability:');
    expect(label).not.toBe(t('demo.option.other'));
  }
  expect(new Set(labels).size).toBe(3);
});
