import { expect, test } from 'vitest';
import {
  applyAction,
  checkInvariants,
  createGameLog,
  deserialize,
  replay,
  resume,
  serialize,
  stateHash,
  type GameState,
} from '../engine/index.ts';
import { realEngine } from './engine.ts';
import { POLICIES } from './policy.ts';
import { DEFAULT_OPTIONS, runSim } from './runner.ts';

// Seeded games that draw all six Events and replay them: ~22 s alone; budget for load (ET-05).
const EVENTS_MS = 120_000;

test(
  'seeded sim draws and resolves all six Events, recycles the deck, and resumes/replays identical draws (§4.6, §6, §8)',
  async () => {
    let resumedGames = 0;
    const { summary, failures } = await runSim(
      realEngine,
      { ...DEFAULT_OPTIONS, games: 12, seed: 162, seats: 3 },
      POLICIES,
      checkInvariants,
      (game) => {
        const log = createGameLog(game.initialState);
        log.actions = game.records;
        expect(stateHash(replay(log))).toBe(stateHash(game.state));
        const split =
          game.records.findIndex((record) =>
            record.events.some((event) => event.kind === 'event_drawn'),
          ) + 1;
        expect(split).toBeGreaterThan(0);
        const partial = { ...log, actions: log.actions.slice(0, split) };
        const saved = deserialize(serialize({ state: replay(partial), log: partial }));
        let state: GameState = resume(saved).state;
        expect(state).toEqual(saved.state);
        for (const record of log.actions.slice(split)) {
          const result = applyAction(state, record.action);
          if ('rejected' in result) throw new Error(result.reason);
          expect(result.events).toEqual(record.events);
          state = result.state;
        }
        expect(stateHash(state)).toBe(stateHash(game.state));
        resumedGames++;
      },
    );
    expect(failures).toEqual([]);
    expect(summary.aborted).toBe(0);
    expect(summary.illegalAppliedActionCount).toBe(0);
    expect(summary.invariantFailures).toBe(0);
    expect(resumedGames).toBe(12);
    for (const id of ['e1', 'e2', 'e3', 'e4', 'e5', 'e6']) {
      expect(summary.events.drawn[id]).toBeGreaterThan(0);
      expect(summary.events.resolved[id]).toBe(summary.events.drawn[id]);
    }
    expect(summary.events.shuffles).toBeGreaterThan(summary.games);
  },
  EVENTS_MS,
);
