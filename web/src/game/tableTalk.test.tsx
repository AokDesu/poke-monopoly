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
import { replyRequestSchema, speakRequestSchema } from '../../../engine/contract/speech.ts';
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
  exchangeCount,
  exchangeEvents,
  leaderOf,
  planTableTalk,
  replyBody,
  requestExchange,
  requestSpeech,
  roundOf,
  speakBody,
  speechEvent,
  TABLE_TALK,
  talkEntries,
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
    // Settings only for the AI seats, as the setup screen makes them.
    Array.from({ length: seats }, (_, seatIndex) => seatIndex)
      .filter((seatIndex) => !human || seatIndex > 0)
      .map((seatIndex) => ({
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

type Route = 'haiku' | 'bank' | 'error' | 'hang' | 'garbage' | 'refuse';

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
        const parsed = JSON.parse(body) as { kind?: string; turnKey?: string };
        // The server's manipulation check refused the opening line, so there is nothing to answer.
        if (route === 'refuse' && parsed.kind === 'reply')
          return json({ source: 'none', fallbackReason: 'manipulation', ...telemetry });
        if (parsed.kind === 'reply')
          return json({ source: 'haiku', text: 'Thank you, that is kind of you.', ...telemetry });
        return route === 'haiku' || route === 'refuse'
          ? json({
              source: 'haiku',
              // Each opening is told apart, so a test can tell which one was shown.
              text:
                route === 'refuse'
                  ? `A calm word from across the table, ${String(parsed.turnKey)}.`
                  : 'A calm word from across the table.',
              ...telemetry,
            })
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
    if (view && view.legalActions.enabled.length > 0)
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
    exchangeAllowed: false,
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
    listener: null,
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
    listener: null,
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
      const store = gameStore(2, true, 1);
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
    // An answer comes from the seat addressed, which may be the one that just acted (it is being
    // spoken to, not speaking about itself); a comment or an opening line never does.
    const openings = talkEntries(first.lines).map((entry) =>
      entry.kind === 'line' ? entry.line : entry.opening,
    );
    for (const line of openings) {
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
    'at most one comment or exchange a round, and the game maximums, across %i-seat game seed %i',
    async (seats, seed) => {
      fakeServer('haiku');
      const store = gameStore(seats, false, seed);
      mountTalk(store);
      await play(store);
      const entries = talkEntries(spoken(store));
      const exchanges = entries.filter((entry) => entry.kind === 'exchange').length;
      expect(exchanges).toBeLessThanOrEqual(TABLE_TALK.maxExchangesPerGame);
      expect(entries.length - exchanges).toBeLessThanOrEqual(TABLE_TALK.maxPerGame);
      const rounds = entries.map((entry) =>
        roundOf((entry.kind === 'line' ? entry.line : entry.opening).globalTurnNo, seats),
      );
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

describe('planning an exchange between two AIs (§5.7)', () => {
  const view = gameStore(4, false, 1).getSpectatorView()!;
  const moment: Moment = {
    situation: 'catch_success',
    actingSeat: 0,
    subjectSeat: 1,
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
    exchangeAllowed: true,
    ...over,
  });
  const say = (turn: number, from: number, to: number): AiSpeechEvent => ({
    kind: 'ai_speech',
    speakerSeatIndex: from,
    addressedSeatIndex: to,
    source: 'haiku',
    text: `Line from ${from}.`,
    globalTurnNo: turn,
  });
  // Four seats: a round is four turns, so turn 1 + 4r is in round r, and the moment (turn 9) is in round 2.
  const exchangeIn = (round: number) => [say(1 + 4 * round, 2, 3), say(1 + 4 * round, 3, 2)];
  const commentIn = (round: number) => say(1 + 4 * round, 2, 1);
  const otherRounds = (count: number) =>
    Array.from({ length: 12 }, (_, round) => round)
      .filter((round) => round !== 2)
      .slice(0, count);

  test('a moment about another AI opens an exchange: that AI answers, and neither is the speaker', () => {
    const plan = planTableTalk(context())!;
    expect(plan.listener).toEqual({ seat: 1, personalityId: 'greedy' });
    expect([2, 3]).toContain(plan.speakerSeat);
    expect(plan.speakerSeat).not.toBe(plan.listener!.seat);
  });

  test('the same seed and moment make the same plan, so a reload does not change who talks', () => {
    expect(planTableTalk(context())).toEqual(planTableTalk(context()));
  });

  test('with exchanges off it is the plain comment it always was', () => {
    const plan = planTableTalk(context({ exchangeAllowed: false }))!;
    expect(plan.listener).toBeNull();
    expect(plan.speakerSeat).toBe(planTableTalk(context())!.speakerSeat);
  });

  test('a moment about the player, or about a seat that is not an AI at this table, is a comment', () => {
    const human = gameStore(4, true, 1).getView()!;
    expect(
      planTableTalk(context({ view: human, moment: { ...moment, addressedSeat: 0 } }))!.listener,
    ).toBeNull();
    expect(
      planTableTalk(context({ moment: { ...moment, addressedSeat: 9 } }))!.listener,
    ).toBeNull();
  });

  test.each([
    ['Fast', { speed: 'fast' as const }],
    ['Instant', { speed: 'instant' as const }],
    ['paused', { paused: true }],
    ['hidden', { hidden: true }],
  ])('at %s nothing is planned', (_name, over) => {
    expect(planTableTalk(context(over))).toBeNull();
  });

  test('at most one exchange or comment a round: a pair already said in this round blocks another', () => {
    expect(planTableTalk(context({ spoken: exchangeIn(2) }))).toBeNull();
    expect(planTableTalk(context({ spoken: [commentIn(2)] }))).toBeNull();
    expect(planTableTalk(context({ spoken: exchangeIn(1) }))).not.toBeNull();
  });

  test('ten exchanges end exchanges but not comments, and ten comments end comments but not exchanges', () => {
    const tenExchanges = otherRounds(TABLE_TALK.maxExchangesPerGame).flatMap(exchangeIn);
    expect(tenExchanges).toHaveLength(20);
    expect(exchangeCount(tenExchanges)).toBe(10);
    const afterExchanges = planTableTalk(context({ spoken: tenExchanges }))!;
    expect(afterExchanges.listener).toBeNull();

    const nineExchanges = otherRounds(9).flatMap(exchangeIn);
    expect(planTableTalk(context({ spoken: nineExchanges }))!.listener).not.toBeNull();

    const tenComments = otherRounds(TABLE_TALK.maxPerGame).map(commentIn);
    expect(planTableTalk(context({ spoken: tenComments }))!.listener).not.toBeNull();
    expect(planTableTalk(context({ spoken: tenComments, exchangeAllowed: false }))).toBeNull();
  });

  test('the limits are read from the saved lines, so a save and a reload change nothing', () => {
    const spoken = otherRounds(TABLE_TALK.maxExchangesPerGame).flatMap(exchangeIn);
    const reloaded = JSON.parse(JSON.stringify(spoken)) as AiSpeechEvent[];
    expect(planTableTalk(context({ spoken: reloaded }))).toEqual(
      planTableTalk(context({ spoken })),
    );
    expect(exchangeCount(reloaded)).toBe(10);
  });
});

describe('an exchange in the saved lines (§5.7)', () => {
  const say = (
    from: number,
    to: number,
    over: Partial<AiSpeechEvent> = {},
    turn = 5,
  ): AiSpeechEvent => ({
    kind: 'ai_speech',
    speakerSeatIndex: from,
    addressedSeatIndex: to,
    source: 'haiku',
    text: 'Fine words.',
    globalTurnNo: turn,
    ...over,
  });

  test('an opening line and its answer read as one exchange, in order', () => {
    const lines = [say(1, 2, {}, 2), say(2, 1, {}, 2), say(3, 1, {}, 6)];
    expect(talkEntries(lines)).toEqual([
      { kind: 'exchange', opening: lines[0], reply: lines[1] },
      { kind: 'line', line: lines[2] },
    ]);
  });

  test.each([
    ['another turn', [say(1, 2, {}, 2), say(2, 1, {}, 3)]],
    ['a different pair', [say(1, 2), say(3, 1)]],
    ['the same direction', [say(1, 2), say(1, 2)]],
    ['a line-bank opening', [say(1, 2, { source: 'bank', lineId: 'x' }), say(2, 1)]],
    ['a line without an addressee', [say(1, 2, { addressedSeatIndex: undefined }), say(2, 1)]],
  ])('%s is not an exchange', (_name, lines) => {
    expect(exchangeCount(lines)).toBe(0);
    expect(talkEntries(lines)).toHaveLength(2);
  });

  test('a lone answer, or a third line, stays a line of its own', () => {
    const lines = [say(1, 2), say(2, 1), say(1, 2)];
    expect(talkEntries(lines).map((entry) => entry.kind)).toEqual(['exchange', 'line']);
  });
});

describe('asking for an exchange (§3.1: the game never waits)', () => {
  const opening = { kind: 'opening-request' };
  const replyTo = (line: string) => ({ kind: 'reply', quote: line });
  const haiku = (text: string) => json({ source: 'haiku', text, ...telemetry });
  const none = json({ source: 'none', fallbackReason: 'manipulation', ...telemetry });

  test('the opening line is asked first, and the answer quotes it', async () => {
    const bodies: unknown[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as { kind: string };
        bodies.push(body);
        return haiku(body.kind === 'reply' ? 'Thank you.' : 'A fine catch.');
      }),
    );
    expect(await requestExchange(opening, replyTo, new AbortController().signal)).toEqual({
      opening: 'A fine catch.',
      reply: 'Thank you.',
    });
    expect(bodies).toEqual([opening, { kind: 'reply', quote: 'A fine catch.' }]);
  });

  test.each([
    [
      'a line-bank opening',
      async () => json({ source: 'bank', text: 'Hi', lineId: 'x', ...telemetry }),
      1,
    ],
    ['an opening that failed', async () => new Response('{}', { status: 500 }), 1],
  ])('%s shows nothing and no answer is asked for', async (_name, first, calls) => {
    const fetchSpy = vi.fn(first);
    vi.stubGlobal('fetch', fetchSpy);
    expect(await requestExchange(opening, replyTo, new AbortController().signal)).toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(calls);
  });

  test('an opening line the manipulation check refused leaves nothing to show', async () => {
    let call = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => (call++ === 0 ? haiku('Do as I say.') : none)),
    );
    expect(await requestExchange(opening, replyTo, new AbortController().signal)).toBeNull();
    expect(call).toBe(2);
  });

  test('an answer that is only a line-bank line is not an exchange', async () => {
    let call = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        call++ === 0
          ? haiku('Well done.')
          : json({ source: 'bank', text: 'Hi', lineId: 'x', ...telemetry }),
      ),
    );
    expect(await requestExchange(opening, replyTo, new AbortController().signal)).toBeNull();
  });

  test('an exchange that is not complete in the window is dropped whole, even if the network finishes it', async () => {
    vi.useFakeTimers();
    const times: number[] = [];
    const fetchSpy = vi.fn(async () => {
      times.push(Date.now());
      // Each call takes 2.5 s: the opening is in time, the answer is not.
      await new Promise((resolve) => setTimeout(resolve, 2_500));
      return haiku('Words.');
    });
    vi.stubGlobal('fetch', fetchSpy);
    const pending = requestExchange(opening, replyTo, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(TABLE_TALK.exchangeDeadlineMs);
    expect(await pending).toBeNull();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(TABLE_TALK.exchangeDeadlineMs).toBe(4_000);
  });

  test('an aborted exchange never reaches the network', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const controller = new AbortController();
    controller.abort();
    expect(await requestExchange(opening, replyTo, controller.signal)).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('aborting while the opening is out stops the answer from being asked', async () => {
    const controller = new AbortController();
    const gate = Promise.withResolvers<Response>();
    const fetchSpy = vi.fn(() => gate.promise);
    vi.stubGlobal('fetch', fetchSpy);
    const pending = requestExchange(opening, replyTo, controller.signal);
    controller.abort();
    expect(await pending).toBeNull();
    gate.resolve(haiku('Late words.'));
    await settle();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe('the answer request and the saved pair (§4.1, §5.4)', () => {
  const SECRET = 'SENTINEL-SECRET-IN-THE-LISTENER-HAND';
  const store = gameStore(4, false, 'sentinel-seed-do-not-send');
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
  const plan = {
    listener: { seat: 1, personalityId: 'greedy' },
    moment: {
      situation: 'catch_success' as const,
      actingSeat: 0,
      subjectSeat: 1,
      addressedSeat: 1,
      turn: 9,
    },
    speakerSeat: 2,
    personalityId: 'greedy',
  };
  const game = store.getSpectatorView()!.observation.public;

  test('it is the listener asked, from the speaker, with the line quoted and nothing private', () => {
    const body = replyBody({ gameId: 'g', plan, game, momentKey: 4, quote: 'A fine catch.' });
    const text = JSON.stringify(body);
    for (const secret of [SECRET, '7777777', 'sentinel-seed', store.getSession()!.state.rng.state])
      expect(text).not.toContain(secret);
    const parsed = replyRequestSchema.parse(JSON.parse(text));
    expect(parsed).toMatchObject({
      seatIndex: 1,
      speakerSeat: 2,
      quote: 'A fine catch.',
      situation: 'catch_success',
      personalityId: 'greedy',
      turnKey: 'talk:4:reply',
    });
    expect(parsed.observation.own).toEqual({
      seatIndex: 1,
      items: [],
      balls: { poke: 0, great: 0, ultra: 0 },
      privateResults: [],
    });
    expect(new TextEncoder().encode(text).length).toBeLessThan(16 * 1024);
  });

  test('the pair is saved opening first, each line labelled AI-written and addressed to the other', () => {
    const events = exchangeEvents(plan, { opening: ' A fine catch. ', reply: 'Thank you.' })!;
    expect(events).toEqual([
      {
        kind: 'ai_speech',
        speakerSeatIndex: 2,
        addressedSeatIndex: 1,
        source: 'haiku',
        text: 'A fine catch.',
        globalTurnNo: 9,
      },
      {
        kind: 'ai_speech',
        speakerSeatIndex: 1,
        addressedSeatIndex: 2,
        source: 'haiku',
        text: 'Thank you.',
        globalTurnNo: 9,
      },
    ]);
    expect(talkEntries(events)).toEqual([
      { kind: 'exchange', opening: events[0], reply: events[1] },
    ]);
  });

  test.each([
    ['an empty opening', { opening: '  ', reply: 'Thank you.' }],
    ['an empty answer', { opening: 'A fine catch.', reply: '' }],
    ['an answer past the saved limit', { opening: 'A fine catch.', reply: 'x'.repeat(281) }],
  ])('%s is not saved, and neither line is', (_name, answer) => {
    expect(exchangeEvents(plan, answer)).toBeNull();
  });
});

describe('exchanges in a played game (§5.7, §4.2)', () => {
  const replies = (calls: { parsed: Record<string, unknown> }[]) =>
    calls.filter((call) => call.parsed.kind === 'reply');

  test.each(WATCHED)(
    'a watched %i-seat game, seed %i: exchanges are two labelled lines between two AIs',
    async (seats, seed) => {
      const calls = fakeServer('haiku');
      const store = gameStore(seats, false, seed);
      const mounted = mountTalk(store);
      await play(store);
      const exchanges = talkEntries(spoken(store)).filter((entry) => entry.kind === 'exchange');
      expect(exchanges.length).toBeGreaterThan(0);
      expect(replies(calls)).toHaveLength(exchanges.length);
      for (const { opening, reply } of exchanges) {
        expect(opening.source).toBe('haiku');
        expect(reply.source).toBe('haiku');
        expect(reply.speakerSeatIndex).toBe(opening.addressedSeatIndex);
        expect(reply.addressedSeatIndex).toBe(opening.speakerSeatIndex);
      }
      // The route is asked for every request kind it knows and the bodies are ones it accepts.
      for (const call of calls)
        expect(
          (call.parsed.kind === 'reply' ? replyRequestSchema : speakRequestSchema).safeParse(
            call.parsed,
          ).success,
        ).toBe(true);
      mounted.unmount();
    },
    60_000,
  );

  test('the game is identical with exchanges on and off: state, action log, hash and replay', async () => {
    const finals: { actions: unknown; hash: string; lines: number; exchanges: number }[] = [];
    for (const route of ['haiku', 'refuse', 'hang', 'error'] as const) {
      fakeServer(route);
      const store = gameStore(4, false, 1);
      const mounted = mountTalk(store);
      await play(store);
      const session = store.getSession()!;
      expect(verifyReplay(session)).toMatchObject({ pass: true });
      finals.push({
        actions: session.log.actions,
        hash: stateHash(session.state),
        lines: spoken(store).length,
        exchanges: exchangeCount(spoken(store)),
      });
      mounted.unmount();
    }
    expect(finals.map((final) => final.hash)).toEqual(Array(4).fill(finals[0]!.hash));
    for (const final of finals) expect(final.actions).toEqual(finals[0]!.actions);
    expect(finals[0]!.exchanges).toBeGreaterThan(0);
    // A refused opening line is shown to nobody, whether the check or the network said no.
    expect(finals.slice(1).map((final) => final.exchanges)).toEqual([0, 0, 0]);
  }, 120_000);

  test('a line the manipulation check refused is neither shown nor saved, and the round is not tried twice', async () => {
    const calls = fakeServer('refuse');
    const store = gameStore(4, false, 1);
    const mounted = mountTalk(store);
    await play(store);
    expect(replies(calls).length).toBeGreaterThan(0);
    // Every opening that was asked for was held back: no exchange, and none of those lines, was saved.
    expect(exchangeCount(spoken(store))).toBe(0);
    const heldBack = replies(calls).map((call) =>
      String(call.parsed.turnKey).replace(':reply', ''),
    );
    for (const line of spoken(store))
      for (const key of heldBack) expect(line.text).not.toContain(`, ${key}.`);
    // One try per round: a refusal is not asked again for another moment in the same round.
    const feed = store.getSpectatorView()!.feed;
    const rounds = replies(calls).map((call) => {
      const momentKey = Number(String(call.parsed.turnKey).split(':')[1]);
      return roundOf(feed[momentKey - 1]!.before.globalTurnNo, 4);
    });
    expect(new Set(rounds).size).toBe(rounds.length);
    mounted.unmount();
  }, 60_000);

  test('with Haiku off, or with Jev on its backup, nobody is asked for an exchange', async () => {
    for (const status of [
      {
        jevEnabled: true,
        backupOnly: false,
        reason: null,
        speech: { enabled: false, reason: 'disabled' },
      },
      {
        jevEnabled: false,
        backupOnly: true,
        reason: 'disabled',
        speech: { enabled: true, reason: null },
      },
    ] as AiStatus[]) {
      const calls = fakeServer('bank', status.speech);
      const store = gameStore(4, false, 1);
      const mounted = mountTalk(store, { status });
      await play(store);
      expect(replies(calls)).toHaveLength(0);
      expect(exchangeCount(spoken(store))).toBe(0);
      mounted.unmount();
      cleanup();
    }
  }, 120_000);

  test.each([
    ['Fast', { speed: 'fast' as const }],
    ['Instant', { speed: 'instant' as const }],
  ])(
    'at %s speed no exchange is asked for',
    async (_name, playback) => {
      const calls = fakeServer('haiku');
      const store = gameStore(4, false, 1);
      mountTalk(store, playback);
      await play(store);
      expect(calls).toHaveLength(0);
    },
    60_000,
  );

  test('after a reload the same exchanges are there, none is asked for again, and the limits go on', async () => {
    fakeServer('haiku');
    const whole = gameStore(4, false, 1);
    mountTalk(whole);
    const total = await play(whole);
    cleanup();
    const expected = shape(spoken(whole));
    expect(exchangeCount(spoken(whole))).toBeGreaterThan(0);

    const cut = Math.floor(total / 2);
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
    expect(exchangeCount(spoken(second))).toBe(exchangeCount(spoken(first)));
    const calls = fakeServer('haiku');
    mountTalk(second);
    await settle();
    expect(calls).toHaveLength(0);
    await play(second);
    expect(shape(spoken(second))).toEqual(expected);
    expect(exchangeCount(spoken(second))).toBeLessThanOrEqual(TABLE_TALK.maxExchangesPerGame);
  }, 120_000);

  test('a sentinel secret in every hand reaches no opening request, no answer request and no save', async () => {
    const SECRET = 'SENTINEL-EXCHANGE-SECRET';
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
    mountTalk(store);
    await play(store);
    expect(replies(calls).length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call.body).not.toContain(SECRET);
      expect(call.body).not.toContain('7777777');
      expect(call.body).not.toContain('sentinel-seed');
    }
    expect(JSON.stringify(store.getSession()!.log.dialogueEvents)).not.toContain(SECRET);
  }, 60_000);
});

describe('the Table talk panel shows an exchange (§3, §4.8)', () => {
  const players = gameStore(4, false, 1).getSpectatorView()!.observation.public.players;
  const pair: AiSpeechEvent[] = [
    {
      kind: 'ai_speech',
      speakerSeatIndex: 2,
      addressedSeatIndex: 1,
      source: 'haiku',
      text: 'That was a lucky catch.',
      globalTurnNo: 9,
    },
    {
      kind: 'ai_speech',
      speakerSeatIndex: 1,
      addressedSeatIndex: 2,
      source: 'haiku',
      text: 'Thank you, the grass was kind.',
      globalTurnNo: 9,
    },
  ];
  const earlier: AiSpeechEvent = {
    kind: 'ai_speech',
    speakerSeatIndex: 3,
    addressedSeatIndex: 0,
    source: 'haiku',
    text: 'Well played at the gym.',
    globalTurnNo: 3,
  };

  test('the two lines are one group, opening above the answer, each labelled AI-written', () => {
    render(
      <TableTalkPanel
        lines={[earlier, ...pair]}
        players={players}
        hidden={false}
        onToggle={() => {}}
        voiceOff={null}
      />,
    );
    const group = screen.getByRole('list', { name: /An exchange: .+ speaks to .+, who answers/ });
    const rows = group.querySelectorAll('li');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toContain('That was a lucky catch.');
    expect(rows[1]!.textContent).toContain('Thank you, the grass was kind.');
    for (const row of rows) expect(row.textContent).toContain(t('talk.aiWritten'));
    // The newest entry is first in the panel, an older single line after the group.
    const top = screen.getByRole('list', { name: t('talk.heading') });
    expect(top.children).toHaveLength(2);
    expect(top.children[0]!.hasAttribute('data-exchange')).toBe(true);
    expect(top.children[1]!.textContent).toContain('Well played at the gym.');
  });
});
