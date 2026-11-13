import { join } from 'node:path';
import { ESLint } from 'eslint';
import { afterAll, afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { decisionResponseSchema, type DecisionRequest } from '../engine/contract/decision.ts';
import {
  applyAction,
  createGame,
  createGameConfig,
  fixtureSchema,
  legalActions,
  observe,
  oddsForAllBalls,
  type GameState,
} from '../engine/index.ts';
import startFixture from '../engine/fixtures/start-of-game-2p.json';
import encounterFixture from '../engine/fixtures/encounter-with-balls.json';
import sellFixture from '../engine/fixtures/sell-phase-three-pokemon.json';
import strategyFixture from '../engine/fixtures/strategy-with-items.json';
import { createApp, MAX_BODY_BYTES } from './app.ts';
import type { Decider } from './decider.ts';
import { SpendLedger } from './jev/spend.ts';

// Offline only: a placeholder key, Hono's in-memory `app.request()` and no network.
const KEY_ENV = 'TYPESAFE_API_KEY';
const PLACEHOLDER_KEY = 'placeholder-key-not-real-4b1e8d';

/** Every response body and header seen in this file, searched for the key at the end. */
const seen: string[] = [];

type App = ReturnType<typeof createApp>;

/** An empty spend ledger, so no test reads a real `logs/jev-usage.jsonl`. */
const noSpend = () => new SpendLedger();
const overBudget = () => ({ budgetExceeded: () => true });

const record = async (response: Response) => {
  seen.push(await response.clone().text(), JSON.stringify([...response.headers]));
  return response;
};

const status = async (app: App = createApp({ usage: noSpend })) =>
  record(await app.request('/api/ai/status'));

const decide = async (body: unknown, app: App = createApp({ usage: noSpend })) =>
  record(
    await app.request('/api/ai/decide', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  );

/** A request for the fixture's active seat, built only from its role-scoped observation. */
const requestFor = (json: unknown): DecisionRequest => {
  const fixture = fixtureSchema.parse(json);
  const seat = fixture.state.activeSeatIndex;
  const observation = fixture.observation[String(seat)]!;
  const decisionPoint = observation.public.phase.kind as DecisionRequest['decisionPoint'];
  return {
    gameId: 'game-test-1',
    seatIndex: seat,
    decisionPoint,
    stateRevision: observation.public.stateRevision,
    observation,
    enabledActions: fixture.legalActions[String(seat)]!.enabled,
    facts: decisionPoint === 'encounter' ? { catchOdds: oddsForAllBalls(fixture.state, seat) } : {},
    difficulty: 'normal',
    personalityId: 'cautious',
    turnKey: `${seat}:${observation.public.globalTurnNo}`,
  };
};

/** Seat 0 (human) in its Social window with the window open; seats 1 and 2 are AIs. */
function socialGame(seats: 2 | 3): GameState {
  const scenario = fixtureSchema.parse(startFixture).state;
  const content = structuredClone(scenario.content);
  content.classes.push({
    id: 'team-rocket',
    name: 'Team Rocket',
    starterSpeciesIds: ['eevee'],
    classItemId: 'pickpocket',
  });
  const state = createGame(
    createGameConfig({
      seats: [
        ...scenario.config.seats,
        { actorId: 'player-2', seatIndex: 2, classId: 'team-rocket', controller: 'ai' as const },
      ].slice(0, seats),
      seed: 4,
      lapTarget: 3,
      socialWindow: true,
    }),
    content,
  );
  state.phase = { kind: 'social' };
  state.globalTurnNo = 1;
  state.players[0]!.ownTurnNo = 1;
  state.turnBudgets = {
    tacticalAction: 1,
    catchAttempt: 1,
    pokemonAbility: 1,
    socialInteraction: 1,
  };
  return state;
}

/** The active seat's command, numbered with the revision that seat observes. */
function act(state: GameState, kind: string, payload: object = {}): GameState {
  const revision = observe(state, state.activeSeatIndex).public.stateRevision;
  const result = applyAction(state, {
    actorId: state.players[state.activeSeatIndex]!.actorId,
    actionSeq: revision + 1,
    stateRevisionBefore: revision,
    kind,
    payload,
  });
  if ('rejected' in result) throw new Error(result.reason);
  return result.state;
}

const strategy = requestFor(strategyFixture);
const encounter = requestFor(encounterFixture);
const sell = requestFor(sellFixture);

const answering =
  (answer: unknown): Decider =>
  async () =>
    answer as Awaited<ReturnType<Decider>>;

beforeEach(() => {
  vi.stubEnv('JEV_ENABLED', 'true');
  vi.stubEnv(KEY_ENV, PLACEHOLDER_KEY);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// Spec §9: whatever the decider sees or returns, no response carries any part of the key.
afterAll(() => {
  expect(seen.length).toBeGreaterThan(0);
  for (const text of seen) expect(text).not.toContain(PLACEHOLDER_KEY);
});

describe('GET /api/ai/status', () => {
  test('reports Jev on when enabled with a key', async () => {
    expect(await (await status()).json()).toEqual({
      jevEnabled: true,
      backupOnly: false,
      reason: null,
    });
  });

  test('reports backup-only mode under the kill switch', async () => {
    vi.stubEnv('JEV_ENABLED', 'false');
    vi.stubEnv(KEY_ENV, undefined);
    expect(await (await status()).json()).toEqual({
      jevEnabled: false,
      backupOnly: true,
      reason: 'disabled',
    });
  });

  test('reports backup-only mode once the spend cap or daily budget is reached', async () => {
    expect(await (await status(createApp({ usage: overBudget }))).json()).toEqual({
      jevEnabled: true,
      backupOnly: true,
      reason: 'budget_exceeded',
    });
  });

  test('reports backup-only mode when the key is missing', async () => {
    vi.stubEnv(KEY_ENV, undefined);
    expect(await (await status()).json()).toEqual({
      jevEnabled: true,
      backupOnly: true,
      reason: 'missing_key',
    });
  });
});

describe('POST /api/ai/decide', () => {
  test('a valid request returns only the response fields', async () => {
    const response = await decide(strategy);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(Object.keys(body).sort()).toEqual(
      ['choice', 'fallbackReason', 'latencyMs', 'requestId', 'source'].sort(),
    );
    expect(body).toMatchObject({ choice: 'use-item:item-0', source: 'fallback' });
    expect(decisionResponseSchema.parse(body)).toEqual(body);
  });

  test('the stub answers each decision point with its first enabled action', async () => {
    expect(await (await decide(encounter)).json()).toMatchObject({
      choice: 'catch:poke',
      source: 'fallback',
      fallbackReason: 'stub',
    });
    const sold = await (await decide(sell)).json();
    expect(sold).toMatchObject({ sellUids: ['pokemon-0'], source: 'fallback' });
    expect(sold).not.toHaveProperty('choice');
  });

  test('falls back with budget_exceeded once the spend guard trips', async () => {
    const response = await decide(strategy, createApp({ usage: overBudget }));
    expect(await response.json()).toMatchObject({
      source: 'fallback',
      fallbackReason: 'budget_exceeded',
    });
  });

  test('works under the kill switch with no key set', async () => {
    vi.stubEnv('JEV_ENABLED', 'false');
    vi.stubEnv(KEY_ENV, undefined);
    const response = await decide(strategy);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      choice: 'use-item:item-0',
      source: 'fallback',
      fallbackReason: 'disabled',
    });
  });

  test('a body over 32 KB returns 413', async () => {
    const response = await decide({ ...strategy, personalityId: 'x'.repeat(MAX_BODY_BYTES) });
    expect(response.status).toBe(413);
  });

  test('a body over 32 KB without a length header returns 413', async () => {
    const bytes = new TextEncoder().encode(
      JSON.stringify({ ...strategy, personalityId: 'x'.repeat(MAX_BODY_BYTES) }),
    );
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    });
    const response = await record(
      await createApp({ usage: noSpend }).request('/api/ai/decide', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'transfer-encoding': 'chunked' },
        body,
        duplex: 'half',
      } as RequestInit),
    );
    expect(response.status).toBe(413);
  });

  test.each([
    ['broken JSON', '{"gameId":'],
    ['a missing field', { ...strategy, turnKey: undefined }],
    ['an unknown top-level field', { ...strategy, debug: true }],
    [
      'an unknown field in an action',
      { ...strategy, enabledActions: [{ id: 'x', kind: 'skip', payload: {}, hint: 1 }] },
    ],
    ['no enabled action', { ...strategy, enabledActions: [] }],
    ['a revision that does not match the observation', { ...strategy, stateRevision: 999 }],
    ['a seat that does not match the observation', { ...strategy, seatIndex: 1 }],
    ['a decision point that does not match the phase', { ...strategy, decisionPoint: 'sell' }],
  ])('%s returns 400 with no stack trace', async (_name, body) => {
    const response = await decide(body);
    expect(response.status).toBe(400);
    const text = await response.text();
    expect(text).not.toMatch(/\bat\s|Error|stack|\.ts\b/);
    expect(JSON.parse(text)).toHaveProperty('error');
  });

  test.each([
    [
      'public',
      (request: DecisionRequest) => ({ ...request.observation.public, eventDeck: ['e1'] }),
    ],
    ['own', (request: DecisionRequest) => ({ ...request.observation.own, rng: 'seed' })],
  ])('an observation with an unknown %s field is rejected', async (part, extend) => {
    const observation = { ...strategy.observation, [part]: extend(strategy) };
    const response = await decide({ ...strategy, observation });
    expect(response.status).toBe(400);
  });

  test.each([2, 3] as const)(
    '%i seats: a request carries the revision the seat observed after a chat (§4.8, #143)',
    async (seats) => {
      const seat = seats - 1;
      // The human chats seat 1; with 3 seats, seat 2 is outside the chat.
      const state = act(socialGame(seats), 'chat', { targetSeatIndex: 1, topic: 'truce' });
      state.activeSeatIndex = seat;
      state.phase = { kind: 'strategy' };
      const observation = observe(state, seat);
      expect(observation.public.stateRevision).toBe(state.stateRevision - (seats === 3 ? 1 : 0));
      const request: DecisionRequest = {
        gameId: 'game-test-1',
        seatIndex: seat,
        decisionPoint: 'strategy',
        stateRevision: observation.public.stateRevision,
        observation,
        enabledActions: legalActions(state, seat).enabled,
        facts: {},
        difficulty: 'normal',
        personalityId: 'cautious',
        turnKey: `${seat}:1`,
      };
      const response = await decide(request);
      expect(response.status).toBe(200);
      expect(decisionResponseSchema.parse(await response.json())).toMatchObject({
        choice: request.enabledActions[0]!.id,
      });
      // A revision other than the observed one (the global count, for a bystander) is refused.
      const other = await decide({
        ...request,
        stateRevision: observation.public.stateRevision + 1,
      });
      expect(other.status).toBe(400);
    },
  );

  test('an answer that is not among the options falls back (spec §3.1)', async () => {
    const app = createApp({
      usage: noSpend,
      decider: answering({ choice: 'buy:everything', source: 'jev' }),
    });
    expect(await (await decide(strategy, app)).json()).toMatchObject({
      choice: 'use-item:item-0',
      source: 'fallback',
      fallbackReason: 'not_an_option',
    });
    const seller = createApp({
      usage: noSpend,
      decider: answering({ sellUids: ['pokemon-1'], source: 'jev' }),
    });
    expect(await (await decide(sell, seller)).json()).toMatchObject({
      sellUids: ['pokemon-0'],
      fallbackReason: 'not_an_option',
    });
  });

  test('a Jev answer among the options is returned without a fallback reason', async () => {
    const app = createApp({
      usage: noSpend,
      decider: answering({ sellUids: ['pokemon-2', 'pokemon-3'], source: 'jev' }),
    });
    const body = await (await decide(sell, app)).json();
    expect(body).toMatchObject({ sellUids: ['pokemon-2', 'pokemon-3'], source: 'jev' });
    expect(body).not.toHaveProperty('fallbackReason');
  });

  test('only IDs and telemetry leave, whatever the decider returns', async () => {
    const app = createApp({
      usage: noSpend,
      decider: answering({
        choice: 'skip',
        source: 'jev',
        jevBody: { answers: {}, key: PLACEHOLDER_KEY },
        apiKey: PLACEHOLDER_KEY,
      }),
    });
    const body = await (await decide(strategy, app)).json();
    expect(Object.keys(body).sort()).toEqual(['choice', 'latencyMs', 'requestId', 'source']);
  });

  test('a decider that throws falls back without leaking the error', async () => {
    const app = createApp({
      usage: noSpend,
      decider: async () => {
        throw new Error(`boom ${PLACEHOLDER_KEY}`);
      },
    });
    const response = await decide(strategy, app);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ fallbackReason: 'decider_error' });
  });
});

// Criterion: web/ reaches the shared contract in engine/, never ai/ (spec §6 item 2, §7).
describe('import boundaries', () => {
  const eslint = new ESLint({ cwd: join(import.meta.dirname, '..') });
  const importErrors = async (code: string) => {
    const [result] = await eslint.lintText(code, { filePath: 'web/src/game/decide.ts' });
    return result!.messages.filter((message) => message.ruleId?.endsWith('no-restricted-imports'));
  };

  test('web/ may import the decision types from engine/contract/decision.ts', async () => {
    const code =
      "import type { DecisionRequest, DecisionResponse } from '../../../engine/contract/decision.ts';\n" +
      'export type Pair = [DecisionRequest, DecisionResponse];\n';
    expect(await importErrors(code)).toEqual([]);
  });

  test('web/ may not import from ai/', async () => {
    const code =
      "import type { Decider } from '../../../ai/decider.ts';\nexport type D = Decider;\n";
    expect(await importErrors(code)).not.toEqual([]);
  });
});
