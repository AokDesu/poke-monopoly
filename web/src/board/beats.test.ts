import { afterEach, describe, expect, test, vi } from 'vitest';
import { content, engineContent } from '../game/content.ts';
import {
  configForSetup,
  createGameStore,
  opponentSettings,
  type GameStore,
} from '../game/store.ts';
import { itemName } from '../i18n/names.ts';
import { settingsFor, watchConfig } from '../test/watchGame.ts';
import { tableBeats, type Beat } from './beats.ts';

afterEach(() => {
  vi.unstubAllGlobals();
});

const ITEM_NAMES = content.items.map((item) => item.name);
const UTILITY_NAMES = content.items
  .filter((item) => item.kind === 'utility')
  .map((item) => item.name);

/**
 * The local server, faked to make rivals busy: every seat uses an item when it can, buys when it
 * can, throws a Ball when it can, and otherwise takes the first option. So rivals buy and use
 * secret items, hostile ones included, on the human and on each other.
 */
function busyServer() {
  vi.stubGlobal('fetch', async (url: RequestInfo | URL, init?: RequestInit) => {
    const path = String(url);
    if (path === '/api/ai/status')
      return new Response(JSON.stringify({ backupOnly: false, jevEnabled: true, reason: null }));
    if (path === '/api/ai/outcome') return new Response(null, { status: 204 });
    const { enabledActions } = JSON.parse(String(init?.body)) as {
      enabledActions: { id: string; kind: string }[];
    };
    const pick =
      enabledActions.find((entry) => entry.kind === 'use_item') ??
      enabledActions.find((entry) => entry.kind === 'buy') ??
      enabledActions.find((entry) => entry.kind === 'catch') ??
      enabledActions[0]!;
    return new Response(JSON.stringify({ choice: pick.id, source: 'jev' }));
  });
}

const QUIET = ['skip', 'roll', 'keep-die', 'finish-sell', 'skip-shop', 'release'];

/** Plays the store on: automatic steps, a human's quietest choice, the rivals from the server. */
async function play(store: GameStore, turns: number) {
  for (let step = 0; step < 6000; step++) {
    const { state } = store.getSession()!;
    if (state.phase.kind === 'finished' || state.globalTurnNo > turns) return;
    if (store.advance({ human: true })) continue;
    const view = store.getView();
    if (view?.decision?.seatIndex === view?.seatIndex && view?.legalActions.enabled.length) {
      const options = view.legalActions.enabled;
      const choice =
        QUIET.map((id) => options.find((entry) => entry.id === id)).find(Boolean) ?? options[0]!;
      store.choose(choice.id);
      continue;
    }
    if (!(await store.playOpponent(new AbortController().signal))) throw new Error('stuck');
  }
}

function humanGame(seed: number): GameStore {
  const setup = {
    mode: 'quick' as const,
    human: { classId: 'main-character', starterSpeciesId: 'bulbasaur' },
    opponents: [
      { classId: 'researcher', starterSpeciesId: 'porygon' },
      { classId: 'rival', starterSpeciesId: 'eevee' },
      { classId: 'fisherman', starterSpeciesId: 'magikarp' },
    ].map((seat) => ({ ...seat, personality: 'greedy' as const, difficulty: 'normal' as const })),
  };
  const store = createGameStore();
  store.start(configForSetup(setup, seed), engineContent, opponentSettings(setup));
  return store;
}

const humanBeats = (store: GameStore) => {
  const view = store.getView()!;
  return tableBeats(view.feed, { game: view.observation.public, viewerSeat: view.seatIndex });
};

/**
 * Where each full log record sits in the human's feed, or -1 for one it may not see (a chat
 * between two other seats). The feed keeps the log's order, so actor and kind line them up.
 */
function feedIndexes(store: GameStore): number[] {
  const feed = store.getView()!.feed;
  let next = 0;
  return store.getSession()!.log.actions.map((record) => {
    const entry = feed[next];
    return entry &&
      entry.record.action.actorId === record.action.actorId &&
      entry.record.action.kind === record.action.kind
      ? next++
      : -1;
  });
}

describe('hidden information never reaches a beat (spec §4.1)', () => {
  test.each([3, 17, 29])(
    'seed %i: what a rival bought, and an item it used on another seat, stay secret',
    async (seed) => {
      busyServer();
      const store = humanGame(seed);
      await play(store, 48);
      const { log, state } = store.getSession()!;
      const beats = humanBeats(store);
      const indexes = feedIndexes(store);
      let purchases = 0;
      log.actions.forEach((record, index) => {
        const seat = state.players.find((player) => player.actorId === record.action.actorId);
        if (!seat || seat.seatIndex === 0) return;
        const told = beats.filter((beat) => beat.at === indexes[index]).map((beat) => beat.text);
        // The full log knows which offer was bought; the human sees the price alone.
        if (record.action.kind === 'buy') {
          purchases++;
          expect(told.length, 'a rival purchase is told').toBeGreaterThan(0);
          for (const text of told) for (const name of ITEM_NAMES) expect(text).not.toContain(name);
        }
        for (const event of record.events) {
          if (event.kind !== 'hostile_item_used' || event.targetSeatIndex === 0) continue;
          for (const text of told) expect(text).not.toContain(itemName(event.itemId));
        }
      });
      expect(purchases).toBeGreaterThan(0);
    },
  );

  test('a hostile item used on the human is named to the human and marked as touching it', async () => {
    busyServer();
    let named: Beat | undefined;
    for (const seed of [3, 17, 29, 41, 53, 67]) {
      const store = humanGame(seed);
      await play(store, 60);
      named = humanBeats(store).find(
        (beat) => beat.key === 'beat.usedItemOn' && beat.seatIndex !== 0,
      );
      if (named) break;
    }
    expect(named, 'some rival used a hostile item on the human').toBeDefined();
    expect(named!.touchedYou).toBe(true);
    expect(UTILITY_NAMES.some((name) => named!.text.includes(name))).toBe(true);
    expect(named!.text).toMatch(/on you\b/);
  });

  test('a watcher’s beats name no secret item: no purchase, no use, no reward', async () => {
    busyServer();
    const store = createGameStore();
    store.start(watchConfig(4, 5), engineContent, settingsFor(4));
    for (let step = 0; step < 5000; step++) {
      const { state } = store.getSession()!;
      if (state.phase.kind === 'finished' || state.globalTurnNo > 40) break;
      if (store.advance({ human: true })) continue;
      if (!(await store.playOpponent(new AbortController().signal))) break;
    }
    const view = store.getSpectatorView()!;
    const beats = tableBeats(view.feed, { game: view.observation.public, viewerSeat: undefined });
    expect(beats.some((beat) => beat.key === 'beat.bought')).toBe(true);
    for (const beat of beats) {
      expect(beat.touchedYou).toBe(false);
      // A shield covering a coin loss is public (the engine tells every seat), so it may be named.
      if (beat.key === 'beat.covered') continue;
      for (const name of UTILITY_NAMES) expect(beat.text, beat.key).not.toContain(name);
    }
  });
});

describe('a Deal Card payment (spec §4.8)', () => {
  test('a payment the viewing seat agreed to is told as coins, never as something that touched it', async () => {
    busyServer();
    const store = humanGame(3);
    await play(store, 6);
    const view = store.getView()!;
    const human = view.observation.public.players.find((player) => player.seatIndex === 0)!;
    // The first rival move in the feed, with a deal payment from the human added to its events.
    const index = view.feed.findIndex(
      (entry) =>
        entry.before.globalTurnNo >= 1 &&
        entry.before.activeSeatIndex !== 0 &&
        entry.record.action.kind === 'roll',
    );
    const entry = view.feed[index]!;
    const rival = view.observation.public.players.find(
      (player) => player.seatIndex === entry.before.activeSeatIndex,
    )!;
    const payment = (reason: string) => ({
      kind: 'coin_transfer' as const,
      source: { kind: 'player' as const, actorId: human.actorId },
      destination: { kind: 'player' as const, actorId: rival.actorId },
      amount: 4,
      reason,
    });
    const told = (reason: string) => {
      const feed = view.feed.map((candidate, at) =>
        at === index
          ? {
              ...candidate,
              record: {
                ...candidate.record,
                events: [...candidate.record.events, payment(reason)],
              },
            }
          : candidate,
      );
      return tableBeats(feed, { game: view.observation.public, viewerSeat: 0 }).filter(
        (beat) => beat.at === index,
      );
    };
    // The coins join the record's own beat and say they came from the viewing seat.
    const deal = told('deal').at(-1)!;
    expect(deal.text).toMatch(/from you$/);
    expect(deal.touchedYou).toBe(false);
    // The same coins taken by some other reason (a stolen purse) do touch the viewing seat.
    expect(told('pickpocket').at(-1)!.touchedYou).toBe(true);
  });
});
