import { expect, test } from 'vitest';
import {
  actionRecordSchema,
  actionVisibleTo,
  actionVisibleToSpectator,
  advanceAutomatically,
  aiSpeechEventSchema,
  applyAction,
  createGame,
  createGameConfig,
  createGameLog,
  createRng,
  deserialize,
  eventsVisibleToSpectator,
  fixtureSchema,
  gameLogSchema,
  int,
  legalActions,
  observe,
  observeSpectator,
  pendingDecision,
  resume,
  serialize,
  stateHash,
  verifyReplay,
  type ActionRecord,
  type AiSpeechEvent,
  type GameLog,
  type GameState,
} from './index.ts';
import { replay } from './pipeline.ts';
import fixture from './fixtures/start-of-game-2p.json';

const SEED = 'SEED-SENTINEL';
const DECK = ['EVENT-SENTINEL-a', 'EVENT-SENTINEL-b', 'EVENT-SENTINEL-c'];

/** A game of 2–4 seats; `human` makes seat 0 a human, otherwise every seat is an AI. */
function newGame(seats: number, seed: string | number, human = false, social = false): GameState {
  const scenario = fixtureSchema.parse(fixture).state;
  const content = structuredClone(scenario.content);
  content.classes.push(
    {
      id: 'team-rocket',
      name: 'Team Rocket',
      starterSpeciesIds: ['eevee'],
      classItemId: 'pickpocket',
    },
    { id: 'trainer-x', name: 'Trainer X', starterSpeciesIds: ['eevee'], classItemId: 'repel' },
  );
  const classes = ['main-character', 'rival', 'team-rocket', 'trainer-x'];
  const config = createGameConfig({
    seats: classes.slice(0, seats).map((classId, seatIndex) => ({
      actorId: `player-${seatIndex}`,
      seatIndex,
      classId,
      controller: human && seatIndex === 0 ? ('human' as const) : ('ai' as const),
    })),
    seed,
    lapTarget: 2,
    ...(social && { socialWindow: true }),
  });
  return createGame(config, content);
}

/** Secrets of every kind in every seat: hands, Ball pouches, peek results, chats and deck order. */
function plantSecrets(state: GameState, tag: string): void {
  const usable = ['lucky-egg', 'repel', 'pickpocket', 'potion'];
  for (const player of state.players) {
    for (let n = 0; n < 2; n++) {
      player.items.push({
        instanceId: `${tag}-ITEM-${player.seatIndex}-${n}`,
        itemId: usable[(player.seatIndex + n) % usable.length]!,
        name: `${tag}-NAME-${player.seatIndex}-${n}`,
        visibility: 'secret',
      });
    }
    player.balls = { poke: 1337, great: 1338, ultra: 1339 };
    player.privateResults = [{ kind: 'peek', eventId: `${tag}-PEEK-${player.seatIndex}` }];
  }
  state.chats = [
    {
      seats: [0, 1],
      messages: [
        {
          fromSeatIndex: 0,
          toSeatIndex: 1,
          topic: 'hold_item',
          itemId: `${tag}-CHAT`,
          globalTurnNo: 0,
        },
      ],
    },
  ];
}

/** Names every secret item after its owner, so a leak of it is detectable after random play too. */
function secretsOf(...states: GameState[]): string[] {
  return states.flatMap((state) =>
    state.players
      .flatMap((player) => player.items.filter((item) => item.visibility === 'secret'))
      .flatMap((item) => [`"${item.instanceId}"`, item.name]),
  );
}

function step(state: GameState, pick: (n: number) => number) {
  const automatic = advanceAutomatically(state);
  if (automatic.records.length === 1) return automatic;
  const seatIndex = pendingDecision(state)!.seatIndex;
  const enabled = legalActions(state, seatIndex).enabled;
  const choice = enabled[pick(enabled.length)]!;
  const result = applyAction(state, {
    actorId: pendingDecision(state)!.actorId,
    actionSeq: state.stateRevision + 1,
    stateRevisionBefore: state.stateRevision,
    kind: choice.kind,
    payload: choice.payload,
  });
  if ('rejected' in result) throw new Error(result.reason);
  return { state: result.state, records: [result.record], events: result.events };
}

const LEAKY_KEYS =
  /"(own|balls|privateResults|chats|chatsSent|rng|cursor|seed|rngVersion|eventDeck|drawPile)":|"(poke|great|ultra)":/;

// 25 invariant-free full games take ~3 s alone; the default 5 s timed out under load (ET-05), and a red
// leak sweep gets ignored as noise. The sweep keeps all 25 games; only the budget is named.
const SPECTATOR_SWEEP_MS = 60_000;

test(
  'no spectator view, event or record of 25 seeded all-AI games of 2–4 seats holds a secret of any seat (§4.1, §4.8, §5.4, §8)',
  () => {
    const kinds = new Set<string>();
    let views = 0;
    for (let game = 0; game < 25; game++) {
      let state = newGame(2 + (game % 3), `${SEED}-${game}`);
      plantSecrets(state, 'S');
      let choices = createRng(game);
      const pick = (n: number) => {
        const draw = int(choices, n);
        choices = draw.rng;
        return draw.value;
      };
      let shown = 0;
      for (let move = 1; move <= 60; move++) {
        const before = state;
        const result = step(before, pick);
        state = structuredClone(result.state);
        // A bought secret item gets a sentinel name too, so its leak is detectable.
        for (const player of state.players) {
          for (const item of player.items) {
            if (item.visibility === 'secret') item.name = `S-NAME-${item.instanceId}`;
          }
        }
        const record = result.records[0]!;
        const secrets = [
          ...secretsOf(before, state),
          `"${before.rng.state}"`,
          `"${state.rng.state}"`,
          ...DECK,
          SEED,
        ];
        for (const event of result.events) kinds.add(event.kind);

        const events = eventsVisibleToSpectator(before, result.events);
        const seen = actionVisibleToSpectator(before, record, shown)!;
        expect(seen.events).toEqual(events);
        expect(seen.action.actionSeq).toBe(shown + 1);
        shown++;
        const feed = JSON.stringify([events, seen]);
        for (const secret of secrets) expect(feed).not.toContain(secret);
        for (const event of events)
          expect(['hostile_item_used', 'chat_sent']).not.toContain(event.kind);
        expect(feed).not.toContain('"offerId"');
        expect(feed).not.toContain('"order"');
        // The drawn card is public; undealt cards remain hidden.

        const projection = { ...state };
        projection.eventDeck = { drawPile: [...DECK], discardPile: [] };
        const view = observeSpectator(projection);
        views++;
        expect(view.public.stateRevision).toBe(shown);
        const text = JSON.stringify(view);
        for (const secret of secrets) expect(text).not.toContain(secret);
        expect(text).not.toMatch(LEAKY_KEYS);
        expect(view).not.toHaveProperty('own');
        // Control: the public facts are there.
        for (const player of state.players) {
          expect(view.public.players[player.seatIndex]).toMatchObject({
            coins: player.coins,
            itemCount: player.items.length,
            knownItems: player.items.filter((item) => item.visibility === 'public'),
          });
        }
      }
    }
    expect(views).toBe(1500);
    // Random play exercised the events the filter exists for.
    expect(kinds).toContain('hostile_item_used');
    expect(kinds).toContain('uid_created');
    expect(kinds).toContain('coin_transfer');
  },
  SPECTATOR_SWEEP_MS,
);

test('two states with the same public history and different secrets give the identical spectator view (§4.1)', () => {
  for (let game = 0; game < 25; game++) {
    let state = newGame(2 + (game % 3), game);
    plantSecrets(state, 'A');
    let choices = createRng(game);
    const pick = (n: number) => {
      const draw = int(choices, n);
      choices = draw.rng;
      return draw.value;
    };
    for (let move = 1; move <= 40; move++) {
      state = step(state, pick).state;
      const twin = structuredClone(state);
      let n = 0;
      for (const player of twin.players) {
        player.items = player.items.map((item) =>
          item.visibility === 'secret'
            ? { ...item, instanceId: `B-${n++}`, name: 'B-NAME', itemId: 'potion' }
            : item,
        );
        player.balls = { poke: 1, great: 2, ultra: 3 };
        player.privateResults = [{ kind: 'peek', eventId: 'B-PEEK' }];
      }
      twin.chats = [];
      twin.eventDeck = { drawPile: ['B-1'], discardPile: ['B-2'] };
      twin.rng = { ...twin.rng, state: 'B-RNG' };
      twin.config = { ...twin.config, seed: 'B-SEED' };
      expect(observeSpectator(twin)).toEqual(observeSpectator(state));
    }
  }
});

/** Plays a human seat 0 and an AI seat 1 to seat 0's open Social window. */
function atSocial(seed: number): GameState {
  let state = newGame(2, seed, true, true);
  const pick = () => 0;
  while (!(
    state.phase.kind === 'social' &&
    state.activeSeatIndex === 0 &&
    legalActions(state, 0).enabled.some((choice) => choice.kind === 'chat')
  )) {
    state = step(state, pick).state;
  }
  return state;
}

test('a chat leaves the spectator feed and view identical to a game where it was skipped, with no gap (§4.8)', () => {
  const start = atSocial(5);
  const act = (state: GameState, kind: string, payload = {}) => {
    const result = applyAction(state, {
      actorId: 'player-0',
      actionSeq: state.stateRevision + 1,
      stateRevisionBefore: state.stateRevision,
      kind,
      payload,
    });
    if ('rejected' in result) throw new Error(result.reason);
    return result;
  };
  const feedOf = (plays: { before: GameState; record: ActionRecord }[]) => {
    const feed = [];
    for (const { before, record } of plays) {
      const seen = actionVisibleToSpectator(before, record, feed.length);
      if (seen) feed.push(seen);
    }
    return feed;
  };

  const chat = act(start, 'chat', { targetSeatIndex: 1, topic: 'hold_item', itemId: 'repel' });
  expect(chat.events.map((event) => event.kind)).toEqual(['chat_sent']);
  expect(actionVisibleToSpectator(start, chat.record, 0)).toBeNull();
  expect(eventsVisibleToSpectator(start, chat.events)).toEqual([]);
  const talked = act(chat.state, 'skip');
  const silent = act(start, 'skip');

  const withChat = feedOf([
    { before: start, record: chat.record },
    { before: chat.state, record: talked.record },
  ]);
  const without = feedOf([{ before: start, record: silent.record }]);
  expect(withChat).toEqual(without);
  expect(withChat).toHaveLength(1);
  expect(JSON.stringify(withChat)).not.toContain('chat');
  expect(talked.state.stateRevision).toBe(silent.state.stateRevision + 1);
  expect(observeSpectator(talked.state)).toEqual(observeSpectator(silent.state));
});

/** Seat 0 in Strategy holding a secret hostile item, with the class items of the 2-seat fixture. */
function strategy(itemId: string, seats = 2): GameState {
  const state = newGame(seats, 4);
  state.phase = { kind: 'strategy' };
  state.globalTurnNo = 1;
  state.players[0]!.ownTurnNo = 1;
  state.turnBudgets = { tacticalAction: 1, catchAttempt: 1, pokemonAbility: 1 };
  state.players[0]!.items.push({
    instanceId: 'SECRET-0',
    itemId,
    name: 'SECRET-0',
    visibility: 'secret',
  });
  return state;
}

test('a hostile item use shows a spectator only its public effect, even in a two-seat game (§4.1, §4.4)', () => {
  const before = strategy('pickpocket');
  const result = applyAction(before, {
    actorId: 'player-0',
    actionSeq: 1,
    stateRevisionBefore: 0,
    kind: 'use_item',
    payload: { itemInstanceId: 'SECRET-0', targetSeatIndex: 1 },
  });
  if ('rejected' in result) throw new Error(result.reason);
  expect(result.events.map((event) => event.kind)).toContain('hostile_item_used');
  const seen = actionVisibleToSpectator(before, result.record, 0)!;
  expect(seen.events.map((event) => event.kind)).toEqual(['coin_transfer']);
  expect(observeSpectator(result.state).public.attackHistory).toEqual([]);
  expect(seen.action.payload).toEqual({});
  expect(eventsVisibleToSpectator(before, result.events)).toEqual(seen.events);
});

test('a public class item keeps its ID in the spectator feed, a bought item does not (§4.1, §4.6)', () => {
  const egg = strategy('repel');
  egg.activeSeatIndex = 1;
  egg.players[1]!.ownTurnNo = 1;
  const eggId = egg.players[1]!.items[0]!.instanceId;
  const used = applyAction(egg, {
    actorId: 'player-1',
    actionSeq: 1,
    stateRevisionBefore: 0,
    kind: 'use_item',
    payload: { itemInstanceId: eggId },
  });
  if ('rejected' in used) throw new Error(used.reason);
  const seen = actionVisibleToSpectator(egg, used.record, 0)!;
  expect(seen.action.payload).toEqual({ itemInstanceId: eggId });
  expect(seen.events.map((event) => event.kind)).toEqual(['uid_destroyed']);
});

const speech: AiSpeechEvent = {
  kind: 'ai_speech',
  speakerSeatIndex: 1,
  addressedSeatIndex: 0,
  source: 'haiku',
  lineId: 'greedy-taunt-1',
  text: 'Nice roll. Shame about the rent.',
  globalTurnNo: 3,
};

/** A mid-game all-AI save: the log of a game played 30 accepted actions in. */
function playedGame(actions: number): { state: GameState; log: GameLog } {
  let state = newGame(3, 11);
  let log = createGameLog(state);
  let choices = createRng(11);
  const pick = (n: number) => {
    const draw = int(choices, n);
    choices = draw.rng;
    return draw.value;
  };
  for (let i = 0; i < actions && state.phase.kind !== 'finished'; i++) {
    const result = step(state, pick);
    state = result.state;
    log = { ...log, actions: [...log.actions, ...result.records] };
  }
  return { state, log };
}

test('ai_speech round-trips through save and load in dialogueEvents and changes no state or replay (§5.7, §6.7, §6.8)', () => {
  const game = playedGame(30);
  const talking = { state: game.state, log: { ...game.log, dialogueEvents: [speech] } };
  const loaded = deserialize(serialize(talking));
  expect(loaded.log.dialogueEvents).toEqual([speech]);
  expect(stateHash(loaded.state)).toBe(stateHash(game.state));
  expect(verifyReplay(loaded)).toEqual(verifyReplay(game));
  expect(verifyReplay(loaded).pass).toBe(true);
  expect(stateHash(replay(talking.log))).toBe(stateHash(replay(game.log)));
  expect(resume(loaded).waitingFor).toEqual(resume(game).waitingFor);
});

test('ai_speech is rejected anywhere but dialogueEvents, and when malformed (§5.7)', () => {
  const game = playedGame(5);
  const record = { ...game.log.actions[0]!, events: [speech] } as unknown as ActionRecord;
  expect(actionRecordSchema.safeParse(record).success).toBe(false);
  expect(() =>
    serialize({ ...game, log: { ...game.log, actions: [record, ...game.log.actions.slice(1)] } }),
  ).toThrow();
  const withSpeech = (event: unknown) =>
    gameLogSchema.safeParse({ ...game.log, dialogueEvents: [event] }).success;
  expect(withSpeech(speech)).toBe(true);
  expect(withSpeech({ ...speech, text: '' })).toBe(false);
  expect(withSpeech({ ...speech, text: 'x'.repeat(281) })).toBe(false);
  expect(withSpeech({ ...speech, source: 'jev' })).toBe(false);
  expect(withSpeech({ ...speech, extra: 1 })).toBe(false);
  expect(withSpeech({ ...speech, speakerSeatIndex: 7 })).toBe(false);
  expect(withSpeech({ ...speech, addressedSeatIndex: 7 })).toBe(false);
  expect(withSpeech({ ...speech, addressedSeatIndex: 1 })).toBe(false);
  const minimal = {
    kind: 'ai_speech',
    speakerSeatIndex: 1,
    source: 'bank',
    text: 'Hm.',
    globalTurnNo: 0,
  };
  expect(withSpeech(minimal)).toBe(true);
  expect(aiSpeechEventSchema.safeParse(speech).success).toBe(true);
});

test('a finished and a mid-game all-AI save resume, waiting for an AI seat or the engine, never a human (§3.1, §6.9)', () => {
  const finished = playedGame(100000);
  expect(finished.state.phase.kind).toBe('finished');
  expect(resume(deserialize(serialize(finished))).waitingFor).toEqual({ kind: 'finished' });

  const seen = new Set<string>();
  for (let actions = 0; actions < 80; actions += 3) {
    const game = playedGame(actions);
    const { waitingFor } = resume(deserialize(serialize(game)));
    seen.add(waitingFor.kind);
    if (waitingFor.kind === 'decision') {
      const seat = game.state.config.seats.find(
        (entry) => entry.seatIndex === waitingFor.seatIndex,
      );
      expect(seat?.controller).toBe('ai');
    }
  }
  expect(seen).toEqual(new Set(['decision', 'engine_result']));
});

test('the spectator view equals a seat’s public view apart from its own revision (§4.1)', () => {
  const state = newGame(4, 9);
  plantSecrets(state, 'Q');
  for (const player of state.players) {
    expect(observeSpectator(state).public).toEqual(observe(state, player.seatIndex).public);
  }
});

test('a spectator never inherits a seat’s hostile attack history or a secret shield (§4.1, D6)', () => {
  const before = strategy('pickpocket', 3);
  before.players[1]!.armedShield = { scope: 'price', visibility: 'secret' };
  const result = applyAction(before, {
    actorId: 'player-0',
    actionSeq: 1,
    stateRevisionBefore: 0,
    kind: 'use_item',
    payload: { itemInstanceId: 'SECRET-0', targetSeatIndex: 1 },
  });
  if ('rejected' in result) throw new Error(result.reason);
  expect(result.events.map((event) => event.kind)).toContain('protection_applied');
  expect(observe(result.state, 0).public.attackHistory).toHaveLength(1);
  expect(observeSpectator(before).public.players[1]).not.toHaveProperty('armedShield');
  expect(observeSpectator(result.state).public.attackHistory).toEqual([]);
  expect(eventsVisibleToSpectator(before, result.events)).toEqual([]);
  const twin = structuredClone(result.state);
  delete twin.attackHistory;
  expect(observe(twin, 2)).toEqual(observe(result.state, 2));
  expect(observeSpectator(twin)).toEqual(observeSpectator(result.state));
});

function abilityStrategy(effect: 'vine_pull' | 'lucky_splash'): GameState {
  const state = strategy('repel');
  const speciesId = state.players[0]!.team[0]!.speciesId;
  state.content.species.find((species) => species.id === speciesId)!.ability = {
    name: effect,
    text: effect,
    effect,
    timing: 'OWN_STRATEGY',
  };
  state.players[1]!.routeProgress = 1;
  return state;
}

test('a hostile Ability’s target and protection stay private in the spectator feed, even with two seats (D6)', () => {
  const before = abilityStrategy('vine_pull');
  before.players[1]!.armedShield = { scope: 'price', visibility: 'secret' };
  const result = applyAction(before, {
    actorId: 'player-0',
    actionSeq: 1,
    stateRevisionBefore: 0,
    kind: 'activate_ability',
    payload: { instanceId: before.players[0]!.team[0]!.instanceId, targetSeatIndex: 1 },
  });
  if ('rejected' in result) throw new Error(result.reason);
  expect(result.events.map((event) => event.kind)).toContain('protection_applied');
  const seen = actionVisibleToSpectator(before, result.record, 0)!;
  expect(seen.action.payload).not.toHaveProperty('targetSeatIndex');
  // The use is public; the block and the attempt are not (§4.1, C.3).
  expect(seen.events).toEqual([
    {
      kind: 'ability_activated',
      ownerId: 'player-0',
      instanceId: 'starter:0',
      effect: 'vine_pull',
    },
  ]);
  expect(observeSpectator(result.state).public.attackHistory).toEqual([]);
});

test('Lucky Splash reveals neither its die nor Ball gain to a spectator (§4.1, S13)', () => {
  const before = abilityStrategy('lucky_splash');
  const activated = applyAction(before, {
    actorId: 'player-0',
    actionSeq: 1,
    stateRevisionBefore: 0,
    kind: 'activate_ability',
    payload: { instanceId: before.players[0]!.team[0]!.instanceId },
  });
  if ('rejected' in activated) throw new Error(activated.reason);
  expect(activated.state.phase.kind).toBe('chance_roll');
  expect(observeSpectator(activated.state)).not.toHaveProperty('own');
  expect(observeSpectator(activated.state)).not.toHaveProperty('pendingDecision');
  const result = advanceAutomatically(activated.state);
  const seen = actionVisibleToSpectator(activated.state, result.records[0]!, 1)!;
  expect(seen.action.payload).not.toHaveProperty('value');
  expect(seen.events.map((event) => event.kind)).not.toContain('random_result');
  expect(seen.events.map((event) => event.kind)).not.toContain('ball_gained');
});

test('public PvP evidence omits internal sequence numbers and a battle window reveals no private shield or choices (§6.3, D6)', () => {
  const before = strategy('repel');
  for (const species of before.content.species) {
    species.ability = {
      name: 'Shell Guard',
      text: 'Guard',
      effect: 'shell_guard',
      timing: 'REACTION',
    };
  }
  const declared = applyAction(before, {
    actorId: 'player-0',
    actionSeq: 1,
    stateRevisionBefore: 0,
    kind: 'declare_pvp',
    payload: { targetSeatIndex: 1 },
  });
  if ('rejected' in declared) throw new Error(declared.reason);
  const seen = actionVisibleToSpectator(before, declared.record, 0)!;
  const attempt = seen.events.find((event) => event.kind === 'attack_attempt');
  expect(attempt).toMatchObject({ source: 'pvp_declaration', targetId: 'player-1' });
  expect(attempt).not.toHaveProperty('actionSeq');
  const accepted = applyAction(declared.state, {
    actorId: 'player-1',
    actionSeq: 2,
    stateRevisionBefore: 1,
    kind: 'respond_pvp',
    payload: { accept: true },
  });
  if ('rejected' in accepted) throw new Error(accepted.reason);
  expect(accepted.state.phase).toMatchObject({ kind: 'pvp', battle: { step: 'defender_window' } });
  const twin = structuredClone(accepted.state);
  twin.players[1]!.armedShield = { scope: 'price', visibility: 'secret' };
  const view = observeSpectator(twin);
  expect(view).toEqual(observeSpectator(accepted.state));
  expect(view).not.toHaveProperty('pendingDecision');
  expect(view).not.toHaveProperty('legalActions');
  expect(view.public.players[1]).not.toHaveProperty('armedShield');
});

test('a visible die leaves the RNG cursor out of every seat feed and the watcher feed, but not the log (§4.1, §8)', () => {
  const state = newGame(4, 255, true);
  const roll = advanceAutomatically(state);
  const die = advanceAutomatically(roll.state);
  const record = die.records[0]!;
  const draws = record.events.filter((event) => event.kind === 'random_result');
  expect(draws.length).toBeGreaterThan(0);
  // The raw log keeps the cursor so a replay can verify it.
  for (const draw of draws) expect(draw).toHaveProperty('drawCounter');
  const feeds = [
    ...state.players.map(({ seatIndex }) => actionVisibleTo(roll.state, record, seatIndex, 1)),
    actionVisibleToSpectator(roll.state, record, 1),
  ];
  expect(feeds).toHaveLength(5);
  for (const feed of feeds) {
    const seen = feed!.events.filter((event) => event.kind === 'random_result');
    expect(seen.length).toBeGreaterThan(0);
    for (const event of seen) expect(event).not.toHaveProperty('drawCounter');
  }
});
