import { expect, test } from 'vitest';
import {
  advanceAutomatically,
  applyAction,
  checkInvariants,
  createGameLog,
  legalActions,
  pendingDecision,
  replay,
  type Action,
  type GameState,
} from '../engine/index.ts';
import { realEngine } from './engine.ts';
import { DEFAULT_OPTIONS, runSim } from './runner.ts';
function command(state: GameState, kind: Action['kind'], payload: unknown) {
  return {
    actorId: pendingDecision(state)!.actorId,
    actionSeq: state.stateRevision + 1,
    stateRevisionBefore: state.stateRevision,
    kind,
    payload,
  };
}
test('three seats finish via the public API with defender responses and rewards, without extra turns or deadlock (§8)', () => {
  let state = realEngine.createGame({
    seed: 55,
    seats: ['fisherman', 'bug-catcher', 'researcher'].map((classId, seatIndex) => ({
      classId,
      seatIndex,
      actorId: `p${seatIndex}`,
    })),
    lapTarget: 1,
  });
  const log = createGameLog(state);
  let responses = 0;
  for (let step = 0; step < 2000 && state.phase.kind !== 'finished'; step++) {
    const automatic = advanceAutomatically(state);
    if (automatic.records.length) {
      log.actions.push(...automatic.records);
      state = automatic.state;
      continue;
    }
    const owner = pendingDecision(state)!;
    const legal = legalActions(state, owner.seatIndex).enabled;
    const preferred = [
      'declare_pvp',
      'respond_pvp',
      'choose_reward',
      'skip',
      'finish_sell',
      'release',
      'skip_shop',
    ];
    const choice =
      preferred.flatMap((kind) => legal.filter((choice) => choice.kind === kind))[0] ?? legal[0]!;
    // Finish Sell without selling the battling team.
    const selected =
      state.phase.kind === 'sell'
        ? legal.find(
            (choice) => choice.kind === 'sell' && choice.payload.pokemonInstanceIds.length === 0,
          )!
        : choice;
    const before = state;
    const result = applyAction(state, command(state, selected.kind, selected.payload));
    if ('rejected' in result) throw new Error(result.reason);
    expect(checkInvariants(state, result.record.action, result)).toEqual([]);
    state = result.state;
    log.actions.push(result.record);
    if (selected.kind === 'respond_pvp' || selected.kind === 'choose_reward') {
      responses++;
      expect(state.activeSeatIndex).toBe(before.activeSeatIndex);
      expect(state.globalTurnNo).toBe(before.globalTurnNo);
      expect(state.players.map((player) => player.ownTurnNo)).toEqual(
        before.players.map((player) => player.ownTurnNo),
      );
    }
  }
  expect(state.phase.kind).toBe('finished');
  expect(responses).toBeGreaterThan(0);
  expect(state.players.map((player) => player.ownTurnNo)).toEqual([
    state.globalTurnNo / 3,
    state.globalTurnNo / 3,
    state.globalTurnNo / 3,
  ]);
  expect(replay(log)).toEqual(state);
});

test('sim runner dispatches a defender’s decisions to that defender’s policy', async () => {
  const seen: { seat: number; active: number; kind: string }[] = [];
  const { summary, failures } = await runSim(
    realEngine,
    { ...DEFAULT_OPTIONS, games: 1, seed: 55, seats: 3, lapTarget: 1, policy: 'pvp' },
    {
      pvp: () => ({
        decide(observation, legal) {
          const choice =
            legal.enabled.find((choice) => choice.kind === 'declare_pvp') ?? legal.enabled[0]!;
          seen.push({
            seat: observation.own.seatIndex,
            active: observation.public.activeSeatIndex,
            kind: choice.kind,
          });
          return choice.id;
        },
      }),
    },
  );
  expect(failures).toEqual([]);
  expect(summary.aborted).toBe(0);
  expect(seen.some((entry) => entry.kind === 'respond_pvp' && entry.seat !== entry.active)).toBe(
    true,
  );
}, 15_000);
