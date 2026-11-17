import { expect, test } from 'vitest';
import { fc } from '@fast-check/vitest';
import {
  pendingDecision,
  actionVisibleTo,
  advanceAutomatically,
  applyAction,
  checkInvariants,
  createGame,
  createGameConfig,
  createGameLog,
  deserialize,
  actionVisibleToSpectator,
  eventsVisibleTo,
  eventsVisibleToSpectator,
  observeSpectator,
  fixtureSchema,
  legalActions,
  observe,
  replay,
  resume,
  serialize,
  verifyReplay,
  type ActionRecord,
  type GameState,
  type SeatActionRecord,
} from './index.ts';
import { promiseActive } from './promises.ts';
import { publicRevision } from './revision.ts';
import fixture from './fixtures/start-of-game-2p.json';

/** Seat 0 (human) in Social with its one interaction, having played `ownTurnNo` 1; the rest are AIs. */
function social(options: { seats?: 2 | 3 | 4; seed?: number } = {}) {
  const { seats = 2, seed = 4 } = options;
  const scenario = fixtureSchema.parse(fixture).state;
  const content = structuredClone(scenario.content);
  content.classes.push({
    id: 'team-rocket',
    name: 'Team Rocket',
    starterSpeciesIds: ['eevee'],
    classItemId: 'pickpocket',
  });
  content.classes.push({
    id: 'gym-trainer',
    name: 'Gym Trainer',
    starterSpeciesIds: ['eevee'],
    classItemId: 'pickpocket',
  });
  const seatList = [
    ...scenario.config.seats,
    { actorId: 'player-2', seatIndex: 2, classId: 'team-rocket', controller: 'ai' as const },
    { actorId: 'player-3', seatIndex: 3, classId: 'gym-trainer', controller: 'ai' as const },
  ].slice(0, seats);
  const state = createGame(
    createGameConfig({ seats: seatList, seed, lapTarget: 3, socialWindow: true }),
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

/** A command from `seat` (default: whoever the engine says acts) on the current revision. */
function command(state: GameState, kind: string, payload: object = {}, seat?: number) {
  const actor = seat ?? pendingDecision(state)!.seatIndex;
  // A seat numbers its command with the revision it observes (hidden records leave no gap, §4.8).
  const revision = observe(state, actor).public.stateRevision;
  return applyAction(state, {
    actorId: state.players[actor]!.actorId,
    actionSeq: revision + 1,
    stateRevisionBefore: revision,
    kind,
    payload,
  });
}

function accepted(state: GameState, kind: string, payload: object = {}, seat?: number) {
  const result = command(state, kind, payload, seat);
  if ('rejected' in result) throw new Error(result.reason);
  return result;
}

const kinds = (state: GameState, seat: number) =>
  legalActions(state, seat).enabled.map((choice) => choice.kind);
const offers = (state: GameState, seat = 0) =>
  legalActions(state, seat).enabled.filter((choice) => choice.kind === 'offer_promise');
const offer = (state: GameState, target = 1, direction: 'offer' | 'ask' = 'offer') =>
  accepted(state, 'offer_promise', { targetSeatIndex: target, direction });
const answer = (state: GameState, choice: 'accept' | 'reject') =>
  accepted(state, 'respond', { answer: choice });

test('the human is offered a promise to each AI in both directions (Q2a, §4.8)', () => {
  const two = offers(social());
  expect(two.map((choice) => choice.payload)).toEqual([
    { targetSeatIndex: 1, direction: 'offer' },
    { targetSeatIndex: 1, direction: 'ask' },
  ]);
  expect(two.map((choice) => choice.id)).toEqual([
    'offer-promise:seat-1:offer',
    'offer-promise:seat-1:ask',
  ]);
  expect(offers(social({ seats: 3 }))).toHaveLength(4);
  // Only the active human in Social with the interaction unspent; never an AI, never off-window.
  expect(offers(social(), 1)).toEqual([]);
  const strategy = social();
  strategy.phase = { kind: 'strategy' };
  expect(offers(strategy)).toEqual([]);
  const spent = social();
  spent.turnBudgets.socialInteraction = 0;
  expect(offers(spent)).toEqual([]);
  const off = social();
  off.config.socialWindow = false;
  expect(offers(off)).toEqual([]);
});

test('a chat spends the interaction, so no promise follows it, and the reverse (§4.2)', () => {
  const chatted = accepted(social(), 'chat', { targetSeatIndex: 1, topic: 'truce' }).state;
  expect(offers(chatted)).toEqual([]);
  const answered = answer(offer(social()).state, 'reject').state;
  expect(kinds(answered, 0)).toEqual(['skip']);
});

test('while an offer is pending only the responder acts: accept or reject, nothing else (§4.2)', () => {
  const before = social({ seats: 3 });
  const { state, events } = offer(before);
  expect(state.pendingResponse).toEqual({
    kind: 'promise_offer',
    initiatorSeatIndex: 0,
    responderSeatIndex: 1,
    direction: 'offer',
  });
  expect(events).toEqual([
    { kind: 'promise_offered', initiatorSeatIndex: 0, responderSeatIndex: 1, direction: 'offer' },
  ]);
  expect(state.activeSeatIndex).toBe(0);
  expect(pendingDecision(before)!.seatIndex).toBe(0);
  expect(pendingDecision(state)!.seatIndex).toBe(1);
  expect(legalActions(state, 1).enabled).toEqual([
    { id: 'respond:accept', kind: 'respond', payload: { answer: 'accept' } },
    { id: 'respond:reject', kind: 'respond', payload: { answer: 'reject' } },
  ]);
  // The waiting human and the uninvolved seat have no enabled choice at all.
  expect(legalActions(state, 0).enabled).toEqual([]);
  expect(legalActions(state, 2).enabled).toEqual([]);
  // The active human is refused whatever they send; so is anyone who does not owe the answer.
  for (const [kind, payload] of [
    ['skip', {}],
    ['chat', { targetSeatIndex: 1, topic: 'truce' }],
    ['respond', { answer: 'accept' }],
    ['offer_promise', { targetSeatIndex: 1, direction: 'offer' }],
  ] as const) {
    for (const seat of [0, 2]) {
      expect(command(state, kind, payload, seat)).toMatchObject({
        rejected: true,
        reason: 'wrong_actor',
        state,
      });
    }
  }
  // The responder can do nothing but answer.
  expect(command(state, 'skip', {}, 1)).toMatchObject({ rejected: true, reason: 'illegal_action' });
  expect(command(state, 'chat', { targetSeatIndex: 0, topic: 'truce' }, 1)).toMatchObject({
    rejected: true,
    reason: 'illegal_action',
  });
  expect(command(state, 'respond', { answer: 'maybe' }, 1)).toMatchObject({
    rejected: true,
    reason: 'malformed_action',
  });
  // Nothing is pending without an offer, so an answer is refused.
  expect(command(before, 'respond', { answer: 'accept' })).toMatchObject({
    rejected: true,
    reason: 'illegal_action',
  });
});

test('the pipeline never answers for the responder: two choices, no automatic step (§6.9)', () => {
  const { state } = offer(social());
  expect(advanceAutomatically(state)).toMatchObject({ records: [], state });
});

test('accepting creates the promise, closing at the promiser’s next turn, for free (§4.8)', () => {
  const pending = offer(social()).state;
  const { state, events } = answer(pending, 'accept');
  expect(state.promises).toEqual([
    { promiserSeatIndex: 0, recipientSeatIndex: 1, createdGlobalTurnNo: 1, closesOwnTurnNo: 2 },
  ]);
  expect(events).toEqual([
    { kind: 'promise_accepted', promiserSeatIndex: 0, recipientSeatIndex: 1, closesOwnTurnNo: 2 },
  ]);
  expect(state.pendingResponse).toBeUndefined();
  expect(pendingDecision(state)!.seatIndex).toBe(0);
  expect(state.turnBudgets).toEqual({
    tacticalAction: 1,
    catchAttempt: 1,
    pokemonAbility: 1,
    socialInteraction: 0,
  });
  expect(kinds(state, 0)).toEqual(['skip']);
  expect(accepted(state, 'skip').state.phase.kind).toBe('strategy');
});

test('asking reverses the roles: the AI promises the human, closing on the AI’s next turn (Q2a)', () => {
  const state = social();
  state.players[1]!.ownTurnNo = 4;
  const accept = answer(offer(state, 1, 'ask').state, 'accept').state;
  expect(accept.promises).toEqual([
    { promiserSeatIndex: 1, recipientSeatIndex: 0, createdGlobalTurnNo: 1, closesOwnTurnNo: 5 },
  ]);
  const refused = answer(offer(state, 1, 'ask').state, 'reject').state;
  expect(refused.promises).toBeUndefined();
});

test('rejecting creates nothing and spends only the social interaction (§4.8)', () => {
  const pending = offer(social()).state;
  const { state, events } = answer(pending, 'reject');
  expect(events).toEqual([
    { kind: 'promise_rejected', promiserSeatIndex: 0, recipientSeatIndex: 1 },
  ]);
  expect(state.promises).toBeUndefined();
  expect(state.pendingResponse).toBeUndefined();
  expect(state.turnBudgets.socialInteraction).toBe(0);
  expect(state.turnBudgets.tacticalAction).toBe(1);
  // Either answer is the whole interaction: no second offer follows.
  expect(offers(state)).toEqual([]);
});

test('an answer changes nothing but the promise, the pending record and the budget (§4.8 hard line)', () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 0, max: 100_000 }),
      fc.boolean(),
      fc.boolean(),
      (seed, ask, yes) => {
        const before = social({ seats: 3, seed });
        const pending = offer(before, 1, ask ? 'ask' : 'offer').state;
        const after = answer(pending, yes ? 'accept' : 'reject').state;
        const strip = (state: GameState) => {
          const copy = structuredClone(state);
          delete copy.promises;
          delete copy.pendingResponse;
          delete copy.turnBudgets.socialInteraction;
          // The hidden-record counters only keep the bystander's numbering (§4.8).
          delete copy.promiseRecords;
          for (const player of copy.players) delete player.unseenRecords;
          copy.stateRevision = 0;
          return copy;
        };
        expect(strip(after)).toEqual(strip(before));
        expect(after.rng).toEqual(before.rng);
        return true;
      },
    ),
    { numRuns: 50 },
  );
});

/** A confirmed promise of seat 0 to seat 1, then the state as it stands `ownTurnNo` later. */
function withPromise() {
  return answer(offer(social()).state, 'accept').state;
}

test('one active promise per directed pair, and no renewal on its closing turn (§4.8)', () => {
  const made = withPromise();
  made.phase = { kind: 'social' };
  made.turnBudgets.socialInteraction = 1;
  // Same turn, once more: the pair 0→1 is taken, the other direction (1→0) is free.
  expect(offers(made).map((choice) => choice.payload)).toEqual([
    { targetSeatIndex: 1, direction: 'ask' },
  ]);
  expect(command(made, 'offer_promise', { targetSeatIndex: 1, direction: 'offer' })).toMatchObject({
    rejected: true,
    reason: 'illegal_action',
  });
  // On the closing turn itself (the promiser's next turn) it is still active: no renewal.
  const closing = structuredClone(made);
  closing.players[0]!.ownTurnNo = 2;
  expect(offers(closing).map((choice) => choice.payload)).toEqual([
    { targetSeatIndex: 1, direction: 'ask' },
  ]);
  // After that turn ends the promiser is not active any more: the promise is closed.
  const closed = structuredClone(closing);
  closed.activeSeatIndex = 1;
  expect(offers(closed, 0)).toEqual([]); // not the active seat now
  closed.activeSeatIndex = 0;
  closed.players[0]!.ownTurnNo = 3;
  expect(offers(closed).map((choice) => choice.payload)).toContainEqual({
    targetSeatIndex: 1,
    direction: 'offer',
  });
});

test('the promise stays active through the whole of the promiser’s next turn only (§4.8)', () => {
  const made = withPromise();
  const promise = made.promises![0]!;
  const turns: { own: number; active: number; expected: boolean }[] = [
    { own: 1, active: 0, expected: true }, // confirmed this turn
    { own: 1, active: 1, expected: true }, // the AI's turn in between
    { own: 2, active: 0, expected: true }, // the promiser's next turn: the last one it covers
    { own: 2, active: 1, expected: false }, // it closed when that turn ended
    { own: 3, active: 0, expected: false },
  ];
  for (const { own, active, expected } of turns) {
    const state = structuredClone(made);
    state.players[0]!.ownTurnNo = own;
    state.activeSeatIndex = active;
    expect(promiseActive(state, promise)).toBe(expected);
  }
});

test('no promise that would close after the Final Table Round ends (§4.2, §4.8)', () => {
  // The round ends once everyone has played own turn 1: seat 0 is on that last turn.
  const last = social();
  last.finalTableRound = { triggerSeatIndex: 1, targetOwnTurnNo: 1 };
  // Seat 0 would close on own turn 2, which never comes; seat 1 closes on its own turn 1, which does.
  expect(offers(last).map((choice) => choice.payload)).toEqual([
    { targetSeatIndex: 1, direction: 'ask' },
  ]);
  const early = social();
  early.finalTableRound = { triggerSeatIndex: 1, targetOwnTurnNo: 2 };
  expect(offers(early)).toHaveLength(2);
  const beyond = social();
  beyond.finalTableRound = { triggerSeatIndex: 1, targetOwnTurnNo: 1 };
  beyond.players[1]!.ownTurnNo = 1;
  expect(offers(beyond)).toEqual([]);
  expect(command(beyond, 'offer_promise', { targetSeatIndex: 1, direction: 'ask' })).toMatchObject({
    rejected: true,
    reason: 'illegal_action',
  });
});

test('a promise is visible to its two parties only (§4.8 Privacy, §5.4)', () => {
  const before = social({ seats: 3 });
  const offered = offer(before);
  const pending = offered.state;
  const answered = answer(pending, 'accept');
  const { state } = answered;
  for (const seat of [0, 1]) {
    expect(eventsVisibleTo(before, offered.events, seat)).toEqual(offered.events);
    expect(eventsVisibleTo(pending, answered.events, seat)).toEqual(answered.events);
    expect(observe(state, seat).own.promises).toEqual(state.promises);
  }
  expect(observe(pending, 0).own.pendingResponse).toEqual(pending.pendingResponse);
  expect(observe(pending, 1).own.pendingResponse).toEqual(pending.pendingResponse);
  expect(observe(pending, 2).own).not.toHaveProperty('pendingResponse');
  expect(eventsVisibleTo(before, offered.events, 2)).toEqual([]);
  expect(eventsVisibleTo(pending, answered.events, 2)).toEqual([]);
  expect(observe(state, 2).own.promises).toEqual([]);
  // Both records are absent for the bystander, not redacted (§4.8, like a chat).
  expect(actionVisibleTo(before, offered.record, 2, 0)).toBeNull();
  expect(actionVisibleTo(pending, answered.record, 2, 0)).toBeNull();
  expect(actionVisibleTo(before, offered.record, 1, 0)?.action).toMatchObject(
    offered.record.action,
  );
  expect(actionVisibleTo(pending, answered.record, 0, 1)?.action).toMatchObject(
    answered.record.action,
  );
  expect(JSON.stringify([observe(pending, 2), observe(state, 2)])).not.toMatch(
    /promise_|accept|pendingResponse|closesOwnTurnNo|"promises":\[\{/,
  );
});

test('resume during a pending offer waits for the responder, and replay is deterministic (§6.8, §6.9)', () => {
  const initial = social();
  const log = createGameLog(initial);
  const offered = offer(initial);
  log.actions.push({ action: offered.record.action, events: offered.events });
  const game = { state: offered.state, log };
  const resumed = resume(game);
  expect(resumed.waitingFor).toMatchObject({
    kind: 'decision',
    seatIndex: 1,
    actorId: initial.players[1]!.actorId,
    phase: 'social',
  });
  expect(resumed.waitingFor).toHaveProperty('legalActions', legalActions(offered.state, 1));
  // A reload re-asks the same question; the save carries the pending record.
  const loaded = deserialize(serialize(game));
  expect(loaded.state.pendingResponse).toEqual(offered.state.pendingResponse);
  expect(resume(loaded).waitingFor).toEqual(resumed.waitingFor);
  expect(verifyReplay(loaded)).toMatchObject({ pass: true });
  // Finishing the answer after the reload equals answering without one, event for event.
  const direct = answer(offered.state, 'accept');
  const afterLoad = answer(loaded.state, 'accept');
  expect(afterLoad.state).toEqual(direct.state);
  log.actions.push({ action: direct.record.action, events: direct.events });
  expect(replay(log)).toEqual(direct.state);
  expect(resume({ state: direct.state, log }).waitingFor).toMatchObject({
    kind: 'decision',
    seatIndex: 0,
  });
  expect(verifyReplay({ state: direct.state, log })).toMatchObject({ pass: true });
});

test('a wrong-actor rejection leaves the state untouched and the invariants hold', () => {
  const before = offer(social()).state;
  const action = {
    actorId: before.players[0]!.actorId,
    actionSeq: before.stateRevision + 1,
    stateRevisionBefore: before.stateRevision,
    kind: 'skip',
    payload: {},
  };
  const result = applyAction(before, action);
  expect(result).toMatchObject({ rejected: true, reason: 'wrong_actor' });
  expect(checkInvariants(before, action, result)).toEqual([]);
  for (const choice of ['accept', 'reject'] as const) {
    const respond = {
      actorId: before.players[1]!.actorId,
      actionSeq: before.stateRevision + 1,
      stateRevisionBefore: before.stateRevision,
      kind: 'respond',
      payload: { answer: choice },
    };
    expect(checkInvariants(before, respond, applyAction(before, respond))).toEqual([]);
  }
});

test('"an unfinished game always has a seat with an enabled choice" follows the acting seat', () => {
  // With a question pending the active seat has none, yet the game can go on: the responder has two.
  const pending = offer(social()).state;
  expect(legalActions(pending, pending.activeSeatIndex).enabled).toEqual([]);
  const probe = {
    actorId: pending.players[1]!.actorId,
    actionSeq: pending.stateRevision + 1,
    stateRevisionBefore: pending.stateRevision,
    kind: 'respond',
    payload: { answer: 'reject' },
  };
  expect(checkInvariants(pending, probe, applyAction(pending, probe))).toEqual([]);
  // A responder that is not a seat would strand the game, and the invariant says so.
  const stranded = structuredClone(pending);
  stranded.pendingResponse = { ...stranded.pendingResponse!, responderSeatIndex: 7 };
  const skip = {
    actorId: stranded.players[1]!.actorId,
    actionSeq: stranded.stateRevision + 1,
    stateRevisionBefore: stranded.stateRevision,
    kind: 'respond',
    payload: { answer: 'reject' },
  };
  const fake = {
    accepted: true as const,
    state: stranded,
    events: [],
    record: { action: skip as never, events: [] },
  };
  expect(checkInvariants(pending, skip, fake).map((v) => v.invariant)).toContain('game-can-finish');
});

/** Plays `steps` from `initial`, each by the seat that owes the next command, and builds every feed. */
function playFeeds(initial: GameState, steps: Array<[string, object]>) {
  let state = initial;
  const full: ActionRecord[] = [];
  const feeds = new Map<number, SeatActionRecord[]>(
    initial.players.map((player) => [player.seatIndex, []]),
  );
  for (const [kind, payload] of steps) {
    const result = accepted(state, kind, payload);
    full.push(result.record);
    for (const [seat, feed] of feeds) {
      const visible = actionVisibleTo(state, result.record, seat, feed.length);
      if (visible) feed.push(visible);
    }
    state = result.state;
  }
  return { state, full, feeds };
}

test.each([3, 4] as const)(
  'a bystander in a %i-seat game cannot tell whether a promise was made or with whom (§4.8)',
  (seats) => {
    const rest: Array<[string, object]> = [
      ['skip', {}],
      ['skip', {}],
    ];
    type Variant = { steps: Array<[string, object]>; parties: number[] };
    const variants: Variant[] = [{ steps: rest, parties: [] }];
    for (const target of [1, 2]) {
      for (const direction of ['offer', 'ask'] as const) {
        for (const choice of ['accept', 'reject'] as const) {
          variants.push({
            steps: [
              ['offer_promise', { targetSeatIndex: target, direction }],
              ['respond', { answer: choice }],
              ...rest,
            ],
            parties: [0, target],
          });
        }
      }
    }
    const played = variants.map((variant) => playFeeds(social({ seats }), variant.steps));
    // The internal log keeps every record, promise included, with its real sequence numbers.
    expect(played[1]!.full.map((record) => record.action.kind)).toEqual([
      'offer_promise',
      'respond',
      'skip',
      'skip',
    ]);
    expect(played[1]!.full.map((record) => record.action.actionSeq)).toEqual([1, 2, 3, 4]);
    expect(played[1]!.full[1]!.action.actorId).toBe(played[1]!.state.players[1]!.actorId);
    for (const [index, variant] of variants.entries()) {
      for (let seat = 0; seat < seats; seat++) {
        const feed = played[index]!.feeds.get(seat)!;
        if (seat !== 0 && !variant.parties.includes(seat)) {
          // A seat outside the pair has the feed of a game where nobody promised anything.
          expect(feed).toEqual(played[0]!.feeds.get(seat));
          expect(feed.map((record) => record.action.actionSeq)).toEqual([1, 2]);
          expect(feed.map((record) => record.action.stateRevisionBefore)).toEqual([0, 1]);
          expect(feed.map((record) => record.action.kind)).toEqual(['skip', 'skip']);
          expect(JSON.stringify(feed)).not.toMatch(/promise|respond|accept|reject|targetSeatIndex/);
          expect(observe(played[index]!.state, seat)).toEqual(observe(played[0]!.state, seat));
        } else if (variant.parties.includes(seat) || seat === 0) {
          if (index === 0) continue;
          // Both parties see the question and the answer, numbered without a gap.
          expect(feed.map((record) => record.action.kind)).toEqual([
            'offer_promise',
            'respond',
            'skip',
            'skip',
          ]);
          expect(feed.map((record) => record.action.actionSeq)).toEqual([1, 2, 3, 4]);
        }
      }
    }
  },
);

test.each([3, 4] as const)(
  'in a %i-seat game a bystander acts on its own revision after a hidden promise (§4.8)',
  (seats) => {
    const plain = social({ seats });
    const promised = answer(offer(social({ seats })).state, 'accept').state;
    // Two records the bystander never saw: global revision runs ahead of its own.
    expect(promised.stateRevision).toBe(plain.stateRevision + 2);
    expect(observe(promised, 2).public.stateRevision).toBe(plain.stateRevision);
    expect(observe(promised, 2)).toEqual(observe(plain, 2));
    expect(publicRevision(promised)).toBe(plain.stateRevision);
    // Its next command, numbered from what it observed, is accepted; the pair's old numbers are stale.
    const stale = applyAction(promised, {
      actorId: promised.players[2]!.actorId,
      actionSeq: promised.stateRevision + 1,
      stateRevisionBefore: promised.stateRevision,
      kind: 'skip',
      payload: {},
    });
    expect(stale).toMatchObject({ rejected: true });
    // A spectator learns nothing either.
    const spectated = observeSpectator(promised);
    expect(spectated).toEqual(observeSpectator(plain));
    expect(JSON.stringify(spectated)).not.toMatch(/promise|pendingResponse/);
    const offered = offer(social({ seats }));
    expect(actionVisibleToSpectator(plain, offered.record, 0)).toBeNull();
    expect(
      actionVisibleToSpectator(offered.state, answer(offered.state, 'reject').record, 0),
    ).toBeNull();
    expect(eventsVisibleToSpectator(plain, offered.events)).toEqual([]);
  },
);

test('a seat outside the pair is unaffected while the question is pending, and after it (§4.8)', () => {
  const plain = social({ seats: 4 });
  const pending = offer(social({ seats: 4 }), 1, 'ask').state;
  for (const seat of [2, 3]) {
    expect(observe(pending, seat)).toEqual(observe(plain, seat));
    expect(legalActions(pending, seat).enabled).toEqual([]);
  }
  const skipped = accepted(plain, 'skip');
  const accepted3 = accepted(answer(pending, 'accept').state, 'skip');
  // After the same next move, a bystander's view is identical with or without the promise.
  expect(observe(accepted3.state, 3).public.stateRevision).toBe(
    observe(skipped.state, 3).public.stateRevision,
  );
  expect(observe(accepted3.state, 3).public).toEqual(observe(skipped.state, 3).public);
});
