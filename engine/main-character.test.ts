import { expect, test } from 'vitest';
import {
  advanceAutomatically,
  applyAction,
  createGame,
  createGameConfig,
  createGameLog,
  fixtureSchema,
  replay,
  type Content,
  type GameState,
} from './index.ts';
import fixture from './fixtures/start-of-game-2p.json';

function mainCharacterContent(): Content {
  const content = structuredClone(fixtureSchema.parse(fixture).state.content);
  for (const [id, name, tags] of [
    ['charmander', 'Charmander', ['fire']],
    ['squirtle', 'Squirtle', ['water']],
  ] as const) {
    content.species.push({
      id,
      name,
      rarity: 'uncommon',
      dc: 3,
      battle: 2,
      base: 8,
      tags: [...tags],
    });
  }
  // Contract-only species no Poké Ball roll can catch, so a failed roll is deterministic.
  content.species.push({
    id: 'fixture-unreachable',
    name: 'Fixture Unreachable',
    rarity: 'rare',
    dc: 9,
    battle: 0,
    base: 1,
    tags: [],
  });
  const mainCharacter = content.classes.find((entry) => entry.id === 'main-character')!;
  mainCharacter.starterSpeciesIds = ['bulbasaur', 'charmander', 'squirtle'];
  mainCharacter.passive = 'lap_first_catch_bonus';
  return content;
}

function mainCharacterGame(starterSpeciesId = 'charmander'): GameState {
  return createGame(
    createGameConfig({
      seats: [
        {
          actorId: 'player-0',
          seatIndex: 0,
          classId: 'main-character',
          starterSpeciesId,
          controller: 'human',
        },
        { actorId: 'player-1', seatIndex: 1, classId: 'rival', controller: 'ai' },
      ],
      seed: 35,
      lapTarget: 3,
    }),
    mainCharacterContent(),
  );
}

test.each(['bulbasaur', 'charmander', 'squirtle'])(
  'a Main Character choosing %s starts with 20 coins, that Starter, 5 Poké Balls and 1 Great Ball (§4.1, Appendix A)',
  (starterSpeciesId) => {
    const player = mainCharacterGame(starterSpeciesId).players[0]!;
    expect(player.coins).toBe(20);
    expect(player.team).toEqual([
      {
        instanceId: 'starter:0',
        speciesId: starterSpeciesId,
        origin: 'original_starter',
        evolutionStage: 0,
        tired: false,
        abilityReady: true,
      },
    ]);
    expect(player.balls).toEqual({ poke: 5, great: 1, ultra: 0 });
    expect(player.items).toEqual([]);
  },
);

/** Put the Main Character in a fresh turn's Encounter, by default with a Caterpie (DC 2). */
function encounter(state: GameState, speciesId = 'caterpie'): GameState {
  const next = structuredClone(state);
  next.activeSeatIndex = 0;
  next.globalTurnNo++;
  next.turnBudgets = { tacticalAction: 1, catchAttempt: 1, pokemonAbility: 1 };
  next.phase = { kind: 'encounter', pokemon: { speciesId } };
  return next;
}

function command(state: GameState, kind: string, payload = {}) {
  const result = applyAction(state, {
    actorId: state.players[state.activeSeatIndex]!.actorId,
    actionSeq: state.stateRevision + 1,
    stateRevisionBefore: state.stateRevision,
    kind,
    payload,
  });
  if ('rejected' in result) throw new Error(result.reason);
  return result;
}

/** Confirm a Poké Ball catch, returning the snapshot class bonus and the state after the roll. */
function catchWithPokeBall(state: GameState) {
  const confirmed = command(state, 'catch', { ballType: 'poke' });
  if (confirmed.state.phase.kind !== 'encounter' || !confirmed.state.phase.catchRoll) {
    throw new Error('Missing catch snapshot');
  }
  const { classBonus } = confirmed.state.phase.catchRoll;
  return { classBonus, state: advanceAutomatically(confirmed.state).state };
}

test('the first real catch roll in a Lap gets +1 and the second does not (§4.3, Appendix A)', () => {
  const first = catchWithPokeBall(encounter(mainCharacterGame()));
  expect(first.classBonus).toBe(1);
  const second = catchWithPokeBall(encounter(first.state));
  expect(second.classBonus).toBe(0);
});

test('a failed real catch roll still uses the Lap bonus (§4.3)', () => {
  const failed = catchWithPokeBall(encounter(mainCharacterGame(), 'fixture-unreachable'));
  expect(failed.classBonus).toBe(1);
  expect(failed.state.players[0]!.team).toHaveLength(1);
  expect(catchWithPokeBall(encounter(failed.state)).classBonus).toBe(0);
});

test('releasing without rolling does not use the Lap bonus (§4.3)', () => {
  const released = command(encounter(mainCharacterGame()), 'release');
  expect(released.state.phase).toEqual({ kind: 'end' });
  expect(catchWithPokeBall(encounter(released.state)).classBonus).toBe(1);
});

/** Credit the next Lap through a real owner move across Start, then keep the team. */
function crossStart(state: GameState): GameState {
  const scenario = structuredClone(state);
  scenario.activeSeatIndex = 0;
  scenario.phase = { kind: 'move' };
  scenario.players[0]!.routeProgress = 24 * scenario.players[0]!.creditedLap + 23;
  const moved = advanceAutomatically(command(scenario, 'roll').state).state;
  expect(moved.phase.kind).toBe('sell');
  return command(moved, 'sell', { pokemonInstanceIds: [] }).state;
}

test('the bonus is available again after the owner passes Start (§4.3, §4.7)', () => {
  const firstLap = catchWithPokeBall(encounter(mainCharacterGame()));
  expect(firstLap.classBonus).toBe(1);
  const nextLap = crossStart(firstLap.state);
  expect(nextLap.players[0]!.creditedLap).toBe(1);
  const first = catchWithPokeBall(encounter(nextLap));
  expect(first.classBonus).toBe(1);
  expect(catchWithPokeBall(encounter(first.state)).classBonus).toBe(0);
});

test('an unused Lap bonus does not carry over: the next Lap still gives only one +1 (§4.3)', () => {
  const nextLap = crossStart(crossStart(mainCharacterGame()));
  const first = catchWithPokeBall(encounter(nextLap));
  expect(first.classBonus).toBe(1);
  expect(catchWithPokeBall(encounter(first.state)).classBonus).toBe(0);
});

test('other classes get no catch bonus from the Main Character passive (§4.3, Appendix A)', () => {
  const state = encounter(mainCharacterGame());
  state.activeSeatIndex = 1;
  const confirmed = command(state, 'catch', { ballType: 'poke' });
  expect(confirmed.state.phase).toMatchObject({ catchRoll: { classBonus: 0 } });
  const rolled = advanceAutomatically(confirmed.state).state;
  expect(rolled.players[1]!.catchBonusUsedLap).toBeUndefined();
});

test('pre-Main-Character executable versions reject instead of replaying different catch rolls (§6.8)', () => {
  const state = mainCharacterGame();
  state.config.engineVersion = '0.4.0';
  expect(() => createGame(state.config, state.content)).toThrow(/unsupported/i);
  expect(() => createGameLog(state)).toThrow(/unsupported/i);
});

test('a first-catch bonus roll replays with the same snapshot and used-bonus record (§6.8, §8)', () => {
  const initial = encounter(mainCharacterGame());
  const log = createGameLog(initial);
  const confirmed = command(initial, 'catch', { ballType: 'poke' });
  const rolled = advanceAutomatically(confirmed.state);
  log.actions.push(confirmed.record, ...rolled.records);
  expect(replay(JSON.parse(JSON.stringify(log)))).toEqual(rolled.state);
  expect(rolled.state.players[0]!.catchBonusUsedLap).toBe(0);
});
