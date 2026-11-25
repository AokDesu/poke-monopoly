import { describe, expect, test } from 'vitest';
import { applyAction, legalActions, observe, type GameState } from '../../engine/index.ts';
import { promiseTable, type PromiseHistory } from '../../eval/jev/scenario-kit.ts';
import { createPolicyRng } from '../../sim/policy.ts';
import { FallbackPolicy, PERSONALITIES, scoreOptions } from './index.ts';

// Spec §4.8, §5.3: the promise response fallback is scored by loyalty and trust (S09).

const IDS = Object.keys(PERSONALITIES) as (keyof typeof PERSONALITIES)[];
const TRUSTS = [-3, -2, -1, 0, 1, 2, 3];
const DIRECTIONS = ['offer', 'ask'] as const;

const answer = (
  state: GameState,
  personality: (typeof PERSONALITIES)[keyof typeof PERSONALITIES],
  seed = 'r',
) => {
  const choice = new FallbackPolicy(personality).decide(
    observe(state, 0),
    legalActions(state, 0),
    createPolicyRng(seed),
  );
  if (typeof choice !== 'string') throw new Error('a promise answer is an action ID');
  return choice;
};
const table = (direction: 'offer' | 'ask', trust: number, history: PromiseHistory = [], seed = 3) =>
  promiseTable({ seed, direction, trust, history });

describe('willingness follows trust', () => {
  test('the same personality accepts at high trust and rejects at low trust, in both directions', () => {
    for (const id of ['greedy', 'aggressive', 'opportunist'] as const) {
      for (const direction of DIRECTIONS) {
        expect(answer(table(direction, -2), PERSONALITIES[id]), `${id} ${direction} low`).toBe(
          'respond:reject',
        );
        expect(answer(table(direction, 2), PERSONALITIES[id]), `${id} ${direction} high`).toBe(
          'respond:accept',
        );
      }
    }
    // Cautious is the most loyal: it still turns away a rival who has broken its word twice over.
    expect(answer(table('offer', -3), PERSONALITIES.cautious)).toBe('respond:reject');
    expect(answer(table('offer', 3), PERSONALITIES.cautious)).toBe('respond:accept');
  });

  test('more trust never makes a seat less willing, for every personality', () => {
    for (const id of IDS) {
      for (const direction of DIRECTIONS) {
        const accepted = TRUSTS.map(
          (trust) => answer(table(direction, trust), PERSONALITIES[id]) === 'respond:accept',
        );
        // Once a seat accepts at some trust it accepts at every higher one.
        expect(accepted, `${id} ${direction}`).toEqual([...accepted].sort((a, b) => +a - +b));
      }
    }
  });

  test('a more loyal personality is at least as willing at the same trust', () => {
    const byLoyalty = [...IDS].sort(
      (a, b) => PERSONALITIES[a].weights.loyalty - PERSONALITIES[b].weights.loyalty,
    );
    for (const trust of TRUSTS) {
      const accepted = byLoyalty.map(
        (id) => answer(table('offer', trust), PERSONALITIES[id]) === 'respond:accept',
      );
      expect(accepted, `trust ${trust}`).toEqual([...accepted].sort((a, b) => +a - +b));
    }
  });

  test('loyalty sets where trust starts to count: the same trust splits the personalities', () => {
    // At neutral trust only the loyal ones accept; the most loyal also forgives some distrust.
    const at = (trust: number) =>
      Object.fromEntries(
        IDS.map((id) => [id, answer(table('offer', trust), PERSONALITIES[id])] as const),
      );
    expect(at(0)).toMatchObject({
      cautious: 'respond:accept',
      greedy: 'respond:accept',
      aggressive: 'respond:reject',
      opportunist: 'respond:reject',
    });
    expect(at(-1).cautious).toBe('respond:accept');
    expect(at(-1).greedy).toBe('respond:reject');
  });
});

describe('a broken-promise memory lowers acceptance', () => {
  // Broken (-2) then two kept (+1 each) leaves trust at 0, the same as no history at all.
  const forgiven: PromiseHistory = ['broken', 'kept', 'kept'];

  test('at the same trust, a seat that remembers a break is less willing than one with no history', () => {
    const clean = observe(table('offer', 0), 0);
    const grudge = observe(table('offer', 0, forgiven), 0);
    const score = (observation: typeof clean, id: keyof typeof PERSONALITIES) =>
      scoreOptions(
        observation,
        legalActions(promiseTable({ seed: 3, direction: 'offer', trust: 0 }), 0).enabled,
        PERSONALITIES[id],
      ).get('respond:accept')!;
    for (const id of IDS) expect(score(grudge, id), id).toBeLessThan(score(clean, id));
    // Enough to flip Greedy at the bar, in either direction of the promise.
    for (const direction of DIRECTIONS) {
      expect(answer(table(direction, 0), PERSONALITIES.greedy)).toBe('respond:accept');
      expect(answer(table(direction, 0, forgiven), PERSONALITIES.greedy)).toBe('respond:reject');
    }
  });

  test('a kept promise is not held against anyone', () => {
    const kept = observe(table('offer', 0, ['kept']), 0);
    const clean = observe(table('offer', 0), 0);
    const enabled = legalActions(table('offer', 0), 0).enabled;
    for (const id of IDS) {
      expect(scoreOptions(kept, enabled, PERSONALITIES[id]).get('respond:accept')).toBe(
        scoreOptions(clean, enabled, PERSONALITIES[id]).get('respond:accept'),
      );
    }
  });
});

describe('every answer is legal', () => {
  test('across personalities, trust, history and direction the answer is an enabled respond action the engine accepts', () => {
    const histories: PromiseHistory[] = [[], ['kept'], ['broken'], ['broken', 'kept', 'kept']];
    let seen = 0;
    for (const id of IDS) {
      for (const direction of DIRECTIONS) {
        for (const trust of TRUSTS) {
          for (const history of histories) {
            const state = table(direction, trust, history);
            const choice = answer(state, PERSONALITIES[id]);
            const enabled = legalActions(state, 0).enabled;
            expect(enabled.map((action) => action.id)).toContain(choice);
            const action = enabled.find((entry) => entry.id === choice)!;
            const revision = observe(state, 0).public.stateRevision;
            const applied = applyAction(state, {
              actorId: 'P1',
              actionSeq: revision + 1,
              stateRevisionBefore: revision,
              kind: action.kind,
              payload: action.payload,
            });
            expect('rejected' in applied, `${id} ${direction} ${trust}`).toBe(false);
            seen++;
          }
        }
      }
    }
    expect(seen).toBe(IDS.length * DIRECTIONS.length * TRUSTS.length * histories.length);
  });

  test('a tie never reaches the seeded tie-break: the answer does not depend on the seed', () => {
    for (const id of IDS) {
      for (const trust of TRUSTS) {
        const state = table('offer', trust);
        const answers = new Set(
          ['a', 'b', 'c', 'd'].map((seed) => answer(state, PERSONALITIES[id], seed)),
        );
        expect(answers.size, `${id} ${trust}`).toBe(1);
      }
    }
  });

  test('other responder questions still score 0, and a deal is not read as a promise', () => {
    const state = table('offer', 2);
    const observation = observe(state, 0);
    const respond = legalActions(state, 0).enabled;
    // The same options with no pending promise question in the observation score alike.
    const noPromise = { ...observation, own: { ...observation.own, pendingResponse: undefined } };
    expect([...scoreOptions(noPromise, respond, PERSONALITIES.greedy).values()]).toEqual([0, 0]);
  });
});
