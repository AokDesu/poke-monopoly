import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import {
  deserialize,
  legalActions,
  resume,
  serialize,
  stateHash,
  verifyReplay,
  type GameLog,
  type GameState,
} from '../../../engine/index.ts';
import { App } from '../App.tsx';
import { t } from '../i18n/en.ts';
import { engineContent } from './content.ts';
import { META_KEY, SAVE_KEY, saveText, type SaveStorage } from './save.ts';
import { configForSetup, createGameStore, type Command, type GameStore } from './store.ts';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function memory(initial: Record<string, string> = {}): SaveStorage {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
}

const opponents = [{ seatIndex: 1, personality: 'cautious' as const, difficulty: 'easy' as const }];
const setup = {
  mode: 'quick' as const,
  human: { classId: 'main-character', starterSpeciesId: 'bulbasaur' },
  opponents: [
    {
      classId: 'researcher',
      starterSpeciesId: 'porygon',
      personality: 'cautious' as const,
      difficulty: 'easy' as const,
    },
  ],
};

function startStore(store: GameStore, lapTarget = 10) {
  store.start({ ...configForSetup(setup, 1), lapTarget }, engineContent, opponents);
}

function driveOne(store: GameStore): boolean {
  const session = store.getSession();
  if (!session || session.state.phase.kind === 'finished') return false;
  const { state } = session;
  const enabled = legalActions(state, state.activeSeatIndex).enabled;
  if (enabled.length > 1) {
    const pass =
      enabled.find(
        (choice) =>
          choice.kind === 'skip' || choice.kind === 'skip_shop' || choice.id === 'finish-sell',
      ) ?? enabled[0]!;
    const actorId = state.players.find(
      (player) => player.seatIndex === state.activeSeatIndex,
    )!.actorId;
    const result = store.submit({
      actorId,
      kind: pass.kind,
      payload: pass.payload,
    } as Command);
    return 'accepted' in result;
  }
  return store.advance({ human: true });
}

const checkpoints: {
  name: string;
  test: (state: GameState, log: GameLog) => boolean;
}[] = [
  {
    name: 'committed first die',
    test: (state, log) =>
      state.phase.kind === 'first_player_roll' &&
      log.actions.some((record) => record.action.kind === 'dice_result'),
  },
  {
    name: 'committed move die',
    test: (state, log) =>
      log.actions.at(-1)?.action.kind === 'dice_result' &&
      state.phase.kind !== 'first_player_roll' &&
      state.phase.kind !== 'move',
  },
  {
    name: 'awaiting move die',
    test: (state) => state.phase.kind === 'move' && state.phase.awaitingResult === true,
  },
  {
    name: 'human shop decision',
    test: (state) => {
      const seat = state.config.seats.find((entry) => entry.seatIndex === state.activeSeatIndex);
      return (
        seat?.controller === 'human' &&
        state.phase.kind === 'shop' &&
        legalActions(state, state.activeSeatIndex).enabled.length > 1
      );
    },
  },
  {
    name: 'AI encounter decision',
    test: (state) => {
      const seat = state.config.seats.find((entry) => entry.seatIndex === state.activeSeatIndex);
      return (
        seat?.controller === 'ai' &&
        state.phase.kind === 'encounter' &&
        legalActions(state, state.activeSeatIndex).enabled.length > 1
      );
    },
  },
];

test('Continue restores five saved points, including an AI decision, without a new roll or turn (§3.1, §6.7, §6.9)', async () => {
  vi.useFakeTimers();
  const box = memory();
  const store = createGameStore();
  render(
    <StrictMode>
      <App store={store} storage={box} seed={1} />
    </StrictMode>,
  );
  act(() => startStore(store));
  const found: { name: string; text: string; meta: string | null }[] = [];
  for (let step = 0; step < 800 && found.length < checkpoints.length; step++) {
    const session = store.getSession()!;
    for (const point of checkpoints) {
      if (found.some((entry) => entry.name === point.name)) continue;
      if (!point.test(session.state, session.log)) continue;
      const text = box.getItem(SAVE_KEY);
      expect(text, point.name).toBeTruthy();
      expect(text).not.toContain('TYPESAFE');
      expect(text).not.toContain('apiKey');
      expect(Object.keys(JSON.parse(text!)).sort()).toEqual(
        ['contentVersion', 'engineVersion', 'log', 'rngVersion', 'saveVersion', 'state'].sort(),
      );
      found.push({ name: point.name, text: text!, meta: box.getItem(META_KEY) });
    }
    if (found.length === checkpoints.length) break;
    expect(driveOne(store), `drive ${step}`).toBe(true);
  }
  expect(found.map((entry) => entry.name).sort()).toEqual(
    checkpoints.map((point) => point.name).sort(),
  );
  cleanup();

  for (const point of found) {
    const saved = deserialize(point.text);
    const expected = resume(saved);
    const next = createGameStore();
    render(
      <StrictMode>
        <App
          store={next}
          storage={memory({
            [SAVE_KEY]: point.text,
            ...(point.meta ? { [META_KEY]: point.meta } : {}),
          })}
        />
      </StrictMode>,
    );
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(t('save.continueHeading'));
    fireEvent.click(screen.getByRole('button', { name: t('save.continue') }));
    const live = next.getSession();
    expect(live, point.name).not.toBeNull();
    expect(stateHash(live!.state), point.name).toBe(stateHash(saved.state));
    expect(resume(live!).waitingFor, point.name).toEqual(expected.waitingFor);
    expect(live!.state.rng, point.name).toEqual(saved.state.rng);
    expect(live!.state.globalTurnNo, point.name).toBe(saved.state.globalTurnNo);
    expect(live!.log.actions.length, point.name).toBe(saved.log.actions.length);
    if (point.name === 'committed first die') {
      const die = saved.log.actions.find((record) => record.action.kind === 'dice_result');
      const value = die?.action.kind === 'dice_result' ? die.action.payload.value : undefined;
      expect(document.body.textContent).toContain(`${t('firstPlayer.rolled')} ${value}`);
    }
    if (point.name === 'AI encounter decision') {
      let body: {
        decisionPoint?: string;
        stateRevision?: number;
        personalityId?: string;
        difficulty?: string;
        enabledActions?: { id: string }[];
      } = {};
      vi.stubGlobal('fetch', (_url: RequestInfo | URL, init?: RequestInit) => {
        body = JSON.parse(String(init?.body));
        return new Promise(() => {});
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1600);
      });
      expect(body.decisionPoint).toBe('encounter');
      expect(body.stateRevision).toBe(saved.state.stateRevision);
      expect(body.personalityId).toBe('cautious');
      expect(body.difficulty).toBe('easy');
      const waiting = expected.waitingFor;
      expect(waiting.kind).toBe('decision');
      if (waiting.kind === 'decision') {
        expect(body.enabledActions?.map((entry) => entry.id)).toEqual(
          waiting.legalActions.enabled.map((entry) => entry.id),
        );
      }
      expect(next.getSession()!.state.stateRevision).toBe(saved.state.stateRevision);
      expect(next.getSession()!.state.globalTurnNo).toBe(saved.state.globalTurnNo);
      expect(screen.getByText(t('game.resumedAiTurn'))).toBeTruthy();
    }
    cleanup();
  }
});

test('a different engine or content version shows the engine mismatch message (§6.9)', () => {
  const store = createGameStore();
  startStore(store);
  const text = serialize(store.getSession()!);
  for (const field of ['engineVersion', 'contentVersion'] as const) {
    const copy = JSON.parse(text) as Record<string, unknown>;
    copy[field] = '0.0.1-old';
    const bad = JSON.stringify(copy);
    let expected = '';
    try {
      deserialize(bad);
    } catch (error) {
      expected = error instanceof Error ? error.message : '';
    }
    render(
      <StrictMode>
        <App storage={memory({ [SAVE_KEY]: bad })} />
      </StrictMode>,
    );
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(t('save.mismatchHeading'));
    expect(screen.getByRole('alert').textContent).toBe(expected);
    expect(expected).toMatch(/Old saves cannot be loaded yet/);
    expect(screen.queryByRole('button', { name: t('save.continue') })).toBeNull();
    cleanup();
  }
});

test('a corrupt or tampered save shows a readable message and does not crash (§6.7)', () => {
  render(
    <StrictMode>
      <App storage={memory({ [SAVE_KEY]: '{' })} />
    </StrictMode>,
  );
  expect(screen.getByText(t('save.unreadable'))).toBeTruthy();
  expect(screen.queryByRole('button', { name: t('save.continue') })).toBeNull();
  cleanup();

  const store = createGameStore();
  startStore(store);
  while (!store.getSession()!.log.actions.some((record) => record.action.kind === 'dice_result')) {
    expect(store.advance({ human: true })).toBe(true);
  }
  const save = JSON.parse(serialize(store.getSession()!)) as {
    log: { actions: { action: { kind: string; payload: { value?: number } } }[] };
  };
  const die = save.log.actions.find((record) => record.action.kind === 'dice_result');
  expect(die?.action.payload.value).toBeTypeOf('number');
  die!.action.payload.value = die!.action.payload.value === 1 ? 2 : 1;
  render(
    <StrictMode>
      <App storage={memory({ [SAVE_KEY]: JSON.stringify(save) })} />
    </StrictMode>,
  );
  expect(screen.getByText(t('save.unreadable'))).toBeTruthy();
  expect(screen.queryByRole('button', { name: t('save.continue') })).toBeNull();
});

test('storage that throws still lets the game start and shows that saving is off (§6.7)', async () => {
  const user = userEvent.setup();
  const throwing: SaveStorage = {
    getItem: () => {
      throw new Error('denied');
    },
    setItem: () => {
      throw new Error('denied');
    },
    removeItem: () => {
      throw new Error('denied');
    },
  };
  render(
    <StrictMode>
      <App storage={throwing} seed={1} random={() => 0} />
    </StrictMode>,
  );
  expect(screen.getByRole('status').textContent).toBe(t('save.off'));
  await user.click(screen.getByRole('button', { name: t('home.randomAll') }));
  await user.click(screen.getByRole('button', { name: t('review.roll') }));
  await user.click(screen.getByRole('button', { name: t('firstPlayer.toBoard') }));
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(t('play.heading'));
  expect(screen.getAllByRole('status').some((status) => status.textContent === t('save.off'))).toBe(
    true,
  );
});

test('a rejected action is not saved, and an accepted one is the engine save (§6.7)', () => {
  const box = memory();
  const store = createGameStore();
  render(
    <StrictMode>
      <App store={store} storage={box} />
    </StrictMode>,
  );
  act(() => startStore(store));
  const before = box.getItem(SAVE_KEY);
  act(() => {
    store.submit({ actorId: 'player-1', kind: 'roll', payload: {} });
  });
  expect(box.getItem(SAVE_KEY)).toBe(before);
  act(() => {
    store.submit({ actorId: 'human', kind: 'roll', payload: {} });
  });
  const text = box.getItem(SAVE_KEY)!;
  expect(text).not.toBe(before);
  expect(text).toBe(saveText(store.getSession()!));
  expect(stateHash(deserialize(text).state)).toBe(stateHash(store.getSession()!.state));
});

test('a finished game shows engine coins, exports a replayable log, and play again clears the save (§4.7, §6.7)', async () => {
  vi.stubGlobal('fetch', async (_url: RequestInfo | URL, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body)) as {
      enabledActions: { id: string; kind: string }[];
    };
    const choice =
      request.enabledActions.find((entry) =>
        ['release', 'skip', 'skip_shop'].includes(entry.kind),
      ) ?? request.enabledActions[0];
    return new Response(JSON.stringify({ choice: choice?.id }));
  });
  const user = userEvent.setup();
  const box = memory();
  const store = createGameStore();
  render(
    <StrictMode>
      <App store={store} storage={box} seed={1} random={() => 0} />
    </StrictMode>,
  );
  await user.click(screen.getByRole('button', { name: t('home.randomAll') }));
  await user.click(screen.getByRole('button', { name: t('review.roll') }));
  await user.click(screen.getByRole('button', { name: t('firstPlayer.toBoard') }));
  act(() => {
    while (store.getSession()?.state.phase.kind !== 'finished') {
      if (!driveOne(store)) throw new Error('game did not finish');
    }
  });
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(t('results.heading'));
  const results = store.getResults();
  expect(results).not.toBeNull();
  for (const row of results!.standings) {
    expect(screen.getAllByText(String(row.coins)).length).toBeGreaterThan(0);
  }
  expect(document.body.textContent).not.toMatch(/pokémon|pokemon|evolution/i);

  const blobs: Blob[] = [];
  vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
    blobs.push(blob as Blob);
    return 'blob:log';
  });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  fireEvent.click(screen.getByRole('button', { name: t('results.export') }));
  const exported = await blobs[0]!.text();
  expect(exported).toBe(saveText(store.getSession()!));
  const loaded = deserialize(exported);
  expect(verifyReplay(loaded)).toEqual({ pass: true, stateHash: stateHash(loaded.state) });

  fireEvent.click(screen.getByRole('button', { name: t('results.playAgain') }));
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(t('home.heading'));
  expect(store.getSession()).toBeNull();
  expect(box.getItem(SAVE_KEY)).toBeNull();
}, 30000);
