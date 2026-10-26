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
    return new Response(JSON.stringify({ choice: request.enabledActions[0].id }));
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
