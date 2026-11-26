import { describe, expect, test } from 'vitest';
import { legalActions, pendingDecision } from '../../../engine/index.ts';
import { classOptions, engineContent } from './content.ts';
import { rollForFirstPlayer } from './firstPlayer.ts';
import {
  completeTable,
  newTableAi,
  seatsProblem,
  tableClassConflicts,
  type TableDraft,
  type TableSeatDraft,
} from './setup.ts';
import { configForTable, createGameStore, tableOpponentSettings, tablePeople } from './store.ts';

/** Spec §3 (local multiplayer setup, #258): seats are people or AIs, and the engine plays the table. */

const person = (name: string, classId?: string): TableSeatDraft => ({
  kind: 'person',
  name,
  ...(classId && {
    choice: {
      classId,
      starterSpeciesId: classOptions.find((o) => o.id === classId)!.starterSpeciesIds[0]!,
    },
  }),
});
const ai = (classId: string): TableSeatDraft => ({
  kind: 'ai',
  choice: {
    classId,
    starterSpeciesId: classOptions.find((o) => o.id === classId)!.starterSpeciesIds[0]!,
    personality: 'greedy',
    difficulty: 'easy',
  },
});
const table = (...seats: TableSeatDraft[]): TableDraft => ({ mode: 'quick', seats });

describe('seat list problems', () => {
  test('two or more people are needed, in two to four seats', () => {
    expect(seatsProblem([person('Ton'), ai('researcher')])).toEqual({ kind: 'people' });
    expect(seatsProblem([person('Ton')])).toEqual({ kind: 'people' });
    expect(seatsProblem([person('Ton'), person('Mai')])).toBeUndefined();
    expect(seatsProblem([person('A'), person('B'), person('C'), person('D'), person('E')])).toEqual(
      { kind: 'people' },
    );
  });

  test('a name must be present, short and different from the other people’s', () => {
    expect(seatsProblem([person('Ton'), person('  ')])).toEqual({
      kind: 'name',
      seat: 1,
      why: 'empty',
    });
    expect(seatsProblem([person('Ton'), person('x'.repeat(17))])).toEqual({
      kind: 'name',
      seat: 1,
      why: 'long',
    });
    expect(seatsProblem([person('Ton'), person(' ton ')])).toEqual({
      kind: 'name',
      seat: 1,
      why: 'taken',
    });
  });
});

describe('a finished table setup', () => {
  test('needs every person on a class of their own', () => {
    const partial = table(person('Ton', 'researcher'), person('Mai'), ai('fisherman'));
    expect(completeTable(partial, classOptions)).toBeUndefined();
    const repeat = table(person('Ton', 'researcher'), person('Mai', 'researcher'));
    expect(tableClassConflicts(repeat.seats)).toEqual([1]);
    expect(completeTable(repeat, classOptions)).toBeUndefined();
    const done = completeTable(
      table(person(' Ton  ', 'researcher'), person('Mai', 'rival'), ai('fisherman')),
      classOptions,
    );
    expect(done?.seats.map((seat) => seat.kind)).toEqual(['person', 'person', 'ai']);
    expect(done?.seats[0]).toMatchObject({ name: 'Ton' });
  });

  test('a new AI takes the first class no seat holds', () => {
    const seats = [person('Ton', 'main-character'), person('Mai', 'researcher')];
    const added = newTableAi(classOptions, seats)!;
    expect(seats.some((seat) => seat.choice?.classId === added.classId)).toBe(false);
  });
});

describe('the engine plays a table of people to the end', { timeout: 60_000 }, () => {
  /** Each pass screen is confirmed and the person takes the first thing the engine lists. */
  function playToEnd(seats: TableSeatDraft[]) {
    const setup = completeTable(table(...seats), classOptions)!;
    const store = createGameStore();
    store.start(
      { ...configForTable(setup, 'people-seed'), lapTarget: 1 },
      engineContent,
      tableOpponentSettings(setup),
      undefined,
      undefined,
      tablePeople(setup),
    );
    rollForFirstPlayer(store);
    const seen = new Set<number>();
    let passes = 0;
    for (let step = 0; step < 4000 && store.getResults() === null; step++) {
      if (store.getPass()) {
        seen.add(store.getPass()!.seatIndex);
        passes++;
        store.confirmPass();
        continue;
      }
      const view = store.getView();
      const choice = view?.legalActions.enabled[0];
      if (choice && view!.decision?.seatIndex === view!.seatIndex) {
        if ('rejected' in store.choose(choice.id)) throw new Error('rejected');
      } else if (!store.advance({ human: true })) {
        // An AI owes a choice: the backup bot's first listed action stands in for the server.
        const state = store.getSession()!.state;
        const seat = pendingDecision(state)!;
        const first = legalActions(state, seat.seatIndex).enabled[0]!;
        store.submit({ actorId: seat.actorId, kind: first.kind, payload: first.payload } as never);
      }
    }
    return { store, seen, passes };
  }

  test('four people, no AI', () => {
    const { store, seen, passes } = playToEnd([
      person('Ton', 'main-character'),
      person('Mai', 'researcher'),
      person('Kim', 'fisherman'),
      person('Joe', 'rival'),
    ]);
    expect(store.getResults()?.humanSeats).toEqual([0, 1, 2, 3]);
    expect(store.getResults()?.humanSeat).toBeUndefined();
    expect(seen).toEqual(new Set([0, 1, 2, 3]));
    expect(passes).toBeGreaterThan(3);
  });

  test('two people and two AIs', () => {
    const { store, seen } = playToEnd([
      person('Ton', 'main-character'),
      ai('fisherman'),
      person('Mai', 'researcher'),
      ai('rival'),
    ]);
    expect(store.getResults()?.humanSeats).toEqual([0, 2]);
    expect(seen).toEqual(new Set([0, 2]));
  });
});
