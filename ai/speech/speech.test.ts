import { describe, expect, test } from 'vitest';
import {
  advanceAutomatically,
  applyAction,
  createGame,
  createGameConfig,
  createRng,
  eventsVisibleTo,
  int,
  legalActions,
  observe,
  pendingDecision,
  type SeatEvent,
  type GameState,
  type Observation,
} from '../../engine/index.ts';
import { toEngineContent } from '../../content/schema.ts';
import { LINES, type Situation } from '../lines.ts';
import { PERSONALITIES } from '../fallback/index.ts';
import { CONTENT } from '../questions/content.ts';
import {
  buildSpeechBrief,
  resolveSpeech,
  screenSpeech,
  SPEECH_INSTRUCTION,
  SPEECH_MAX_CHARS,
  VOICE,
  type SpeechBrief,
} from './index.ts';
import recorded from './fixtures/recorded-replies.json';

const content = toEngineContent(CONTENT);
const greedy = PERSONALITIES.greedy;
const SEED = 'SPEECH-SEED-SENTINEL';
const DECK = ['EVENT-SPEECH-a', 'EVENT-SPEECH-b', 'EVENT-SPEECH-c'];
const CLASSES = [
  'main-character',
  'rival',
  'nurse-joy',
  'researcher',
  'bug-catcher',
  'team-rocket',
];
const SITUATIONS: Situation[] = ['game_start', 'catch_success', 'catch_fail', 'sold_pokemon'];
const SECRET_USABLE = ['lucky-egg', 'repel', 'pickpocket', 'potion', 'battle-ticket', 'sticky-web'];

const seatOf = (classId: string) => ({
  classId,
  starterSpeciesId: content.classes.find((entry) => entry.id === classId)!.starterSpeciesIds[0]!,
});

/** 2 to 4 seats, human-controlled with the Social window open so chats happen, each holding secret items. */
function game(index: number): GameState {
  const seatCount = 2 + (index % 3);
  const seats = Array.from({ length: seatCount }, (_, seatIndex) => ({
    actorId: `player-${seatIndex}`,
    seatIndex,
    ...seatOf(CLASSES[(index + seatIndex) % CLASSES.length]!),
    controller: 'human' as const,
  }));
  const state = createGame(
    createGameConfig({ seats, seed: `${SEED}-${index}`, lapTarget: 3, socialWindow: true }),
    content,
  );
  for (const player of state.players) {
    for (let n = 0; n < 2; n++) {
      player.items.push({
        instanceId: `SENTINEL-${player.seatIndex}-${n}`,
        itemId: SECRET_USABLE[(index + player.seatIndex + n) % SECRET_USABLE.length]!,
        name: `SENTINEL-name-${player.seatIndex}-${n}`,
        visibility: 'secret',
      });
    }
    player.privateResults.push({ kind: 'peek', eventId: `SENTINEL-peek-${player.seatIndex}` });
  }
  state.eventDeck = { drawPile: [...DECK], discardPile: [] };
  return state;
}

function step(state: GameState, pick: (n: number) => number) {
  const automatic = advanceAutomatically(state);
  if (automatic.records.length === 1) return automatic;
  const seatIndex = pendingDecision(state)!.seatIndex;
  const enabled = legalActions(state, seatIndex).enabled;
  const choice = enabled[pick(enabled.length)]!;
  // A seat numbers its own feed: chats it took no part in leave no gap (§4.8).
  const revision = observe(state, seatIndex).public.stateRevision;
  const result = applyAction(state, {
    actorId: pendingDecision(state)!.actorId,
    actionSeq: revision + 1,
    stateRevisionBefore: revision,
    kind: choice.kind,
    payload: choice.payload,
  });
  if ('rejected' in result) throw new Error(result.reason);
  return result;
}

const brief = (
  observation: Observation,
  events: readonly SeatEvent[],
  situation: Situation,
  addressedSeat?: number,
) =>
  buildSpeechBrief({
    observation,
    events,
    situation,
    addressedSeat,
    personality: greedy,
    content,
    voice: VOICE,
  });

/** Everything in a brief that would be a leak, as plain strings to look for. */
function leaks(
  json: string,
  state: GameState,
  seat: number,
  publicNames: readonly string[],
): string[] {
  const found: string[] = [];
  const secretNames = state.players
    .flatMap((player) => player.items.filter((item) => item.visibility === 'secret'))
    .map((item) => content.items.find((entry) => entry.id === item.itemId)!.name)
    .filter((name) => !publicNames.includes(name));
  for (const needle of ['SENTINEL', SEED, state.rng.state, ...DECK, ...secretNames]) {
    if (json.includes(needle)) found.push(needle);
  }
  if (/\p{N}/u.test(json)) found.push('digit');
  for (const key of ['balls', 'items', 'private_results', 'chats', 'seed', 'rng', 'draw']) {
    if (json.includes(`"${key}"`)) found.push(`key ${key}`);
  }
  for (const topic of ['truce', 'point_leader', 'use_item', 'hold_item']) {
    if (json.includes(topic)) found.push(`chat ${topic} (seat ${seat})`);
  }
  return found;
}

describe('speech brief (§4.1, §4.8, §5.4, §8)', () => {
  test('across 25 seeded 2 to 4 seat games, no brief for any seat, target and situation leaks a secret, a chat or a digit', () => {
    let briefs = 0;
    let withEvents = 0;
    const seatCounts = new Set<number>();
    const chats = new Set<string>();
    for (let index = 0; index < 25; index++) {
      let state = game(index);
      seatCounts.add(state.players.length);
      let choices = createRng(index);
      const pick = (n: number) => {
        const draw = int(choices, n);
        choices = draw.rng;
        return draw.value;
      };
      const feeds = new Map<number, SeatEvent[]>(state.players.map((p) => [p.seatIndex, []]));
      for (let move = 1; move <= 60; move++) {
        const before = state;
        const result = step(before, pick);
        state = structuredClone(result.state);
        for (const player of state.players) {
          feeds
            .get(player.seatIndex)!
            .push(...eventsVisibleTo(before, result.events, player.seatIndex));
        }
        for (const event of result.events) if (event.kind === 'chat_sent') chats.add(event.topic);
        if (move % 3 !== 0) continue;
        for (const player of state.players) {
          const seat = player.seatIndex;
          const observation = observe(state, seat);
          const publicNames = observation.public.players.flatMap((p) =>
            p.knownItems.map((item) => item.name),
          );
          const others = state.players.map((p) => p.seatIndex).filter((s) => s !== seat);
          const situation = SITUATIONS[(move / 3 + seat) % SITUATIONS.length]!;
          for (const addressed of [undefined, ...others]) {
            const made = brief(observation, feeds.get(seat)!, situation, addressed);
            const json = JSON.stringify(made);
            expect(leaks(json, state, seat, publicNames), `game ${index} move ${move}`).toEqual([]);
            expect(made.recent_events.length).toBeLessThanOrEqual(3);
            briefs++;
            if (made.recent_events.length > 0) withEvents++;
          }
        }
      }
    }
    expect(seatCounts).toEqual(new Set([2, 3, 4]));
    expect(chats.size, 'random play reached chats').toBeGreaterThan(0);
    expect(withEvents).toBeGreaterThan(0);
    expect(briefs).toBeGreaterThan(1000);
  });

  test('the leak check fails when a sentinel, a secret item name, a digit or a chat topic is put into a brief', () => {
    const state = game(0);
    const observation = observe(state, 0);
    const clean = JSON.stringify(brief(observation, [], 'game_start'));
    expect(leaks(clean, state, 0, ['Lucky Egg'])).toEqual([]);
    const secret = content.items.find(
      (entry) => entry.id === state.players[0]!.items.at(-1)!.itemId,
    )!;
    for (const tainted of [
      `${clean} SENTINEL-name-0-0`,
      `${clean} ${secret.name}`,
      `${clean} ${DECK[0]}`,
      `${clean} 7`,
      `${clean} "balls"`,
      `${clean} hold_item`,
    ]) {
      expect(leaks(tainted, state, 0, ['Lucky Egg']), tainted).not.toEqual([]);
    }
  });

  test('a brief reads only public data: planting sentinels in the seat’s own hand, Balls, peeks and chats changes nothing', () => {
    const state = game(1);
    const observation = observe(state, 0);
    const planted = structuredClone(observation);
    planted.own = {
      seatIndex: 0,
      items: [
        { instanceId: 'SENTINEL-A', itemId: 'repel', name: 'SENTINEL-B', visibility: 'secret' },
      ],
      balls: { poke: 91, great: 92, ultra: 93 },
      privateResults: [{ kind: 'peek', eventId: 'SENTINEL-C' }],
      chats: [
        { fromSeatIndex: 1, toSeatIndex: 0, topic: 'trade', globalTurnNo: 1 },
        { fromSeatIndex: 0, toSeatIndex: 1, topic: 'hold_item', itemId: 'repel', globalTurnNo: 2 },
      ],
    };
    expect(brief(planted, [], 'catch_fail', 1)).toEqual(brief(observation, [], 'catch_fail', 1));
  });

  test('only public events become sentences, three at most, with no amounts; hostile items, chats and item UIDs are never told', () => {
    const state = game(2);
    const observation = observe(state, 0);
    const pokemon = observation.public.players[1]!.team[0]!;
    const feed: SeatEvent[] = [
      { kind: 'hostile_item_used', userSeatIndex: 1, targetSeatIndex: 0, itemId: 'repel' },
      { kind: 'chat_sent', fromSeatIndex: 1, toSeatIndex: 0, topic: 'trade' },
      { kind: 'uid_created', instanceId: 'SENTINEL-item', entity: 'item', ownerId: 'player-0' },
      { kind: 'uid_destroyed', instanceId: 'SENTINEL-item', entity: 'item', reason: 'used' },
      { kind: 'random_result', purpose: 'shuffle:events', result: DECK, drawCounter: 1 },
    ];
    expect(brief(observation, feed, 'game_start').recent_events).toEqual([]);
    const told: SeatEvent[] = [
      {
        kind: 'uid_created',
        instanceId: pokemon.instanceId,
        entity: 'pokemon',
        ownerId: 'player-1',
      },
      {
        kind: 'coin_transfer',
        source: { kind: 'bank' },
        destination: { kind: 'player', actorId: 'player-0' },
        amount: 5,
        reason: 'start_income',
      },
      {
        kind: 'coin_transfer',
        source: { kind: 'player', actorId: 'player-0' },
        destination: { kind: 'player', actorId: 'player-1' },
        amount: 31,
        reason: 'pvp_reward',
      },
      { kind: 'final_table_round', triggerSeatIndex: 0, targetOwnTurnNo: 4 },
    ];
    const events = brief(observation, [...feed, ...told], 'game_start').recent_events;
    expect(events).toHaveLength(3);
    expect(events.at(-1)).toBe('The final table round began.');
    expect(events[0]).toMatch(/passed Start and was paid\.$/);
    expect(events.join(' ')).not.toMatch(/\d|Repel|SENTINEL/);
  });

  test('standing, Lap stage and the addressed seat are words; a bad addressed seat or a missing voice entry is refused', () => {
    const state = game(1);
    state.players[0]!.coins = 30;
    state.players[1]!.coins = 12;
    state.players[2]!.coins = 30;
    const seen = (seat: number) => brief(observe(state, seat), [], 'catch_success', (seat + 1) % 3);
    expect(seen(0).speaker.coins).toBe('level');
    expect(seen(1).speaker.coins).toBe('behind');
    expect(seen(1).addressed?.coins).toBe('level');
    state.players[0]!.coins = 40;
    expect(seen(0).speaker.coins).toBe('leading');
    expect(seen(0).lap_stage).toBe('first lap');
    expect(seen(0).addressed).toEqual({ name: seen(1).speaker.name, coins: 'behind' });
    expect(() => brief(observe(state, 0), [], 'game_start', 0)).toThrow(RangeError);
    expect(() => brief(observe(state, 0), [], 'game_start', 9)).toThrow(RangeError);
    expect(() => brief(observe(state, 0), [], 'fallback_notice')).toThrow(/no topic/);
  });

  test('a brief stays inside the Jev state size budget and states its limits only in the instruction', () => {
    const made = JSON.stringify(brief(observe(game(5), 0), [], 'game_start', 1));
    expect(made.length / 4).toBeLessThan(500);
    expect(SPEECH_INSTRUCTION).toContain(String(SPEECH_MAX_CHARS));
    expect(made).not.toContain(String(SPEECH_MAX_CHARS));
  });
});

describe('output screen (§4.8, §5.7, §8)', () => {
  // Seat 0 is the Main Character; Rival, Nurse Joy and Researcher bring public class items.
  const state = createGame(
    createGameConfig({
      seats: ['main-character', 'rival', 'nurse-joy', 'researcher'].map((classId, seatIndex) => ({
        actorId: `player-${seatIndex}`,
        seatIndex,
        ...seatOf(classId),
        controller: 'ai' as const,
      })),
      seed: 'screen',
      lapTarget: 3,
    }),
    content,
  );
  const speech: SpeechBrief = brief(observe(state, 0), [], 'catch_success', 1);
  const screen = (reply: string) => screenSpeech(reply, speech, content);

  test('the public items of the brief are the utility class items every seat can see; Ball class items stay in the pouch', () => {
    expect(speech.public_items).toEqual(['Lucky Egg', 'Potion', 'Price Shield']);
  });

  test('plain in-voice lines pass, trimmed', () => {
    for (const line of recorded.safe) expect(screen(` ${line} `)).toEqual({ ok: true, text: line });
  });

  test('a utility item is allowed only while it is public in the brief', () => {
    expect(screen('That Lucky Egg looks lovely on you.').ok).toBe(true);
    expect(screen('That Pickpocket looks lovely on you.')).toEqual({
      ok: false,
      reason: 'item_name',
    });
  });

  test('length is checked in characters: 140 passes, 141 fails', () => {
    const line = (length: number) =>
      `${'Good luck everyone. '.repeat(10)}`.slice(0, length - 1) + '!';
    expect(screen(line(SPEECH_MAX_CHARS)).ok).toBe(true);
    expect(screen(line(SPEECH_MAX_CHARS + 1))).toEqual({ ok: false, reason: 'too_long' });
  });

  const unsafe = recorded.unsafe;
  test('the recorded set has at least 30 adversarial replies across every category', () => {
    expect(unsafe.length).toBeGreaterThanOrEqual(30);
    expect(new Set(unsafe.map((entry) => entry.category))).toEqual(
      new Set([
        'quoted instruction',
        'hidden item',
        'number bait',
        'promise bait',
        'format',
        'foreign species',
        'echo',
      ]),
    );
  });

  test.each(unsafe.map((entry) => [entry.id, entry] as const))('%s is rejected', (_id, entry) => {
    expect(screen(entry.reply)).toEqual({ ok: false, reason: entry.reason });
  });

  test.each(unsafe.map((entry) => [entry.id, entry] as const))(
    '%s becomes a Greedy bank line, never the reply',
    (_id, entry) => {
      const spoken = resolveSpeech({
        reply: entry.reply,
        brief: speech,
        content,
        personalityId: 'greedy',
        rng: createRng('presentation'),
      });
      if (spoken.kind !== 'bank') throw new Error('expected a bank line');
      expect(spoken.rejection).toBe(entry.reason);
      expect(LINES.catch_success.map((line) => line.text)).toContain(spoken.selection.template);
    },
  );

  test('an accepted line never repeats the instruction or the personality text word for word', () => {
    for (const text of [SPEECH_INSTRUCTION, speech.speaker.personality.text, speech.world]) {
      const sentence = text.split(/[.;]/)[0]!;
      expect(screen(sentence).ok, sentence).toBe(false);
    }
  });

  test('a long line over the limit, an empty reply and a missing reply fall back to the bank', () => {
    const rng = createRng('late');
    const args = { brief: speech, content, personalityId: 'greedy', rng };
    expect(resolveSpeech({ ...args, reply: 'a'.repeat(141) })).toMatchObject({
      kind: 'bank',
      rejection: 'too_long',
    });
    expect(resolveSpeech({ ...args, reply: null })).toMatchObject({ kind: 'bank' });
    expect(resolveSpeech({ ...args, reply: null }).rejection).toBeUndefined();
  });

  test('an accepted reply is used as written and leaves the presentation RNG untouched', () => {
    const rng = createRng('keep');
    const spoken = resolveSpeech({
      reply: recorded.safe[0]!,
      brief: speech,
      content,
      personalityId: 'greedy',
      rng,
    });
    expect(spoken).toEqual({ kind: 'haiku', text: recorded.safe[0], rng });
  });

  test('the bank pick is seeded, deterministic and advances the presentation RNG', () => {
    const run = () =>
      resolveSpeech({
        reply: 'I promise to win.',
        brief: speech,
        content,
        personalityId: 'greedy',
        rng: createRng('seeded'),
      });
    const first = run();
    expect(run()).toEqual(first);
    if (first.kind !== 'bank') throw new Error('expected a bank line');
    expect(first.rng).toEqual(first.selection.rng);
    expect(first.rng).not.toEqual(createRng('seeded'));
  });

  test('a personality without lines is silent: no error, no generated text, the RNG untouched', () => {
    const rng = createRng('quiet');
    for (const reply of ['I promise to win.', null, recorded.unsafe[0]!.reply]) {
      expect(
        resolveSpeech({ reply, brief: speech, content, personalityId: 'unwritten', rng }),
      ).toMatchObject({ kind: 'silence', rng });
    }
  });
});
