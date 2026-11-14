import { applyAction, legalActions } from './contract/stubs.ts';
import {
  gameLogSchema,
  logHeaderSchema,
  type ActionRecord,
  type EngineEvent,
  type GameState,
  type GameLog,
} from './contract/schema.ts';
import { createLogHeader, ENGINE_VERSION } from './versions.ts';
import { createRng, d6, RNG_VERSION } from './rng.ts';
import { pendingRollPurpose } from './turns.ts';
import { canonicalJson } from './state-hash.ts';
import { actorRevision } from './visibility.ts';

/** A single step: later gameplay transitions may expose another decision. */
export function advanceAutomatically(state: GameState): {
  state: GameState;
  records: ActionRecord[];
  events: EngineEvent[];
} {
  const purpose = pendingRollPurpose(state);
  if (purpose) {
    const result = applyAction(state, {
      actorId: 'engine',
      actionSeq: state.stateRevision + 1,
      stateRevisionBefore: state.stateRevision,
      kind: 'dice_result',
      payload: { purpose, value: d6(state.rng, purpose).value },
    });
    if ('rejected' in result) return { state, records: [], events: [] };
    return {
      state: result.state,
      records: [{ ...result.record, auto: true }],
      events: result.events,
    };
  }
  const choices = legalActions(state, state.activeSeatIndex).enabled;
  if (choices.length !== 1) return { state, records: [], events: [] };
  const actor = state.config.seats.find((seat) => seat.seatIndex === state.activeSeatIndex);
  if (!actor) return { state, records: [], events: [] };
  const choice = choices[0]!;
  const revision = actorRevision(state, actor.actorId);
  const result = applyAction(state, {
    actorId: actor.actorId,
    actionSeq: revision + 1,
    stateRevisionBefore: revision,
    kind: choice.kind,
    payload: choice.payload,
  });
  if ('rejected' in result) return { state, records: [], events: [] };
  return {
    state: result.state,
    records: [{ ...result.record, auto: true }],
    events: result.events,
  };
}

/** Retain exact content and the pre-roll snapshot from createGame (or a contract scenario). */
export function createGameLog(initialState: GameState): GameLog {
  const log = gameLogSchema.parse({
    ...createLogHeader(initialState.config),
    logVersion: 'command-log-v1',
    initialState,
    actions: [],
  });
  validateInitial(log);
  return log;
}

function validateInitial(log: GameLog): void {
  logHeaderSchema.parse({
    initialConfig: log.initialConfig,
    seed: log.seed,
    engineVersion: log.engineVersion,
    contentVersion: log.contentVersion,
    rngVersion: log.rngVersion,
  });
  if (log.engineVersion !== ENGINE_VERSION || log.rngVersion !== RNG_VERSION) {
    throw new RangeError('Unsupported replay engine or RNG version');
  }
  if (
    canonicalJson(log.initialState.config) !== canonicalJson(log.initialConfig) ||
    log.initialState.stateRevision !== 0 ||
    canonicalJson(log.initialState.rng) !== canonicalJson(createRng(log.seed))
  ) {
    throw new RangeError('Initial state must match configuration, seed and zero revision');
  }
}

/** Pure executor: recorded commands pass through the same acceptance boundary. */
export function replay(input: GameLog): GameState {
  const log = gameLogSchema.parse(input);
  validateInitial(log);
  let state = log.initialState;
  for (const record of log.actions) {
    if (record.auto) {
      const automatic = advanceAutomatically(state);
      if (
        automatic.records.length !== 1 ||
        canonicalJson(automatic.records[0]!.action) !== canonicalJson(record.action)
      ) {
        throw new RangeError('Invalid auto action marker');
      }
    }
    const result = applyAction(state, record.action);
    if ('rejected' in result) throw new RangeError(`Invalid replay action: ${result.reason}`);
    if (canonicalJson(result.events) !== canonicalJson(record.events)) {
      throw new RangeError('Replay events do not match accepted action');
    }
    state = result.state;
  }
  return state;
}
