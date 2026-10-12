/// <reference types="vite/client" />
import { expect, test } from 'vitest';
import { fixtureSchema, observe, legalActions, applyAction } from './index.ts';

const fixtures = import.meta.glob<unknown>('./fixtures/*.json', { eager: true, import: 'default' });

test('shared fixture schema validates a complete 2-seat snapshot and rejects negative counters', () => {
  const fixture = fixtureSchema.parse(fixtures['./fixtures/start-of-game-2p.json']);
  expect(fixture.state.players.map((player) => player.seatIndex)).toEqual([0, 1]);
  expect(
    fixtureSchema.safeParse({ ...fixture, state: { ...fixture.state, stateRevision: -1 } }).success,
  ).toBe(false);
});

test('observation reveals only a seat’s own secrets and public starting-kit items (spec §5.4)', () => {
  const fixture = fixtureSchema.parse(fixtures['./fixtures/strategy-with-items.json']);
  const seat0 = observe(fixture.state, 0);
  expect(seat0).toEqual(fixture.observation['0']);
  expect(observe(fixture.state, 1)).toEqual(fixture.observation['1']);
  expect(JSON.stringify(seat0)).not.toMatch(
    /SECRET_ITEM_SENTINEL|PRIVATE_RESULT_SENTINEL|RNG_STATE_SENTINEL|EVENT_ORDER_SENTINEL|drawPile|discardPile|rng|cursor/,
  );
  const startingKit = fixtureSchema.parse(fixtures['./fixtures/start-of-game-2p.json']);
  expect(observe(startingKit.state, 0).public.players[1]?.knownItems[0]?.name).toBe('Lucky Egg');
});

test('encounter choices show Ball availability and permit release without a Ball (spec §3.1)', () => {
  for (const name of ['encounter-with-balls', 'encounter-no-ball']) {
    const fixture = fixtureSchema.parse(fixtures[`./fixtures/${name}.json`]);
    expect(legalActions(fixture.state, 0)).toEqual(fixture.legalActions['0']);
  }
});

test('one coin buys a Poké Ball but not Great/Ultra Balls (approved issue #3 clarification)', () => {
  const fixture = fixtureSchema.parse(fixtures['./fixtures/shop-low-coins.json']);
  expect(legalActions(fixture.state, 0)).toEqual(fixture.legalActions['0']);
});

test('zero coins disables every Shop purchase with a reason and keeps skip enabled (spec §3.1)', () => {
  const fixture = fixtureSchema.parse(fixtures['./fixtures/shop-no-coins.json']);
  expect(legalActions(fixture.state, 0)).toEqual(fixture.legalActions['0']);
  expect(fixture.legalActions['0']?.enabled.map((action) => action.kind)).toEqual(['skip']);
});

test('the initial active seat can roll while the other seat sees an out-of-turn reason', () => {
  const fixture = fixtureSchema.parse(fixtures['./fixtures/start-of-game-2p.json']);
  expect(legalActions(fixture.state, 0)).toEqual(fixture.legalActions['0']);
  expect(legalActions(fixture.state, 1)).toEqual(fixture.legalActions['1']);
});

test('Strategy scaffold lists own item choices and skip without exposing another seat’s items', () => {
  const fixture = fixtureSchema.parse(fixtures['./fixtures/strategy-with-items.json']);
  expect(legalActions(fixture.state, 0)).toEqual(fixture.legalActions['0']);
  expect(legalActions(fixture.state, 1)).toEqual(fixture.legalActions['1']);
});

test('Sell fixture offers three Pokémon including the base Original Starter and a finish choice', () => {
  const fixture = fixtureSchema.parse(fixtures['./fixtures/sell-phase-three-pokemon.json']);
  expect(fixture.state.players[0]?.team).toHaveLength(3);
  expect(fixture.state.players[0]?.team[0]).toMatchObject({
    origin: 'original_starter',
    evolutionStage: 0,
  });
  expect(legalActions(fixture.state, 0)).toEqual(fixture.legalActions['0']);
});

test('Final Table Round exposes its target and keeps seat, turn, progress and Lap counters separate', () => {
  const fixture = fixtureSchema.parse(fixtures['./fixtures/final-table-round.json']);
  expect(fixture.state.finalTableRound).toEqual({ triggerSeatIndex: 0, targetOwnTurnNo: 4 });
  expect(fixture.state.players[0]).toMatchObject({
    seatIndex: 0,
    ownTurnNo: 4,
    routeProgress: 72,
    creditedLap: 3,
  });
  expect(fixture.state.globalTurnNo).toBe(8);
  expect(observe(fixture.state, 0)).toEqual(fixture.observation['0']);
  expect(legalActions(fixture.state, 1)).toEqual(fixture.legalActions['1']);
});

test('stale records are rejected without changing the fixture snapshot (spec §8)', () => {
  const fixture = fixtureSchema.parse(fixtures['./fixtures/start-of-game-2p.json']);
  const before = structuredClone(fixture.state);
  for (const stateRevisionBefore of [99, 100]) {
    expect(
      applyAction(fixture.state, {
        actorId: 'player-0',
        actionSeq: 1,
        stateRevisionBefore,
        kind: 'roll',
        payload: {},
      }),
    ).toEqual({ rejected: true, reason: 'stale_revision', state: fixture.state });
    expect(fixture.state).toEqual(before);
  }
});

test('short log sequences player and engine actions together and records sourced transfers', () => {
  const fixture = fixtureSchema.parse(fixtures['./fixtures/log-short.json']);
  expect(fixture.log).toHaveLength(6);
  expect(fixture.log.map(({ action }) => [action.actionSeq, action.stateRevisionBefore])).toEqual([
    [1, 0],
    [2, 1],
    [3, 2],
    [4, 3],
    [5, 4],
    [6, 5],
  ]);
  expect(fixture.state.stateRevision).toBe(6);
  expect(fixture.log[4]?.events).toContainEqual({
    kind: 'coin_transfer',
    source: { kind: 'bank' },
    destination: { kind: 'player', actorId: 'player-0' },
    amount: 6,
    reason: 'event:e2',
  });
  expect(fixture.log.map(({ action }) => action.kind)).toEqual([
    'shuffle',
    'skip',
    'roll',
    'dice_result',
    'event_draw',
    'skip',
  ]);
});

test('short log’s intermediate resolve phase is valid in state and seat observations', () => {
  const fixture = fixtureSchema.parse(fixtures['./fixtures/log-short.json']);
  expect(fixture.log[3]?.events).toContainEqual({
    kind: 'phase_changed',
    from: 'move',
    to: 'resolve',
  });
  expect(
    fixtureSchema.safeParse({
      ...fixture,
      state: { ...fixture.state, stateRevision: 4, phase: { kind: 'resolve' } },
      observation: Object.fromEntries(
        Object.entries(fixture.observation).map(([seat, observation]) => [
          seat,
          {
            ...observation,
            public: { ...observation.public, stateRevision: 4, phase: { kind: 'resolve' } },
          },
        ]),
      ),
    }).success,
  ).toBe(true);
});

test('every shipped fixture validates and agrees with the exported observation and action seams', () => {
  expect(Object.values(fixtures)).toHaveLength(9);
  for (const input of Object.values(fixtures)) {
    const fixture = fixtureSchema.parse(input);
    for (const [seat, expected] of Object.entries(fixture.observation)) {
      expect(observe(fixture.state, Number(seat)), `${fixture.name}, observation ${seat}`).toEqual(
        expected,
      );
    }
    for (const [seat, expected] of Object.entries(fixture.legalActions)) {
      expect(legalActions(fixture.state, Number(seat)), `${fixture.name}, actions ${seat}`).toEqual(
        expected,
      );
    }
  }
});
