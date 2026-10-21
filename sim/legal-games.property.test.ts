import fc from 'fast-check';
import { expect, test } from 'vitest';
import {
  actionSchema,
  INVARIANTS,
  stateHash,
  type Action,
  type ApplyActionResult,
  type GameLog,
  type GameState,
  type InvariantDefinition,
} from '../engine/index.ts';
import { realEngine } from './engine.ts';
import {
  gamePlan,
  playGame,
  PROPERTY_TIMEOUT_MS,
  PROPERTY_RUNS,
  type Step,
} from './legal-games.ts';
import type { SimEngine } from './runner.ts';

type ActiveInvariant = Extract<InvariantDefinition, { status: 'active' }>;
type InvariantStep = Parameters<ActiveInvariant['check']>[0];

/**
 * Every active engine invariant except `replay-reproduces-state`, which re-applies each step and
 * costs more than the rest together; `replay.property.test.ts` checks the same determinism
 * against the whole command log through the engine's own `replay`.
 */
const STEP_INVARIANTS = INVARIANTS.filter(
  (invariant): invariant is ActiveInvariant =>
    invariant.status === 'active' && invariant.id !== 'replay-reproduces-state',
);

function checkInvariants(engine: SimEngine, { before, action, result }: Step): void {
  const parsed = actionSchema.safeParse(action);
  const step: InvariantStep = {
    before,
    parsed: parsed.success ? parsed.data : null,
    result,
    apply: engine.applyAction,
  };
  const violations = STEP_INVARIANTS.flatMap((invariant) =>
    invariant.check(step).map((message) => `${invariant.id}: ${message}`),
  );
  if (violations.length > 0) throw new Error(`invariant violation: ${violations.join('; ')}`);
}

/** A stale or foreign command must be rejected and leave the state exactly as it was. */
function expectUnchanged(state: GameState, hash: string, label: string, result: ApplyActionResult) {
  if (!('rejected' in result)) throw new Error(`${label} was accepted`);
  if (result.state !== state && stateHash(result.state) !== hash) {
    throw new Error(`${label} (${result.reason}) changed the state`);
  }
}

/** Probes a player decision with variants of the command the generator is about to submit. */
function probeStaleAndForeign(engine: SimEngine, state: GameState, action: Action, log: GameLog) {
  const hash = stateHash(state);
  const probe = (label: string, command: unknown) =>
    expectUnchanged(state, hash, label, engine.applyAction(state, command));
  if (state.stateRevision > 0) {
    probe('a command on the previous revision', {
      ...action,
      stateRevisionBefore: state.stateRevision - 1,
    });
    probe('the last accepted command sent again', log.actions.at(-1)!.action);
  }
  probe('an unknown actor', { ...action, actorId: 'intruder' });
  for (const seat of state.config.seats) {
    if (seat.seatIndex === state.activeSeatIndex) continue;
    probe(`${seat.actorId} out of turn`, { ...action, actorId: seat.actorId });
    const own = engine.legalActions(state, seat.seatIndex);
    for (const choice of [...own.enabled, ...own.disabled]) {
      probe(`${seat.actorId} ${choice.id} out of turn`, {
        ...action,
        actorId: seat.actorId,
        kind: choice.kind,
        payload: choice.payload,
      });
    }
  }
  // A rejected command must not have mutated the snapshot it was given either.
  if (stateHash(state) !== hash) throw new Error('a rejected command mutated its input');
}

/**
 * Three of issue #26's properties on the same games, so each game is played once: no step violates
 * an invariant, stale or foreign commands never change the state, and the game finishes within
 * the sim step limit. `playGame` asserts every generated action is an enabled legal action.
 */
function legalGamesHold(engine: SimEngine) {
  return fc.property(gamePlan(engine.classIds), (plan) => {
    const game = playGame(engine, plan, {
      beforeDecision: (state, action, log) => probeStaleAndForeign(engine, state, action, log),
      afterStep: (step) => checkInvariants(engine, step),
    });
    if (!game.finished) throw new Error(`the game did not finish in ${game.steps} steps`);
  });
}

test(
  '200 random legal games break no invariant, ignore stale or foreign commands and finish (§6.3, §8)',
  () => fc.assert(legalGamesHold(realEngine), PROPERTY_RUNS),
  PROPERTY_TIMEOUT_MS,
);

/** A known bug: a catch attempt that gives its Ball back (§4.3, §8 "consumes exactly 1 Ball"). */
const freeBallEngine: SimEngine = {
  ...realEngine,
  applyAction(state, input) {
    const result = realEngine.applyAction(state, input);
    const action = actionSchema.safeParse(input);
    if (!('accepted' in result) || !action.success || action.data.kind !== 'catch') return result;
    const { actorId, payload } = action.data;
    const next = structuredClone(result.state);
    next.players.find((player) => player.actorId === actorId)!.balls[payload.ballType]++;
    return { ...result, state: next };
  },
};

test('a Ball that is not used up fails the property with a shrunk action sequence (§8)', () => {
  const report = fc.check(legalGamesHold(freeBallEngine), PROPERTY_RUNS);
  expect(report.failed).toBe(true);
  const message = String(report.errorInstance);
  expect(message).toContain('catch-consumes-one-ball');
  // Shrinking empties the decision tape, so the reported sequence ends at the first catch.
  expect(report.counterexample![0]).toMatchObject({ choices: [] });
  expect(message).toMatch(/\n {2}\d+\. +r\d+ seat-\d catch \{"ballType":"\w+"\}$/);
});
