import { afterEach, describe, expect, test, vi } from 'vitest';
import type { GameState, PokemonInstance } from '../engine/index.ts';
import { caught, sell, withFinalTableRound } from '../eval/jev/scenario-kit.ts';
import { decideRequest, type EvalScenario } from '../eval/jev/scenarios.ts';
import { createPolicyRng } from '../sim/policy.ts';
import { FallbackPolicy, PERSONALITIES } from './fallback/index.ts';
import type { JevResult } from './jev/client.ts';
import { createFakeJevClient } from './jev/fake.ts';
import { lastSellChoice, sellsEverythingNow } from './last-sell.ts';
import { Orchestrator, type DecideRequest } from './orchestrator.ts';

// Spec §5.6 (last Sell Phase), §4.7.3: the Final Table Round's Sell Phase sells everything
// sellable unless a Gym follows, and Jev is then not asked. Offline: fake client, no key.
afterEach(() => vi.unstubAllEnvs());

const PERSONALITY_LIST = Object.values(PERSONALITIES);
const EVENT = 2;
const GYM = 6;
const TEAM = () => [caught(1, 'pidgey'), caught(2, 'psyduck')];

interface Setup {
  team?: PokemonInstance[];
  destination?: number;
  lastPhase?: boolean;
  /** Replace the first member of seat 0's team, e.g. with a Rescue Starter. */
  mutate?: (state: GameState) => void;
}

function requestFor(personalityId: keyof typeof PERSONALITIES, setup: Setup = {}): DecideRequest {
  const { team = TEAM(), destination = EVENT, lastPhase = true, mutate } = setup;
  const scenario: EvalScenario = {
    id: `last-sell-${personalityId}`,
    description: 'last Sell Phase rule',
    personality: PERSONALITIES[personalityId],
    acceptable: {},
    build: () => {
      let state = sell(team);
      state.phase = { kind: 'sell', destinationPosition: destination };
      if (lastPhase) state = withFinalTableRound(state);
      mutate?.(state);
      return { state };
    },
  };
  return decideRequest(scenario).request;
}

/** A Jev client that answers every Sell Noul with `noul` and records what was asked. */
const noulClient = (noul: number) =>
  createFakeJevClient((request): JevResult => ({
    ok: true,
    answers: Object.fromEntries(
      Object.keys(request.questions).map((name) => [name, { type: 'noul' as const, noul }]),
    ),
    requestId: 'req_fake',
    model: 'jev-fake',
    latencyMs: 1,
    usage: { inputTokens: 1, outputTokens: 1 },
  }));

const sellable = (request: DecideRequest) =>
  request.legalActions.enabled.flatMap((action) =>
    action.kind === 'sell' && action.payload.pokemonInstanceIds.length === 1
      ? action.payload.pokemonInstanceIds
      : [],
  );
const ids = (choice: unknown) =>
  typeof choice === 'object' && choice !== null && 'sellUids' in choice
    ? (choice as { sellUids: string[] }).sellUids
    : choice;

describe.each(PERSONALITY_LIST.map((personality) => [personality.id, personality] as const))(
  'last Sell Phase, %s',
  (id) => {
    const key = id as keyof typeof PERSONALITIES;

    test('Jev path: sells every sellable Pokémon and sends no request', async () => {
      const request = requestFor(key);
      const client = noulClient(0);
      const decision = await new Orchestrator({ client }).decide(request);
      expect(client.requests).toHaveLength(0);
      expect(decision).toMatchObject({ source: 'auto', fallbackReason: null, requests: 0 });
      expect(ids(decision.choice)).toEqual(sellable(request));
      expect(sellable(request)).toHaveLength(3);
    });

    test('fallback path: sells every sellable Pokémon with or without engine facts', () => {
      const request = requestFor(key);
      const policy = new FallbackPolicy(PERSONALITIES[key]);
      const rng = () => createPolicyRng('last-sell');
      for (const facts of [request.facts.policy, undefined]) {
        const choice = policy.decide(request.observation, request.legalActions, rng(), facts);
        expect(ids(choice)).toEqual(sellable(request));
      }
    });

    test('Jev unavailable (no sale facts, kill switch): still sells everything, still no request', async () => {
      vi.stubEnv('JEV_ENABLED', 'false');
      const client = noulClient(0);
      const withoutFacts = { ...requestFor(key), facts: {} };
      const decision = await new Orchestrator({ client }).decide(withoutFacts);
      expect(client.requests).toHaveLength(0);
      expect(ids(decision.choice)).toEqual(sellable(withoutFacts));
    });

    test('a Gym destination is unchanged: Jev is asked and its answers decide', async () => {
      const request = requestFor(key, { destination: GYM });
      const client = noulClient(0);
      const decision = await new Orchestrator({ client }).decide(request);
      expect(client.requests).toHaveLength(1);
      expect(decision).toMatchObject({ source: 'jev', choice: 'finish-sell' });
      const keeps = new FallbackPolicy(PERSONALITIES[key]).decide(
        request.observation,
        request.legalActions,
        createPolicyRng('gym'),
        {},
      );
      // With no sale facts the threshold rule sells nothing, so the all-sale rule is not applied.
      expect(keeps).toBe('finish-sell');
    });

    test('a normal Sell Phase is unchanged: Jev is asked and its answers decide', async () => {
      const request = requestFor(key, { lastPhase: false });
      const client = noulClient(0);
      const decision = await new Orchestrator({ client }).decide(request);
      expect(client.requests).toHaveLength(1);
      expect(decision).toMatchObject({ source: 'jev', choice: 'finish-sell' });
      const high = noulClient(1);
      const sold = await new Orchestrator({ client: high }).decide(request);
      expect(high.requests).toHaveLength(1);
      expect(ids(sold.choice)).toEqual(sellable(request));
    });
  },
);

describe('what the last Sell Phase sells (§4.7)', () => {
  test('a Rescue Starter is never sold; the other members are', async () => {
    const rescue: PokemonInstance = {
      instanceId: 'rescue:0:9',
      speciesId: 'charmander',
      origin: 'rescue_starter',
      evolutionStage: 0,
      tired: false,
      abilityReady: true,
      tradeable: false,
    };
    const request = requestFor('aggressive', {
      mutate: (state) => (state.players[0]!.team = [rescue, caught(1, 'pidgey')]),
    });
    // The engine lists the Rescue Starter's zero-coin sale, which the rule leaves alone.
    expect(sellable(request)).toContain('rescue:0:9');
    const client = noulClient(0);
    const decision = await new Orchestrator({ client }).decide(request);
    expect(client.requests).toHaveLength(0);
    expect(decision.choice).toBe('sell:caught:0:1');
  });

  test('a team of only a Rescue Starter finishes the Sell Phase', async () => {
    const rescue: PokemonInstance = {
      instanceId: 'rescue:0:9',
      speciesId: 'charmander',
      origin: 'rescue_starter',
      evolutionStage: 0,
      tired: false,
      abilityReady: true,
      tradeable: false,
    };
    const request = requestFor('cautious', {
      mutate: (state) => (state.players[0]!.team = [rescue]),
    });
    const client = noulClient(1);
    const decision = await new Orchestrator({ client }).decide(request);
    expect(client.requests).toHaveLength(0);
    expect(decision.choice).toBe('finish-sell');
  });

  test('a member the engine does not list as sellable is not sold; a tired one is', () => {
    const request = requestFor('opportunist', {
      team: [caught(1, 'pidgey', { tired: true }), caught(2, 'psyduck')],
    });
    const enabled = request.legalActions.enabled.filter(
      (action) =>
        !(action.kind === 'sell' && action.payload.pokemonInstanceIds[0] === 'caught:0:2'),
    );
    expect(lastSellChoice(request.observation, enabled)).toEqual({
      sellUids: [expect.any(String), 'caught:0:1'],
    });
  });
});

describe('the Gym destination comes from the engine board', () => {
  test('a Gym is whatever the engine board says, not a position written in ai/', async () => {
    const asGym = requestFor('aggressive', {
      mutate: (state) => (state.content.board[EVENT]!.kind = 'gym'),
    });
    expect(sellsEverythingNow(asGym.observation)).toBe(false);
    const notGym = requestFor('aggressive', {
      destination: GYM,
      mutate: (state) => (state.content.board[GYM]!.kind = 'wild'),
    });
    expect(sellsEverythingNow(notGym.observation)).toBe(true);
    const client = noulClient(0);
    await new Orchestrator({ client }).decide(asGym);
    expect(client.requests).toHaveLength(1);
  });

  test('the rule needs the Sell Phase and an announced Final Table Round', () => {
    expect(sellsEverythingNow(requestFor('greedy').observation)).toBe(true);
    expect(sellsEverythingNow(requestFor('greedy', { lastPhase: false }).observation)).toBe(false);
    const strategy = requestFor('greedy');
    strategy.observation.public.phase = { kind: 'strategy' };
    expect(sellsEverythingNow(strategy.observation)).toBe(false);
  });
});
