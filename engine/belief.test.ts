import { describe, expect, test } from 'vitest';
import {
  gameStateSchema,
  legalActions,
  matchOwnState,
  observe,
  pendingDecision,
  sampleBelief,
  type GameState,
} from './index.ts';
import { decisionStates, realContent } from './rollout-testing.ts';

const content = realContent();
const seatOf = (state: GameState) => pendingDecision(state)!.seatIndex;

/** The same table as `state` seen by seat 0, but with every secret the seat cannot see changed. */
function withOtherSecrets(state: GameState): GameState {
  const other = structuredClone(state);
  other.config.seed = 'another-secret-seed';
  other.rng = { state: '123456789', cursor: 77 };
  other.eventDeck.drawPile = [...other.eventDeck.drawPile].reverse();
  other.eventDeck.discardPile = [...other.eventDeck.discardPile].reverse();
  const seat = seatOf(state);
  for (const player of other.players) {
    if (player.seatIndex === seat) continue;
    player.balls = { poke: player.balls.poke + 1, great: 3, ultra: 2 };
    player.privateResults = [];
  }
  return other;
}

const states = [11, 12, 13].flatMap((seed) => decisionStates(seed, { seats: 2 + (seed % 3) }));

describe('sampleBelief (spec §5.6 Hard: unknowns come from known information only)', () => {
  test('there are real states to test against', () => {
    expect(states.length).toBeGreaterThan(10);
  });

  test.each(states.map((state, index) => [index, state] as const))(
    'state %i: the sampled world looks the same to the deciding seat',
    (_index, state) => {
      const seat = seatOf(state);
      const real = observe(state, seat);
      const belief = sampleBelief(real, content, 'seed-a');
      expect(gameStateSchema.parse(belief)).toEqual(belief);
      expect(observe(belief, seat)).toEqual(real);
    },
  );

  test.each(states.map((state, index) => [index, state] as const))(
    'state %i: the sampled world offers the same legal actions',
    (_index, state) => {
      const seat = seatOf(state);
      const real = observe(state, seat);
      const ids = (value: GameState) => legalActions(value, seat).enabled.map((entry) => entry.id);
      const hints = matchOwnState(real, content, ids(state));
      expect(hints).toBeDefined();
      expect(ids(sampleBelief(real, content, 'seed-a', hints))).toEqual(ids(state));
    },
  );

  test.each(states.map((state, index) => [index, state] as const))(
    'state %i: a different seed changes nothing the seat can see',
    (_index, state) => {
      const seat = seatOf(state);
      const real = observe(state, seat);
      expect(observe(sampleBelief(real, content, 'seed-b'), seat)).toEqual(real);
    },
  );

  test.each(states.map((state, index) => [index, state] as const))(
    "state %i: the real seed, deck order and opponents' Balls never reach the sample (leak test)",
    (_index, state) => {
      const seat = seatOf(state);
      const a = sampleBelief(observe(state, seat), content, 'seed-a');
      const other = withOtherSecrets(state);
      expect(observe(other, seat)).toEqual(observe(state, seat));
      expect(sampleBelief(observe(other, seat), content, 'seed-a')).toEqual(a);
    },
  );

  test('the belief seed, not the game, decides the unknowns', () => {
    const state = states.find((candidate) => candidate.globalTurnNo > 4)!;
    const seat = seatOf(state);
    const real = observe(state, seat);
    const samples = ['a', 'b', 'c', 'd', 'e', 'f'].map((seed) => sampleBelief(real, content, seed));
    expect(new Set(samples.map((sample) => JSON.stringify(sample.eventDeck))).size).toBeGreaterThan(
      1,
    );
    expect(sampleBelief(real, content, 'a')).toEqual(samples[0]);
  });

  test('unknown opponent Balls and items stay inside what the table could hold', () => {
    for (const state of states) {
      const seat = seatOf(state);
      const real = observe(state, seat);
      const belief = sampleBelief(real, content, 'bounds');
      for (const player of belief.players) {
        const shown = real.public.players.find((entry) => entry.seatIndex === player.seatIndex)!;
        expect(player.items).toHaveLength(shown.itemCount);
        expect(player.items.filter((item) => item.visibility === 'public')).toEqual(
          shown.knownItems,
        );
        for (const item of player.items) {
          expect(content.items.some((entry) => entry.id === item.itemId)).toBe(true);
        }
        if (player.seatIndex === seat) continue;
        expect(player.balls.poke).toBeGreaterThanOrEqual(0);
        expect(player.balls.poke).toBeLessThanOrEqual(5);
      }
      expect([...belief.eventDeck.drawPile].sort()).toEqual(
        content.events!.map((event) => event.id).sort(),
      );
    }
  });
});
