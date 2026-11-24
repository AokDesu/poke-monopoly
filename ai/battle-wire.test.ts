import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { battlePreview, legalActions, observe, type GameState } from '../engine/index.ts';
import {
  decisionRequestSchema,
  decisionResponseSchema,
  type DecisionRequest,
} from '../engine/contract/decision.ts';
import { BATTLE_SCENARIOS } from '../eval/jev/battle-scenarios.ts';
import { wireBattleFacts } from './battle.ts';
import { createApp } from './app.ts';
import { createFakeJevClient } from './jev/fake.ts';
import { PINNED_JEV_MODEL, type JevAnswer, type JevRequest, type JevResult } from './jev/client.ts';
import { SpendLedger } from './jev/spend.ts';

// Spec §4.4, §5.3, §6 item 2: the wire for the battle decision points (issue #56, C3). The browser
// does not send them yet; these tests post what it will, with a fake client and no network.

const SAME_ORIGIN = {
  host: 'localhost:5173',
  origin: 'http://localhost:5173',
  'content-type': 'application/json',
};

beforeEach(() => {
  vi.stubEnv('JEV_ENABLED', 'true');
  vi.stubEnv('TYPESAFE_API_KEY', 'placeholder-key-not-real-4b1e8d');
});
afterEach(() => vi.unstubAllEnvs());

const stateOf = (id: string): GameState => BATTLE_SCENARIOS.find((s) => s.id === id)!.build().state;

/** The request a browser would send for seat 0, from the engine's observation and preview alone. */
const wireRequest = (id: string, battle = true): DecisionRequest => {
  const state = stateOf(id);
  const observation = observe(state, 0);
  const preview = battle ? battlePreview(state, 0) : null;
  const point = id.includes('-pvp-response-')
    ? 'pvp_response'
    : id.includes('-window-')
      ? 'ability_window'
      : 'reward';
  return {
    gameId: 'game-battle-1',
    seatIndex: 0,
    decisionPoint: point,
    stateRevision: observation.public.stateRevision,
    observation,
    enabledActions: legalActions(state, 0).enabled,
    facts: preview && point !== 'reward' ? { battle: wireBattleFacts(preview) } : {},
    difficulty: 'normal',
    personalityId: 'aggressive',
    turnKey: '5:0',
  };
};

const confident =
  (pick: string) =>
  (request: JevRequest): JevResult => {
    const answers: Record<string, JevAnswer> = {};
    for (const [name, question] of Object.entries(request.questions)) {
      if (question.type !== 'choice') throw new Error('expected a Choice');
      const labels = Object.keys(question.criteria);
      answers[name] = {
        type: 'choice',
        choice: pick,
        confidence: 1,
        probabilities: Object.fromEntries(labels.map((label) => [label, label === pick ? 1 : 0])),
      };
    }
    return {
      ok: true,
      answers,
      requestId: 'req_fake_battle',
      model: PINNED_JEV_MODEL,
      latencyMs: 5,
      usage: { inputTokens: 100, outputTokens: 0 },
    };
  };

const post = async (body: unknown, pick = 'accept') => {
  const fake = createFakeJevClient(confident(pick));
  const app = createApp({ usage: () => new SpendLedger(), jevClient: () => fake });
  const response = await app.request('/api/ai/decide', {
    method: 'POST',
    headers: SAME_ORIGIN,
    body: JSON.stringify(body),
  });
  return { response, fake };
};

describe('the schema accepts each battle point for the seat that owes it', () => {
  test.each([
    ['aggressive-pvp-response-even'],
    ['aggressive-window-defender-underdog'],
    ['aggressive-window-pickpocket-block'],
    ['aggressive-reward-pvp-won'],
    ['aggressive-reward-gym-won'],
  ])('%s', (id) => {
    expect(decisionRequestSchema.safeParse(wireRequest(id)).success).toBe(true);
  });

  test('a battle point is refused for another seat, another phase or another action kind', () => {
    const challenge = wireRequest('aggressive-pvp-response-even');
    const issue = (request: unknown) => decisionRequestSchema.safeParse(request).success;
    // The challenger, who owes nothing.
    const challenger = observe(stateOf('aggressive-pvp-response-even'), 1);
    expect(
      issue({
        ...challenge,
        seatIndex: 1,
        observation: challenger,
        stateRevision: challenger.public.stateRevision,
      }),
    ).toBe(false);
    // Each point named in a phase that does not hold it.
    expect(issue({ ...challenge, decisionPoint: 'reward' })).toBe(false);
    expect(issue({ ...challenge, decisionPoint: 'ability_window' })).toBe(false);
    const reward = wireRequest('aggressive-reward-gym-won');
    expect(issue({ ...reward, decisionPoint: 'pvp_response' })).toBe(false);
    expect(issue({ ...reward, decisionPoint: 'ability_window' })).toBe(false);
    // A battle point with the wrong kind of action.
    expect(issue({ ...challenge, enabledActions: reward.enabledActions })).toBe(false);
    // A Pickpocket window is named only for the seat that holds the reaction.
    const window = wireRequest('aggressive-window-pickpocket-block');
    const other = observe(stateOf('aggressive-window-pickpocket-block'), 1);
    expect(
      issue({
        ...window,
        seatIndex: 1,
        observation: other,
        stateRevision: other.public.stateRevision,
      }),
    ).toBe(false);
  });

  test('battle facts are strict probabilities, and nothing else is accepted', () => {
    const request = wireRequest('aggressive-pvp-response-even');
    const parsed = (battle: unknown) =>
      decisionRequestSchema.safeParse({ ...request, facts: { battle } }).success;
    const good = request.facts.battle!;
    expect(parsed(good)).toBe(true);
    expect(parsed({ ...good, win: 1.5 })).toBe(false);
    expect(parsed({ ...good, rng: 1 })).toBe(false);
    expect(parsed({ ...good, kind: 'duel' })).toBe(false);
  });
});

describe('POST /api/ai/decide for the battle points', () => {
  test.each([
    ['aggressive-pvp-response-even', 'accept', 'accept-pvp'],
    ['aggressive-pvp-response-even', 'decline', 'decline-pvp'],
    ['aggressive-window-defender-underdog', 'none', 'pass-window'],
    ['aggressive-window-defender-underdog', 'use_blaze_charmander', 'ability:starter:0'],
    ['aggressive-window-pickpocket-block', 'use_block_snorlax', 'ability:caught:0:1'],
    ['aggressive-reward-gym-won', 'coins', 'reward:coins'],
    [
      'aggressive-reward-gym-won',
      'evolve_charmander_to_charmeleon',
      'reward:evolve:starter:0:charmeleon',
    ],
  ])('%s: Jev picks %s and the engine action %s is applied', async (id, pick, action) => {
    const { response, fake } = await post(wireRequest(id), pick);
    expect(response.status).toBe(200);
    const body = decisionResponseSchema.parse(await response.json());
    expect(body).toMatchObject({ choice: action, source: 'jev' });
    expect(fake.requests).toHaveLength(1);
  });

  test('a Jev failure still answers with an engine option, by the fallback policy', async () => {
    const app = createApp({
      usage: () => new SpendLedger(),
      jevClient: () => ({ ask: async () => ({ ok: false, fallbackReason: 'network' }) }),
    });
    for (const id of [
      'aggressive-pvp-response-even',
      'aggressive-window-defender-underdog',
      'aggressive-reward-gym-won',
    ]) {
      const request = wireRequest(id);
      const response = await app.request('/api/ai/decide', {
        method: 'POST',
        headers: SAME_ORIGIN,
        body: JSON.stringify(request),
      });
      const body = decisionResponseSchema.parse(await response.json());
      expect(body).toMatchObject({ source: 'fallback', fallbackReason: 'network' });
      expect(request.enabledActions.map((action) => action.id)).toContain(
        (body as { choice: string }).choice,
      );
    }
  });

  test('a challenge sent without the engine chances falls back as missing_facts and asks nothing', async () => {
    const { response, fake } = await post(wireRequest('aggressive-pvp-response-even', false));
    const body = decisionResponseSchema.parse(await response.json());
    expect(body).toMatchObject({ source: 'fallback', fallbackReason: 'missing_facts' });
    expect(fake.requests).toHaveLength(0);
  });
});
