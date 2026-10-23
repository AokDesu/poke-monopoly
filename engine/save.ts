import { z } from 'zod';
import { legalActions } from './contract/stubs.ts';
import {
  gameLogSchema,
  gameStateSchema,
  type ActionRecord,
  type GameLog,
  type GameState,
  type LegalActions,
  type Phase,
} from './contract/schema.ts';
import { pendingRollPurpose } from './turns.ts';
import { canonicalJson, stateHash } from './state-hash.ts';
import { replay } from './pipeline.ts';
import { RNG_VERSION } from './rng.ts';
import { CONTENT_VERSION, ENGINE_VERSION } from './versions.ts';

export const SAVE_VERSION = 'save-v1';

/** Spec §6.7: the current state and the action log are siblings; the log is never inside `state`. */
export const saveSchema = z
  .strictObject({
    saveVersion: z.literal(SAVE_VERSION),
    engineVersion: z.string().min(1),
    contentVersion: z.string().min(1),
    rngVersion: z.string().min(1),
    state: gameStateSchema,
    log: gameLogSchema,
  })
  .superRefine((save, ctx) => {
    for (const field of ['engineVersion', 'contentVersion', 'rngVersion'] as const) {
      if (save[field] !== save.log[field]) {
        ctx.addIssue({ code: 'custom', path: [field], message: 'Must match the log header' });
      }
    }
    // The snapshot is the state after every logged action of the same game.
    if (
      save.state.stateRevision !== save.log.actions.length ||
      canonicalJson(save.state.config) !== canonicalJson(save.log.initialConfig)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['state'],
        message: 'The state and log disagree: the state must follow every logged action',
      });
    }
  });

export type Save = z.infer<typeof saveSchema>;
export type SavedGame = { state: GameState; log: GameLog };

/** Text for local storage or a file; the engine itself writes nothing. */
export function serialize(game: SavedGame): string {
  const save: Save = saveSchema.parse({
    saveVersion: SAVE_VERSION,
    engineVersion: game.log.engineVersion,
    contentVersion: game.log.contentVersion,
    rngVersion: game.log.rngVersion,
    state: game.state,
    log: game.log,
  });
  return JSON.stringify(save);
}

const CURRENT = {
  engineVersion: ['engine', ENGINE_VERSION],
  contentVersion: ['content', CONTENT_VERSION],
  rngVersion: ['RNG', RNG_VERSION],
} as const;

/** Throws on malformed text, another save format, or a save from another engine, content or RNG. */
export function deserialize(text: string): SavedGame {
  const raw: unknown = JSON.parse(text);
  const header = z
    .looseObject({
      saveVersion: z.unknown().optional(),
      engineVersion: z.unknown().optional(),
      contentVersion: z.unknown().optional(),
      rngVersion: z.unknown().optional(),
    })
    .safeParse(raw);
  if (!header.success) throw new RangeError('Invalid save: expected a JSON object');
  const stamps = header.data;
  if (stamps.saveVersion !== SAVE_VERSION) {
    throw new RangeError(
      `This save has format ${String(stamps.saveVersion)}; this game reads ${SAVE_VERSION}.`,
    );
  }
  // Migration of old saves is out of scope (issue #33): a different version is refused by name.
  for (const [field, [name, current]] of Object.entries(CURRENT)) {
    const saved = stamps[field as keyof typeof CURRENT];
    if (saved !== current) {
      throw new RangeError(
        `This save was made with ${name} version ${String(saved)}; this game runs ${name} version ${current}. Old saves cannot be loaded yet.`,
      );
    }
  }
  const parsed = saveSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
    throw new RangeError(`Invalid save: ${issues.join('; ')}`);
  }
  const save = parsed.data;
  return { state: save.state, log: save.log };
}

/** What the resumed game waits for; resuming never decides or rolls on anyone's behalf. */
export type WaitingFor =
  | { kind: 'finished' }
  | { kind: 'engine_result'; purpose: string }
  | {
      kind: 'decision';
      seatIndex: number;
      actorId: string;
      phase: Phase['kind'];
      legalActions: LegalActions;
    };

export type Resumed = { state: GameState; lastAction: ActionRecord | null; waitingFor: WaitingFor };

/**
 * Spec §3.1, §6.9: continue from the last committed action. A request that was pending when the
 * save was taken is not in it, so the caller asks again for `waitingFor` from the same state.
 */
export function resume(game: SavedGame): Resumed {
  const { state, log } = game;
  return { state, lastAction: log.actions.at(-1) ?? null, waitingFor: waitingFor(state) };
}

function waitingFor(state: GameState): WaitingFor {
  if (state.phase.kind === 'finished') return { kind: 'finished' };
  const purpose = pendingRollPurpose(state);
  if (purpose) return { kind: 'engine_result', purpose };
  const seat = state.config.seats.find((entry) => entry.seatIndex === state.activeSeatIndex)!;
  return {
    kind: 'decision',
    seatIndex: seat.seatIndex,
    actorId: seat.actorId,
    phase: state.phase.kind,
    legalActions: legalActions(state, seat.seatIndex),
  };
}

export type ReplayCheck = { pass: true; stateHash: string } | { pass: false; reason: string };

/**
 * Spec §6.8, §8: re-executes the log from its initial state with the recorded random results and
 * compares the result with the saved state. Pure: no decider, network, storage or clock.
 */
export function verifyReplay(game: SavedGame): ReplayCheck {
  let replayed: GameState;
  try {
    replayed = replay(game.log);
  } catch (error) {
    return { pass: false, reason: error instanceof Error ? error.message : String(error) };
  }
  const expected = stateHash(game.state);
  const actual = stateHash(replayed);
  if (actual !== expected) {
    return { pass: false, reason: `state hash ${expected} but replay gives ${actual}` };
  }
  return { pass: true, stateHash: actual };
}
