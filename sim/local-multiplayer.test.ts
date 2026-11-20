import { expect, test } from 'vitest';
import {
  advanceAutomatically,
  applyAction,
  checkInvariants,
  createGameLog,
  decisionPoint,
  deserialize,
  legalActions,
  observe,
  pendingDecision,
  replay,
  resume,
  serialize,
  verifyReplay,
} from '../engine/index.ts';
import { parseSimArgs } from './args.ts';
import { realEngine } from './engine.ts';
import { runSim, type PlayedGame } from './runner.ts';

test.each([2, 4])(
  'a four-seat game with %i scripted humans finishes and resumes a human PvP response (#255)',
  async (humanSeats) => {
    const options = parseSimArgs([
      '--games',
      '1',
      '--seed',
      '255',
      '--seats',
      '4',
      '--human-seats',
      String(humanSeats),
      '--human-policy',
      'always-pvp',
    ]);
    const played: PlayedGame[] = [];
    const { summary, failures } = await runSim(
      realEngine,
      options,
      undefined,
      checkInvariants,
      (game) => played.push(game),
    );
    expect(failures).toEqual([]);
    expect(summary).toMatchObject({
      games: 1,
      aborted: 0,
      invariantFailures: 0,
      illegalAppliedActionCount: 0,
    });
    expect(played).toHaveLength(1);
    const { initialState, state, records } = played[0]!;
    expect(state.phase.kind).toBe('finished');
    expect(initialState.config.seats.map((seat) => seat.controller)).toEqual(
      humanSeats === 2 ? ['human', 'human', 'ai', 'ai'] : ['human', 'human', 'human', 'human'],
    );
    const humans = initialState.config.seats.filter((seat) => seat.controller === 'human');
    const log = createGameLog(initialState);
    log.actions = records;
    expect(verifyReplay({ state, log })).toMatchObject({ pass: true });

    const declaration = records.findIndex(
      ({ action }) =>
        action.kind === 'declare_pvp' &&
        action.payload.force === undefined &&
        humans.some((seat) => seat.actorId === action.actorId) &&
        humans.some((seat) => seat.seatIndex === action.payload.targetSeatIndex),
    );
    expect(declaration).toBeGreaterThanOrEqual(0);
    const checkpoint = { ...log, actions: records.slice(0, declaration + 1) };
    const pending = replay(checkpoint);
    if (pending.phase.kind !== 'pvp' || pending.phase.battle.step !== 'response') {
      throw new Error('Expected a voluntary PvP challenge awaiting its defender');
    }
    const { attackerSeatIndex, defenderSeatIndex } = pending.phase.battle;
    const defender = initialState.config.seats[defenderSeatIndex]!;
    expect(pending.activeSeatIndex).toBe(attackerSeatIndex);
    expect(decisionPoint(pending)).toBe('pvp_response');
    expect(pendingDecision(pending)).toEqual({
      seatIndex: defenderSeatIndex,
      actorId: defender.actorId,
    });
    expect(advanceAutomatically(pending).records).toEqual([]);
    for (const seat of pending.config.seats) {
      const enabled = legalActions(pending, seat.seatIndex).enabled.map((choice) => choice.id);
      expect(enabled).toEqual(
        seat.seatIndex === defenderSeatIndex ? ['accept-pvp', 'decline-pvp'] : [],
      );
    }

    const loaded = resume(deserialize(serialize({ state: pending, log: checkpoint })));
    expect(loaded.state).toEqual(pending);
    expect(loaded.waitingFor).toEqual({
      kind: 'decision',
      seatIndex: defenderSeatIndex,
      actorId: defender.actorId,
      phase: 'pvp',
      legalActions: legalActions(pending, defenderSeatIndex),
    });
    const attacker = initialState.config.seats[attackerSeatIndex]!;
    const revision = observe(pending, attackerSeatIndex).public.stateRevision;
    const response = records[declaration + 1]!;
    expect(response.action).toMatchObject({ kind: 'respond_pvp', actorId: defender.actorId });
    expect(
      applyAction(loaded.state, {
        ...response.action,
        actorId: attacker.actorId,
        stateRevisionBefore: revision,
        actionSeq: revision + 1,
      }),
    ).toMatchObject({ rejected: true, reason: 'wrong_actor', state: pending });
    const continued = applyAction(loaded.state, response.action);
    expect(continued).toMatchObject({ accepted: true, record: response });
    expect(checkInvariants(loaded.state, response.action, continued)).toEqual([]);
  },
  60_000,
);
