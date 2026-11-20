import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  decisionRequestSchema,
  decisionResponseSchema,
  type DecisionRequest,
} from '../engine/contract/decision.ts';
import {
  applyAction,
  legalActions,
  observe,
  pendingDecision,
  stateHash,
  type GameState,
} from '../engine/index.ts';
import { command } from '../sim/runner.ts';
import { createPolicyRng } from '../sim/policy.ts';
import {
  dealTable,
  owned,
  proposeDeal,
  type DealOffer,
  type DealTable,
} from '../eval/jev/deal-kit.ts';
import { createApp } from './app.ts';
import { fallbackAnswer } from './decider.ts';
import { FallbackPolicy, PERSONALITIES } from './fallback/index.ts';
import type { JevAnswer, JevClient, JevFailure, JevRequest, JevResult } from './jev/client.ts';
import { PINNED_JEV_MODEL } from './jev/client.ts';
import { createFakeJevClient } from './jev/fake.ts';
import { SpendLedger } from './jev/spend.ts';
import { LINES } from './lines.ts';
import { Orchestrator, type DecideRequest } from './orchestrator.ts';
import { buildDealQuestion, counterAction, pendingDeal, trustBucket } from './questions/index.ts';
import { assertNoComparableNumbers } from './state/index.ts';

// Spec §4.8, §5.3, §5.4, §3 (fallback table); issue #164 D3. Offline only: fakes, no key, no network.

const AI = 1;
const PERSONALITY_IDS = ['greedy', 'aggressive', 'cautious', 'opportunist'] as const;

beforeEach(() => vi.stubEnv('JEV_ENABLED', 'true'));
afterEach(() => vi.unstubAllEnvs());

const EEVEE: Pick<DealTable, 'seed' | 'coins' | 'humanTeam'> = {
  seed: 41,
  coins: [10, 20],
  humanTeam: [owned(0, 1, 'eevee')],
};
const sellEevee = (coins: number): DealOffer => ({ sells: { pokemon: 'caught:0:1' }, coins });
const REPEL: Pick<DealTable, 'seed' | 'coins' | 'humanItems'> = {
  seed: 42,
  coins: [10, 20],
  humanItems: ['repel'],
};
const sellRepel = (coins: number): DealOffer => ({ sells: { item: 'item:0:0' }, coins });

/** Within budget: the AI pays 7 coins for an Eevee worth about 7. */
const fair = () => proposeDeal(dealTable(EEVEE), sellEevee(7));
/** Over the per-deal budget: the AI pays 9 for a Pidgey worth about 4. */
const overBudget = () =>
  proposeDeal(dealTable({ seed: 44, coins: [10, 20], humanTeam: [owned(0, 1, 'pidgey')] }), {
    sells: { pokemon: 'caught:0:1' },
    coins: 9,
  });

const decideRequest = (
  state: GameState,
  personalityId: (typeof PERSONALITY_IDS)[number] = 'greedy',
  overrides: Partial<DecideRequest> = {},
): DecideRequest => {
  const observation = observe(state, AI);
  const pending = observation.own.pendingResponse;
  return {
    turnKey: 'deal-test',
    observation,
    legalActions: legalActions(state, AI),
    facts: pending?.kind === 'deal' && pending.facts ? { deal: pending.facts } : {},
    difficulty: 'normal',
    personality: PERSONALITIES[personalityId],
    decisionPoint: 'deal_response',
    rng: createPolicyRng('deal-test'),
    ...overrides,
  };
};

const answering = (answers: Record<string, JevAnswer>): JevResult => ({
  ok: true,
  answers,
  requestId: 'req_test',
  model: PINNED_JEV_MODEL,
  latencyMs: 5,
  usage: { inputTokens: 100, outputTokens: 10 },
});
const choose = (choice: string, confidence = 0.9): JevResult =>
  answering({
    deal: {
      type: 'choice',
      choice,
      confidence,
      probabilities: { accept: 0, reject: 0, counter: 0, [choice]: 1 },
    },
  });
const failure = (fallbackReason: JevFailure['fallbackReason']): JevResult => ({
  ok: false,
  fallbackReason,
});

const apply = (state: GameState, actionId: string, seat = AI) => {
  const action = legalActions(state, seat).enabled.find((entry) => entry.id === actionId);
  expect(action, `${actionId} is listed`).toBeDefined();
  const result = applyAction(state, command(state, state.players[seat]!.actorId, action!));
  expect('rejected' in result, `${actionId} applied`).toBe(false);
  return result.state;
};
const listed = (state: GameState) => legalActions(state, AI).enabled.map((action) => action.id);

describe('over budget: code rejects and Jev is not asked (spec §5.3)', () => {
  test('the engine lists no accept, yet a cheaper counter may still be listed', () => {
    const ids = listed(overBudget());
    expect(ids).not.toContain('respond-deal:accept');
    expect(ids).toContain('respond-deal:reject');
    expect(ids.some((id) => id.startsWith('counter-deal:'))).toBe(true);
  });

  test.each(PERSONALITY_IDS)('%s: no request goes out, the answer is the refusal', async (id) => {
    const state = overBudget();
    const ask = vi.fn(async () => choose('accept'));
    for (const difficulty of ['normal', 'easy'] as const) {
      const decision = await new Orchestrator({ client: { ask } }).decide(
        decideRequest(state, id, { difficulty }),
      );
      expect(decision).toMatchObject({
        choice: 'respond-deal:reject',
        source: 'auto',
        fallbackReason: null,
        requests: 0,
      });
    }
    expect(ask).not.toHaveBeenCalled();
  });

  test('a spent game budget rejects the same way, with Jev untouched', async () => {
    const state = proposeDeal(dealTable({ ...REPEL, spent: 2 }), sellRepel(5));
    expect(listed(state)).not.toContain('respond-deal:accept');
    const ask = vi.fn(async () => choose('accept'));
    const decision = await new Orchestrator({ client: { ask } }).decide(decideRequest(state));
    expect(decision).toMatchObject({ choice: 'respond-deal:reject', requests: 0 });
    expect(ask).not.toHaveBeenCalled();
  });

  test('an over-budget answer never reaches the request counter or the token budget', async () => {
    const orchestrator = new Orchestrator({ client: { ask: vi.fn() } });
    await orchestrator.decide(decideRequest(overBudget()));
    expect(orchestrator.usage.totals().inputTokens).toBe(0);
  });

  test('the HTTP route answers with the refusal and a client that would throw is never called', async () => {
    const state = overBudget();
    const ask = vi.fn(async () => {
      throw new Error('Jev must not be asked over budget');
    });
    const app = createApp({
      usage: () => new SpendLedger(),
      jevClient: () => ({ ask }) as JevClient,
    });
    vi.stubEnv('TYPESAFE_API_KEY', 'placeholder-key-not-real');
    const response = await app.request('/api/ai/decide', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(wireRequest(state)),
    });
    expect(response.status).toBe(200);
    const body = decisionResponseSchema.parse(await response.json());
    expect(body).toMatchObject({ choice: 'respond-deal:reject', source: 'fallback' });
    expect(ask).not.toHaveBeenCalled();
  });
});

describe('within budget: Jev answers accept, reject or counter (spec §5.3)', () => {
  test('the question offers exactly the engine-listed answers and no amount', () => {
    const state = fair();
    const request = decideRequest(state);
    const decision = buildDealQuestion(
      request.observation,
      request.legalActions.enabled,
      request.facts.deal!,
      PERSONALITIES.greedy,
    );
    if (decision.kind !== 'ask') throw new Error('expected a question');
    expect(Object.keys(decision.options)).toEqual(['accept', 'reject', 'counter']);
    expect(decision.options.accept).toBe('respond-deal:accept');
    expect(decision.options.reject).toBe('respond-deal:reject');
    // The AI pays coins, so a counter lowers them: the nearest listed amount below 7.
    expect(decision.options.counter).toBe('counter-deal:coins-6');
    expect(Object.keys(decision.questions)).toEqual(['deal']);
    // What Jev is sent (state and questions) carries no amount; the option map stays in code.
    const terms = { ...decision.state.deal, from_id: undefined };
    expect(JSON.stringify([terms, decision.questions])).not.toMatch(/\d/);
  });

  test('a counter for coins the AI receives goes up by one listed step', () => {
    const state = proposeDeal(
      dealTable({ seed: 46, coins: [20, 10], aiTeam: [owned(1, 1, 'eevee')] }),
      { buys: { pokemon: 'caught:1:1' }, coins: 11 },
    );
    const pending = pendingDeal(observe(state, AI))!;
    expect(counterAction(legalActions(state, AI).enabled, pending)?.id).toBe(
      'counter-deal:coins-12',
    );
  });

  test.each([
    ['accept', 'respond-deal:accept'],
    ['reject', 'respond-deal:reject'],
    ['counter', 'counter-deal:coins-6'],
  ])('a confident %s is applied as the engine action %s', async (label, actionId) => {
    const state = fair();
    const client = createFakeJevClient(() => choose(label));
    const decision = await new Orchestrator({ client }).decide(decideRequest(state));
    expect(decision).toMatchObject({
      choice: actionId,
      source: 'jev',
      fallbackReason: null,
      requests: 1,
    });
    expect(decision.events[0]).toMatchObject({ questionId: 'deal', choice: actionId });
    // The engine takes it: every answer is legal.
    expect(() => apply(state, actionId)).not.toThrow();
    expect(client.requests).toHaveLength(1);
  });

  test('an answer that is not offered is discarded for the fallback', async () => {
    const client = createFakeJevClient(() => choose('confirm'));
    const decision = await new Orchestrator({ client }).decide(decideRequest(fair()));
    expect(decision).toMatchObject({ source: 'fallback', fallbackReason: 'invalid_choice' });
    expect(listed(fair())).toContain(decision.choice as string);
  });

  test("below the confidence floor the fallback chooses between Jev's top two", async () => {
    const client = createFakeJevClient(() => choose('accept', 0.1));
    const decision = await new Orchestrator({ client }).decide(decideRequest(fair()));
    expect(decision).toMatchObject({ source: 'fallback', fallbackReason: 'low_confidence' });
    expect(listed(fair())).toContain(decision.choice as string);
  });

  test("Easy samples the answer from Jev's probabilities with the seeded draw", async () => {
    const client = createFakeJevClient(() => choose('reject'));
    const decision = await new Orchestrator({ client }).decide(
      decideRequest(fair(), 'greedy', { difficulty: 'easy' }),
    );
    expect(decision).toMatchObject({ choice: 'respond-deal:reject', source: 'jev' });
    expect(decision.events[0]!.sampled).not.toBeNull();
  });

  test('a stale revision discards the answer', async () => {
    const client = createFakeJevClient(() => choose('accept'));
    const decision = await new Orchestrator({ client }).decide(
      decideRequest(fair(), 'greedy', { currentRevision: () => 999 }),
    );
    expect(decision).toMatchObject({ source: 'fallback', fallbackReason: 'revision_mismatch' });
  });
});

describe('a Jev failure mid-deal falls back under the same budget and never commits (spec §3)', () => {
  const failures = [
    'timeout',
    'rate_limited',
    'server_error',
    'network',
    'schema_mismatch',
  ] as const;

  test.each(failures)('%s: the policy answers with a listed action', async (reason) => {
    for (const id of PERSONALITY_IDS) {
      const state = fair();
      const client = createFakeJevClient(() => failure(reason));
      const decision = await new Orchestrator({ client }).decide(decideRequest(state, id));
      expect(decision.source).toBe('fallback');
      expect(decision.fallbackReason).toBe(reason);
      expect(listed(state)).toContain(decision.choice as string);
    }
  });

  test('a late answer is never applied', async () => {
    const client: JevClient = {
      ask: () =>
        new Promise<JevResult>((resolve) => setTimeout(() => resolve(choose('accept')), 80)),
    };
    const decision = await new Orchestrator({ client, decisionMs: 10 }).decide(
      decideRequest(fair()),
    );
    expect(decision).toMatchObject({ source: 'fallback', fallbackReason: 'timeout' });
  });

  test.each(failures)(
    '%s over budget: the fallback never accepts and no accept is possible',
    async (reason) => {
      const state = overBudget();
      const client = createFakeJevClient(() => failure(reason));
      for (const id of PERSONALITY_IDS) {
        const decision = await new Orchestrator({ client }).decide(decideRequest(state, id));
        expect(decision.choice).toBe('respond-deal:reject');
      }
      // Over budget Jev was not asked at all, so there was nothing to fail.
      expect(client.requests).toHaveLength(0);
    },
  );

  test('the answer, accepted or not, moves nothing until the human confirms', () => {
    const state = fair();
    const before = state.players.map((player) => ({
      coins: player.coins,
      team: player.team.length,
    }));
    const accepted = apply(state, 'respond-deal:accept');
    expect(
      accepted.players.map((player) => ({ coins: player.coins, team: player.team.length })),
    ).toEqual(before);
    expect(accepted.pendingResponse).toMatchObject({ kind: 'deal', stage: 'accepted' });
    // The human is now the seat that owes the answer, so the AI is never asked to confirm its own deal.
    expect(pendingDecision(accepted)?.seatIndex).toBe(0);
    const committed = apply(accepted, 'confirm-deal', 0);
    expect(committed.players[AI]!.coins).toBe(13);
  });

  test('the last-resort answer for a deal is the refusal, never the first listed accept', () => {
    const request = wireRequest(fair());
    expect(request.enabledActions[0]!.id).toBe('respond-deal:accept');
    expect(fallbackAnswer(request, 'decider_error')).toMatchObject({
      choice: 'respond-deal:reject',
    });
  });
});

describe('the fallback policy agrees with the engine and the personalities (spec §5.2, §5.5)', () => {
  const policy = (state: GameState, id: (typeof PERSONALITY_IDS)[number], seed = 'p') =>
    new FallbackPolicy(PERSONALITIES[id]).decide(
      observe(state, AI),
      legalActions(state, AI),
      createPolicyRng(seed),
    );

  test('every table, personality and seed gives a listed answer, and no accept over budget', () => {
    const tables: [string, GameState][] = [
      ['fair', fair()],
      ['over budget', overBudget()],
      ['trust low', proposeDeal(dealTable({ ...EEVEE, trust: -3 }), sellEevee(7))],
      ['trust high', proposeDeal(dealTable({ ...EEVEE, trust: 3 }), sellEevee(7))],
      ['repel', proposeDeal(dealTable(REPEL), sellRepel(5))],
    ];
    for (const [name, state] of tables) {
      for (const id of PERSONALITY_IDS) {
        for (const seed of ['a', 'b', 'c']) {
          const choice = policy(state, id, seed);
          expect(listed(state), `${name} ${id}`).toContain(choice as string);
          if (name === 'over budget') expect(choice, `${name} ${id}`).toBe('respond-deal:reject');
        }
      }
    }
  });

  test('low trust moves a loyal personality from accepting to refusing; a disloyal one is unmoved', () => {
    const neutral = fair();
    const distrusted = proposeDeal(dealTable({ ...EEVEE, trust: -3 }), sellEevee(7));
    expect(policy(neutral, 'cautious')).toBe('respond-deal:accept');
    expect(policy(distrusted, 'cautious')).toBe('respond-deal:reject');
    expect(policy(neutral, 'opportunist')).toBe(policy(distrusted, 'opportunist'));
  });

  test('a lopsided gain is accepted by every personality', () => {
    const state = proposeDeal(
      dealTable({ seed: 43, coins: [10, 20], humanTeam: [owned(0, 1, 'snorlax')] }),
      { sells: { pokemon: 'caught:0:1' }, coins: 2 },
    );
    for (const id of PERSONALITY_IDS) expect(policy(state, id)).toBe('respond-deal:accept');
  });

  test('a small overpay within budget is countered or refused, never taken by the cautious', () => {
    const state = proposeDeal(dealTable(REPEL), sellRepel(5));
    expect(policy(state, 'cautious')).toMatch(/^counter-deal:coins-4$|^respond-deal:reject$/);
    expect(policy(state, 'greedy')).toMatch(/^counter-deal:coins-4$|^respond-deal:reject$/);
  });

  test('without the engine buckets nothing is worth accepting', () => {
    const state = fair();
    const observation = observe(state, AI);
    const pending = observation.own.pendingResponse;
    if (pending?.kind !== 'deal') throw new Error('expected a deal');
    delete pending.facts;
    const choice = new FallbackPolicy(PERSONALITIES.greedy).decide(
      observation,
      legalActions(state, AI),
      createPolicyRng('x'),
    );
    expect(choice).toBe('respond-deal:reject');
  });
});

describe('no hidden information in the request (spec §5.4, §1)', () => {
  const world = (tag: string): GameState => {
    const state = dealTable({
      ...EEVEE,
      humanItems: ['repel'],
      aiItems: ['potion'],
    });
    // The human holds one more secret item it is not offering; the AI's own item is its own.
    state.players[0]!.items.push({
      instanceId: 'item:0:hidden',
      itemId: 'pickpocket',
      name: `SECRET_ITEM_${tag}`,
      visibility: 'secret',
    });
    state.players[0]!.privateResults = [{ kind: 'peek', eventId: `PRIVATE_PEEK_${tag}` }];
    state.config.seed = `SEED_${tag}`;
    state.rng = { state: `RNG_${tag}`, cursor: tag === 'A' ? 987654321 : 123456789 };
    state.eventDeck = { drawPile: [`EVENT_ORDER_${tag}`], discardPile: [`DISCARD_${tag}`] };
    return proposeDeal(state, { sells: { pokemon: 'caught:0:1' }, coins: 7 });
  };
  const requestFor = (tag: string, id: (typeof PERSONALITY_IDS)[number] = 'cautious') => {
    const request = decideRequest(world(tag), id);
    const decision = buildDealQuestion(
      request.observation,
      request.legalActions.enabled,
      request.facts.deal!,
      PERSONALITIES[id],
    );
    if (decision.kind !== 'ask') throw new Error('expected a question');
    return decision;
  };

  test('two worlds that differ only in what the seat cannot see give the same request', () => {
    const a = requestFor('A');
    const b = requestFor('B');
    expect(a).toEqual(b);
    const text = JSON.stringify(a);
    for (const sentinel of [
      'SECRET_ITEM_',
      'PRIVATE_PEEK_',
      'SEED_',
      'RNG_',
      'EVENT_ORDER_',
      'DISCARD_',
      '987654321',
      'item:0:hidden',
      'pickpocket',
    ]) {
      expect(text, sentinel).not.toContain(sentinel);
    }
  });

  test('the state holds named buckets only: no coin amount, no budget number, no raw trust', () => {
    const decision = requestFor('A');
    assertNoComparableNumbers(decision.state);
    const { deal } = decision.state;
    expect(deal).toMatchObject({
      you_give: 'coins',
      you_receive: 'a Pokémon: Eevee',
      value_you_give: 'medium',
      value_you_receive: 'medium',
      concession: 'none',
      budget_left: 'few',
      proposer_trust: 'neutral',
    });
    expect(Object.keys(deal).sort()).toEqual([
      'budget_left',
      'concession',
      'from_id',
      'proposer_trust',
      'value_you_give',
      'value_you_receive',
      'you_give',
      'you_receive',
    ]);
  });

  test('an item the human offers is named from the pending record, and nothing else the human holds', () => {
    const state = proposeDeal(
      dealTable({ ...REPEL, humanItems: ['repel', 'pickpocket'] }),
      sellRepel(3),
    );
    const request = decideRequest(state);
    const decision = buildDealQuestion(
      request.observation,
      request.legalActions.enabled,
      request.facts.deal!,
      PERSONALITIES.greedy,
    );
    if (decision.kind !== 'ask') throw new Error('expected a question');
    expect(decision.state.deal.you_receive).toContain('Repel');
    expect(JSON.stringify(decision)).not.toMatch(/Pickpocket|item:0:1/);
  });

  test("a third seat's deal never appears: the AI's state names only its own pending question", () => {
    // Without a pending question there is no deal block at all.
    const idle = dealTable(EEVEE);
    expect(pendingDeal(observe(idle, AI))).toBeUndefined();
    expect(() =>
      buildDealQuestion(
        observe(idle, AI),
        [],
        { valueGiven: 'low', valueReceived: 'low', concession: 'none' },
        PERSONALITIES.greedy,
      ),
    ).toThrow(RangeError);
  });

  test('trust is a name by the sign of the engine number', () => {
    expect([-3, -1, 0, 1, 3].map(trustBucket)).toEqual(['low', 'low', 'neutral', 'high', 'high']);
  });
});

/** The wire request the browser would send for the AI's pending deal. */
function wireRequest(state: GameState, personalityId = 'greedy'): DecisionRequest {
  const observation = observe(state, AI);
  const pending = observation.own.pendingResponse;
  return decisionRequestSchema.parse({
    gameId: 'game-deal-1',
    seatIndex: AI,
    decisionPoint: 'deal_response',
    stateRevision: observation.public.stateRevision,
    observation,
    enabledActions: legalActions(state, AI).enabled,
    facts: pending?.kind === 'deal' && pending.facts ? { deal: pending.facts } : {},
    difficulty: 'normal',
    personalityId,
    turnKey: `${state.globalTurnNo}:${AI}`,
  });
}

describe('the decision route and the wire contract (spec §6 item 2)', () => {
  const postDecision = async (
    body: unknown,
    client: JevClient = createFakeJevClient(() => choose('accept')),
  ) => {
    vi.stubEnv('TYPESAFE_API_KEY', 'placeholder-key-not-real');
    const app = createApp({ usage: () => new SpendLedger(), jevClient: () => client });
    return app.request('/api/ai/decide', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  };

  test('a deal_response request for the AI answering its own proposed deal is valid', () => {
    expect(() => wireRequest(fair())).not.toThrow();
  });

  test('only the pending seat, the pending kind and a deal answer list are accepted', async () => {
    const state = fair();
    const valid = wireRequest(state);
    const reject = async (body: unknown) => expect((await postDecision(body)).status).toBe(400);
    // The proposer is the active seat but owes nothing.
    await reject({ ...valid, seatIndex: 0, observation: observe(state, 0) });
    // A promise point for a Deal Card question.
    await reject({ ...valid, decisionPoint: 'promise_response' });
    // A non-deal action in the list.
    await reject({ ...valid, enabledActions: [{ id: 'skip', kind: 'skip', payload: {} }] });
    // The human's confirm or cancel is never asked of an AI.
    const agreed = apply(state, 'respond-deal:accept');
    await reject({
      ...valid,
      stateRevision: observe(agreed, AI).public.stateRevision,
      observation: observe(agreed, AI),
      enabledActions: [{ id: 'confirm-deal', kind: 'confirm_deal', payload: {} }],
    });
  });

  test('a confident Jev accept comes back with a line from the bank and a deal_accept dialogue event', async () => {
    const response = await postDecision(wireRequest(fair(), 'cautious'));
    expect(response.status).toBe(200);
    const body = decisionResponseSchema.parse(await response.json());
    expect(body).toMatchObject({ choice: 'respond-deal:accept', source: 'jev' });
    const lineId = response.headers.get('x-ai-line-id')!;
    const line = LINES.deal_accept.find((entry) => entry.id === lineId);
    expect(line?.personality).toBe('cautious');
    const events = JSON.parse(response.headers.get('x-ai-dialogue-events')!);
    expect(events[0]).toMatchObject({ kind: 'line_selected', situation: 'deal_accept', lineId });
  });

  test('a reject says a deal_reject line, a counter says none, and the line is the same on a retry', async () => {
    const rejecting = createFakeJevClient(() => choose('reject'));
    const first = await postDecision(wireRequest(fair(), 'greedy'), rejecting);
    const lineId = first.headers.get('x-ai-line-id')!;
    expect(LINES.deal_reject.some((entry) => entry.id === lineId)).toBe(true);
    const again = await postDecision(wireRequest(fair(), 'greedy'), rejecting);
    expect(again.headers.get('x-ai-line-id')).toBe(lineId);
    const countering = createFakeJevClient(() => choose('counter'));
    const countered = await postDecision(wireRequest(fair(), 'greedy'), countering);
    expect(decisionResponseSchema.parse(await countered.json())).toMatchObject({
      choice: 'counter-deal:coins-6',
    });
    expect(countered.headers.get('x-ai-line-id')).toBeNull();
  });

  test('every deal line in the bank is for neutral trust and exists for each personality', () => {
    for (const situation of ['deal_accept', 'deal_reject'] as const) {
      for (const id of PERSONALITY_IDS) {
        expect(
          LINES[situation].filter((line) => line.personality === id && line.trust === 'neutral')
            .length,
        ).toBeGreaterThanOrEqual(3);
      }
    }
  });

  test('the Jev request for the route carries no key, no amount and only the deal question', async () => {
    const client = createFakeJevClient(() => choose('accept'));
    await postDecision(wireRequest(fair()), client);
    const [request] = client.requests as [JevRequest];
    expect(Object.keys(request.questions)).toEqual(['deal']);
    expect(JSON.stringify(request)).not.toContain('placeholder-key-not-real');
  });
});

test('a stale state hash is unchanged by asking: deciding reads, never writes', async () => {
  const state = fair();
  const before = stateHash(state);
  await new Orchestrator({ client: createFakeJevClient(() => choose('accept')) }).decide(
    decideRequest(state),
  );
  expect(stateHash(state)).toBe(before);
});
