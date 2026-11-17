import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, useSyncExternalStore } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  createGameConfig,
  stateHash,
  verifyReplay,
  type AiSpeechEvent,
  type EngineEvent,
} from '../../../engine/index.ts';
import { speakRequestSchema } from '../../../engine/contract/speech.ts';
import type { AiStatus } from '../../../engine/contract/decision.ts';
import { TableTalkPanel } from '../board/TableTalk.tsx';
import { useTableTalk } from '../board/useTableTalk.ts';
import { t } from '../i18n/en.ts';
import { content, engineContent } from './content.ts';
import { loadSave, saveText } from './save.ts';
import { createGameStore, type GameStore, type SeatFeedEntry } from './store.ts';
import {
  canSpeakWithoutHaiku,
  detectMoment,
  leaderOf,
  planTableTalk,
  requestSpeech,
  roundOf,
  speakBody,
  speechEvent,
  TABLE_TALK,
  voiceOff,
  type Moment,
  type PublicGame,
  type TalkContext,
  type TalkPlan,
} from './tableTalk.ts';

beforeEach(() => {
  vi.useRealTimers();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const SEATS = [
  { classId: 'main-character', starterSpeciesId: 'bulbasaur' },
  { classId: 'researcher', starterSpeciesId: 'porygon' },
  { classId: 'rival', starterSpeciesId: 'eevee' },
  { classId: 'fisherman', starterSpeciesId: 'magikarp' },
];

/** A game of `seats` seats; seat 0 is the human when `human`, else every seat is an AI (a watched game). */
function gameStore(seats: 2 | 3 | 4, human: boolean, seed: number | string): GameStore {
  const store = createGameStore();
  store.start(
    createGameConfig({
      seats: SEATS.slice(0, seats).map((seat, seatIndex) => ({
        actorId: `player-${seatIndex}`,
        seatIndex,
        ...seat,
        controller: human && seatIndex === 0 ? ('human' as const) : ('ai' as const),
      })),
      seed,
      lapTarget: 2,
    }),
    engineContent,
    Array.from({ length: seats }, (_, seatIndex) => ({
      seatIndex,
      personality: 'greedy' as const,
      difficulty: 'normal' as const,
    })),
  );
  return store;
}

const viewOf = (store: GameStore) => store.getView() ?? store.getSpectatorView();

const json = (value: unknown) => new Response(JSON.stringify(value));
const telemetry = { requestId: 'r', latencyMs: 1 };

type Route = 'haiku' | 'bank' | 'error' | 'hang' | 'garbage';

/**
 * The local server, faked, with no model behind it: every seat takes its first enabled action,
 * so a game is a pure function of its seed, and `/api/ai/speak` answers as `route` says.
 */
function fakeServer(route: Route, status?: Partial<AiStatus['speech']>) {
  const speak: { body: string; parsed: Record<string, unknown> }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const path = String(url);
      const body = String(init?.body);
      if (path === '/api/ai/status')
        return json({
          backupOnly: false,
          jevEnabled: true,
          reason: null,
          speech: { enabled: true, reason: null, ...status },
        });
      if (path === '/api/ai/outcome') return new Response(null, { status: 204 });
      if (path === '/api/ai/speak') {
        speak.push({ body, parsed: JSON.parse(body) });
        if (route === 'hang') return new Promise<Response>(() => {});
        if (route === 'error') return new Response('{}', { status: 500 });
        if (route === 'garbage') return json({ text: 42 });
        return route === 'haiku'
          ? json({ source: 'haiku', text: 'A calm word from across the table.', ...telemetry })
          : json({
              source: 'bank',
              text: '{target} is in front. I will watch that closely.',
              lineId: 'taunt-leader-cautious-neutral-1',
              fallbackReason: 'disabled',
              ...telemetry,
            });
      }
      const choice = JSON.parse(body).enabledActions[0].id;
      if (path === '/api/ai/fallback') return json({ choice, source: 'fallback' });
      return json({ choice, source: 'jev' });
    }),
  );
  return speak;
}

interface Playback {
  speed: 'normal' | 'fast' | 'instant';
  paused: boolean;
  status: AiStatus | null;
}

/** The table talk hook as the board mounts it, on whichever view the store has. */
function mountTalk(store: GameStore, playback: Partial<Playback> = {}) {
  return renderHook(
    (props: Playback) => {
      const view = useSyncExternalStore(store.subscribe, () => viewOf(store));
      return useTableTalk(store, view, props);
    },
    { initialProps: { speed: 'normal', paused: false, status: null, ...playback } },
  );
}

const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));

/** Plays one step the way the board does: an automatic step, the human's first choice, or an AI decision. */
async function step(store: GameStore): Promise<boolean> {
  const { state } = store.getSession()!;
  if (state.phase.kind === 'finished') return false;
  await act(async () => {
    if (store.advance({ human: true })) return;
    const view = store.getView();
    if (view && view.observation.public.activeSeatIndex === view.seatIndex)
      store.choose(view.legalActions.enabled[0]!.id);
    else if (!(await store.playOpponent(new AbortController().signal))) throw new Error('stuck');
  });
  await settle();
  return true;
}

async function play(store: GameStore, stop: (steps: number) => boolean = () => false) {
  for (let steps = 0; steps < 20_000; steps++) {
    if (stop(steps) || !(await step(store))) return steps;
  }
  throw new Error('game did not finish');
}

const spoken = (store: GameStore): AiSpeechEvent[] =>
  (store.getSession()!.log.dialogueEvents ?? []).filter(
    (event): event is AiSpeechEvent => event.kind === 'ai_speech',
  );
const shape = (lines: readonly AiSpeechEvent[]) =>
  lines.map(({ speakerSeatIndex, addressedSeatIndex, globalTurnNo, source }) => ({
    speakerSeatIndex,
    addressedSeatIndex,
    globalTurnNo,
    source,
  }));

// Seeded games that reach lead changes under the first-choice policy (see the moments they hold).
const WATCHED = [
  [3, 1],
  [3, 2],
  [4, 1],
  [4, 3],
] as const;

describe('a public moment (§5.7)', () => {
  const base = gameStore(4, false, 1).getSpectatorView()!;
  const players = (coins: number[]) =>
    base.observation.public.players.map((player, index) => ({
      ...structuredClone(player),
      coins: coins[index]!,
    }));
  const publicGame = (coins: number[] = [10, 10, 10, 10]): PublicGame => ({
    ...base.observation.public,
    players: players(coins),
  });
  const entry = (kind: string, events: EngineEvent[] = [], active = 0, turn = 9): SeatFeedEntry =>
    ({
      before: { phase: { kind: 'move' }, activeSeatIndex: active, globalTurnNo: turn },
      record: { action: { kind }, events },
    }) as unknown as SeatFeedEntry;
  const sale = (amount: number): EngineEvent => ({
    kind: 'coin_transfer',
    source: { kind: 'bank' },
    destination: { kind: 'player', actorId: 'player-0' },
    amount,
    reason: 'pokemon_sale',
  });

  test('a Gym win is about its winner', () => {
    const reward: EngineEvent = {
      kind: 'battle_reward_resolved',
      rewardId: 'gym-1',
      winnerId: 'player-2',
      source: { kind: 'gym' },
      choice: { kind: 'coins' },
      coinAmount: 3,
    };
    expect(detectMoment(entry('gym', [reward], 2), publicGame(), null)).toMatchObject({
      situation: 'gym_win',
      subjectSeat: 2,
      addressedSeat: 2,
      turn: 9,
    });
    // A battle between players is not a Gym.
    const pvp = { ...reward, source: { kind: 'pvp', loserId: 'player-1', coinLossBlocked: false } };
    expect(detectMoment(entry('gym', [pvp as EngineEvent], 2), publicGame(), null)).toBeNull();
  });

  test('only a rare catch is a moment', () => {
    const caught = (speciesId: string) => {
      const game = publicGame();
      game.players[1]!.team = [{ ...game.players[1]!.team[0]!, instanceId: 'new-1', speciesId }];
      const created: EngineEvent = {
        kind: 'uid_created',
        instanceId: 'new-1',
        entity: 'pokemon',
        ownerId: game.players[1]!.actorId,
      };
      return detectMoment(entry('catch', [created], 1), game, null);
    };
    const rare = content.species.find((species) => species.rarity === 'rare')!;
    const uncommon = content.species.find((species) => species.rarity === 'uncommon')!;
    expect(caught(rare.id)).toMatchObject({ situation: 'catch_success', subjectSeat: 1 });
    expect(caught(uncommon.id)).toBeNull();
  });

  test('a sale is big from the presentation threshold up', () => {
    const at = (coins: number) => detectMoment(entry('sell', [sale(coins)], 3), publicGame(), null);
    expect(at(TABLE_TALK.bigSaleCoins)).toMatchObject({
      situation: 'sold_pokemon',
      subjectSeat: 3,
    });
    expect(at(TABLE_TALK.bigSaleCoins - 1)).toBeNull();
    // Two sales in one batch add up.
    expect(detectMoment(entry('sell', [sale(10), sale(10)], 3), publicGame(), null)).toMatchObject({
      situation: 'sold_pokemon',
    });
  });

  test('a change of leader is a moment; a first lead, a tie and no change are not', () => {
    const turn = (coins: number[], previous: number | null) =>
      detectMoment(entry('move', [], 0), publicGame(coins), previous);
    expect(turn([10, 14, 10, 10], 0)).toMatchObject({
      situation: 'taunt_leader',
      addressedSeat: 1,
      actingSeat: 0,
    });
    expect(turn([14, 10, 10, 10], 0)).toBeNull();
    expect(turn([14, 14, 10, 10], 0)).toBeNull();
    expect(turn([14, 10, 10, 10], null)).toBeNull();
  });

  test('the final round teases the leader, and nobody when the lead is tied', () => {
    const final: EngineEvent = {
      kind: 'final_table_round',
      triggerSeatIndex: 0,
      targetOwnTurnNo: 4,
    };
    expect(detectMoment(entry('move', [final]), publicGame([10, 10, 12, 10]), 2)).toMatchObject({
      situation: 'taunt_leader',
      addressedSeat: 2,
    });
    expect(detectMoment(entry('move', [final]), publicGame(), null)).toBeNull();
  });

  test('a Gym win outranks a change of leader on the same step', () => {
    const reward: EngineEvent = {
      kind: 'battle_reward_resolved',
      rewardId: 'gym-1',
      winnerId: 'player-0',
      source: { kind: 'gym' },
      choice: { kind: 'coins' },
      coinAmount: 3,
    };
    expect(detectMoment(entry('gym', [reward]), publicGame([20, 10, 10, 10]), 1)).toMatchObject({
      situation: 'gym_win',
    });
  });
});

describe('who may speak, and when (§5.7)', () => {
  const view = gameStore(4, false, 1).getSpectatorView()!;
  const moment: Moment = {
    situation: 'taunt_leader',
    actingSeat: 0,
    subjectSeat: 0,
    addressedSeat: 1,
    turn: 9,
  };
  const context = (over: Partial<TalkContext> = {}): TalkContext => ({
    view,
    seed: 'seed',
    momentKey: 5,
    spoken: [],
    moment,
    speed: 'normal',
    paused: false,
    hidden: false,
    ...over,
  });
  const line = (turn: number): AiSpeechEvent => ({
    kind: 'ai_speech',
    speakerSeatIndex: 2,
    source: 'bank',
    text: 'Hello.',
    globalTurnNo: turn,
  });

  test('a speaker comes from the AI seats, never the acting, subject or addressed seat', () => {
    for (let key = 0; key < 200; key++) {
      const plan = planTableTalk(context({ momentKey: key }))!;
      expect([2, 3]).toContain(plan.speakerSeat);
    }
  });

  test('the speaker is a fixed function of the seed and the moment, and the seats all get a turn', () => {
    const speakers = (seed: string) =>
      Array.from(
        { length: 60 },
        (_, key) => planTableTalk(context({ seed, momentKey: key }))!.speakerSeat,
      );
    expect(speakers('seed')).toEqual(speakers('seed'));
    expect(new Set(speakers('seed'))).toEqual(new Set([2, 3]));
    expect(speakers('seed')).not.toEqual(speakers('another seed'));
  });

  test('nobody is left to speak when the other seats are the subject and the addressee', () => {
    const duel = gameStore(2, true, 1).getView()!;
    expect(planTableTalk(context({ view: duel, moment: { ...moment, actingSeat: 0 } }))).toBeNull();
    const own: Moment = { ...moment, actingSeat: 1, subjectSeat: 1, addressedSeat: 0 };
    expect(planTableTalk(context({ view: duel, moment: own }))).toBeNull();
  });

  test.each([
    ['at Fast speed', { speed: 'fast' as const }],
    ['at Instant speed', { speed: 'instant' as const }],
    ['while paused', { paused: true }],
    ['while hidden', { hidden: true }],
  ])('no comment %s', (_name, over) => {
    expect(planTableTalk(context())).not.toBeNull();
    expect(planTableTalk(context(over))).toBeNull();
  });

  test('one comment per round: a line in this round blocks it, a line in another does not', () => {
    const seats = view.observation.public.players.length;
    const round = roundOf(moment.turn, seats);
    const sameRound = Array.from({ length: seats }, (_, index) => round * seats + 1 + index).filter(
      (turn) => roundOf(turn, seats) === round,
    );
    expect(sameRound).toHaveLength(seats);
    for (const turn of sameRound)
      expect(planTableTalk(context({ spoken: [line(turn)] })), `turn ${turn}`).toBeNull();
    expect(
      planTableTalk(context({ spoken: [line(round * seats), line((round + 1) * seats + 1)] })),
    ).not.toBeNull();
    expect(roundOf(0, seats)).toBe(0);
    expect(roundOf(seats, seats)).toBe(0);
    expect(roundOf(seats + 1, seats)).toBe(1);
  });

  test('a game never has more than the per-game maximum', () => {
    const lines = (count: number) =>
      Array.from({ length: count }, (_, index) => line(100 + index * 4));
    expect(planTableTalk(context({ spoken: lines(TABLE_TALK.maxPerGame - 1) }))).not.toBeNull();
    expect(planTableTalk(context({ spoken: lines(TABLE_TALK.maxPerGame) }))).toBeNull();
  });
});

describe('the request (§4.1, §5.4)', () => {
  const SECRET = 'SENTINEL-SECRET-IN-THE-SPEAKER-HAND';

  /** Every seat holds a secret item, a pouch count and a peek result that no seat may see in another. */
  function plant(store: GameStore) {
    for (const player of store.getSession()!.state.players) {
      player.items.push({
        instanceId: `${SECRET}-uid-${player.seatIndex}`,
        itemId: 'repel',
        name: `${SECRET}-name`,
        visibility: 'secret',
      });
      player.balls.poke = 7_777_777;
      player.privateResults.push({ kind: 'peek', eventId: `${SECRET}-peek` });
    }
  }
  const plan: TalkPlan = {
    moment: {
      situation: 'taunt_leader',
      actingSeat: 0,
      subjectSeat: 0,
      addressedSeat: 1,
      turn: 9,
    },
    speakerSeat: 2,
    personalityId: 'greedy',
  };

  test.each([
    ['a watched game', gameStore(3, false, 'sentinel-seed-do-not-send')],
    ['a game with a human seat', gameStore(3, true, 'sentinel-seed-do-not-send')],
  ])('%s: no hand, pouch, peek result, seed or RNG leaves for the speech route', (_name, store) => {
    plant(store);
    const rng = store.getSession()!.state.rng.state;
    const view = viewOf(store)!;
    const body = speakBody({ gameId: 'g', plan, game: view.observation.public, momentKey: 4 });
    const text = JSON.stringify(body);
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain('7777777');
    expect(text).not.toContain('sentinel-seed');
    expect(text).not.toContain(rng);
    // It is a request the route accepts, within the route's 16 KB limit.
    const parsed = speakRequestSchema.parse(JSON.parse(text));
    expect(parsed).toMatchObject({ seatIndex: 2, addressedSeat: 1, situation: 'taunt_leader' });
    expect(parsed.observation.own).toEqual({
      seatIndex: 2,
      items: [],
      balls: { poke: 0, great: 0, ultra: 0 },
      privateResults: [],
    });
    expect(new TextEncoder().encode(text).length).toBeLessThan(16 * 1024);
  });

  test('a late-game observation still fits the route limit', async () => {
    fakeServer('hang');
    const store = gameStore(4, false, 1);
    await play(store, (steps) => steps === 60);
    const body = speakBody({
      gameId: 'g',
      plan: { ...plan, speakerSeat: 3 },
      game: viewOf(store)!.observation.public,
      momentKey: 60,
    });
    expect(speakRequestSchema.safeParse(body).success).toBe(true);
    expect(new TextEncoder().encode(JSON.stringify(body)).length).toBeLessThan(16 * 1024);
  });
});

describe('asking the route (§3.1: the game never waits)', () => {
  const body = { any: 'request' };
  const haiku = { source: 'haiku', text: 'Fine words.', ...telemetry };

  test('a line inside the window comes back', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json(haiku)),
    );
    expect(await requestSpeech(body, new AbortController().signal)).toEqual({
      source: 'haiku',
      text: 'Fine words.',
    });
  });

  test('a line that arrives after the window is dropped even if the network answers it', async () => {
    vi.useFakeTimers();
    const fetchSpy = vi.fn(
      () =>
        new Promise<Response>((resolve) =>
          setTimeout(() => resolve(json(haiku)), TABLE_TALK.deadlineMs + 500),
        ),
    );
    vi.stubGlobal('fetch', fetchSpy);
    const pending = requestSpeech(body, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(TABLE_TALK.deadlineMs);
    expect(await pending).toBeNull();
    await vi.advanceTimersByTimeAsync(1000);
    // Never retried.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  test.each([
    ['an HTTP error', async () => new Response('{}', { status: 500 })],
    ['a refused request', async () => new Response('{}', { status: 403 })],
    ['a network failure', async () => Promise.reject(new TypeError('offline'))],
    ['not JSON', async () => new Response('<html>')],
    ['a line with no text', async () => json({ source: 'haiku', ...telemetry })],
    ['a bank line with no id', async () => json({ source: 'bank', text: 'Hi', ...telemetry })],
    ['no line', async () => json({ source: 'none', fallbackReason: 'disabled', ...telemetry })],
    ['an unknown source', async () => json({ source: 'model', text: 'Hi' })],
  ])('%s shows nothing and is not retried', async (_name, answer) => {
    const fetchSpy = vi.fn(answer);
    vi.stubGlobal('fetch', fetchSpy);
    expect(await requestSpeech(body, new AbortController().signal)).toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  test('an aborted request never reaches the network', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const controller = new AbortController();
    controller.abort();
    expect(await requestSpeech(body, controller.signal)).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('the line that is saved (§4.8, §5.7)', () => {
  const view = gameStore(3, false, 1).getSpectatorView()!;
  const game = view.observation.public;
  const planFor = (situation: Moment['situation']): TalkPlan => ({
    moment: { situation, actingSeat: 0, subjectSeat: 0, addressedSeat: 1, turn: 6 },
    speakerSeat: 2,
    personalityId: 'cautious',
  });

  test('a Haiku line is saved as written, addressed and tied to its turn', () => {
    expect(
      speechEvent(planFor('taunt_leader'), { source: 'haiku', text: '  Well held.  ' }, game),
    ).toEqual({
      kind: 'ai_speech',
      speakerSeatIndex: 2,
      addressedSeatIndex: 1,
      source: 'haiku',
      text: 'Well held.',
      globalTurnNo: 6,
    });
    expect(speechEvent(planFor('gym_win'), { source: 'haiku', text: '   ' }, game)).toBeNull();
    expect(
      speechEvent(planFor('gym_win'), { source: 'haiku', text: 'x'.repeat(281) }, game),
    ).toBeNull();
  });

  test('a bank line about the table is filled with the addressed class name', () => {
    const event = speechEvent(
      planFor('taunt_leader'),
      { source: 'bank', lineId: 'taunt-leader-cautious-neutral-1', text: 'ignored' },
      game,
    );
    expect(event).toMatchObject({
      source: 'bank',
      lineId: 'taunt-leader-cautious-neutral-1',
      text: 'Researcher is in front. I will watch that closely.',
    });
    expect(event!.text).not.toMatch(/[{}]/);
  });

  test('a bank line written for the actor is never said by another seat, and an unknown line is dropped', () => {
    for (const [situation, lineId] of [
      ['gym_win', 'gym-win-cautious-neutral-1'],
      ['catch_success', 'catch-success-cautious-neutral-1'],
      ['sold_pokemon', 'sold-pokemon-cautious-neutral-1'],
    ] as const) {
      expect(canSpeakWithoutHaiku(situation)).toBe(false);
      expect(
        speechEvent(planFor(situation), { source: 'bank', lineId, text: 'x' }, game),
      ).toBeNull();
    }
    expect(canSpeakWithoutHaiku('taunt_leader')).toBe(true);
    expect(
      speechEvent(
        planFor('taunt_leader'),
        { source: 'bank', lineId: 'no-such-line', text: 'x' },
        game,
      ),
    ).toBeNull();
  });
});

describe('table talk in a played game (§5.7, §3.1)', () => {
  test.each(WATCHED)(
    'a %i-seat watched game (seed %i): words never change a coin, die, legal action or the log, whatever the route does',
    async (seats, seed) => {
      const finals: { actions: unknown; hash: string; lines: number }[] = [];
      for (const route of ['haiku', 'error', 'hang', 'garbage'] as const) {
        fakeServer(route);
        const store = gameStore(seats, false, seed);
        const mounted = mountTalk(store);
        await play(store);
        const session = store.getSession()!;
        expect(verifyReplay(session)).toMatchObject({ pass: true });
        finals.push({
          actions: session.log.actions,
          hash: stateHash(session.state),
          lines: spoken(store).length,
        });
        mounted.unmount();
      }
      expect(finals.map((final) => final.hash)).toEqual(Array(4).fill(finals[0]!.hash));
      for (const final of finals) expect(final.actions).toEqual(finals[0]!.actions);
      // Only the route that answered left lines behind.
      expect(finals.map((final) => final.lines > 0)).toEqual([true, false, false, false]);
    },
    60_000,
  );

  test('a human game gets the same comparison: the player never sees a different game', async () => {
    const results: { actions: unknown; hash: string; lines: number }[] = [];
    for (const route of ['haiku', 'hang'] as const) {
      fakeServer(route);
      const store = gameStore(2, true, 4);
      mountTalk(store);
      await play(store);
      results.push({
        actions: store.getSession()!.log.actions,
        hash: stateHash(store.getSession()!.state),
        lines: spoken(store).length,
      });
      cleanup();
    }
    expect(results[0]!.hash).toBe(results[1]!.hash);
    expect(results[0]!.actions).toEqual(results[1]!.actions);
    expect(results[0]!.lines).toBeGreaterThan(0);
    expect(results[1]!.lines).toBe(0);
  }, 60_000);

  test('the same seed and settings choose the same speakers; none is the seat whose turn it is', async () => {
    const run = async () => {
      fakeServer('haiku');
      const store = gameStore(4, false, 1);
      const mounted = mountTalk(store);
      await play(store);
      mounted.unmount();
      return { store, lines: spoken(store) };
    };
    const first = await run();
    const second = await run();
    expect(first.lines.length).toBeGreaterThan(0);
    expect(shape(second.lines)).toEqual(shape(first.lines));
    const feed = first.store.getSpectatorView()!.feed;
    for (const line of first.lines) {
      const acting = feed.filter((entry) => entry.before.globalTurnNo === line.globalTurnNo);
      expect(acting.length).toBeGreaterThan(0);
      for (const entry of acting)
        expect(entry.before.activeSeatIndex).not.toBe(line.speakerSeatIndex);
      expect(line.speakerSeatIndex).not.toBe(line.addressedSeatIndex);
    }
    // A different seed is a different game with its own speakers.
    fakeServer('haiku');
    const other = gameStore(4, false, 3);
    mountTalk(other);
    await play(other);
    expect(shape(spoken(other))).not.toEqual(shape(first.lines));
  }, 60_000);

  test.each(WATCHED)(
    'at most one line a round and the game maximum, across %i-seat game seed %i',
    async (seats, seed) => {
      fakeServer('haiku');
      const store = gameStore(seats, false, seed);
      mountTalk(store);
      await play(store);
      const lines = spoken(store);
      expect(lines.length).toBeLessThanOrEqual(TABLE_TALK.maxPerGame);
      const rounds = lines.map((line) => roundOf(line.globalTurnNo, seats));
      expect(new Set(rounds).size).toBe(rounds.length);
    },
    60_000,
  );

  test('a reload keeps the lines, and the limits and speakers carry on as if it never happened', async () => {
    fakeServer('haiku');
    const whole = gameStore(4, false, 1);
    mountTalk(whole);
    const total = await play(whole);
    cleanup();
    const expected = shape(spoken(whole));
    expect(expected.length).toBeGreaterThan(0);

    for (const cut of [5, Math.floor(total / 3), Math.floor(total / 2), total - 8]) {
      fakeServer('haiku');
      const first = gameStore(4, false, 1);
      const mountedFirst = mountTalk(first);
      await play(first, (steps) => steps === cut);
      const text = saveText(first.getSession()!);
      mountedFirst.unmount();

      const loaded = loadSave(text);
      if (!loaded.ok) throw new Error(loaded.message);
      const second = createGameStore();
      second.restore(loaded.game, first.getOpponents());
      // The same table talk comes back with the game: nothing is asked for again.
      expect(shape(spoken(second)), `cut ${cut}`).toEqual(shape(spoken(first)));
      const calls = fakeServer('haiku');
      mountTalk(second);
      await settle();
      expect(calls, `cut ${cut}`).toHaveLength(0);
      await play(second);
      expect(shape(spoken(second)), `cut ${cut}`).toEqual(expected);
      expect(verifyReplay(second.getSession()!)).toMatchObject({ pass: true });
      cleanup();
    }
  }, 120_000);

  test.each([
    ['Fast', { speed: 'fast' as const }],
    ['Instant', { speed: 'instant' as const }],
    ['paused', { paused: true }],
  ])(
    'at %s speed or while paused the route is never called and the game still ends',
    async (_name, playback) => {
      const calls = fakeServer('haiku');
      const store = gameStore(4, false, 1);
      mountTalk(store, playback);
      await play(store);
      expect(calls).toHaveLength(0);
      expect(spoken(store)).toHaveLength(0);
      expect(store.getSession()!.state.phase.kind).toBe('finished');
    },
    60_000,
  );

  test('a route that never answers neither blocks the game nor leaves a line when it is over', async () => {
    const calls = fakeServer('hang');
    const store = gameStore(3, false, 1);
    const mounted = mountTalk(store);
    await play(store);
    expect(store.getSession()!.state.phase.kind).toBe('finished');
    expect(calls.length).toBeGreaterThan(0);
    expect(spoken(store)).toHaveLength(0);
    mounted.unmount();
  }, 60_000);

  test('a line that arrives after the player paused or sped up is dropped', async () => {
    const gate = Promise.withResolvers<void>();
    fakeServer('haiku');
    const real = globalThis.fetch;
    let asked = false;
    vi.stubGlobal('fetch', async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url) === '/api/ai/speak') {
        asked = true;
        await gate.promise;
      }
      return real(url, init);
    });
    const store = gameStore(4, false, 1);
    const mounted = mountTalk(store);
    // Play until the first request is out, then pause before it is answered.
    await play(store, () => asked);
    expect(asked).toBe(true);
    mounted.rerender({ speed: 'normal', paused: true, status: null });
    gate.resolve();
    await settle();
    expect(spoken(store)).toHaveLength(0);
  }, 60_000);

  test('hiding the panel stops new lines from being asked for; showing it again resumes', async () => {
    const calls = fakeServer('haiku');
    const store = gameStore(4, false, 1);
    const mounted = mountTalk(store);
    act(() => mounted.result.current.setHidden(true));
    await play(store);
    expect(calls).toHaveLength(0);
    expect(spoken(store)).toHaveLength(0);

    const again = gameStore(4, false, 1);
    const shown = mountTalk(again);
    act(() => shown.result.current.setHidden(true));
    await play(again, (steps) => steps === 20);
    act(() => shown.result.current.setHidden(false));
    await play(again);
    expect(spoken(again).length).toBeGreaterThan(0);
  }, 60_000);

  test('a sentinel secret in every hand reaches neither the request, the panel nor the save', async () => {
    const SECRET = 'SENTINEL-HAND-SECRET';
    const calls = fakeServer('haiku');
    const store = gameStore(4, false, 'sentinel-seed-do-not-send');
    for (const player of store.getSession()!.state.players) {
      player.items.push({
        instanceId: `${SECRET}-uid`,
        itemId: 'repel',
        name: `${SECRET}-item`,
        visibility: 'secret',
      });
      player.balls.poke = 7_777_777;
    }
    const mounted = mountTalk(store);
    await play(store);
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call.body).not.toContain(SECRET);
      expect(call.body).not.toContain('7777777');
      expect(call.body).not.toContain('sentinel-seed');
    }
    render(
      <TableTalkPanel
        lines={mounted.result.current.lines}
        players={store.getSpectatorView()!.observation.public.players}
        hidden={false}
        onToggle={() => {}}
        voiceOff={null}
      />,
    );
    expect(spoken(store).length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toContain(SECRET);
    const saved = saveText(store.getSession()!);
    expect(saved.match(/"ai_speech"/g)!.length).toBe(spoken(store).length);
    // The hands are in the engine state, as always; the table talk beside them holds none of it.
    expect(JSON.stringify(store.getSession()!.log.dialogueEvents)).not.toContain(SECRET);
  }, 60_000);

  test('with generated speech off, only a line about the table can be shown, and it is a bank line', async () => {
    fakeServer('bank', { enabled: false, reason: 'disabled' });
    const status: AiStatus = {
      jevEnabled: true,
      backupOnly: false,
      reason: null,
      speech: { enabled: false, reason: 'disabled' },
    };
    const store = gameStore(4, false, 1);
    const mounted = mountTalk(store, { status });
    await play(store);
    expect(mounted.result.current.voiceOff).toBe('disabled');
    const lines = spoken(store);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line.source).toBe('bank');
      expect(line.lineId).toBe('taunt-leader-cautious-neutral-1');
      expect(line.text).not.toMatch(/[{}]/);
    }
  }, 60_000);
});

describe('the Table talk panel (§3, §4.8)', () => {
  const players = gameStore(3, true, 1).getView()!.observation.public.players;
  const lines: AiSpeechEvent[] = [
    {
      kind: 'ai_speech',
      speakerSeatIndex: 1,
      addressedSeatIndex: 0,
      source: 'haiku',
      text: 'Well played at the gym.',
      globalTurnNo: 4,
    },
    {
      kind: 'ai_speech',
      speakerSeatIndex: 2,
      addressedSeatIndex: 1,
      source: 'bank',
      lineId: 'taunt-leader-cautious-neutral-1',
      text: 'Researcher is in front. I will watch that closely.',
      globalTurnNo: 9,
    },
  ];
  const panel = (over: Partial<Parameters<typeof TableTalkPanel>[0]> = {}) => (
    <TableTalkPanel
      lines={lines}
      players={players}
      viewerSeat={0}
      hidden={false}
      onToggle={() => {}}
      voiceOff={null}
      {...over}
    />
  );

  test('a Haiku line is labelled AI-written, a bank line is not, and each names its speaker', () => {
    render(panel());
    const [newest, oldest] = screen.getAllByRole('listitem');
    // Newest first: the Rival's bank line to the Researcher, then the Researcher's Haiku line to the player.
    expect(newest!.querySelector('strong')!.textContent).toBe('Rival');
    expect(newest!.textContent).toContain(t('talk.to', { name: 'Researcher' }));
    expect(newest!.textContent).toContain(t('talk.bank'));
    expect(newest!.textContent).not.toContain(t('talk.aiWritten'));
    expect(oldest!.querySelector('strong')!.textContent).toBe('Researcher');
    expect(oldest!.textContent).toContain(t('talk.toYou'));
    expect(oldest!.textContent).toContain(t('talk.aiWritten'));
    expect(t('talk.aiWritten')).toBe('AI-written · only words');
    expect(screen.getByText(t('talk.onlyWords'))).toBeTruthy();
  });

  test('Hide and Show are one control, and a hidden panel still says what it is', async () => {
    function Harness() {
      const [hidden, setHidden] = useState(false);
      return panel({ hidden, onToggle: () => setHidden(!hidden) });
    }
    render(<Harness />);
    const hide = screen.getByRole('button', { name: t('talk.hide') });
    expect(hide.getAttribute('aria-expanded')).toBe('true');
    await userEvent.click(hide);
    const show = screen.getByRole('button', { name: t('talk.show') });
    expect(show.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('Well played at the gym.')).toBeNull();
    expect(screen.getByText(t('talk.hidden'))).toBeTruthy();
    await userEvent.click(show);
    expect(screen.getByText('Well played at the gym.')).toBeTruthy();
  });

  test('an empty panel explains itself instead of being blank', () => {
    render(panel({ lines: [] }));
    expect(screen.getByText(t('talk.empty'))).toBeTruthy();
    expect(screen.queryByText(t('talk.voiceOff'))).toBeNull();
  });

  test.each([
    ['disabled', 'talk.reason.disabled'],
    ['missing_key', 'talk.reason.missing_key'],
    ['budget_exceeded', 'talk.reason.budget_exceeded'],
  ] as const)('Voice off says why: %s', (reason, key) => {
    render(panel({ voiceOff: reason }));
    expect(screen.getByText(t('talk.voiceOff'))).toBeTruthy();
    expect(screen.getByText(t(key))).toBeTruthy();
    for (const other of [
      'talk.reason.disabled',
      'talk.reason.missing_key',
      'talk.reason.budget_exceeded',
    ] as const)
      if (other !== key) expect(screen.queryByText(t(other))).toBeNull();
  });

  test('the badge follows the status route, and says nothing when the status is unknown or on', () => {
    const status = (speech: AiStatus['speech']): AiStatus => ({
      jevEnabled: true,
      backupOnly: false,
      reason: null,
      speech,
    });
    expect(voiceOff(status({ enabled: false, reason: 'missing_key' }))).toBe('missing_key');
    expect(voiceOff(status({ enabled: false, reason: 'budget_exceeded' }))).toBe('budget_exceeded');
    expect(voiceOff(status({ enabled: true, reason: null }))).toBeNull();
    expect(voiceOff(status({ enabled: false, reason: null }))).toBeNull();
    expect(voiceOff(null)).toBeNull();
    expect(voiceOff({ jevEnabled: true } as unknown as AiStatus)).toBeNull();
  });
});

describe('saving a line (§5.7)', () => {
  const line: AiSpeechEvent = {
    kind: 'ai_speech',
    speakerSeatIndex: 1,
    addressedSeatIndex: 0,
    source: 'haiku',
    text: 'Nicely done.',
    globalTurnNo: 3,
  };

  test('a recorded line survives save, load and an export, and the log still replays', () => {
    const store = gameStore(2, true, 7);
    expect(store.recordSpeech(line)).toBe(true);
    const loaded = loadSave(saveText(store.getSession()!));
    if (!loaded.ok) throw new Error(loaded.message);
    expect(loaded.game.log.dialogueEvents).toEqual([line]);
    expect(verifyReplay(loaded.game)).toMatchObject({ pass: true });
  });

  test('a line changes no state, revision or view, and tells the saver', () => {
    const store = gameStore(2, true, 7);
    const before = { state: store.getSession()!.state, view: store.getView() };
    let notified = 0;
    store.subscribe(() => notified++);
    expect(store.recordSpeech(line)).toBe(true);
    expect(notified).toBe(1);
    expect(store.getSession()!.state).toBe(before.state);
    expect(store.getView()).toBe(before.view);
  });

  test.each([
    ['an unknown speaker', { ...line, speakerSeatIndex: 5 }],
    ['an unknown listener', { ...line, addressedSeatIndex: 5 }],
    ['a seat talking to itself', { ...line, speakerSeatIndex: 0, addressedSeatIndex: 0 }],
    ['an empty line', { ...line, text: '' }],
    ['a line of 281 characters', { ...line, text: 'x'.repeat(281) }],
  ])('%s is not saved', (_name, bad) => {
    const store = gameStore(2, true, 7);
    expect(store.recordSpeech(bad as AiSpeechEvent)).toBe(false);
    expect(store.getSession()!.log.dialogueEvents).toBeUndefined();
  });

  test('a line arriving while an AI decision is out does not discard that decision', async () => {
    const gate = Promise.withResolvers<void>();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
        const path = String(url);
        if (path === '/api/ai/outcome') return new Response(null, { status: 204 });
        const choice = JSON.parse(String(init?.body)).enabledActions[0].id;
        if (path === '/api/ai/fallback') return json({ choice, source: 'fallback' });
        await gate.promise;
        return json({ choice, source: 'jev' });
      }),
    );
    const store = gameStore(2, false, 7);
    while (store.advance({ human: true }));
    const before = store.getSession()!.log.actions.length;
    const pending = store.playOpponent(new AbortController().signal);
    expect(store.recordSpeech({ ...line, speakerSeatIndex: 1, addressedSeatIndex: 0 })).toBe(true);
    gate.resolve();
    expect(await pending).toBe(true);
    expect(store.getSession()!.log.actions.length).toBe(before + 1);
    expect(store.getSession()!.log.dialogueEvents).toHaveLength(1);
  });

  test('leaders are read from coins alone', () => {
    const { players } = gameStore(3, false, 1).getSpectatorView()!.observation.public;
    const withCoins = (coins: number[]) =>
      players.map((player, index) => ({ ...player, coins: coins[index]! }));
    expect(leaderOf(withCoins([3, 9, 5]))).toBe(1);
    expect(leaderOf(withCoins([9, 9, 5]))).toBeNull();
  });
});
