import { afterEach, expect, test, vi } from 'vitest';
import { replay, stateHash } from '../../../engine/index.ts';
import { engineContent } from './content.ts';
import { configForSetup, createGameStore, type GameStore } from './store.ts';

function game(): GameStore {
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
        'private-game-seed',
      ),
      lapTarget: 10,
    },
    engineContent,
    [{ seatIndex: 1, personality: 'greedy', difficulty: 'normal' }],
  );
  return store;
}

function opponentDecision(store: GameStore) {
  for (let step = 0; step < 300; step++) {
    if (store.advance({ human: true })) continue;
    const session = store.getSession()!;
    if (session.state.activeSeatIndex !== 0) return;
    const options = store.getView()!.legalActions.enabled;
    const pass = options.find(
      (choice) =>
        ['skip', 'release', 'skip_shop'].includes(choice.kind) || choice.id === 'finish-sell',
    );
    if (!pass) throw new Error('Missing human decision');
    store.choose(pass.id);
  }
  throw new Error('Opponent decision was not reached');
}

afterEach(() => vi.unstubAllGlobals());

test('single human steps are engine-auto records, but multiple human actions never auto-play', () => {
  const store = game();
  expect(store.advance({ human: true })).toBe(true);
  expect(store.getSession()!.log.actions[0]).toMatchObject({
    auto: true,
    action: { actorId: 'human', kind: 'roll' },
  });
  for (let step = 0; step < 200; step++) {
    if (!store.advance({ human: true })) break;
  }
  const before = store.getSession()!;
  expect(store.advance({ human: true })).toBe(false);
  expect(store.getSession()).toBe(before);
  expect(stateHash(replay(before.log))).toBe(stateHash(before.state));
});

test('opponent requests contain only that seat projection; the returned legal choice commits and replays', async () => {
  const store = game();
  opponentDecision(store);
  const before = store.getSession()!;
  const transport = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body));
    expect(request.observation.own.seatIndex).toBe(1);
    expect(request.seatIndex).toBe(1);
    expect(request.stateRevision).toBe(before.state.stateRevision);
    expect(request.observation.public.players.every((player: object) => !('balls' in player))).toBe(
      true,
    );
    expect(JSON.stringify(request)).not.toMatch(
      /private-game-seed|"rng"|"eventDeck"|"initialState"/,
    );
    return new Response(
      JSON.stringify({
        choice: request.enabledActions[0].id,
        source: 'fallback',
        fallbackReason: 'stub',
      }),
    );
  });
  vi.stubGlobal('fetch', transport);
  expect(await store.playOpponent(new AbortController().signal)).toBe(true);
  const after = store.getSession()!;
  expect(after.state.stateRevision).toBe(before.state.stateRevision + 1);
  expect(stateHash(replay(after.log))).toBe(stateHash(after.state));
});

test.each(['http-error', 'illegal-choice', 'malformed-response'])(
  'an opponent %s leaves the game unchanged',
  async (failure) => {
    const store = game();
    opponentDecision(store);
    const before = store.getSession();
    vi.stubGlobal('fetch', async () =>
      failure === 'http-error'
        ? new Response('', { status: 503 })
        : new Response(
            failure === 'illegal-choice' ? JSON.stringify({ choice: 'invented' }) : '[]',
          ),
    );
    await expect(store.playOpponent(new AbortController().signal)).rejects.toThrow();
    expect(store.getSession()).toBe(before);
  },
);

test('a late opponent response cannot change a replaced game', async () => {
  const store = game();
  opponentDecision(store);
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ choice: 'release' })));
  const pending = store.playOpponent(new AbortController().signal);
  store.clear();
  expect(await pending).toBe(false);
  expect(store.getSession()).toBeNull();
});

test('leaving the Board aborts a pending answer without advancing its decision', async () => {
  const store = game();
  opponentDecision(store);
  const before = store.getSession();
  const controller = new AbortController();
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ choice: 'release' })));
  const pending = store.playOpponent(controller.signal);
  controller.abort();
  expect(await pending).toBe(false);
  expect(store.getSession()).toBe(before);
});

/** A Quick game with the Social window open; seat 0 is the human, then 1 or 2 AI opponents. */
function socialGame(seats: 2 | 3): GameStore {
  const opponents = [
    { classId: 'main-character', starterSpeciesId: 'bulbasaur' },
    { classId: 'rival', starterSpeciesId: 'eevee' },
  ]
    .slice(0, seats - 1)
    .map((choice) => ({
      ...choice,
      personality: 'greedy' as const,
      difficulty: 'normal' as const,
    }));
  const store = createGameStore();
  store.start(
    {
      ...configForSetup(
        {
          mode: 'quick',
          human: { classId: 'researcher', starterSpeciesId: 'porygon' },
          opponents,
        },
        'private-game-seed',
      ),
      lapTarget: 10,
      socialWindow: true,
    },
    engineContent,
    opponents.map((_, index) => ({
      seatIndex: index + 1,
      personality: 'greedy',
      difficulty: 'normal',
    })),
  );
  return store;
}

/** Each opponent answers with its first enabled action. */
const firstChoice = async (_url: RequestInfo | URL, init?: RequestInit) => {
  const request = JSON.parse(String(init?.body));
  return new Response(JSON.stringify({ choice: request.enabledActions[0].id, source: 'fallback' }));
};

test.each([2, 3] as const)(
  '%i seats: after the human chats seat 1, the store submits each seat its observed revision (§4.8, #143)',
  async (seats) => {
    const store = socialGame(seats);
    const seat = seats - 1;
    vi.stubGlobal('fetch', firstChoice);
    let chatted = false;
    for (let step = 0; step < 1000; step++) {
      if (store.advance({ human: true })) continue;
      const { state } = store.getSession()!;
      if (chatted && state.activeSeatIndex === seat) break;
      if (state.activeSeatIndex === 0) {
        const options = store.getView()!.legalActions.enabled;
        const chat = options.find((choice) => choice.id === 'chat:seat-1:truce');
        const pass = options.find(
          (choice) =>
            ['skip', 'release', 'skip_shop'].includes(choice.kind) || choice.id === 'finish-sell',
        )!;
        const pick: (typeof options)[number] = !chatted && chat ? chat : pass;
        chatted ||= pick === chat;
        expect('accepted' in store.choose(pick.id)).toBe(true);
        continue;
      }
      expect(await store.playOpponent(new AbortController().signal)).toBe(true);
    }
    const before = store.getSession()!;
    expect(chatted).toBe(true);
    expect(before.state.activeSeatIndex).toBe(seat);
    // The human took part in every chat, so its feed is numbered like its observation.
    const view = store.getView()!;
    expect(view.feed).toHaveLength(view.observation.public.stateRevision);
    expect(view.feed.map((entry) => entry.record.action.actionSeq)).toEqual(
      view.feed.map((_, index) => index + 1),
    );
    const transport = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body));
      // With 3 seats, seat 2 was outside the chat: its revision does not count it.
      expect(request.stateRevision).toBe(request.observation.public.stateRevision);
      expect(request.stateRevision).toBe(before.state.stateRevision - (seats === 3 ? 1 : 0));
      return firstChoice(url, init);
    });
    vi.stubGlobal('fetch', transport);
    expect(await store.playOpponent(new AbortController().signal)).toBe(true);
    expect(transport).toHaveBeenCalled();
    const after = store.getSession()!;
    expect(after.state.stateRevision).toBe(before.state.stateRevision + 1);
    expect(stateHash(replay(after.log))).toBe(stateHash(after.state));
  },
);
