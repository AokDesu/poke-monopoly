import { expect, test } from 'vitest';
import {
  advanceAutomatically,
  applyAction,
  createGame,
  createGameConfig,
  createGameLog,
  fixtureSchema,
  legalActions,
  LAP_TARGETS,
  replay,
  winner,
  type EngineEvent,
  type GameState,
} from './index.ts';
import fixture from './fixtures/start-of-game-2p.json';

function fixtureContent() {
  const content = fixtureSchema.parse(fixture).state.content;
  // Contract-only seats, using species/items already in the minimal fixture.
  content.classes.push(
    {
      id: 'fixture-caterpie',
      name: 'Fixture Caterpie',
      starterSpeciesIds: ['caterpie'],
      classItemId: 'potion',
    },
    {
      id: 'fixture-pidgey',
      name: 'Fixture Pidgey',
      starterSpeciesIds: ['pidgey'],
      classItemId: 'great-ball',
    },
  );
  return content;
}

/** A started game whose first player is decided by real logged rolls. */
function startedGame(seats: number, lapTarget: number, seed = 21): GameState {
  let state = createGame(
    createGameConfig({
      seats: ['main-character', 'rival', 'fixture-caterpie', 'fixture-pidgey']
        .slice(0, seats)
        .map((classId, seatIndex) => ({
          actorId: `player-${seatIndex}`,
          seatIndex,
          classId,
          controller: seatIndex === 0 ? 'human' : 'ai',
        })),
      seed,
      lapTarget,
    }),
    fixtureContent(),
  );
  while (state.phase.kind === 'first_player_roll') state = advanceAutomatically(state).state;
  return state;
}

function command(state: GameState, kind: string, payload: object = {}) {
  const result = applyAction(state, {
    actorId: state.players.find((player) => player.seatIndex === state.activeSeatIndex)!.actorId,
    actionSeq: state.stateRevision + 1,
    stateRevisionBefore: state.stateRevision,
    kind,
    payload,
  });
  if ('rejected' in result) throw new Error(result.reason);
  return result;
}

/** One accepted step: keep the team at Sell, release at Encounter, otherwise the single choice. */
function step(state: GameState) {
  if (state.phase.kind === 'sell') return command(state, 'sell', { pokemonInstanceIds: [] });
  if (state.phase.kind === 'encounter' && !state.phase.catchRoll) return command(state, 'release');
  const result = advanceAutomatically(state);
  if (result.records.length !== 1) throw new Error(`No step from ${state.phase.kind}`);
  return { state: result.state, events: result.events, record: result.records[0]! };
}

/** Places a seat one square before its final paid Start milestone. */
function poiseToTrigger(state: GameState, seatIndex: number): void {
  const player = state.players.find((entry) => entry.seatIndex === seatIndex)!;
  const target = state.config.lapTarget;
  player.routeProgress = target * 24 - 1;
  player.creditedLap = target - 1;
  player.highestRewardedMilestone = target - 1;
}

test('the first Start crossing that reaches the Lap target announces the Final Table Round before Sell (§4.7 step 3)', () => {
  let state = startedGame(2, 2);
  const seat = state.activeSeatIndex;
  poiseToTrigger(state, seat);
  const events = [];
  while (state.phase.kind !== 'sell') {
    const result = step(state);
    events.push(...result.events);
    state = result.state;
  }
  const ownTurnNo = state.players.find((player) => player.seatIndex === seat)!.ownTurnNo;
  expect(state.finalTableRound).toEqual({ triggerSeatIndex: seat, targetOwnTurnNo: ownTurnNo });
  expect(events.slice(-3)).toEqual([
    expect.objectContaining({ kind: 'coin_transfer', reason: 'start_income' }),
    { kind: 'final_table_round', triggerSeatIndex: seat, targetOwnTurnNo: ownTurnNo },
    { kind: 'phase_changed', from: 'move', to: 'sell' },
  ]);
});

function playToEnd(state: GameState, limit = 400) {
  const events = [];
  // The snapshot before the ending action, and that action's events.
  let last = state;
  let finalEvents: EngineEvent[] = [];
  for (let count = 0; state.phase.kind !== 'finished'; count++) {
    if (count === limit) throw new Error('Game did not finish');
    const result = step(state);
    events.push(...result.events);
    last = state;
    finalEvents = result.events;
    state = result.state;
  }
  return { state, events, last, finalEvents };
}

test.each([2, 3, 4].flatMap((seats) => Array.from({ length: seats }, (_, seat) => [seats, seat])))(
  'with %i seats, a trigger from seat %i ends the game once every seat has the same own-turn count (§4.7 step 3, §6.4)',
  (seats, trigger) => {
    const state = startedGame(seats, 2);
    poiseToTrigger(state, trigger);
    const ended = playToEnd(state).state;
    expect(ended.finalTableRound?.triggerSeatIndex).toBe(trigger);
    const target = ended.finalTableRound!.targetOwnTurnNo;
    expect(ended.players.map((player) => player.ownTurnNo)).toEqual(Array(seats).fill(target));
  },
);

test('after the game ends no Sell Phase or turn starts and every further action is rejected (§4.7 step 3)', () => {
  const state = startedGame(3, 1);
  poiseToTrigger(state, 0);
  const ended = playToEnd(state).state;
  expect(ended.phase).toEqual({ kind: 'finished' });
  // A pending Event card would otherwise make the generated draw below valid.
  ended.eventDeck.drawPile = ['fixture-event'];
  for (const player of ended.players) {
    expect(legalActions(ended, player.seatIndex).enabled).toEqual([]);
  }
  expect(advanceAutomatically(ended)).toEqual({ state: ended, records: [], events: [] });
  const active = ended.players.find((player) => player.seatIndex === ended.activeSeatIndex)!;
  const attempts = [
    { actorId: active.actorId, kind: 'skip', payload: {} },
    { actorId: active.actorId, kind: 'roll', payload: {} },
    { actorId: active.actorId, kind: 'sell', payload: { pokemonInstanceIds: [] } },
    { actorId: active.actorId, kind: 'finish_sell', payload: {} },
    { actorId: 'engine', kind: 'dice_result', payload: { purpose: 'other', value: 1 } },
    { actorId: 'engine', kind: 'shuffle', payload: { deckId: 'events', order: [] } },
    { actorId: 'engine', kind: 'event_draw', payload: { eventId: ended.eventDeck.drawPile[0] } },
  ];
  const before = structuredClone(ended);
  for (const attempt of attempts) {
    const result = applyAction(ended, {
      ...attempt,
      actionSeq: ended.stateRevision + 1,
      stateRevisionBefore: ended.stateRevision,
    });
    expect(result, attempt.kind).toMatchObject({ rejected: true, reason: 'illegal_action' });
    expect(result.state).toBe(ended);
  }
  expect(ended).toEqual(before);
});

test('leftover Pokémon auto-sell at half Sale Basis rounded half up, without Rescue Starters or items (§4.7 step 3)', () => {
  const state = startedGame(2, 1);
  poiseToTrigger(state, 0);
  const first = state.players[0]!;
  const second = state.players[1]!;
  // Original base-form Bulbasaur has Sale Basis 5; caught Eevee 12, Pidgey 5, Chansey 16.
  first.team.push(
    { ...first.team[0]!, instanceId: 'eevee', speciesId: 'eevee', origin: 'caught' },
    { ...first.team[0]!, instanceId: 'pidgey', speciesId: 'pidgey', origin: 'caught' },
  );
  second.team = [
    {
      instanceId: 'rescue',
      speciesId: 'eevee',
      origin: 'rescue_starter',
      evolutionStage: 0,
      tired: false,
      abilityReady: true,
      tradeable: false,
    },
    { ...second.team[0]!, instanceId: 'chansey', speciesId: 'chansey', origin: 'caught' },
  ];
  const starter = first.team[0]!.instanceId;
  const { state: ended, last, finalEvents } = playToEnd(state);
  const sale = (actorId: string, instanceId: string, amount: number) => [
    {
      kind: 'coin_transfer',
      source: { kind: 'bank' },
      destination: { kind: 'player', actorId },
      amount,
      reason: 'final_sale',
    },
    { kind: 'uid_destroyed', instanceId, entity: 'pokemon', reason: 'final_sale' },
  ];
  expect(finalEvents).toEqual([
    ...sale('player-0', starter, 3),
    ...sale('player-0', 'eevee', 6),
    ...sale('player-0', 'pidgey', 3),
    ...sale('player-1', 'chansey', 8),
    { kind: 'phase_changed', from: 'end', to: 'finished' },
  ]);
  expect(ended.players.map((player) => player.coins)).toEqual([
    last.players[0]!.coins + 12,
    last.players[1]!.coins + 8,
  ]);
  expect(ended.players[0]!.team).toEqual([]);
  expect(ended.players[1]!.team.map((pokemon) => pokemon.instanceId)).toEqual(['rescue']);
  expect(ended.players.map((player) => player.items)).toEqual(last.players.map((p) => p.items));
});

test('Quick and Standard modes use Lap targets 2 and 3 (§1 delivery scope)', () => {
  expect(LAP_TARGETS).toEqual({ quick: 2, standard: 3 });
});

test.each([1, LAP_TARGETS.quick, LAP_TARGETS.standard])(
  'a game with Lap target %i ends after exactly that many paid Laps (§4.7 step 3, §6.5)',
  (lapTarget) => {
    const { state: ended, events } = playToEnd(startedGame(3, lapTarget, 5), 3000);
    const announcements = events.filter((event) => event.kind === 'final_table_round');
    expect(announcements).toHaveLength(1);
    const trigger = ended.players.find(
      (player) => player.seatIndex === ended.finalTableRound!.triggerSeatIndex,
    )!;
    expect(trigger.creditedLap).toBe(lapTarget);
    expect(Math.max(...ended.players.map((player) => player.creditedLap))).toBe(lapTarget);
    const incomes = events.filter(
      (event) => event.kind === 'coin_transfer' && event.reason === 'start_income',
    );
    expect(incomes.length).toBe(ended.players.reduce((sum, player) => sum + player.creditedLap, 0));
  },
);

function standings(entries: { coins: number; badges: number; pokemon: number }[]): GameState {
  const state = startedGame(entries.length, 2);
  entries.forEach(({ coins, badges, pokemon }, seatIndex) => {
    const player = state.players[seatIndex]!;
    player.coins = coins;
    player.badges = badges;
    player.team = Array.from({ length: pokemon }, (_, index) => ({
      ...player.team[0]!,
      instanceId: `pokemon:${seatIndex}:${index}`,
    }));
  });
  return state;
}

test('the most coins wins outright, whatever the badge or Pokémon counts (§4.7 step 4)', () => {
  const state = standings([
    { coins: 30, badges: 2, pokemon: 6 },
    { coins: 31, badges: 0, pokemon: 0 },
    { coins: 29, badges: 3, pokemon: 4 },
  ]);
  expect(winner(state)).toEqual({ winners: ['player-1'], reason: 'coins' });
});

test('a coin tie goes to the higher badge count, never the larger team (§4.7 step 4)', () => {
  const state = standings([
    { coins: 40, badges: 0, pokemon: 5 },
    { coins: 40, badges: 1, pokemon: 1 },
    { coins: 12, badges: 3, pokemon: 2 },
  ]);
  expect(winner(state)).toEqual({ winners: ['player-1'], reason: 'badges' });
});

test('a tie on both coins and badges returns co-winners in seat order, ignoring team size (§4.7 step 4)', () => {
  const state = standings([
    { coins: 25, badges: 0, pokemon: 4 },
    { coins: 18, badges: 0, pokemon: 1 },
    { coins: 25, badges: 0, pokemon: 1 },
    { coins: 25, badges: 0, pokemon: 0 },
  ]);
  expect(winner(state)).toEqual({
    winners: ['player-0', 'player-2', 'player-3'],
    reason: 'co_winners',
  });
});

test('a finished game, including its announcement and auto-sell, replays exactly from its log (§6.8, §8)', () => {
  const initial = createGame(
    createGameConfig({
      seats: ['main-character', 'rival'].map((classId, seatIndex) => ({
        actorId: `player-${seatIndex}`,
        seatIndex,
        classId,
        controller: seatIndex === 0 ? ('human' as const) : ('ai' as const),
      })),
      seed: 9,
      lapTarget: 1,
    }),
    fixtureContent(),
  );
  const log = createGameLog(initial);
  let state = initial;
  while (state.phase.kind !== 'finished') {
    const result = step(state);
    log.actions.push(result.record);
    state = result.state;
  }
  const events = log.actions.flatMap((record) => record.events);
  expect(events.some((event) => event.kind === 'final_table_round')).toBe(true);
  expect(
    events.some((event) => event.kind === 'coin_transfer' && event.reason === 'final_sale'),
  ).toBe(true);
  expect(replay(JSON.parse(JSON.stringify(log)))).toEqual(state);
});
