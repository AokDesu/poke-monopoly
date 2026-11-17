import { expect, test } from 'vitest';
import {
  advanceAutomatically,
  applyAction,
  checkInvariants,
  createGame,
  createGameConfig,
  eventsVisibleTo,
  eventsVisibleToSpectator,
  fixtureSchema,
  legalActions,
  observe,
  observeSpectator,
  pendingDecision,
  type EngineEvent,
  type GameState,
} from './index.ts';
import { closePromisesAtGameEnd } from './promises.ts';
import fixture from './fixtures/start-of-game-2p.json';

type Controller = 'human' | 'ai';

/**
 * A game in seat order with `controllers`, on the first seat's Social window, having played own turn 1
 * with every other seat still on own turn 0, so the first seat is the one that offers.
 */
function game(controllers: Controller[] = ['human', 'ai'], seed = 4) {
  const scenario = fixtureSchema.parse(fixture).state;
  const content = structuredClone(scenario.content);
  for (const id of ['team-rocket', 'gym-trainer']) {
    content.classes.push({ id, name: id, starterSpeciesIds: ['eevee'], classItemId: 'pickpocket' });
  }
  const classes = ['main-character', 'rival', 'team-rocket', 'gym-trainer'];
  const state = createGame(
    createGameConfig({
      seats: controllers.map((controller, seatIndex) => ({
        actorId: `player-${seatIndex}`,
        seatIndex,
        classId: classes[seatIndex]!,
        controller,
      })),
      seed,
      lapTarget: 3,
      socialWindow: true,
    }),
    content,
  );
  state.phase = { kind: 'social' };
  state.globalTurnNo = 1;
  state.players[0]!.ownTurnNo = 1;
  state.turnBudgets = {
    tacticalAction: 1,
    catchAttempt: 1,
    pokemonAbility: 1,
    socialInteraction: 1,
  };
  return state;
}

function command(state: GameState, kind: string, payload: object = {}, seat?: number) {
  const actor = seat ?? pendingDecision(state)!.seatIndex;
  const revision = observe(state, actor).public.stateRevision;
  const action = {
    actorId: state.players[actor]!.actorId,
    actionSeq: revision + 1,
    stateRevisionBefore: revision,
    kind,
    payload,
  };
  const result = applyAction(state, action);
  // Every accepted or rejected step also passes the §8 invariants, promise closure included.
  expect(checkInvariants(state, action, result)).toEqual([]);
  return result;
}

function accepted(state: GameState, kind: string, payload: object = {}, seat?: number) {
  const result = command(state, kind, payload, seat);
  if ('rejected' in result) throw new Error(result.reason);
  return result;
}

/** Seat 0 offers or asks, and the responder accepts. */
function promise(state: GameState, target: number, direction: 'offer' | 'ask') {
  const offered = accepted(state, 'offer_promise', { targetSeatIndex: target, direction });
  return accepted(offered.state, 'respond', { answer: 'accept' }).state;
}

const PREFERRED = ['skip', 'roll', 'keep-die', 'finish-sell', 'skip-shop', 'release'];

/** The first choice in preference order: moves the turn on, never attacks or spends anything. */
function step(state: GameState): { state: GameState; events: EngineEvent[] } {
  const auto = advanceAutomatically(state);
  if (auto.records.length) return auto;
  const seat = pendingDecision(state)!.seatIndex;
  const choices = legalActions(state, seat).enabled;
  const choice =
    PREFERRED.map((id) => choices.find((entry) => entry.id === id)).find(Boolean) ?? choices[0]!;
  const result = accepted(state, choice.kind, choice.payload);
  return { state: result.state, events: result.events };
}

/** Plays until `until` holds, collecting every event; fails if the game ends or stalls first. */
function play(state: GameState, until: (state: GameState, events: EngineEvent[]) => boolean) {
  const events: EngineEvent[] = [];
  let current = state;
  for (let i = 0; i < 4000; i++) {
    const next = step(current);
    current = next.state;
    events.push(...next.events);
    if (until(current, next.events)) return { state: current, events };
    if (current.phase.kind === 'finished') return { state: current, events };
  }
  throw new Error('no progress');
}

const closed = <T extends { kind: string }>(events: T[]) =>
  events.filter((event) => event.kind === 'promise_closed');
const trust = (state: GameState, from: number, to: number) =>
  state.trust?.find((entry) => entry.fromSeatIndex === from && entry.toSeatIndex === to)?.value ??
  0;
/** At End of `seat`'s own turn `ownTurnNo`: the instant the promise must close, before the skip. */
const atEnd = (seat: number, ownTurnNo: number) => (state: GameState) =>
  state.phase.kind === 'end' &&
  state.activeSeatIndex === seat &&
  state.players[seat]!.ownTurnNo === ownTurnNo;

test.each([
  { name: 'a human promiser, two seats', controllers: ['human', 'ai'], direction: 'offer' },
  { name: 'an AI promiser, two seats', controllers: ['human', 'ai'], direction: 'ask' },
  { name: 'a human promiser, three seats', controllers: ['human', 'ai', 'ai'], direction: 'offer' },
  {
    name: 'an AI promiser, four seats',
    controllers: ['human', 'ai', 'ai', 'ai'],
    direction: 'ask',
  },
] as { name: string; controllers: Controller[]; direction: 'offer' | 'ask' }[])(
  'closes exactly at End of the promiser’s next own turn, with $name (C3 exit test, §4.8)',
  ({ controllers, direction }) => {
    const made = promise(game(controllers), 1, direction);
    const record = made.promises![0]!;
    const promiser = record.promiserSeatIndex;
    expect(record.closesOwnTurnNo).toBe(made.players[promiser]!.ownTurnNo + 1);
    // Still open at the End of every other turn, and at the End of every promiser turn before the closing one.
    const reached = play(made, atEnd(promiser, record.closesOwnTurnNo));
    expect(closed(reached.events)).toEqual([]);
    expect(reached.state.promises![0]!.settled).toBeUndefined();
    // The skip that ends that turn closes it, and nothing before it did.
    const ended = accepted(reached.state, 'skip');
    expect(closed(ended.events)).toEqual([
      {
        kind: 'promise_closed',
        promiserSeatIndex: promiser,
        recipientSeatIndex: record.recipientSeatIndex,
        outcome: 'kept',
        globalTurnNo: reached.state.globalTurnNo,
      },
    ]);
    expect(ended.state.promises![0]!.settled!.globalTurnNo).toBe(reached.state.globalTurnNo);
  },
);

test('a promise closes at the End of the promiser’s turn whatever the seat order (§4.2)', () => {
  // The human sits last: seat 0 is the third seat to play after the promise is made by the seat before it.
  const state = game(['ai', 'ai', 'human']);
  state.players[0]!.ownTurnNo = 0;
  state.players[2]!.ownTurnNo = 1;
  state.activeSeatIndex = 2;
  const made = promise(state, 0, 'ask');
  const record = made.promises![0]!;
  expect([record.promiserSeatIndex, record.recipientSeatIndex]).toEqual([0, 2]);
  const reached = play(made, atEnd(0, record.closesOwnTurnNo));
  expect(closed(reached.events)).toEqual([]);
  expect(closed(accepted(reached.state, 'skip').events)).toHaveLength(1);
});

test('an attack on the recipient breaks the promise: −2 trust, and the use stayed legal (§4.8, §4.6)', () => {
  const state = game();
  state.players[0]!.items.push({
    instanceId: 'item-ping',
    itemId: 'pickpocket',
    name: 'pickpocket',
    visibility: 'secret',
  });
  state.players[1]!.coins = 6;
  const made = promise(state, 1, 'offer');
  const strategy = accepted(made, 'skip').state;
  // The hostile use is legal while the promise is active: promises never change legality (§4.8).
  const use = legalActions(strategy, 0).enabled.find(
    (choice) => choice.kind === 'use_item' && choice.payload.itemInstanceId === 'item-ping',
  )!;
  expect(use).toBeDefined();
  const used = accepted(strategy, use.kind, use.payload);
  expect(used.events.some((event) => event.kind === 'hostile_item_used')).toBe(true);
  const reached = play(used.state, atEnd(0, 2));
  const ended = accepted(reached.state, 'skip');
  expect(closed([...reached.events, ...ended.events])).toEqual([
    expect.objectContaining({ outcome: 'broken', promiserSeatIndex: 0, recipientSeatIndex: 1 }),
  ]);
  // The recipient's trust in the promiser fell by 2; the promiser's trust in the recipient did not move.
  expect(trust(ended.state, 1, 0)).toBe(-2);
  expect(trust(ended.state, 0, 1)).toBe(0);
  expect(observe(ended.state, 1).own.trust).toEqual([{ seatIndex: 0, value: -2 }]);
  expect(observe(ended.state, 0).own.trust).toEqual([{ seatIndex: 1, value: 0 }]);
});

test('a shielded attempt still breaks the promise (§4.8, Appendix C.4 AC-2)', () => {
  const state = game();
  state.players[0]!.items.push({
    instanceId: 'item-ping',
    itemId: 'repel',
    name: 'repel',
    visibility: 'secret',
  });
  state.players[1]!.armedShield = { scope: 'price', visibility: 'public' };
  const strategy = accepted(promise(state, 1, 'offer'), 'skip').state;
  const use = legalActions(strategy, 0).enabled.find((choice) => choice.kind === 'use_item')!;
  const used = accepted(strategy, use.kind, use.payload);
  expect(used.events.some((event) => event.kind === 'protection_applied')).toBe(true);
  const reached = play(used.state, atEnd(0, 2));
  const ended = accepted(reached.state, 'skip');
  expect(closed(ended.events)[0]).toMatchObject({ outcome: 'broken' });
  expect(trust(ended.state, 1, 0)).toBe(-2);
});

test('an attack on a different seat, or before the promise, does not break it (§4.8)', () => {
  const state = game(['human', 'ai', 'ai']);
  const earlier = structuredClone(state);
  // An attempt on the recipient recorded before confirmation.
  earlier.attackHistory = [
    {
      kind: 'attack_attempt',
      attackId: 'pvp:0',
      actorId: 'player-0',
      targetId: 'player-1',
      source: 'pvp_declaration',
      actionSeq: 1,
      globalTurnNo: 1,
    },
  ];
  earlier.stateRevision = 1;
  const made = promise(earlier, 1, 'offer');
  made.attackHistory!.push({
    kind: 'attack_attempt',
    attackId: 'pvp:9',
    actorId: 'player-0',
    targetId: 'player-2',
    source: 'pvp_declaration',
    actionSeq: made.stateRevision + 1,
    globalTurnNo: 1,
  });
  const reached = play(made, atEnd(0, 2));
  const ended = accepted(reached.state, 'skip');
  expect(closed(ended.events)[0]).toMatchObject({ outcome: 'kept' });
});

test('kept with a public chance earns +1 trust; kept without one earns nothing (§4.8)', () => {
  // With a chance: both teams are battle-ready in the promiser's Strategy.
  const withChance = promise(game(), 1, 'offer');
  const strategy = accepted(withChance, 'skip').state;
  expect(strategy.promises![0]!.chance).toBe(true);
  const keptWith = accepted(play(strategy, atEnd(0, 2)).state, 'skip');
  expect(keptWith.state.promises![0]!.settled!.outcome).toBe('kept_with_chance');
  expect(trust(keptWith.state, 1, 0)).toBe(1);
  // Without one: the promiser has no battle-ready Pokémon, and holds nothing else public.
  const state = game();
  state.players[0]!.team = state.players[0]!.team.map((pokemon) => ({ ...pokemon, tired: true }));
  const noChance = promise(state, 1, 'offer');
  const strategyNo = accepted(noChance, 'skip').state;
  expect(strategyNo.promises![0]!.chance).toBeUndefined();
  const keptWithout = accepted(play(strategyNo, atEnd(0, 2)).state, 'skip');
  expect(keptWithout.state.promises![0]!.settled!.outcome).toBe('kept_without_chance');
  expect(trust(keptWithout.state, 1, 0)).toBe(0);
  expect(keptWithout.state.trust ?? []).toEqual([]);
});

test('a secret hostile item gives no chance: the chance reads public facts only (Q3)', () => {
  const state = game();
  state.players[0]!.team = state.players[0]!.team.map((pokemon) => ({ ...pokemon, tired: true }));
  state.players[0]!.items.push({
    instanceId: 'item-ping',
    itemId: 'repel',
    name: 'repel',
    visibility: 'secret',
  });
  const strategy = accepted(promise(state, 1, 'offer'), 'skip').state;
  expect(strategy.promises![0]!.chance).toBeUndefined();
  const open = structuredClone(state);
  open.players[0]!.items[open.players[0]!.items.length - 1]!.visibility = 'public';
  const publicStrategy = accepted(promise(open, 1, 'offer'), 'skip').state;
  expect(publicStrategy.promises![0]!.chance).toBe(true);
});

/** One more promise from seat 0 to seat 1, played to its close; `attack` has seat 0 hit seat 1 first. */
function round(from: GameState, attack: boolean): GameState {
  let state = structuredClone(from);
  state.phase = { kind: 'social' };
  state.activeSeatIndex = 0;
  state.players[0]!.ownTurnNo++;
  state.globalTurnNo++;
  state.turnBudgets = {
    tacticalAction: 1,
    catchAttempt: 1,
    pokemonAbility: 1,
    socialInteraction: 1,
  };
  state = promise(state, 1, 'offer');
  if (attack) {
    state.attackHistory = [
      ...(state.attackHistory ?? []),
      {
        kind: 'attack_attempt',
        attackId: `hostile:${state.stateRevision}`,
        actorId: 'player-0',
        targetId: 'player-1',
        source: 'hostile_item',
        actionSeq: state.stateRevision + 1,
        globalTurnNo: state.globalTurnNo,
      },
    ];
  }
  const strategy = accepted(state, 'skip').state;
  return accepted(play(strategy, atEnd(0, strategy.players[0]!.ownTurnNo + 1)).state, 'skip').state;
}

test('the +1 stops at +2 per pair, the −2 is not capped, and trust stays within −3..3 (§4.8)', () => {
  let state = game();
  const kept: number[] = [];
  for (let i = 0; i < 4; i++) {
    state = round(state, false);
    kept.push(trust(state, 1, 0));
  }
  expect(kept).toEqual([1, 2, 2, 2]);
  expect(state.trust).toEqual([{ fromSeatIndex: 1, toSeatIndex: 0, value: 2, keptGain: 2 }]);
  const broken: number[] = [];
  for (let i = 0; i < 3; i++) {
    state = round(state, true);
    broken.push(trust(state, 1, 0));
  }
  expect(broken).toEqual([0, -2, -3]);
  // The kept gain stays spent: a later kept promise earns nothing more, and trust climbs back only by gains.
  expect(state.trust![0]!.keptGain).toBe(2);
  state = round(state, false);
  expect(trust(state, 1, 0)).toBe(-3);
});

test('a game that ends inside the window closes the promise with no trust change (§4.8, §4.2)', () => {
  const made = promise(game(['human', 'ai', 'ai']), 1, 'offer');
  // The Final Table Round was announced after the offer: everyone's last turn comes before seat 0's closing one.
  made.finalTableRound = { triggerSeatIndex: 2, targetOwnTurnNo: 1 };
  made.players[1]!.ownTurnNo = 0;
  made.players[2]!.ownTurnNo = 0;
  made.activeSeatIndex = 2;
  made.phase = { kind: 'end' };
  made.players[2]!.ownTurnNo = 1;
  made.players[1]!.ownTurnNo = 1;
  const ended = accepted(made, 'skip');
  expect(ended.state.phase.kind).toBe('finished');
  expect(closed(ended.events)).toEqual([
    expect.objectContaining({ outcome: 'closed_by_game_end', promiserSeatIndex: 0 }),
  ]);
  expect(ended.state.promises![0]!.settled!.outcome).toBe('closed_by_game_end');
  expect(ended.state.trust ?? []).toEqual([]);
  // Nothing is left open, and settling again changes nothing.
  expect(closePromisesAtGameEnd(structuredClone(ended.state))).toEqual([]);
});

test('the opportunity flag and the kept split never reach a seat (§4.8 Privacy, §6.3)', () => {
  const state = game(['human', 'ai', 'ai']);
  const strategy = accepted(promise(state, 1, 'offer'), 'skip').state;
  expect(strategy.promises![0]!.chance).toBe(true);
  const reached = play(strategy, atEnd(0, 2));
  const ended = accepted(reached.state, 'skip');
  const seen = JSON.stringify(
    [0, 1, 2].map((seat) => ({
      view: observe(ended.state, seat),
      events: eventsVisibleTo(reached.state, ended.events, seat),
    })),
  );
  expect(seen).not.toMatch(/chance|kept_with|kept_without|acceptedActionSeq/);
  // The recipient sees the pair's evidence, with outcome `kept`, and nothing else.
  expect(observe(ended.state, 1).own.promises).toEqual([
    {
      promiserSeatIndex: 0,
      recipientSeatIndex: 1,
      createdGlobalTurnNo: 1,
      closesOwnTurnNo: 2,
      closed: { outcome: 'kept', globalTurnNo: reached.state.globalTurnNo },
    },
  ]);
  // The promiser sees the same, not the recipient's trust in it.
  expect(observe(ended.state, 0).own.trust!.every((entry) => entry.seatIndex !== 0)).toBe(true);
});

test('the closing event and trust reach the pair only, and spectators see none (§4.8, §5.4)', () => {
  const made = promise(game(['human', 'ai', 'ai']), 1, 'offer');
  const strategy = accepted(made, 'skip').state;
  const reached = play(strategy, atEnd(0, 2));
  const ended = accepted(reached.state, 'skip');
  const count = (seat: number) => closed(eventsVisibleTo(reached.state, ended.events, seat)).length;
  expect([count(0), count(1), count(2)]).toEqual([1, 1, 0]);
  expect(closed(eventsVisibleToSpectator(reached.state, ended.events))).toEqual([]);
  expect(observe(ended.state, 2).own.promises).toEqual([]);
  expect(observe(ended.state, 2).own.trust).toEqual([
    { seatIndex: 0, value: 0 },
    { seatIndex: 1, value: 0 },
  ]);
  expect(JSON.stringify(observeSpectator(ended.state))).not.toMatch(/trust|promise/);
});

test('settling spends nothing and moves no coin, item or Pokémon (§4.8 hard line)', () => {
  const made = promise(game(), 1, 'offer');
  const reached = play(accepted(made, 'skip').state, atEnd(0, 2));
  const ended = accepted(reached.state, 'skip');
  expect(ended.state.players.map((player) => [player.coins, player.items, player.team])).toEqual(
    reached.state.players.map((player) => [player.coins, player.items, player.team]),
  );
});
