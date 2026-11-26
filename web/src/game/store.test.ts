import { expect, test, vi } from 'vitest';
import {
  createGame,
  createGameConfig,
  createGameLog,
  fixtureSchema,
  observeSpectator,
  replay,
  stateHash,
  type GameConfig,
} from '../../../engine/index.ts';
import fixture from '../../../engine/fixtures/start-of-game-2p.json';
import { createGameStore } from './store.ts';

const content = fixtureSchema.parse(fixture).state.content;
const config: GameConfig = createGameConfig({
  seats: ['main-character', 'rival'].map((classId, seatIndex) => ({
    actorId: `player-${seatIndex}`,
    seatIndex,
    classId,
    controller: seatIndex === 0 ? ('human' as const) : ('ai' as const),
  })),
  seed: 7,
  lapTarget: 3,
});

test('the store keeps a log that replays to its current state (§6.1, §6.8)', () => {
  const store = createGameStore();
  const listener = vi.fn();
  store.subscribe(listener);
  store.start(config, content);
  expect(store.getSession()?.log.actions).toEqual([]);

  const result = store.submit({ actorId: 'player-0', kind: 'roll', payload: {} });
  expect('accepted' in result).toBe(true);
  expect(store.advance()).toBe(true); // the engine's first-player die result
  const session = store.getSession()!;
  expect(session.state.stateRevision).toBe(2);
  expect(session.log.actions.map((record) => record.action.kind)).toEqual(['roll', 'dice_result']);
  expect(stateHash(replay(session.log))).toBe(stateHash(session.state));
  expect(listener).toHaveBeenCalledTimes(3);
});

test('a rejected command changes neither state nor log and notifies no one', () => {
  const store = createGameStore();
  store.start(config, content);
  const before = store.getSession();
  const listener = vi.fn();
  store.subscribe(listener);

  const result = store.submit({ actorId: 'player-1', kind: 'roll', payload: {} });
  expect(result).toMatchObject({ rejected: true, reason: 'wrong_actor' });
  expect(store.getSession()).toBe(before);
  expect(listener).not.toHaveBeenCalled();
});

test('advance never plays the human seat, even when it has a single legal choice (§3.1)', () => {
  const store = createGameStore();
  store.start(config, content);
  const before = store.getSession();
  expect(store.getView()!.legalActions.enabled.map((choice) => choice.kind)).toEqual(['roll']);

  expect(store.advance()).toBe(false);
  expect(store.getSession()).toBe(before);

  // The human's roll goes through `choose`; the AI's sole roll is then the engine's to apply.
  expect('accepted' in store.choose('roll')).toBe(true);
  expect(store.advance()).toBe(true); // human's die result
  expect(store.advance()).toBe(true); // AI's roll
  expect(store.getSession()!.log.actions.map((record) => record.action.actorId)).toEqual([
    'player-0',
    'engine',
    'player-1',
  ]);
});

test('the view holds only what the human seat may see: no seed, RNG or opponent pouch (§4.1)', () => {
  const store = createGameStore();
  const secretSeed = 'sentinel-seed-do-not-show';
  store.start({ ...config, seed: secretSeed }, content);
  store.choose('roll');
  while (store.getView()!.observation.public.phase.kind === 'first_player_roll' && store.advance());

  const view = store.getView()!;
  const text = JSON.stringify(view);
  expect(view.seatIndex).toBe(0);
  expect(view.observation.own.seatIndex).toBe(0);
  expect(text).not.toContain(secretSeed);
  expect(text).not.toContain(store.getSession()!.state.rng.state);
  expect(view.observation.public.players[1]).not.toHaveProperty('balls');
  expect(view.feed.map((entry) => entry.record.action.kind)).toEqual(
    store.getSession()!.log.actions.map((record) => record.action.kind),
  );
  // Stable between changes, as useSyncExternalStore requires.
  expect(store.getView()).toBe(view);
});

test('choose rejects an ID that is not one of the human seat enabled choices', () => {
  const store = createGameStore();
  store.start(config, content);
  const before = store.getSession();
  expect(store.choose('skip')).toMatchObject({ rejected: true, reason: 'illegal_action' });
  expect(store.getSession()).toBe(before);
});

test('a seat outside a Deal Card sees the same decision owner as with no question pending (§4.8)', () => {
  // Two humans (seats 0 and 2) and an AI (seat 1), as in a two-human save: human 2 proposes to AI 1 in Social.
  const three = structuredClone(content);
  three.classes.push({
    id: 'team-rocket',
    name: 'Team Rocket',
    starterSpeciesIds: ['eevee'],
    classItemId: 'pickpocket',
  });
  const classIds = three.classes.map((entry) => entry.id);
  const threeSeat = createGameConfig({
    seats: [0, 1, 2].map((seatIndex) => ({
      actorId: `player-${seatIndex}`,
      seatIndex,
      classId: classIds[seatIndex % classIds.length]!,
      controller: seatIndex === 1 ? ('ai' as const) : ('human' as const),
    })),
    seed: 7,
    lapTarget: 3,
    socialWindow: true,
  });
  const deal = (initiatorSeatIndex: number) => {
    const state = createGame(threeSeat, three);
    const log = createGameLog(state);
    state.phase = { kind: 'social' };
    state.activeSeatIndex = initiatorSeatIndex;
    const quiet = structuredClone(state);
    state.pendingResponse = {
      kind: 'deal',
      stage: 'proposed',
      initiatorSeatIndex,
      responderSeatIndex: 1,
      targetSeatIndex: 1,
      terms: {
        give: { coins: 0, pokemonInstanceIds: ['x'], itemInstanceIds: [] },
        get: { coins: 3, pokemonInstanceIds: [], itemInstanceIds: [] },
      },
      counterDepth: 0,
    };
    return { state, quiet, log };
  };
  const decisionOf = (
    state: ReturnType<typeof createGame>,
    log: ReturnType<typeof createGameLog>,
  ) => {
    const store = createGameStore();
    store.restore({ state, log });
    // With two people the device is the proposing person's: the other person reads nothing until their own turn.
    store.confirmPass();
    return store.getView()!.decision;
  };

  // Human seat 0 is outside the deal between human seat 2 and AI seat 1: nothing of the game is readable for
  // it until the device reaches it, and the proposing person sees that the AI owes the answer.
  const outside = deal(2);
  const bystander = createGameStore();
  bystander.restore({ state: outside.state, log: outside.log });
  expect(bystander.getPass()).toEqual({ seatIndex: 2, kind: 'turn' });
  expect(bystander.getView()).toBeNull();
  expect(decisionOf(outside.state, outside.log)?.seatIndex).toBe(1);
  // Seat 0 is the proposer to AI seat 1: it sees that the AI owes the answer.
  const party = deal(0);
  expect(decisionOf(party.state, party.log)?.seatIndex).toBe(1);
  expect(decisionOf(party.quiet, party.log)?.seatIndex).toBe(0);
});

test("shared speech carries the revision every seat shares, never one seat's own (§4.8)", () => {
  const store = createGameStore();
  store.start(config, content);
  const session = store.getSession()!;
  const state = structuredClone(session.state);
  // Two Deal Cards that seat 1 never saw; seat 0, the viewer, was a party to both.
  state.stateRevision = 5;
  state.dealRecords = 2;
  state.players[0]!.unseenRecords = 0;
  state.players[1]!.unseenRecords = 2;
  store.restore({ state, log: session.log });
  const viewer = store.getView()!.observation.public.stateRevision;
  expect(viewer).toBe(5);
  // The party's own revision counts both records, which would show a bystander how many it was part of.
  expect(store.sharedPublic()!.stateRevision).toBe(3);
  expect(store.sharedPublic()!.stateRevision).toBe(observeSpectator(state).public.stateRevision);
  expect(store.sharedPublic()!.stateRevision).not.toBe(viewer);
});

test('a speech request carries only the fields every seat shares: no private attack, no seat-relative revision (§4.1, §4.8)', () => {
  const store = createGameStore();
  store.start(config, content);
  const session = store.getSession()!;
  const state = structuredClone(session.state);
  // AI seat 1 Pickpocketed seat 0 (a hostile item use is private to the pair); seat 0 also declared a PvP attack.
  state.attackHistory = [
    {
      kind: 'attack_attempt',
      attackId: 'attack:1',
      actorId: 'player-1',
      targetId: 'player-0',
      source: 'hostile_item',
      actionSeq: 1,
      globalTurnNo: 1,
    },
    {
      kind: 'attack_attempt',
      attackId: 'attack:2',
      actorId: 'player-0',
      targetId: 'player-1',
      source: 'pvp_declaration',
      actionSeq: 2,
      globalTurnNo: 1,
    },
  ];
  state.stateRevision = 5;
  state.players[1]!.unseenRecords = 2;
  store.restore({ state, log: session.log });
  const shared = store.sharedPublic()!;
  expect(shared.attackHistory?.map((attempt) => attempt.source)).toEqual(['pvp_declaration']);
  expect(shared.stateRevision).toBe(observeSpectator(state).public.stateRevision);
});
