import { vi } from 'vitest';
import { createGameConfig, type GameConfig } from '../../../engine/index.ts';
import { engineContent } from '../game/content.ts';
import { createGameStore, type GameStore, type OpponentSettings } from '../game/store.ts';

/** Test helpers for watched games: every seat is an AI and no seat is human. */

export const SEATS = [
  { classId: 'main-character', starterSpeciesId: 'bulbasaur' },
  { classId: 'researcher', starterSpeciesId: 'porygon' },
  { classId: 'rival', starterSpeciesId: 'eevee' },
  { classId: 'fisherman', starterSpeciesId: 'magikarp' },
];

/** A game with no human seat: every seat is an AI. */
export function watchConfig(seats: 2 | 3 | 4, seed: GameConfig['seed'] = 11): GameConfig {
  return createGameConfig({
    seats: SEATS.slice(0, seats).map((seat, seatIndex) => ({
      actorId: `ai-${seatIndex}`,
      seatIndex,
      ...seat,
      controller: 'ai' as const,
    })),
    seed,
    lapTarget: 2,
  });
}

export const settingsFor = (seats: number): OpponentSettings[] =>
  Array.from({ length: seats }, (_, seatIndex) => ({
    seatIndex,
    personality: seatIndex % 2 ? ('cautious' as const) : ('greedy' as const),
    difficulty: 'normal' as const,
  }));

export function watchStore(seats: 2 | 3 | 4, seed?: GameConfig['seed']): GameStore {
  const store = createGameStore();
  store.start(watchConfig(seats, seed), engineContent, settingsFor(seats));
  return store;
}

const json = (value: unknown) => new Response(JSON.stringify(value));

/**
 * The local server, faked. `jev` answers decisions itself; `down` makes the decision route fail
 * so the backup bot answers; `gate` holds the decision route until released. Every seat takes
 * its first enabled action, so a game is a pure function of its seed.
 */
export function fakeServer(mode: 'jev' | 'down' = 'jev', gate?: Promise<void>) {
  const calls = { decide: 0 };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const path = String(url);
      if (path === '/api/ai/status')
        return json({ backupOnly: mode === 'down', jevEnabled: mode !== 'down', reason: null });
      if (path === '/api/ai/outcome') return new Response(null, { status: 204 });
      const choice = JSON.parse(String(init?.body)).enabledActions[0].id;
      if (path === '/api/ai/fallback') return json({ choice, source: 'fallback' });
      calls.decide++;
      if (mode === 'down') throw new TypeError('network down');
      await gate;
      return json({ choice, source: 'jev' });
    }),
  );
  return calls;
}

/** Plays whatever is next, as the playback hook does, until `stop` or the game finishes. */
export async function playOut(store: GameStore, stop: (steps: number) => boolean = () => false) {
  for (let steps = 0; steps < 20_000; steps++) {
    if (store.getSession()!.state.phase.kind === 'finished' || stop(steps)) return steps;
    if (store.advance({ human: true })) continue;
    if (!(await store.playOpponent(new AbortController().signal))) throw new Error('stuck');
  }
  throw new Error('game did not finish');
}
