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
import { en, t } from '../i18n/en.ts';
import { engineContent } from './content.ts';
import { loadSave, readMeta, saveText, writeSave, type SaveStorage } from './save.ts';
import type { Pace } from './setup.ts';
import { createGameStore, type GameStore, type SeatFeedEntry } from './store.ts';
import {
  bankAnswer,
  banterDue,
  detectMoment,
  exchangeEvents,
  greeting,
  leaderOf,
  planTableTalk,
  replyBody,
  requestExchange,
  retortEvent,
  requestSpeech,
  retortAnswer,
  roundOf,
  speakBody,
  speechEvent,
  TABLE_TALK,
  talkEntries,
  voiceFor,
  voiceOff,
  type Moment,
  type PublicGame,
  type TalkContext,
  type TalkPlan,
  type TalkSituation,
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
const PERSONALITIES = ['greedy', 'aggressive', 'cautious', 'opportunist'] as const;

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
        personality: PERSONALITIES[seatIndex % PERSONALITIES.length]!,
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
        const parsed = JSON.parse(body) as {
          kind?: string;
          turnKey?: string;
          situation: string;
          personalityId: string;
        };
        // The server's manipulation check refused the opening line, so there is nothing to answer.
        if (route === 'refuse' && parsed.kind === 'reply')
          return json({ source: 'none', fallbackReason: 'manipulation', ...telemetry });
        if (parsed.kind === 'reply')
          return json({ source: 'haiku', text: 'Thank you, that is kind of you.', ...telemetry });
        if (route === 'haiku' || route === 'refuse')
          return json({
            source: 'haiku',
            // Each opening is told apart, so a test can tell which one was shown.
            text:
              route === 'refuse'
                ? `A calm word from across the table, ${String(parsed.turnKey)}.`
                : 'A calm word from across the table.',
            ...telemetry,
          });
        const lineId = `${parsed.situation.replaceAll('_', '-')}-${parsed.personalityId}-neutral-1`;
        return json({
          source: 'bank',
          text: en[`ai.line.${lineId}` as keyof typeof en],
          lineId,
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
  pace: Pace;
  skipping: boolean;
  paused: boolean;
  status: AiStatus | null;
}

const OFF: AiStatus = {
  jevEnabled: true,
  backupOnly: false,
  reason: null,
  speech: { enabled: false, reason: 'disabled' },
};

/** The table talk hook as the board mounts it, on whichever view the store has. */
function mountTalk(store: GameStore, playback: Partial<Playback> = {}) {
  return renderHook(
    (props: Playback) => {
      const view = useSyncExternalStore(store.subscribe, () => viewOf(store));
      return useTableTalk(store, view, props);
    },
    {
      initialProps: {
        pace: 'readable',
        skipping: false,
        paused: false,
        status: null,
        ...playback,
      },
    },
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
  lines.map(({ speakerSeatIndex, addressedSeatIndex, globalTurnNo, source, text }) => ({
    speakerSeatIndex,
    addressedSeatIndex,
    globalTurnNo,
    source,
    text,
  }));
const roundOfLine = (line: AiSpeechEvent, seats: number) => roundOf(line.globalTurnNo, seats);

// Tables the played-game tests run: 1, 2 and 3 rivals around the player, and a watched table.
const HUMAN_TABLES = [
  [2, 1],
  [3, 1],
  [4, 1],
] as const;

/** A base moment with the fields a test does not care about filled in. */
const moment = (over: Partial<Moment> = {}): Moment => ({
  kind: 'roll_high',
  actingSeat: 0,
  subjectSeat: 0,
  counterSeat: null,
  addressedSeat: null,
  turn: 9,
  ...over,
});

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
  const entry = (
    kind: string,
    events: EngineEvent[] = [],
    active = 0,
    turn = 9,
    phase: unknown = { kind: 'move' },
  ): SeatFeedEntry =>
    ({
      before: { phase, activeSeatIndex: active, globalTurnNo: turn },
      record: { action: { kind }, events },
    }) as unknown as SeatFeedEntry;
  const random = (purpose: string, result: number): EngineEvent => ({
    kind: 'random_result',
    purpose,
    result,
    drawCounter: 1,
  });
  const sale = (amount: number, actorId = 'player-3'): EngineEvent => ({
    kind: 'coin_transfer',
    source: { kind: 'bank' },
    destination: { kind: 'player', actorId },
    amount,
    reason: 'pokemon_sale',
  });
  const destroyed = (instanceId: string): EngineEvent => ({
    kind: 'uid_destroyed',
    instanceId,
    entity: 'pokemon',
    reason: 'sold',
  });
  const reward = (source: unknown, winnerId: string): EngineEvent =>
    ({
      kind: 'battle_reward_resolved',
      rewardId: 'r-1',
      winnerId,
      source,
      choice: { kind: 'coins' },
      coinAmount: 3,
    }) as EngineEvent;

  test('a Gym win is about its winner', () => {
    expect(
      detectMoment(
        entry('choose_reward', [reward({ kind: 'gym' }, 'player-2')], 2),
        publicGame(),
        null,
      ),
    ).toMatchObject({ kind: 'gym_win', subjectSeat: 2, turn: 9 });
  });

  test('a battle between players is won by the attacker or the defender, and a draw is no moment', () => {
    const resolved = (outcome: 'win' | 'loss' | 'tie'): EngineEvent =>
      ({
        kind: 'pvp_resolved',
        battleId: 'pvp:1',
        attackerFace: 3,
        defenderFace: 3,
        outcome,
        attackerTotal: 5,
        defenderTotal: 5,
        rewardSeatIndex: null,
      }) as EngineEvent;
    const phase = { kind: 'pvp', battle: { attackerSeatIndex: 1, defenderSeatIndex: 2 } };
    const at = (outcome: 'win' | 'loss' | 'tie') =>
      detectMoment(entry('dice_result', [resolved(outcome)], 1, 9, phase), publicGame(), null);
    expect(at('win')).toMatchObject({ kind: 'battle_win', subjectSeat: 1, counterSeat: 2 });
    expect(at('loss')).toMatchObject({ kind: 'battle_win', subjectSeat: 2, counterSeat: 1 });
    expect(at('tie')).toBeNull();
  });

  test('a lost Gym battle is about the challenger', () => {
    const lost = {
      kind: 'gym_resolved',
      battleId: 'gym:1',
      face: 2,
      total: 3,
      dc: 9,
      outcome: 'loss',
      rewardSeatIndex: null,
    } as EngineEvent;
    expect(
      detectMoment(entry('dice_result', [lost], 3, 9, { kind: 'gym' }), publicGame(), null),
    ).toMatchObject({ kind: 'battle_loss', subjectSeat: 3 });
  });

  test('coins moving from one player to another are a moment about the one paid; the bank is not a player', () => {
    const transfer = (from: string, to: string, amount = 3): EngineEvent => ({
      kind: 'coin_transfer',
      source: { kind: 'player', actorId: from },
      destination: { kind: 'player', actorId: to },
      amount,
      reason: 'pvp_reward',
    });
    expect(
      detectMoment(
        entry('choose_reward', [transfer('player-1', 'player-2')], 2),
        publicGame(),
        null,
      ),
    ).toMatchObject({ kind: 'coins', subjectSeat: 2, counterSeat: 1 });
    expect(
      detectMoment(
        entry('choose_reward', [transfer('player-1', 'player-2', 0)], 2),
        publicGame(),
        null,
      ),
    ).toBeNull();
    const bankPays: EngineEvent = {
      kind: 'coin_transfer',
      source: { kind: 'bank' },
      destination: { kind: 'player', actorId: 'player-1' },
      amount: 3,
      reason: 'start_income',
    };
    expect(detectMoment(entry('dice_result', [bankPays], 1), publicGame(), null)).toBeNull();
  });

  test('any catch is a moment, found in the engine die result, with the species caught', () => {
    const caught = (speciesId: string) => {
      const game = publicGame();
      game.players[1]!.team = [{ ...game.players[1]!.team[0]!, instanceId: 'new-1', speciesId }];
      const created: EngineEvent = {
        kind: 'uid_created',
        instanceId: 'new-1',
        entity: 'pokemon',
        ownerId: game.players[1]!.actorId,
      };
      return detectMoment(
        entry('dice_result', [random('catch:1:3', 4), created], 1, 9, { kind: 'encounter' }),
        game,
        null,
      );
    };
    expect(caught('weedle')).toMatchObject({ kind: 'catch', subjectSeat: 1, pokemon: 'Weedle' });
    expect(caught('pikachu')).toMatchObject({ kind: 'catch', pokemon: 'Pikachu' });
    // The player's own `catch` command carries no result and is no moment.
    expect(detectMoment(entry('catch', [], 1), publicGame(), null)).toBeNull();
  });

  test('a catch the die refused is a moment about the creature that got away', () => {
    const phase = { kind: 'encounter', pokemon: { speciesId: 'psyduck' } };
    const events = [
      random('catch:2:3', 1),
      { kind: 'phase_changed', from: 'encounter', to: 'end' },
    ];
    expect(
      detectMoment(entry('dice_result', events as EngineEvent[], 2, 9, phase), publicGame(), null),
    ).toMatchObject({ kind: 'miss', subjectSeat: 2, pokemon: 'Psyduck' });
    // A Porygon reroll leaves the encounter open: nothing has been decided.
    expect(
      detectMoment(entry('dice_result', [random('catch:2:3', 1)], 2, 9, phase), publicGame(), null),
    ).toBeNull();
  });

  test('a sale is big from the presentation threshold up, and names the largest creature sold', () => {
    const previous = publicGame();
    previous.players[3]!.team = [
      { ...previous.players[3]!.team[0]!, instanceId: 'cheap', speciesId: 'rattata' },
      { ...previous.players[3]!.team[0]!, instanceId: 'dear', speciesId: 'growlithe' },
    ];
    const at = (events: EngineEvent[]) =>
      detectMoment(entry('sell', events, 3), publicGame(), null, previous);
    expect(at([sale(TABLE_TALK.bigSaleCoins), destroyed('dear')])).toMatchObject({
      kind: 'sale',
      subjectSeat: 3,
      pokemon: 'Growlithe',
      coins: TABLE_TALK.bigSaleCoins,
    });
    expect(at([sale(TABLE_TALK.bigSaleCoins - 1), destroyed('dear')])).toBeNull();
    // Two sales in one batch add up to the threshold; the line names the dearer one.
    expect(at([sale(6), destroyed('cheap'), sale(10), destroyed('dear')])).toMatchObject({
      kind: 'sale',
      pokemon: 'Growlithe',
      coins: 10,
    });
  });

  test('a change of leader is a moment; a first lead, a tie and no change are not', () => {
    const turn = (coins: number[], previous: number | null) =>
      detectMoment(entry('skip', [], 0), publicGame(coins), previous);
    expect(turn([10, 14, 10, 10], 0)).toMatchObject({
      kind: 'lead',
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
    expect(detectMoment(entry('skip', [final]), publicGame([10, 10, 12, 10]), 2)).toMatchObject({
      kind: 'lead',
      addressedSeat: 2,
    });
    expect(detectMoment(entry('skip', [final]), publicGame(), null)).toBeNull();
  });

  test.each([
    [TABLE_TALK.highRoll, 'roll_high'],
    [TABLE_TALK.lowRoll, 'roll_low'],
  ] as const)('a move die of %i is a moment about the seat that rolled: %s', (face, kind) => {
    expect(
      detectMoment(entry('dice_result', [random('move:2:9', face)], 3), publicGame(), null),
    ).toMatchObject({ kind, subjectSeat: 2 });
  });

  test('only the move die is read: the dice between are not, and neither is a first-player or battle die', () => {
    for (const face of [2, 3, 4, 5])
      expect(
        detectMoment(entry('dice_result', [random('move:2:9', face)], 2), publicGame(), null),
      ).toBeNull();
    expect(
      detectMoment(entry('dice_result', [random('first-player:2', 6)], 2), publicGame(), null),
    ).toBeNull();
    expect(
      detectMoment(
        entry('dice_result', [random('gym:9:challenger_roll', 6)], 2),
        publicGame(),
        null,
      ),
    ).toBeNull();
  });

  test('a Gym win outranks coins, a sale and a change of leader on the same step', () => {
    const events = [
      sale(30),
      reward({ kind: 'gym' }, 'player-0'),
      random('move:0:9', 6),
    ] as EngineEvent[];
    expect(
      detectMoment(entry('choose_reward', events), publicGame([20, 10, 10, 10]), 1),
    ).toMatchObject({ kind: 'gym_win' });
  });

  test('leaders are read from coins alone', () => {
    expect(leaderOf(players([3, 9, 5, 1]))).toBe(1);
    expect(leaderOf(players([9, 9, 5, 1]))).toBeNull();
  });
});

describe('what a seat says about a moment (§5.7)', () => {
  test.each<[Partial<Moment>, number, TalkSituation, number | null]>([
    // About its own turn an AI speaks to the table; about another seat, to that seat.
    [{ kind: 'roll_high', subjectSeat: 1 }, 1, 'roll_high_own', null],
    [{ kind: 'roll_high', subjectSeat: 1 }, 2, 'roll_high_other', 1],
    [{ kind: 'roll_low', subjectSeat: 1 }, 1, 'roll_low_own', null],
    [{ kind: 'roll_low', subjectSeat: 1 }, 0, 'roll_low_other', 1],
    [{ kind: 'catch', subjectSeat: 1 }, 1, 'catch_success', null],
    [{ kind: 'catch', subjectSeat: 1 }, 2, 'catch_other', 1],
    [{ kind: 'miss', subjectSeat: 1 }, 1, 'catch_fail', null],
    [{ kind: 'miss', subjectSeat: 1 }, 2, 'miss_other', 1],
    [{ kind: 'sale', subjectSeat: 1 }, 1, 'sold_pokemon', null],
    [{ kind: 'sale', subjectSeat: 1 }, 3, 'sale_other', 1],
    [{ kind: 'gym_win', subjectSeat: 1 }, 1, 'gym_win', null],
    [{ kind: 'gym_win', subjectSeat: 1 }, 3, 'gym_win_other', 1],
    // A battle has a winner, a loser and the table.
    [{ kind: 'battle_win', subjectSeat: 1, counterSeat: 2 }, 1, 'battle_won_own', null],
    [{ kind: 'battle_win', subjectSeat: 1, counterSeat: 2 }, 2, 'battle_lost_own', null],
    [{ kind: 'battle_win', subjectSeat: 1, counterSeat: 2 }, 3, 'battle_won_other', 1],
    [{ kind: 'battle_loss', subjectSeat: 1 }, 1, 'battle_lost_own', null],
    [{ kind: 'battle_loss', subjectSeat: 1 }, 2, 'battle_lost_other', 1],
    // Coins have a receiver, a payer and the table.
    [{ kind: 'coins', subjectSeat: 1, counterSeat: 2 }, 1, 'coins_in_own', null],
    [{ kind: 'coins', subjectSeat: 1, counterSeat: 2 }, 2, 'coins_out_own', null],
    [{ kind: 'coins', subjectSeat: 1, counterSeat: 2 }, 3, 'coins_other', 1],
    [{ kind: 'lead', subjectSeat: 0, addressedSeat: 2 }, 3, 'taunt_leader', 2],
    [{ kind: 'greeting' }, 3, 'game_start', null],
    [{ kind: 'banter' }, 3, 'table_banter', null],
  ])('%j, said by seat %i, is %s to seat %j', (over, speaker, situation, addressed) => {
    expect(voiceFor(moment(over), speaker)).toEqual({ situation, addressedSeat: addressed });
  });
});

describe('who may speak, and when (§5.7)', () => {
  const view = gameStore(4, false, 1).getSpectatorView()!;
  const lead = moment({ kind: 'lead', actingSeat: 0, subjectSeat: 0, addressedSeat: 1 });
  const context = (over: Partial<TalkContext> = {}): TalkContext => ({
    view,
    seed: 'seed',
    momentKey: 5,
    spoken: [],
    moment: lead,
    pace: 'readable',
    paused: false,
    hidden: false,
    ...over,
  });
  const line = (turn: number, from = 2, to?: number): AiSpeechEvent => ({
    kind: 'ai_speech',
    speakerSeatIndex: from,
    ...(to !== undefined && { addressedSeatIndex: to }),
    source: 'bank',
    text: 'Hello.',
    globalTurnNo: turn,
  });

  test('a lead taunt comes from the AI seats, never the one that took the lead or the leader', () => {
    for (let key = 0; key < 200; key++) {
      const plan = planTableTalk(context({ momentKey: key }))!;
      expect([2, 3]).toContain(plan.speakerSeat);
      expect(plan.addressedSeat).toBe(1);
      expect(plan.situation).toBe('taunt_leader');
    }
  });

  test('any AI seat may speak about anything else, the seat whose turn it is included', () => {
    const speakers = new Set(
      Array.from(
        { length: 200 },
        (_, key) =>
          planTableTalk(
            context({ moment: moment({ kind: 'roll_high', subjectSeat: 1 }), momentKey: key }),
          )!.speakerSeat,
      ),
    );
    expect(speakers).toEqual(new Set([0, 1, 2, 3]));
  });

  test('about its own turn the speaker is the subject, about another seat the line is addressed to it', () => {
    for (let key = 0; key < 100; key++) {
      const plan = planTableTalk(
        context({ moment: moment({ kind: 'catch', subjectSeat: 1 }), momentKey: key }),
      )!;
      expect(plan.addressedSeat).not.toBe(plan.speakerSeat);
      expect(plan.situation).toBe(plan.speakerSeat === 1 ? 'catch_success' : 'catch_other');
      if (plan.speakerSeat !== 1) expect(plan.addressedSeat).toBe(1);
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

  test('a lead taunt with nobody left to speak is no plan, while a one-rival table can still talk', () => {
    const duel = gameStore(2, true, 1).getView()!;
    expect(
      planTableTalk(context({ view: duel, moment: moment({ kind: 'lead', addressedSeat: 1 }) })),
    ).toBeNull();
    const roll = planTableTalk(
      context({ view: duel, moment: moment({ kind: 'roll_low', actingSeat: 1, subjectSeat: 1 }) }),
    )!;
    // The only AI speaks about its own turn, to the table; the player is whom it addresses.
    expect(roll).toMatchObject({ speakerSeat: 1, situation: 'roll_low_own', addressedSeat: 0 });
    expect(roll.listener).toBeNull();
  });

  test.each([
    ['at Fast pace', { pace: 'fast' as const }],
    ['at Instant pace', { pace: 'instant' as const }],
    ['while paused', { paused: true }],
    ['while hidden', { hidden: true }],
  ])('no comment %s', (_name, over) => {
    expect(planTableTalk(context())).not.toBeNull();
    expect(planTableTalk(context(over))).toBeNull();
  });

  test('no comment once the game is over', () => {
    const finished = {
      ...view,
      observation: {
        ...view.observation,
        public: { ...view.observation.public, phase: { kind: 'finished' } },
      },
    } as unknown as typeof view;
    expect(planTableTalk(context({ view: finished }))).toBeNull();
  });

  test('a round holds three comments: a fourth waits for the next round', () => {
    const seats = view.observation.public.players.length;
    const round = roundOf(lead.turn, seats);
    const turnIn = (index: number) => round * seats + 1 + (index % seats);
    expect(TABLE_TALK.maxPerRound).toBe(3);
    const said = (count: number) => Array.from({ length: count }, (_, i) => line(turnIn(i), 2, 1));
    expect(planTableTalk(context({ spoken: said(TABLE_TALK.maxPerRound - 1) }))).not.toBeNull();
    expect(planTableTalk(context({ spoken: said(TABLE_TALK.maxPerRound) }))).toBeNull();
    // Lines of another round do not count.
    expect(
      planTableTalk(
        context({
          spoken: Array.from({ length: 9 }, (_, i) => line((round + 1) * seats + 1 + (i % seats))),
        }),
      ),
    ).not.toBeNull();
    expect(roundOf(0, seats)).toBe(0);
    expect(roundOf(seats, seats)).toBe(0);
    expect(roundOf(seats + 1, seats)).toBe(1);
  });

  test('there is no game maximum: a long game keeps talking', () => {
    const many = Array.from({ length: 200 }, (_, i) => line(1000 + 4 * i, 2, 1));
    expect(planTableTalk(context({ spoken: many }))).not.toBeNull();
  });

  test('the same seed and moment make the same plan, so a reload does not change who talks', () => {
    expect(planTableTalk(context())).toEqual(planTableTalk(context()));
  });

  describe('an exchange between two AIs', () => {
    const about = moment({ kind: 'catch', actingSeat: 0, subjectSeat: 1 });
    const pick = (over: Partial<TalkContext> = {}) =>
      Array.from({ length: 80 }, (_, key) =>
        planTableTalk(context({ moment: about, momentKey: key, ...over })),
      ).flatMap((plan) => (plan ? [plan] : []));

    test('a line addressed to another AI may be answered by it, once; a line to the player or the table cannot be', () => {
      const plans = pick();
      expect(plans.some((plan) => plan.listener !== null)).toBe(true);
      for (const plan of plans) {
        if (plan.listener) {
          expect(plan.listener.seat).toBe(plan.addressedSeat);
          expect(plan.listener.seat).not.toBe(plan.speakerSeat);
        }
      }
      const human = gameStore(3, true, 1).getView()!;
      const toPlayer = planTableTalk(
        context({
          view: human,
          moment: moment({ kind: 'catch', actingSeat: 0, subjectSeat: 0 }),
        }),
      )!;
      expect(toPlayer.addressedSeat).not.toBe(toPlayer.speakerSeat);
      for (let key = 0; key < 40; key++) {
        const plan = planTableTalk(
          context({
            view: human,
            moment: moment({ kind: 'catch', subjectSeat: 0 }),
            momentKey: key,
          }),
        )!;
        if (plan.addressedSeat === 0) expect(plan.listener).toBeNull();
      }
    });

    test('one exchange a round: a pair already said in the round ends exchanges but not comments', () => {
      const seats = view.observation.public.players.length;
      const turn = roundOf(about.turn, seats) * seats + 1;
      const pair: AiSpeechEvent[] = [
        { ...line(turn, 2, 3), source: 'haiku' },
        { ...line(turn, 3, 2), source: 'haiku' },
      ];
      const plans = pick({ spoken: pair });
      expect(plans.length).toBeGreaterThan(0);
      for (const plan of plans) expect(plan.listener).toBeNull();
      // The pair is one entry of the round, so two more comments still fit.
      expect(pick({ spoken: [...pair, line(turn, 2, 1)] }).length).toBeGreaterThan(0);
      expect(pick({ spoken: [...pair, line(turn, 2, 1), line(turn, 3, 1)] })).toHaveLength(0);
      // Another round's pair does not count.
      const later = pair.map((entry) => ({ ...entry, globalTurnNo: turn + seats }));
      expect(pick({ spoken: later }).some((plan) => plan.listener !== null)).toBe(true);
    });
  });
});

describe('the lines that keep a round from being silent (§5.7)', () => {
  const view = gameStore(3, false, 1).getSpectatorView()!;
  const game = (turn: number): PublicGame => ({
    ...view.observation.public,
    globalTurnNo: turn,
    activeSeatIndex: turn % 3,
  });
  const said = (turn: number): AiSpeechEvent => ({
    kind: 'ai_speech',
    speakerSeatIndex: 1,
    source: 'bank',
    text: 'Hi.',
    globalTurnNo: turn,
  });

  test('the game opens with a greeting before the first turn, in the first round', () => {
    const opening = greeting(game(0));
    expect(opening).toMatchObject({ kind: 'greeting', turn: 0 });
    expect(roundOf(opening.turn, 3)).toBe(0);
  });

  test('a round with no line asks for one in its last turn, and only then', () => {
    expect(banterDue(game(1), [])).toBeNull();
    expect(banterDue(game(2), [])).toBeNull();
    expect(banterDue(game(3), [])).toMatchObject({ kind: 'banter', turn: 3 });
    expect(banterDue(game(6), [])).toMatchObject({ kind: 'banter', turn: 6 });
    expect(banterDue(game(0), [])).toBeNull();
  });

  test('a line anywhere in the round, the greeting for the first one, is its line', () => {
    expect(banterDue(game(3), [said(0)])).toBeNull();
    expect(banterDue(game(3), [said(2)])).toBeNull();
    expect(banterDue(game(3), [said(4)])).toMatchObject({ kind: 'banter' });
    expect(banterDue(game(6), [said(0), said(3)])).toMatchObject({ kind: 'banter' });
  });

  test('nothing is asked for once the game is over', () => {
    const over = { ...game(3), phase: { kind: 'finished' } } as unknown as PublicGame;
    expect(banterDue(over, [])).toBeNull();
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
    moment: moment({ kind: 'lead', addressedSeat: 1 }),
    speakerSeat: 2,
    personalityId: 'greedy',
    situation: 'taunt_leader',
    addressedSeat: 1,
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

  test('every situation a seat can speak is one the route accepts', () => {
    const game = viewOf(gameStore(3, false, 1))!.observation.public;
    for (const situation of [
      'game_start',
      'table_banter',
      'roll_high_own',
      'miss_other',
      'battle_lost_own',
      'coins_other',
    ] as const) {
      const body = speakBody({ gameId: 'g', plan: { ...plan, situation }, game, momentKey: 1 });
      expect(speakRequestSchema.safeParse(body).success, situation).toBe(true);
    }
  });

  test('the answer to a line is asked of the listener, from the speaker, quoting the line and nothing private', () => {
    const store = gameStore(3, false, 'sentinel-seed-do-not-send');
    plant(store);
    const game = viewOf(store)!.observation.public;
    const exchange = { ...plan, listener: { seat: 1, personalityId: 'cautious' } };
    const body = replyBody({
      gameId: 'g',
      plan: exchange,
      game,
      momentKey: 4,
      quote: 'A quoted line.',
    });
    const text = JSON.stringify(body);
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain('sentinel-seed');
    expect(replyRequestSchema.parse(JSON.parse(text))).toMatchObject({
      kind: 'reply',
      seatIndex: 1,
      speakerSeat: 2,
      quote: 'A quoted line.',
      situation: 'table_retort',
      personalityId: 'cautious',
    });
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

  test('a talk line may wait about three seconds, not the old one and a fifth', async () => {
    expect(TABLE_TALK.deadlineMs).toBeGreaterThanOrEqual(3_000);
    expect(TABLE_TALK.deadlineMs).toBeLessThanOrEqual(4_000);
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () => new Promise<Response>((resolve) => setTimeout(() => resolve(json(haiku)), 2_900)),
      ),
    );
    const pending = requestSpeech(body, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(2_900);
    expect(await pending).toEqual({ source: 'haiku', text: 'Fine words.' });
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

  test('an exchange is the opening line and its answer, both written by Haiku, and nothing less', async () => {
    const answers = [haiku, { ...haiku, text: 'Kind of you.' }];
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json(answers.shift())),
    );
    const quotes: string[] = [];
    expect(
      await requestExchange(
        body,
        (quote) => (quotes.push(quote), body),
        new AbortController().signal,
      ),
    ).toEqual({ opening: 'Fine words.', reply: 'Kind of you.' });
    expect(quotes).toEqual(['Fine words.']);
    for (const second of [
      { source: 'bank', text: 'x', lineId: 'table-retort-greedy-neutral-1', ...telemetry },
      { source: 'none', fallbackReason: 'manipulation', ...telemetry },
    ]) {
      const queue = [haiku, second];
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => json(queue.shift())),
      );
      expect(await requestExchange(body, () => body, new AbortController().signal)).toBeNull();
    }
    // A bank opening is no exchange, and the answer is never asked for.
    const asked = vi.fn(async () =>
      json({ source: 'bank', text: 'x', lineId: 'taunt-leader-greedy-neutral-1', ...telemetry }),
    );
    vi.stubGlobal('fetch', asked);
    expect(await requestExchange(body, () => body, new AbortController().signal)).toBeNull();
    expect(asked).toHaveBeenCalledTimes(1);
  });

  test('an exchange not complete inside the window is dropped whole, even if the network finishes it, and never retried', async () => {
    vi.useFakeTimers();
    const fetchSpy = vi.fn(
      () =>
        new Promise<Response>((resolve) =>
          setTimeout(() => resolve(json(haiku)), TABLE_TALK.deadlineMs / 2 + 100),
        ),
    );
    vi.stubGlobal('fetch', fetchSpy);
    const pending = requestExchange(body, () => body, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(TABLE_TALK.deadlineMs);
    expect(await pending).toBeNull();
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  test('an aborted exchange never reaches the network', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const controller = new AbortController();
    controller.abort();
    expect(await requestExchange(body, () => body, controller.signal)).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('the line bank speaks for every moment (§5.7)', () => {
  const view = gameStore(3, false, 1).getSpectatorView()!;
  const game = view.observation.public;
  const SITUATIONS: TalkSituation[] = [
    'game_start',
    'table_banter',
    'taunt_leader',
    'catch_success',
    'catch_fail',
    'sold_pokemon',
    'gym_win',
    'roll_high_own',
    'roll_low_own',
    'battle_won_own',
    'battle_lost_own',
    'coins_in_own',
    'coins_out_own',
    'catch_other',
    'miss_other',
    'roll_high_other',
    'roll_low_other',
    'battle_won_other',
    'battle_lost_other',
    'coins_other',
    'sale_other',
    'gym_win_other',
  ];
  const planFor = (situation: TalkSituation, personalityId: string): TalkPlan => ({
    moment: moment({ pokemon: 'Magikarp', coins: 20, turn: 6 }),
    speakerSeat: 2,
    personalityId,
    situation,
    addressedSeat: 1,
    listener: null,
  });

  test.each(SITUATIONS)(
    '%s has a line for every personality that can be shown with the facts of the moment',
    (situation) => {
      for (const personality of PERSONALITIES) {
        for (let key = 0; key < 12; key++) {
          const answer = bankAnswer(situation, personality, 'seed', key);
          expect(answer, `${situation} ${personality}`).not.toBeNull();
          const event = speechEvent(planFor(situation, personality), answer!, game);
          expect(event, `${situation} ${personality} ${answer!.lineId}`).not.toBeNull();
          expect(event!.text).not.toMatch(/[{}]/);
          expect(event!.text.length).toBeGreaterThan(0);
        }
      }
    },
  );

  test('a line is a fixed function of the seed, the personality and the moment, and the lines vary', () => {
    const pick = (seed: string, key: number) =>
      bankAnswer('table_banter', 'greedy', seed, key)!.lineId;
    expect(pick('a', 3)).toBe(pick('a', 3));
    expect(new Set(Array.from({ length: 40 }, (_, key) => pick('a', key))).size).toBeGreaterThan(2);
  });

  test('a Haiku line is saved as written, addressed and tied to its turn', () => {
    const plan = planFor('roll_high_other', 'cautious');
    expect(speechEvent(plan, { source: 'haiku', text: '  Well rolled.  ' }, game)).toEqual({
      kind: 'ai_speech',
      speakerSeatIndex: 2,
      addressedSeatIndex: 1,
      source: 'haiku',
      text: 'Well rolled.',
      globalTurnNo: 6,
    });
    expect(speechEvent(plan, { source: 'haiku', text: '   ' }, game)).toBeNull();
    expect(speechEvent(plan, { source: 'haiku', text: 'x'.repeat(281) }, game)).toBeNull();
  });

  test('a bank line is filled with the addressed class name, the species and the coins of the moment', () => {
    const named = speechEvent(
      planFor('taunt_leader', 'cautious'),
      { source: 'bank', lineId: 'taunt-leader-cautious-neutral-1', text: 'ignored' },
      game,
    );
    expect(named).toMatchObject({
      source: 'bank',
      addressedSeatIndex: 1,
      text: 'Researcher is in front. I will watch that closely.',
    });
    const sold = speechEvent(
      planFor('sold_pokemon', 'greedy'),
      { source: 'bank', lineId: 'sold-pokemon-greedy-neutral-1', text: 'x' },
      game,
    );
    expect(sold!.text).toBe('Sold Magikarp for 20 coins.');
  });

  test('a bank line that names no one is said to the table, one that names the addressee is said to it', () => {
    const plan = planFor('roll_high_own', 'greedy');
    const own = speechEvent(plan, bankAnswer('roll_high_own', 'greedy', 'seed', 1)!, game)!;
    expect(own.addressedSeatIndex).toBeUndefined();
    const other = speechEvent(
      planFor('roll_high_other', 'greedy'),
      bankAnswer('roll_high_other', 'greedy', 'seed', 1)!,
      game,
    )!;
    expect(other.addressedSeatIndex).toBe(1);
    expect(other.text).toContain('Researcher');
  });

  test('a line with a slot the moment cannot fill, or one the bank does not have, is not shown', () => {
    const noFacts = { ...planFor('sold_pokemon', 'greedy'), moment: moment() };
    expect(
      speechEvent(
        noFacts,
        { source: 'bank', lineId: 'sold-pokemon-greedy-neutral-1', text: 'x' },
        game,
      ),
    ).toBeNull();
    expect(
      speechEvent(
        planFor('roll_low_own', 'greedy'),
        { source: 'bank', lineId: 'no-such-line', text: 'x' },
        game,
      ),
    ).toBeNull();
    expect(
      speechEvent(planFor('game_start', 'greedy'), { source: 'bank', text: 'x' }, game),
    ).toBeNull();
  });

  test('a bank pick steers clear of the lines said recently, and repeats only when it must', () => {
    const all = Array.from(
      { length: 4 },
      (_, index) => `roll-high-other-greedy-neutral-${index + 1}`,
    );
    for (let key = 0; key < 40; key++) {
      const recent = all.slice(0, 3);
      expect(bankAnswer('roll_high_other', 'greedy', 'seed', key, recent)!.lineId).toBe(all[3]);
      expect(bankAnswer('roll_high_other', 'greedy', 'seed', key, all)!.lineId).toBeTruthy();
      expect(
        retortAnswer('greedy', 'seed', key, ['table-retort-greedy-neutral-1'])!.lineId,
      ).not.toBe('table-retort-greedy-neutral-1');
    }
    // Nothing recent: the same pick as before for the same seed and moment.
    expect(bankAnswer('roll_high_other', 'greedy', 'seed', 7)).toEqual(
      bankAnswer('roll_high_other', 'greedy', 'seed', 7, []),
    );
  });

  test('in a played game no two lines in a row are the same bank line', async () => {
    fakeServer('bank');
    const store = gameStore(2, true, 1);
    mountTalk(store, { status: OFF });
    await play(store);
    const ids = spoken(store).flatMap((line) => (line.lineId ? [line.lineId] : []));
    expect(ids.length).toBeGreaterThan(4);
    ids.slice(1).forEach((id, index) => expect(id).not.toBe(ids[index]));
  }, 60_000);

  test('every personality has a retort, a bank answer that names the one it answers', () => {
    const exchange = {
      ...planFor('table_banter', 'greedy'),
      listener: { seat: 1, personalityId: 'x' },
    };
    for (const personality of PERSONALITIES) {
      for (let key = 0; key < 12; key++) {
        const retort = retortAnswer(personality, 'seed', key)!;
        const event = retortEvent(exchange, retort, game);
        expect(event).toMatchObject({
          source: 'bank',
          speakerSeatIndex: 1,
          addressedSeatIndex: 2,
        });
        expect(event!.text).not.toMatch(/[{}]/);
      }
    }
    // Only a retort answers; any other bank line is never said as an answer.
    expect(
      retortEvent(
        exchange,
        { source: 'bank', lineId: 'taunt-leader-greedy-neutral-1', text: 'x' },
        game,
      ),
    ).toBeNull();
    expect(retortEvent(exchange, { source: 'haiku', text: 'Kind of you.' }, game)).toBeNull();
  });

  test('a generated exchange is saved opening first, each line addressed to the other', () => {
    const exchange = {
      ...planFor('table_banter', 'greedy'),
      listener: { seat: 1, personalityId: 'x' },
    };
    const base = { kind: 'ai_speech', source: 'haiku', globalTurnNo: 6 };
    expect(exchangeEvents(exchange, { opening: ' One. ', reply: 'Two.' })).toEqual([
      { ...base, speakerSeatIndex: 2, addressedSeatIndex: 1, text: 'One.' },
      { ...base, speakerSeatIndex: 1, addressedSeatIndex: 2, text: 'Two.' },
    ]);
    expect(exchangeEvents(exchange, { opening: 'One.', reply: '  ' })).toBeNull();
    expect(exchangeEvents(exchange, { opening: 'x'.repeat(281), reply: 'Two.' })).toBeNull();
  });
});

describe('an exchange in the saved lines (§5.7)', () => {
  const say = (
    turn: number,
    from: number,
    to: number | undefined,
    source: 'haiku' | 'bank' = 'haiku',
    lineId = 'table-retort-greedy-neutral-1',
  ): AiSpeechEvent =>
    source === 'haiku'
      ? {
          kind: 'ai_speech',
          speakerSeatIndex: from,
          ...(to !== undefined && { addressedSeatIndex: to }),
          source,
          text: `Line from ${from}.`,
          globalTurnNo: turn,
        }
      : {
          kind: 'ai_speech',
          speakerSeatIndex: from,
          ...(to !== undefined && { addressedSeatIndex: to }),
          source,
          lineId,
          text: `Line from ${from}.`,
          globalTurnNo: turn,
        };

  test('an opening line and its answer read as one exchange, in order, for Haiku lines and for the bank', () => {
    const haiku = talkEntries([say(9, 2, 1), say(9, 1, 2)]);
    expect(haiku).toHaveLength(1);
    expect(haiku[0]).toMatchObject({ kind: 'exchange' });
    const bank = talkEntries([
      say(9, 2, 1, 'bank', 'roll-low-other-greedy-neutral-1'),
      say(9, 1, 2, 'bank'),
    ]);
    expect(bank).toHaveLength(1);
    expect(bank[0]).toMatchObject({ kind: 'exchange' });
  });

  test.each([
    ['another turn', [say(9, 2, 1), say(10, 1, 2)]],
    ['not the other way round', [say(9, 2, 1), say(9, 1, 3)]],
    ['a Haiku opening and a bank answer', [say(9, 2, 1), say(9, 1, 2, 'bank')]],
    [
      'a bank opening and a bank line that is not a retort',
      [
        say(9, 2, 1, 'bank', 'roll-low-other-greedy-neutral-1'),
        say(9, 1, 2, 'bank', 'catch-other-greedy-neutral-1'),
      ],
    ],
    ['an answer addressed to no one', [say(9, 2, 1), say(9, 1, undefined)]],
  ])('%s is two lines of their own', (_name, lines) => {
    expect(talkEntries(lines)).toHaveLength(2);
  });

  test('a lone answer, or a third line, stays a line of its own', () => {
    expect(talkEntries([say(9, 1, 2)])).toHaveLength(1);
    const three = talkEntries([say(9, 2, 1), say(9, 1, 2), say(9, 2, 1)]);
    expect(three.map((entry) => entry.kind)).toEqual(['exchange', 'line']);
  });
});

describe('table talk in a played game (§5.7, §3.1)', () => {
  test.each([
    [3, 1],
    [4, 1],
  ] as const)(
    'a %i-seat watched game (seed %i): words never change a coin, die, legal action or the log, whatever the route does',
    async (seats, seed) => {
      const finals: { actions: unknown; hash: string; lines: number }[] = [];
      for (const route of ['haiku', 'error', 'hang', 'garbage', 'bank'] as const) {
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
      expect(finals.map((final) => final.hash)).toEqual(Array(5).fill(finals[0]!.hash));
      for (const final of finals) expect(final.actions).toEqual(finals[0]!.actions);
      // Every route, the one that never answers included, leaves lines: the bank takes over.
      for (const final of finals.slice(0, 1)) expect(final.lines).toBeGreaterThan(0);
    },
    120_000,
  );

  test('a human game is the same game with talk on and off: the player never sees a different game', async () => {
    const results: { actions: unknown; hash: string; lines: number }[] = [];
    for (const pace of ['readable', 'fast'] as const) {
      fakeServer('haiku');
      const store = gameStore(2, true, 1);
      mountTalk(store, { pace });
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

  const everyRound = (store: GameStore, seats: number) => {
    const lines = spoken(store);
    const { globalTurnNo } = store.getSession()!.state;
    const complete = Math.floor(globalTurnNo / seats);
    expect(complete).toBeGreaterThan(2);
    const rounds = new Set(lines.map((line) => roundOfLine(line, seats)));
    for (let round = 0; round < complete; round++)
      expect(rounds.has(round), `a line in round ${round}`).toBe(true);
  };

  test.each(HUMAN_TABLES)(
    'a %i-seat game with Haiku on has a line in the first round and in every round after',
    async (seats, seed) => {
      fakeServer('haiku');
      const store = gameStore(seats, true, seed);
      mountTalk(store);
      await play(store);
      everyRound(store, seats);
      expect(spoken(store).some((line) => line.source === 'haiku')).toBe(true);
    },
    60_000,
  );

  test.each(HUMAN_TABLES)(
    'a %i-seat game with Haiku off has a line in the first round and in every round after, and never asks the route',
    async (seats, seed) => {
      const calls = fakeServer('bank');
      const store = gameStore(seats, true, seed);
      const mounted = mountTalk(store, { status: OFF });
      await play(store);
      expect(mounted.result.current.voiceOff).toBe('disabled');
      expect(calls).toHaveLength(0);
      everyRound(store, seats);
      for (const line of spoken(store)) {
        expect(line.source).toBe('bank');
        expect(line.text).not.toMatch(/[{}]/);
      }
    },
    60_000,
  );

  test.each(HUMAN_TABLES)(
    'a %i-seat game with a route that fails still has a line in every round, from the bank',
    async (seats, seed) => {
      fakeServer('error');
      const store = gameStore(seats, true, seed);
      mountTalk(store);
      await play(store);
      everyRound(store, seats);
      for (const line of spoken(store)) expect(line.source).toBe('bank');
    },
    60_000,
  );

  test('a watched game has a line in every round too', async () => {
    fakeServer('bank');
    const store = gameStore(3, false, 2);
    mountTalk(store);
    await play(store);
    everyRound(store, 3);
  }, 60_000);

  test('the first line is the greeting, from a rival, before any turn is played', async () => {
    fakeServer('haiku');
    const store = gameStore(3, true, 1);
    mountTalk(store);
    await settle();
    const [first] = spoken(store);
    expect(first).toMatchObject({ globalTurnNo: 0, source: 'haiku' });
    expect(first!.speakerSeatIndex).toBeGreaterThan(0);
    expect(store.getSession()!.state.globalTurnNo).toBe(0);
  });

  test('React StrictMode, which mounts, unmounts and mounts again, still greets once', async () => {
    const calls = fakeServer('haiku');
    const store = gameStore(3, true, 1);
    renderHook(
      () => {
        const view = useSyncExternalStore(store.subscribe, () => viewOf(store));
        return useTableTalk(store, view, {
          pace: 'readable',
          skipping: false,
          paused: false,
          status: null,
        });
      },
      { reactStrictMode: true },
    );
    await settle();
    const greetings = spoken(store).filter((line) => line.globalTurnNo === 0);
    expect(greetings).toHaveLength(1);
    expect(calls.filter((call) => call.parsed.kind !== 'reply').length).toBeLessThanOrEqual(2);
  });

  test('the board opened in the first turn, with no line yet, still greets; one opened later does not', async () => {
    fakeServer('bank');
    const early = gameStore(3, true, 1);
    while (early.advance({ human: true }) && early.getSession()!.state.globalTurnNo < 1);
    expect(early.getSession()!.state.globalTurnNo).toBe(1);
    mountTalk(early, { status: OFF });
    await settle();
    expect(spoken(early)).toHaveLength(1);
    cleanup();
    const late = gameStore(3, true, 1);
    await play(late, () => late.getSession()!.state.globalTurnNo >= 3);
    mountTalk(late, { status: OFF });
    await settle();
    expect(spoken(late)).toHaveLength(0);
  });

  test('with Haiku off the greeting is a game_start line addressed to a seat, and says hello by name', async () => {
    fakeServer('bank');
    const store = gameStore(2, true, 1);
    mountTalk(store, { status: OFF });
    await settle();
    const [first] = spoken(store);
    expect(first).toMatchObject({ globalTurnNo: 0, source: 'bank', addressedSeatIndex: 0 });
    expect(first!.lineId).toMatch(/^game-start-/);
    expect(first!.text).not.toMatch(/[{}]/);
  });

  test("a rival talks about its own turn, and the player's turn, whichever table it sits at", async () => {
    fakeServer('bank');
    const store = gameStore(2, true, 1);
    mountTalk(store, { status: OFF });
    await play(store);
    const lines = spoken(store);
    const feed = store.getView()!.feed;
    const activeAt = (turn: number) =>
      feed.find((entry) => entry.before.globalTurnNo === turn)?.before.activeSeatIndex;
    // The only rival is seat 1: it speaks when it is its own turn and when it is the player's.
    expect(lines.every((line) => line.speakerSeatIndex === 1)).toBe(true);
    expect(lines.some((line) => activeAt(line.globalTurnNo) === 1)).toBe(true);
    expect(lines.some((line) => activeAt(line.globalTurnNo) === 0)).toBe(true);
    expect(
      lines.some(
        (line) =>
          line.lineId &&
          /-own-|^(catch-success|catch-fail|sold-pokemon|gym-win)-/.test(line.lineId),
      ),
    ).toBe(true);
    expect(lines.some((line) => line.lineId?.includes('-other-'))).toBe(true);
  }, 60_000);

  test('the same seed and settings choose the same speakers and the same lines', async () => {
    const run = async (route: Route) => {
      fakeServer(route);
      const store = gameStore(4, false, 1);
      const mounted = mountTalk(store);
      await play(store);
      mounted.unmount();
      return spoken(store);
    };
    for (const route of ['haiku', 'bank'] as const) {
      const first = await run(route);
      expect(first.length).toBeGreaterThan(0);
      expect(shape(await run(route))).toEqual(shape(first));
    }
    // A different seed is a different game with its own speakers.
    fakeServer('bank');
    const other = gameStore(4, false, 3);
    mountTalk(other);
    await play(other);
    expect(shape(spoken(other))).not.toEqual(shape(await run('bank')));
  }, 120_000);

  test.each([
    [3, 1],
    [4, 1],
  ] as const)(
    'at most three comments or exchanges a round, one exchange, and each seat talks to another: %i seats, seed %i',
    async (seats, seed) => {
      fakeServer('haiku');
      const store = gameStore(seats, false, seed);
      mountTalk(store);
      await play(store);
      const entries = talkEntries(spoken(store));
      const byRound = new Map<number, typeof entries>();
      for (const entry of entries) {
        const round = roundOfLine(entry.kind === 'line' ? entry.line : entry.opening, seats);
        byRound.set(round, [...(byRound.get(round) ?? []), entry]);
      }
      for (const [round, group] of byRound) {
        expect(group.length, `round ${round}`).toBeLessThanOrEqual(TABLE_TALK.maxPerRound);
        expect(
          group.filter((entry) => entry.kind === 'exchange').length,
          `round ${round}`,
        ).toBeLessThanOrEqual(TABLE_TALK.maxExchangesPerRound);
      }
      for (const line of spoken(store))
        expect(line.speakerSeatIndex).not.toBe(line.addressedSeatIndex);
    },
    60_000,
  );

  test('AI-to-AI back-and-forth: with Haiku on an AI answers an AI, and with Haiku off the bank does', async () => {
    fakeServer('haiku');
    const on = gameStore(4, false, 1);
    mountTalk(on);
    await play(on);
    const haikuPairs = talkEntries(spoken(on)).filter((entry) => entry.kind === 'exchange');
    expect(haikuPairs.length).toBeGreaterThan(0);
    for (const pair of haikuPairs) {
      expect(pair.kind === 'exchange' && pair.reply.addressedSeatIndex).toBe(
        pair.kind === 'exchange' && pair.opening.speakerSeatIndex,
      );
    }
    cleanup();
    fakeServer('bank');
    const off = gameStore(4, false, 1);
    mountTalk(off, { status: OFF });
    await play(off);
    const bankPairs = talkEntries(spoken(off)).filter((entry) => entry.kind === 'exchange');
    expect(bankPairs.length).toBeGreaterThan(0);
    for (const pair of bankPairs) {
      if (pair.kind === 'exchange') {
        expect(pair.reply.source).toBe('bank');
        expect(pair.reply.lineId).toMatch(/^table-retort-/);
      }
    }
  }, 120_000);

  test('an opening line the manipulation check refused is never shown, the bank speaks instead, and nothing is asked twice', async () => {
    const calls = fakeServer('refuse');
    const store = gameStore(4, false, 1);
    mountTalk(store);
    await play(store);
    const exchanges = talkEntries(spoken(store)).filter((entry) => entry.kind === 'exchange');
    expect(exchanges.length).toBeGreaterThan(0);
    for (const entry of exchanges)
      expect(entry.kind === 'exchange' && entry.opening.source).toBe('bank');
    const asked = calls.filter((call) => call.parsed.kind !== 'reply');
    expect(asked.length).toBeGreaterThan(0);
    const keys = calls.map((call) => String(call.parsed.turnKey));
    expect(new Set(keys).size).toBe(keys.length);
  }, 60_000);

  test('a reload keeps the lines, and the limits and speakers carry on as if it never happened', async () => {
    fakeServer('bank');
    const whole = gameStore(4, false, 1);
    mountTalk(whole, { status: OFF });
    const total = await play(whole);
    cleanup();
    const expected = shape(spoken(whole));
    expect(expected.length).toBeGreaterThan(0);

    for (const cut of [5, Math.floor(total / 3), Math.floor(total / 2), total - 8]) {
      fakeServer('bank');
      const first = gameStore(4, false, 1);
      const mountedFirst = mountTalk(first, { status: OFF });
      await play(first, (steps) => steps === cut);
      const text = saveText(first.getSession()!);
      mountedFirst.unmount();

      const loaded = loadSave(text);
      if (!loaded.ok) throw new Error(loaded.message);
      const second = createGameStore();
      second.restore(loaded.game, first.getOpponents(), undefined, first.getGameId());
      // The same table talk comes back with the game: nothing is asked for again.
      expect(shape(spoken(second)), `cut ${cut}`).toEqual(shape(spoken(first)));
      expect(second.getGameId()).toBe(first.getGameId());
      mountTalk(second, { status: OFF });
      await settle();
      expect(shape(spoken(second)), `cut ${cut}`).toEqual(shape(spoken(first)));
      await play(second);
      expect(shape(spoken(second)), `cut ${cut}`).toEqual(expected);
      expect(verifyReplay(second.getSession()!)).toMatchObject({ pass: true });
      cleanup();
    }
  }, 180_000);

  test.each([
    ['Fast', { pace: 'fast' as const }],
    ['Instant', { pace: 'instant' as const }],
    ['skipping ahead', { skipping: true }],
    ['paused', { paused: true }],
  ])(
    'at %s pace or while paused the route is never called, nobody speaks and the game still ends',
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

  test('a route that never answers neither blocks the game nor leaves the table silent: the bank takes over after about three seconds', async () => {
    const calls = fakeServer('hang');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const store = gameStore(3, true, 1);
    mountTalk(store);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(calls).toHaveLength(1);
    expect(spoken(store)).toHaveLength(0);
    // The game is not held: the player can play on while the line is out.
    expect(store.advance({ human: true })).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TABLE_TALK.deadlineMs - 1);
    });
    expect(spoken(store)).toHaveLength(0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    const [line] = spoken(store);
    expect(line).toMatchObject({ source: 'bank', globalTurnNo: 0 });
    expect(line!.text).not.toMatch(/[{}]/);
  });

  test('a Haiku line that arrives inside the window is shown, not the bank line', async () => {
    const gate = Promise.withResolvers<void>();
    fakeServer('haiku');
    const real = globalThis.fetch;
    vi.stubGlobal('fetch', async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url) === '/api/ai/speak') await gate.promise;
      return real(url, init);
    });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const store = gameStore(3, true, 1);
    mountTalk(store);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TABLE_TALK.deadlineMs - 500);
    });
    expect(spoken(store)).toHaveLength(0);
    gate.resolve();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(spoken(store)[0]).toMatchObject({
      source: 'haiku',
      text: 'A calm word from across the table.',
    });
  });

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
    // The greeting is out; pause before it is answered.
    await settle();
    expect(asked).toBe(true);
    mounted.rerender({ pace: 'readable', skipping: false, paused: true, status: null });
    gate.resolve();
    await settle();
    expect(spoken(store)).toHaveLength(0);
  });

  test('hiding the panel stops new lines from being asked for; showing it again resumes', async () => {
    const calls = fakeServer('haiku');
    const store = gameStore(4, false, 1);
    const mounted = mountTalk(store);
    // The greeting, and the answer to it, are out before the player can hide the panel.
    await settle();
    const greetings = calls.length;
    act(() => mounted.result.current.setHidden(true));
    await play(store);
    expect(calls).toHaveLength(greetings);
    expect(spoken(store).filter((line) => line.globalTurnNo > 0)).toHaveLength(0);

    const again = gameStore(4, false, 1);
    const shown = mountTalk(again);
    act(() => shown.result.current.setHidden(true));
    await play(again, (steps) => steps === 20);
    act(() => shown.result.current.setHidden(false));
    await play(again);
    expect(spoken(again).length).toBeGreaterThan(0);
  }, 60_000);

  test('a watched game started with talk off asks for nothing and shows no line', async () => {
    const calls = fakeServer('haiku');
    const store = createGameStore();
    store.start(
      createGameConfig({
        seats: SEATS.slice(0, 3).map((seat, seatIndex) => ({
          actorId: `player-${seatIndex}`,
          seatIndex,
          ...seat,
          controller: 'ai' as const,
        })),
        seed: 1,
        lapTarget: 2,
      }),
      engineContent,
      [0, 1, 2].map((seatIndex) => ({
        seatIndex,
        personality: 'greedy' as const,
        difficulty: 'normal' as const,
      })),
      { talk: false, pace: 'readable' },
    );
    mountTalk(store);
    await play(store);
    expect(calls).toHaveLength(0);
    expect(spoken(store)).toHaveLength(0);
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

  test('no bank line names a hidden item, a Ball count or a number the speaker could not see', async () => {
    fakeServer('bank');
    const store = gameStore(4, false, 1);
    mountTalk(store, { status: OFF });
    await play(store);
    const items = engineContent.items
      .filter((item) => item.kind === 'utility')
      .map((item) => item.name);
    for (const line of spoken(store)) {
      for (const name of items) expect(line.text.toLowerCase()).not.toContain(name.toLowerCase());
      // A number in a line is the engine's own coins for a sale, said by the seller about its own sale.
      if (/\d/.test(line.text)) expect(line.lineId).toMatch(/^sold-pokemon-/);
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

  test('a line spoken to the table names no one it is to', () => {
    render(
      panel({
        lines: [
          {
            kind: 'ai_speech',
            speakerSeatIndex: 2,
            source: 'bank',
            lineId: 'roll-high-own-greedy-neutral-1',
            text: 'Big roll! More road means more coins. I call that Poké-profit.',
            globalTurnNo: 9,
          },
        ],
      }),
    );
    const [row] = screen.getAllByRole('listitem');
    expect(row!.textContent).toContain('Big roll!');
    expect(row!.textContent).not.toContain(t('talk.toYou'));
    expect(row!.textContent).not.toMatch(/\bto \w+/);
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
    expect(t('talk.empty')).toMatch(/greeting|every round/i);
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

  test('the two lines of an exchange are one group, opening above the answer, each labelled AI-written', () => {
    render(panel({ lines: [lines[0]!, ...pair] }));
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

  test('a bank exchange is one group, each line labelled as the line bank', () => {
    render(
      panel({
        lines: [
          {
            kind: 'ai_speech',
            speakerSeatIndex: 2,
            addressedSeatIndex: 1,
            source: 'bank',
            lineId: 'roll-low-other-greedy-neutral-1',
            text: 'Oof, Researcher, tiny roll. That is a lot of road with no coins.',
            globalTurnNo: 9,
          },
          {
            kind: 'ai_speech',
            speakerSeatIndex: 1,
            addressedSeatIndex: 2,
            source: 'bank',
            lineId: 'table-retort-aggressive-neutral-2',
            text: 'Is that your best, Rival? Try harder!',
            globalTurnNo: 9,
          },
        ],
      }),
    );
    const group = screen.getByRole('list', { name: /An exchange: .+ speaks to .+, who answers/ });
    const rows = group.querySelectorAll('li');
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row.textContent).toContain(t('talk.bank'));
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

  test('a line to the table, with no one addressed, is saved too', () => {
    const store = gameStore(2, true, 7);
    const toTable: AiSpeechEvent = {
      kind: 'ai_speech',
      speakerSeatIndex: 1,
      source: 'haiku',
      text: 'Nicely done.',
      globalTurnNo: 3,
    };
    expect(store.recordSpeech(toTable)).toBe(true);
    const loaded = loadSave(saveText(store.getSession()!));
    if (!loaded.ok) throw new Error(loaded.message);
    expect(loaded.game.log.dialogueEvents).toEqual([toTable]);
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

  describe('the game id, so the per-game limits survive a reload (§9)', () => {
    const memory = (): SaveStorage & { data: Map<string, string> } => {
      const data = new Map<string, string>();
      return {
        data,
        getItem: (key) => data.get(key) ?? null,
        setItem: (key, value) => void data.set(key, value),
        removeItem: (key) => void data.delete(key),
      };
    };

    test('it is saved beside the game, read back, and kept by a restore', () => {
      const store = gameStore(2, true, 7);
      const storage = memory();
      writeSave(storage, store.getSession()!, {
        opponents: store.getOpponents(),
        gameId: store.getGameId(),
      });
      expect(readMeta(storage).gameId).toBe(store.getGameId());
      const loaded = loadSave(storage.getItem('poke-monopoly.save')!);
      if (!loaded.ok) throw new Error(loaded.message);
      const restored = createGameStore();
      restored.restore(
        loaded.game,
        [...readMeta(storage).opponents],
        undefined,
        readMeta(storage).gameId,
      );
      expect(restored.getGameId()).toBe(store.getGameId());
      // The id is not part of the exported log.
      expect(storage.getItem('poke-monopoly.save')).not.toContain(store.getGameId());
    });

    test.each([
      ['a save with no id', undefined],
      ['an id that is not a plain token', 'bad id with spaces and "quotes"'],
      ['an id that is too long', 'x'.repeat(65)],
    ])('%s gets a new id', (_name, gameId) => {
      const store = gameStore(2, true, 7);
      const storage = memory();
      writeSave(storage, store.getSession()!, { opponents: store.getOpponents(), gameId });
      expect(readMeta(storage).gameId).toBeUndefined();
      const restored = createGameStore();
      restored.restore(store.getSession()!, [], undefined, readMeta(storage).gameId);
      expect(restored.getGameId()).not.toBe('');
      expect(restored.getGameId()).not.toBe(store.getGameId());
    });
  });
});
