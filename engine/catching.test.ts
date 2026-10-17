import { expect, test } from 'vitest';
import { fc } from '@fast-check/vitest';
import {
  advanceAutomatically,
  applyAction,
  createGame,
  createGameConfig,
  createGameLog,
  replay,
  legalActions,
  gameStateSchema,
  fixtureSchema,
  type GameState,
} from './index.ts';
import fixture from './fixtures/start-of-game-2p.json';

function encounter(seed = 4): GameState {
  const scenario = fixtureSchema.parse(fixture).state;
  const state = createGame(
    createGameConfig({ seats: scenario.config.seats, seed, lapTarget: 3 }),
    scenario.content,
  );
  state.phase = {
    kind: 'encounter',
    pokemon: { speciesId: 'caterpie' },
  };
  state.globalTurnNo = 1;
  state.turnBudgets.catchAttempt = 1;
  return state;
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

test('confirming a catch spends one chosen Ball and budget before the logged roll, then creates a team UID (§4.3, §8)', () => {
  const state = encounter();
  const before = structuredClone(state);
  const confirmed = command(state, 'catch', { ballType: 'great' });
  expect(confirmed.state.players[0]!.balls).toEqual({ poke: 5, great: 0, ultra: 0 });
  expect(confirmed.state.turnBudgets.catchAttempt).toBe(0);
  expect(confirmed.state.players[0]!.team).toEqual(state.players[0]!.team);
  expect(confirmed.events).toEqual([]);
  expect(confirmed.state.rng).toEqual(state.rng);
  const rolled = advanceAutomatically(confirmed.state);
  expect(rolled.state.phase).toEqual({ kind: 'end' });
  expect(rolled.state.players[0]!.team).toHaveLength(2);
  const caught = rolled.state.players[0]!.team[1]!;
  expect(caught).toMatchObject({
    speciesId: 'caterpie',
    origin: 'caught',
    evolutionStage: 0,
    tired: false,
    abilityReady: true,
  });
  expect(rolled.events).toEqual([
    { kind: 'random_result', purpose: 'catch:0:1', result: 6, drawCounter: 1 },
    { kind: 'uid_created', instanceId: caught.instanceId, entity: 'pokemon', ownerId: 'player-0' },
    { kind: 'phase_changed', from: 'encounter', to: 'end' },
  ]);
  expect(state).toEqual(before);
});

test('Wild resolution draws a species with two logged RNG results and creates no UID (§4.5)', () => {
  const state = encounter(1);
  state.phase = { kind: 'resolve' };
  state.players[0]!.routeProgress = 1;
  const before = structuredClone(state);
  const resolved = command(state, 'skip');
  expect(resolved.state.phase).toEqual({ kind: 'encounter', pokemon: { speciesId: 'eevee' } });
  expect(resolved.events).toEqual([
    { kind: 'space_resolved', seatIndex: 0, position: 1 },
    { kind: 'random_result', purpose: 'encounter:rarity', result: 1, drawCounter: 1 },
    { kind: 'random_result', purpose: 'encounter:species', result: 0, drawCounter: 2 },
    { kind: 'phase_changed', from: 'resolve', to: 'encounter' },
  ]);
  expect(resolved.state.players).toEqual(state.players);
  expect(state).toEqual(before);
});

// 20,000 commands through the public applyAction seam, each structuredClone-ing state,
// take ~4-6s depending on the runner, so this test gets an explicit budget above the 5s default.
test(
  '10,000 seed-1 Wild draws exclude starters/Porygon and preserve 50/33/17 rarity weights (§4.5, §8)',
  {
    timeout: 30_000,
  },
  () => {
    let state = encounter(1);
    // Include each excluded species so exclusion is actually exercised.
    for (const id of ['charmander', 'squirtle', 'porygon']) {
      state.content.species.push({
        ...state.content.species.find((entry) => entry.id === 'bulbasaur')!,
        id,
      });
    }
    const excluded = new Set(['bulbasaur', 'charmander', 'squirtle', 'porygon']);
    const rarityOf = new Map(state.content.species.map((entry) => [entry.id, entry.rarity]));
    const counts = { common: 0, uncommon: 0, rare: 0 };
    const speciesCounts: Record<string, number> = {};
    // Collect per-draw violations and assert once, so 10,000 iterations do not pay for 40,000 expects.
    const violations: string[] = [];
    for (let draw = 0; draw < 10_000; draw++) {
      state.phase = { kind: 'resolve' };
      state.players[0]!.routeProgress = 1;
      const result = command(state, 'skip');
      state = result.state;
      if (state.phase.kind !== 'encounter') throw new Error('Missing encounter');
      const id = state.phase.pokemon.speciesId;
      if (excluded.has(id)) violations.push(`draw ${draw}: excluded species ${id}`);
      if (result.events.some((event) => event.kind === 'uid_created')) {
        violations.push(`draw ${draw}: uid_created on encounter`);
      }
      if (state.rng.cursor !== (draw + 1) * 2) {
        violations.push(`draw ${draw}: rng cursor ${state.rng.cursor}`);
      }
      counts[rarityOf.get(id)!]++;
      speciesCounts[id] = (speciesCounts[id] ?? 0) + 1;
      state = command(state, 'release').state;
    }
    expect(violations).toEqual([]);
    expect(Math.abs(counts.common / 10_000 - 0.5)).toBeLessThanOrEqual(0.03);
    expect(Math.abs(counts.uncommon / 10_000 - 0.33)).toBeLessThanOrEqual(0.03);
    expect(Math.abs(counts.rare / 10_000 - 0.17)).toBeLessThanOrEqual(0.03);
    // The two common species must be picked uniformly, rather than by weight or DC.
    expect(Math.abs(speciesCounts.caterpie! / counts.common - 0.5)).toBeLessThanOrEqual(0.03);
    expect(Math.abs(speciesCounts.pidgey! / counts.common - 0.5)).toBeLessThanOrEqual(0.03);
    expect(state.players[0]!.team).toHaveLength(1);
  },
);

test.each([
  { ballType: 'poke', seed: 1, die: 4, bonus: 0, succeeds: true },
  { ballType: 'poke', seed: 14, die: 3, bonus: 0, succeeds: false },
  { ballType: 'great', seed: 14, die: 3, bonus: 1, succeeds: true },
  { ballType: 'great', seed: 0, die: 2, bonus: 1, succeeds: false },
  { ballType: 'ultra', seed: 0, die: 2, bonus: 2, succeeds: true },
  { ballType: 'ultra', seed: 7, die: 1, bonus: 2, succeeds: false },
] as const)(
  '$ballType scripted die $die with bonus $bonus against DC 4: success=$succeeds (§4.3)',
  ({ ballType, seed, die, bonus, succeeds }) => {
    const state = encounter(seed);
    state.phase = { kind: 'encounter', pokemon: { speciesId: 'eevee' } };
    state.players[0]!.balls = { poke: 2, great: 2, ultra: 2 };
    const confirmed = command(state, 'catch', { ballType });
    expect(confirmed.state.phase).toMatchObject({
      catchRoll: {
        ballType,
        catchDC: 4,
        classBonus: 0,
        ballBonus: bonus,
        abilityBonus: 0,
        itemBonus: 0,
      },
    });
    expect(gameStateSchema.parse(confirmed.state)).toEqual(confirmed.state);
    expect(legalActions(confirmed.state, 0)).toEqual({ enabled: [], disabled: [] });
    // Seeded RNG is the script: submit the literal expected die through the engine action seam.
    const rolled = applyAction(confirmed.state, {
      actorId: 'engine',
      actionSeq: 2,
      stateRevisionBefore: 1,
      kind: 'dice_result',
      payload: { purpose: 'catch:0:1', value: die },
    });
    if ('rejected' in rolled) throw new Error(rolled.reason);
    const expectedBalls = { poke: 2, great: 2, ultra: 2 };
    expectedBalls[ballType] = 1;
    expect(rolled.state.players[0]!.balls).toEqual(expectedBalls);
    expect(rolled.events[0]).toEqual({
      kind: 'random_result',
      purpose: 'catch:0:1',
      result: die,
      drawCounter: 1,
    });
    expect(rolled.state.players[0]!.team).toHaveLength(succeeds ? 2 : 1);
    expect(rolled.events.filter((event) => event.kind === 'uid_created')).toHaveLength(
      succeeds ? 1 : 0,
    );
    expect(rolled.state.phase).toEqual({ kind: 'end' });
    const repeated = applyAction(rolled.state, {
      actorId: 'engine',
      actionSeq: 3,
      stateRevisionBefore: 2,
      kind: 'dice_result',
      payload: { purpose: 'catch:0:1', value: die },
    });
    expect(repeated).toMatchObject({ rejected: true, reason: 'illegal_action' });
    expect(repeated.state).toBe(rolled.state);
  },
);

test('empty Ball pouch permits only release, with NO_BALL / No Ball on catches (§3.1)', () => {
  const state = encounter();
  state.players[0]!.balls = { poke: 0, great: 0, ultra: 0 };
  expect(legalActions(state, 0)).toEqual({
    enabled: [{ id: 'release', kind: 'release', payload: {} }],
    disabled: ['poke', 'great', 'ultra'].map((ballType) => ({
      id: `catch:${ballType}`,
      kind: 'catch',
      payload: { ballType },
      reasonCode: 'NO_BALL',
      reasonText: 'No Ball',
    })),
  });
  const illegal = applyAction(state, {
    actorId: 'player-0',
    actionSeq: 1,
    stateRevisionBefore: 0,
    kind: 'catch',
    payload: { ballType: 'poke' },
  });
  expect(illegal).toMatchObject({ rejected: true, reason: 'illegal_action' });
  expect(illegal.state).toBe(state);
  const released = command(state, 'release');
  expect(released.state.players).toEqual(state.players);
  expect(released.state.turnBudgets).toEqual(state.turnBudgets);
  expect(released.state.rng).toEqual(state.rng);
  expect(released.events).toEqual([{ kind: 'phase_changed', from: 'encounter', to: 'end' }]);
});

test('a spent catch budget disables a second same-turn encounter despite held Balls (§4.2, §8)', () => {
  const confirmed = command(encounter(), 'catch', { ballType: 'poke' });
  for (const kind of ['catch', 'release']) {
    const rejected = applyAction(confirmed.state, {
      actorId: 'player-0',
      actionSeq: 2,
      stateRevisionBefore: 1,
      kind,
      payload: kind === 'catch' ? { ballType: 'great' } : {},
    });
    expect(rejected).toMatchObject({ rejected: true, reason: 'illegal_action' });
    expect(rejected.state).toBe(confirmed.state);
  }
  const state = advanceAutomatically(confirmed.state).state;
  // A later effect could introduce another encounter in this same turn.
  state.phase = { kind: 'encounter', pokemon: { speciesId: 'eevee' } };
  expect(legalActions(state, 0).enabled.map((choice) => choice.kind)).toEqual(['release']);
  expect(legalActions(state, 0).disabled).toContainEqual({
    id: 'catch:poke',
    kind: 'catch',
    payload: { ballType: 'poke' },
    reasonCode: 'ALREADY_USED_THIS_TURN',
    reasonText: 'Catch already used this turn',
  });
  const rejected = applyAction(state, {
    actorId: 'player-0',
    actionSeq: 3,
    stateRevisionBefore: 2,
    kind: 'catch',
    payload: { ballType: 'poke' },
  });
  expect(rejected).toMatchObject({ rejected: true, reason: 'illegal_action' });
  expect(rejected.state).toBe(state);
});

test('release with held Balls consumes none and creates no Pokémon (§4.3, §8)', () => {
  const state = encounter();
  const result = command(state, 'release');
  expect(result.state.players).toEqual(state.players);
  expect(result.state.rng).toEqual(state.rng);
  expect(result.state.turnBudgets).toEqual(state.turnBudgets);
  expect(result.state.phase).toEqual({ kind: 'end' });
  expect(result.events).toEqual([{ kind: 'phase_changed', from: 'encounter', to: 'end' }]);
});

test('repeated species get distinct team UIDs and pending/resolved catches resume and replay once (§4.5, §8)', () => {
  let state = encounter();
  for (const player of state.players) player.balls = { poke: 5, great: 5, ultra: 20 };
  const log = createGameLog(state);
  const caughtIds: string[] = [];
  for (let step = 0; step < 400 && caughtIds.length < 2; step++) {
    if (state.phase.kind === 'encounter') {
      if (state.phase.pokemon.speciesId === 'caterpie') {
        const confirmed = command(state, 'catch', { ballType: 'ultra' });
        log.actions.push(confirmed.record);
        const resumed = replay(JSON.parse(JSON.stringify(log)));
        expect(resumed).toEqual(confirmed.state);
        const result = advanceAutomatically(resumed);
        log.actions.push(...result.records);
        state = result.state;
        const created = result.events.filter((event) => event.kind === 'uid_created');
        expect(created).toHaveLength(1); // Caterpie DC 2 always succeeds with Ultra +2.
        caughtIds.push(created[0]!.instanceId);
        expect(replay(JSON.parse(JSON.stringify(log)))).toEqual(state);
      } else {
        const result = command(state, 'release');
        state = result.state;
        log.actions.push(result.record);
      }
    } else {
      const result = advanceAutomatically(state);
      expect(result.records).toHaveLength(1);
      state = result.state;
      log.actions.push(...result.records);
    }
  }
  expect(caughtIds).toHaveLength(2);
  expect(new Set(caughtIds).size).toBe(2);
  const allIds = state.players.flatMap((player) =>
    player.team.map((pokemon) => pokemon.instanceId),
  );
  expect(new Set(allIds).size).toBe(allIds.length);
  expect(
    state.players
      .flatMap((player) => player.team)
      .filter((pokemon) => caughtIds.includes(pokemon.instanceId))
      .map((pokemon) => pokemon.speciesId),
  ).toEqual(['caterpie', 'caterpie']);
  expect(replay(log)).toEqual(state);
});

// 30 property runs of up to 300 public-API turns each, with replay, take ~6-8s on Node 24,
// so this test gets an explicit budget above the 5s default; runs and assertions are unchanged.
test(
  'random legal turn sequences spend exactly the selected Ball on every attempt and none on release (§8)',
  {
    timeout: 20_000,
  },
  () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100_000 }),
        fc.array(fc.nat(), { minLength: 150, maxLength: 300 }),
        (seed, selections) => {
          let state = encounter(seed);
          for (const player of state.players) player.balls = { poke: 3, great: 3, ultra: 3 };
          const log = createGameLog(state);
          for (const selection of selections) {
            const before = state;
            if (state.phase.kind === 'encounter' && !state.phase.catchRoll) {
              const choices = legalActions(state, state.activeSeatIndex).enabled;
              const choice = choices[selection % choices.length]!;
              const result = command(state, choice.kind, choice.payload);
              const expected = structuredClone(before.players.map((player) => player.balls));
              if (choice.kind === 'catch') {
                expected[before.activeSeatIndex]![choice.payload.ballType]--;
                expect(result.state.turnBudgets.catchAttempt).toBe(0);
              } else {
                expect(choice.kind).toBe('release');
                expect(result.state.turnBudgets).toEqual(before.turnBudgets);
              }
              expect(result.state.players.map((player) => player.balls)).toEqual(expected);
              expect(result.state.players.map((player) => player.team)).toEqual(
                before.players.map((player) => player.team),
              );
              expect(result.events.filter((event) => event.kind === 'uid_created')).toEqual([]);
              state = result.state;
              log.actions.push(result.record);
            } else {
              const result = advanceAutomatically(state);
              expect(result.records).toHaveLength(1);
              expect(result.state.players.map((player) => player.balls)).toEqual(
                before.players.map((player) => player.balls),
              );
              state = result.state;
              log.actions.push(...result.records);
            }
            for (const player of state.players) {
              expect(player.balls.poke).toBeGreaterThanOrEqual(0);
              expect(player.balls.great).toBeGreaterThanOrEqual(0);
              expect(player.balls.ultra).toBeGreaterThanOrEqual(0);
            }
          }
          expect(replay(JSON.parse(JSON.stringify(log)))).toEqual(state);
        },
      ),
      { numRuns: 30, seed: 23 },
    );
  },
);

test('pending catch rejects forged dice and late Ball changes without spending again (§4.3, §8)', () => {
  const state = encounter(1);
  state.phase = { kind: 'encounter', pokemon: { speciesId: 'eevee' } };
  const confirmed = command(state, 'catch', { ballType: 'poke' });
  const before = structuredClone(confirmed.state);
  for (const payload of [
    { purpose: 'catch:0:1', value: 3 }, // Seed 1 is 4, not 3.
    { purpose: 'other', value: 4 },
    { purpose: 'catch:1:1', value: 4 },
  ]) {
    const result = applyAction(confirmed.state, {
      actorId: 'engine',
      actionSeq: 2,
      stateRevisionBefore: 1,
      kind: 'dice_result',
      payload,
    });
    expect(result).toMatchObject({ rejected: true, reason: 'illegal_action' });
    expect(result.state).toBe(confirmed.state);
  }
  const late = applyAction(confirmed.state, {
    actorId: 'player-0',
    actionSeq: 2,
    stateRevisionBefore: 1,
    kind: 'catch',
    payload: { ballType: 'great' },
  });
  expect(late).toMatchObject({ rejected: true, reason: 'illegal_action' });
  expect(confirmed.state).toEqual(before);
  expect(advanceAutomatically(confirmed.state).state.players[0]!.team).toHaveLength(2);
});
