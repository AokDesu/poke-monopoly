import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createApp } from '../ai/app.ts';
import { createOrchestratorDecider } from '../ai/decider.ts';
import { FallbackPolicy, PERSONALITIES } from '../ai/fallback/index.ts';
import { PINNED_JEV_MODEL, type JevAnswer, type JevRequest } from '../ai/jev/client.ts';
import type { DecisionRecord } from '../ai/jev/decision-log.ts';
import { createFakeJevClient } from '../ai/jev/fake.ts';
import { SpendLedger } from '../ai/jev/spend.ts';
import { legalActions, observe, type GameState } from '../engine/index.ts';
import { createPolicyRng } from '../sim/policy.ts';
import { realEngine } from '../sim/engine.ts';
import { engineContent } from '../web/src/game/content.ts';
import { configForSetup, createGameStore, type GameStore } from '../web/src/game/store.ts';

// The one place that drives the browser's request path (web/) into the server (ai/): neither
// folder may import the other, so this offline test lives with the Jev evaluation. No key, no
// network; Hono's in-memory `app.request()` stands in for the server.

// The seed of the #150 harness; the game is built here and replayed from it, never from a log.
const SEED = 3396655296;

// An exported JEV_ENABLED=false (the §9 kill switch) must not turn these fake-transport tests into fallback runs: pin the switch on; tests of the switch stub it off themselves (#64).
beforeEach(() => {
  vi.stubEnv('JEV_ENABLED', 'true');
  // Deterministic game ID (the policy RNG is seeded by it) and request IDs.
  let next = 0;
  vi.spyOn(crypto, 'randomUUID').mockImplementation(
    () => `00000000-0000-4000-8000-${String(next++).padStart(12, '0')}`,
  );
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function newGame(): GameStore {
  const store = createGameStore();
  store.start(
    {
      ...configForSetup(
        {
          mode: 'quick',
          human: { classId: 'researcher', starterSpeciesId: 'porygon' },
          opponents: [
            {
              classId: 'main-character',
              starterSpeciesId: 'bulbasaur',
              personality: 'greedy',
              difficulty: 'normal',
            },
          ],
        },
        SEED,
      ),
      lapTarget: 10,
    },
    engineContent,
    [{ seatIndex: 1, personality: 'greedy', difficulty: 'normal' }],
  );
  return store;
}

const sold = (state: GameState, pick: string | { sellUids: readonly string[] }): string[] => {
  if (typeof pick !== 'string') return [...pick.sellUids].sort();
  const action = legalActions(state, state.activeSeatIndex).enabled.find((a) => a.id === pick);
  return action?.kind === 'sell' ? [...action.payload.pokemonInstanceIds].sort() : [];
};

/** One Sell request the browser sent and the answer the server gave, with the state it was asked at. */
interface SellDecision {
  state: GameState;
  request: Record<string, unknown>;
  answer: Record<string, unknown>;
}

interface Played {
  decisions: number;
  /** Decisions sent to `/api/ai/decide`; the #55 Gym, battle and Ability steps are taken locally. */
  asked: number;
  sells: SellDecision[];
  records: DecisionRecord[];
}

/** Jev answers every Noul "sell it" and every Choice with its first label, fully confident. */
const jevAnswers = (request: JevRequest) => ({
  ok: true as const,
  answers: Object.fromEntries(
    Object.entries(request.questions).map(([name, question]): [string, JevAnswer] => {
      if (question.type === 'noul') return [name, { type: 'noul', noul: 0.9 }];
      const labels = Object.keys(question.criteria);
      return [
        name,
        {
          type: 'choice',
          choice: labels[0]!,
          confidence: 1,
          probabilities: Object.fromEntries(labels.map((label, i) => [label, i === 0 ? 1 : 0])),
        },
      ];
    }),
  ),
  requestId: 'req_fake',
  model: PINNED_JEV_MODEL,
  latencyMs: 5,
  usage: { inputTokens: 100, outputTokens: 0 },
});

/**
 * Plays the game from its seed: the human passes everything, the AI seat decides through
 * `store.playOpponent` over `fetch` into `createApp`. Each Sell request and answer is kept for
 * the test to check afterwards: an assertion thrown inside `fetch` would only make the browser
 * fall back, and the test would pass for the wrong reason.
 */
async function play(withJev: boolean): Promise<Played> {
  const records: DecisionRecord[] = [];
  const decide = createOrchestratorDecider({
    client: () => createFakeJevClient(jevAnswers),
    usage: () => undefined,
  });
  const app = createApp({
    usage: () => new SpendLedger(),
    // The status is set here, not read from the environment, so no key is ever involved: with
    // Jev off the server is in its "missing key" backup mode, with it on a fake client answers.
    decider: (request) =>
      decide(request, {
        status: withJev
          ? { jevEnabled: true, backupOnly: false, reason: null }
          : { jevEnabled: true, backupOnly: true, reason: 'missing_key' },
      }),
    decisionLog: (line) => records.push(line),
  });
  const store = newGame();
  const played: Played = { decisions: 0, asked: 0, sells: [], records };
  vi.stubGlobal('fetch', async (url: RequestInfo | URL, init?: RequestInit) => {
    const path = String(url);
    // `keepalive` is a browser flag that Hono's in-memory Request does not take.
    // The browser sends a same-origin Host and Origin that the server requires (spec §9).
    const headers = {
      host: 'localhost:5173',
      origin: 'http://localhost:5173',
      ...Object.fromEntries(new Headers(init?.headers)),
    };
    const response = await app.request(path, { ...init, headers, keepalive: undefined });
    if (path === '/api/ai/decide') {
      played.asked++;
      const request = JSON.parse(String(init?.body));
      if (request.decisionPoint === 'sell') {
        played.sells.push({
          state: store.getSession()!.state,
          request,
          answer: await response.clone().json(),
        });
      }
    }
    return response;
  });
  for (let step = 0; step < 20_000; step++) {
    if (store.advance({ human: true })) continue;
    const { state } = store.getSession()!;
    if (state.phase.kind === 'finished') break;
    if (state.activeSeatIndex === 0) {
      const pass = store
        .getView()!
        .legalActions.enabled.find(
          (choice) =>
            ['skip', 'release', 'skip_shop'].includes(choice.kind) || choice.id === 'finish-sell',
        );
      if (!pass) throw new Error('Missing human decision');
      store.choose(pass.id);
      continue;
    }
    if (!(await store.playOpponent(new AbortController().signal))) {
      throw new Error(`The opponent did not play in the ${state.phase.kind} phase`);
    }
    played.decisions++;
  }
  // The outcome reports are fire-and-forget; let them reach the app.
  await new Promise((resolve) => setTimeout(resolve, 20));
  return played;
}

test('the web request path sells what the sim policy sells, on the replayed game', async () => {
  const played = await play(false);
  expect(played.decisions).toBeGreaterThan(20);
  expect(played.sells.length).toBeGreaterThan(3);
  for (const { state, request, answer } of played.sells) {
    const seat = state.activeSeatIndex;
    // What `npm run sim` computes at this very state, from its own detached batch sale.
    const expected = new FallbackPolicy(PERSONALITIES.greedy).decide(
      observe(state, seat),
      legalActions(state, seat),
      createPolicyRng(`${request.gameId}:${request.turnKey}:${request.stateRevision}`),
      realEngine.facts!(state, seat),
    );
    expect(answer).toMatchObject({ source: 'fallback', fallbackReason: 'missing_key' });
    expect([...(answer.sellUids as string[])].sort()).toEqual(sold(state, expected));
  }
  // The point of #150: the web AI sells, rather than hoarding at every Sell Phase.
  expect(played.sells.some(({ answer }) => (answer.sellUids as string[]).length > 0)).toBe(true);
});

test('with Jev reachable, every Sell Phase with a Pokémon to offer asks one Noul per Pokémon', async () => {
  const played = await play(true);
  expect(played.sells.length).toBeGreaterThan(3);
  let asked = 0;
  for (const { state, request, answer } of played.sells) {
    const team = state.players.find((player) => player.seatIndex === state.activeSeatIndex)!.team;
    const offered = team.flatMap((pokemon, index) =>
      pokemon.origin === 'rescue_starter' ? [] : [`sell_team_${index}`],
    );
    const rows = played.records.filter(
      (row) =>
        row.decisionPoint === 'sell' &&
        row.turnKey === request.turnKey &&
        row.stateRevision === request.stateRevision,
    );
    if (offered.length === 0) {
      // Only a Rescue Starter, which sells for nothing: no question, not a fallback.
      expect(answer).toMatchObject({ source: 'fallback', fallbackReason: 'auto' });
      continue;
    }
    asked++;
    expect(answer).toMatchObject({ source: 'jev' });
    expect(rows.map((row) => row.questionId)).toEqual(offered);
    expect(rows.every((row) => row.fallbackReason === null)).toBe(true);
  }
  expect(asked).toBeGreaterThan(0);
});

test('a full seeded game: every AI decision is one decision-log row, Shop included as non-Jev', async () => {
  const played = await play(false);
  expect(played.decisions).toBeGreaterThan(20);
  // No Jev question is asked without a key, so each decision the server answers logs exactly
  // one event. The engine's first listed choice at a #55 step the server has no question for
  // yet is not a server decision, so it is not logged.
  expect(played.asked).toBeGreaterThan(20);
  expect(played.records).toHaveLength(played.asked);
  const decisions = new Set(
    played.records.map((row) => `${row.turnKey}:${row.stateRevision}:${row.decisionPoint}`),
  );
  expect(decisions.size).toBe(played.records.length);
  const shop = played.records.filter((row) => row.decisionPoint === 'shop');
  expect(shop.length).toBeGreaterThan(0);
  expect(shop.every((row) => row.fallbackReason === 'auto' && row.questionId === 'shop')).toBe(
    true,
  );
  expect(played.records.some((row) => row.fallbackReason === 'stub')).toBe(false);
});
