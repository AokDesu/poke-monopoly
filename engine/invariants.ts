import { applyAction, legalActions } from './contract/stubs.ts';
import {
  actionSchema,
  type Action,
  type ApplyActionResult,
  type EngineEvent,
  type GameState,
} from './contract/schema.ts';
import { canonicalJson, stateHash } from './state-hash.ts';

/** Spec §8 engine invariants, plus the §6.5 Lap credit rules that issue #14 names. */
export type InvariantId =
  | 'coins-non-negative'
  | 'coin-transfer-sourced'
  | 'uid-unique'
  | 'uid-lifecycle-logged'
  | 'rejected-or-stale-unchanged'
  | 'catch-consumes-one-ball'
  | 'credited-lap-monotonic'
  | 'credited-lap-pays-once'
  | 'replay-reproduces-state'
  | 'game-can-finish'
  | 'deals-atomic'
  | 'move-debuff-until-next-move'
  | 'tired-and-nurse-joy-useful'
  | 'promise-closes-on-own-turn'
  | 'resume-creates-nothing'
  | 'ability-once-per-instance-per-lap'
  | 'ability-once-per-player-turn'
  | 'evolution-keeps-cooldowns'
  | 'rescue-starter-no-coin-loop'
  | 'battle-reward-coins-or-evolution'
  | 'evolution-one-stage-same-uid';

export interface Violation {
  invariant: InvariantId;
  message: string;
}

export type ApplyActionFn = (state: GameState, action: unknown) => ApplyActionResult;

/** One checked step; `parsed` is the action when it matches the command schema. */
interface Step {
  before: GameState;
  parsed: Action | null;
  result: ApplyActionResult;
  apply: ApplyActionFn;
}

interface InvariantBase {
  id: InvariantId;
  /** Spec section and the exact spec line the invariant comes from. */
  section: string;
  specLine: string;
}

export type InvariantDefinition =
  | (InvariantBase & { status: 'active'; check: (step: Step) => string[] })
  | (InvariantBase & { status: 'pending' });

const accepted = (result: ApplyActionResult) => 'accepted' in result;

/** Instance IDs that players own. An instance ID is created at the catch (issue #23). */
function ownedInstanceIds(state: GameState): string[] {
  return state.players.flatMap((player) => [
    ...player.team.map((pokemon) => pokemon.instanceId),
    ...player.items.map((item) => item.instanceId),
  ]);
}

function eventsOf<K extends EngineEvent['kind']>(events: EngineEvent[], kind: K) {
  return events.filter((event): event is Extract<EngineEvent, { kind: K }> => event.kind === kind);
}

function checkCoinsNonNegative({ result }: Step): string[] {
  return result.state.players
    .filter((player) => player.coins < 0)
    .map((player) => `${player.actorId} has ${player.coins} coins`);
}

function checkCoinTransfers({ before, result }: Step): string[] {
  if (!accepted(result)) return [];
  const problems: string[] = [];
  const actors = new Set(result.state.players.map((player) => player.actorId));
  const net = new Map<string, number>();
  const credit = (actorId: string, amount: number) =>
    net.set(actorId, (net.get(actorId) ?? 0) + amount);
  for (const transfer of eventsOf(result.events, 'coin_transfer')) {
    // Events are checked as untrusted data: a broken engine may omit the source.
    const source = transfer.source as typeof transfer.source | undefined;
    if (!source || (source.kind === 'player' && !actors.has(source.actorId))) {
      problems.push(`coin_transfer "${transfer.reason}" has no valid source`);
    } else if (source.kind === 'player') {
      credit(source.actorId, -transfer.amount);
    }
    if (transfer.destination.kind === 'player') {
      credit(transfer.destination.actorId, transfer.amount);
    }
  }
  for (const player of result.state.players) {
    const previous = before.players.find((candidate) => candidate.actorId === player.actorId);
    const change = player.coins - (previous?.coins ?? 0);
    const logged = net.get(player.actorId) ?? 0;
    if (change !== logged) {
      problems.push(
        `${player.actorId} coins changed by ${change} but coin_transfer events net ${logged}`,
      );
    }
  }
  return problems;
}

function checkUidUnique({ result }: Step): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  const ids = ownedInstanceIds(result.state);
  // The wild encounter's Pokémon must not reuse an owned ID, but it is not created until caught.
  if (result.state.phase.kind === 'encounter') ids.push(result.state.phase.pokemon.instanceId);
  for (const id of ids) (seen.has(id) ? duplicates : seen).add(id);
  return [...duplicates].map((id) => `instance ID ${id} appears more than once`);
}

function checkUidLifecycle({ before, result }: Step): string[] {
  if (!accepted(result)) return [];
  const problems: string[] = [];
  const was = new Set(ownedInstanceIds(before));
  const now = new Set(ownedInstanceIds(result.state));
  const created = new Set(eventsOf(result.events, 'uid_created').map((event) => event.instanceId));
  const destroyed = new Set(
    eventsOf(result.events, 'uid_destroyed').map((event) => event.instanceId),
  );
  for (const id of now) {
    if (!was.has(id) && !created.has(id)) problems.push(`${id} appeared without uid_created`);
  }
  for (const id of was) {
    if (!now.has(id) && !destroyed.has(id)) problems.push(`${id} vanished without uid_destroyed`);
  }
  for (const id of created) {
    if (was.has(id) || !now.has(id)) problems.push(`uid_created ${id} does not match the state`);
  }
  for (const id of destroyed) {
    if (!was.has(id) || now.has(id)) problems.push(`uid_destroyed ${id} does not match the state`);
  }
  return problems;
}

function checkRejectedOrStale({ before, parsed, result }: Step): string[] {
  const stale = parsed !== null && parsed.stateRevisionBefore !== before.stateRevision;
  if (!stale && accepted(result)) return [];
  if (stateHash(result.state) === stateHash(before)) return [];
  return [`${stale ? 'stale' : 'rejected'} action changed the state hash`];
}

function checkCatchBalls({ before, parsed, result }: Step): string[] {
  if (!accepted(result) || !parsed || (parsed.kind !== 'catch' && parsed.kind !== 'release')) {
    return [];
  }
  const was = before.players.find((player) => player.actorId === parsed.actorId)?.balls;
  const now = result.state.players.find((player) => player.actorId === parsed.actorId)?.balls;
  if (!was || !now) return [`${parsed.kind} actor ${parsed.actorId} has no Ball pouch`];
  const problems: string[] = [];
  for (const type of ['poke', 'great', 'ultra'] as const) {
    const used = was[type] - now[type];
    const expected = parsed.kind === 'catch' && parsed.payload.ballType === type ? 1 : 0;
    if (used !== expected) problems.push(`${parsed.kind} consumed ${used} ${type} Ball(s)`);
  }
  return problems;
}

function checkCreditedLap({ before, result }: Step): string[] {
  const problems: string[] = [];
  const squares = result.state.content.board.length;
  for (const player of result.state.players) {
    const previous = before.players.find((candidate) => candidate.actorId === player.actorId);
    if (!previous || player.creditedLap === previous.creditedLap) continue;
    if (player.creditedLap < previous.creditedLap) {
      problems.push(
        `${player.actorId} creditedLap fell from ${previous.creditedLap} to ${player.creditedLap}`,
      );
    } else if (player.creditedLap > Math.floor(player.routeProgress / squares)) {
      problems.push(
        `${player.actorId} creditedLap ${player.creditedLap} exceeds the milestone reached at routeProgress ${player.routeProgress}`,
      );
    }
  }
  return problems;
}

function checkReplay({ before, parsed, result, apply }: Step): string[] {
  if (!('accepted' in result)) return [];
  const { record } = result;
  if (!parsed || canonicalJson(record.action) !== canonicalJson(parsed)) {
    return ['the logged record does not hold the submitted action'];
  }
  if (canonicalJson(record.events) !== canonicalJson(result.events)) {
    return ['the logged record does not hold the emitted events'];
  }
  const again = apply(before, record.action);
  if (!('accepted' in again)) return [`replaying the logged action is rejected: ${again.reason}`];
  if (stateHash(again.state) !== stateHash(result.state)) {
    return ['replaying the logged action produces a different state'];
  }
  if (canonicalJson(again.events) !== canonicalJson(result.events)) {
    return ['replaying the logged action produces different events'];
  }
  return [];
}

function checkGameCanFinish({ result }: Step): string[] {
  const { state } = result;
  if (state.phase.kind === 'finished') return [];
  const seated =
    state.config.seats.some((seat) => seat.seatIndex === state.activeSeatIndex) &&
    state.players.some((player) => player.seatIndex === state.activeSeatIndex);
  if (!seated) return [`active seat ${state.activeSeatIndex} is not a configured player`];
  if (legalActions(state, state.activeSeatIndex).enabled.length === 0) {
    return [`seat ${state.activeSeatIndex} has no enabled choice in phase ${state.phase.kind}`];
  }
  return [];
}

const S8_COINS = 'Coins never go negative, and every transfer has a source.';
const S8_UIDS = 'UIDs are unique, and every creation or destruction is logged.';
const S8_REJECTED = 'Rejected or stale actions do not change state, and deals are atomic.';
const S8_REPLAY = 'Replay and resume never create assets or re-roll dice.';
const S8_ABILITIES =
  'Abilities fire ≤1 per instance per Lap and ≤1 per player turn, and evolution does not reset cooldowns.';
const S8_BATTLE =
  'A Battle Reward gives coins or evolution, never both. Evolution is one stage at a time on the same UID.';

/** Every spec §8 invariant; pending ones switch on when their rules land. */
export const INVARIANTS: readonly InvariantDefinition[] = [
  {
    id: 'coins-non-negative',
    status: 'active',
    section: '§8',
    specLine: S8_COINS,
    check: checkCoinsNonNegative,
  },
  {
    id: 'coin-transfer-sourced',
    status: 'active',
    section: '§8',
    specLine: S8_COINS,
    check: checkCoinTransfers,
  },
  { id: 'uid-unique', status: 'active', section: '§8', specLine: S8_UIDS, check: checkUidUnique },
  {
    id: 'uid-lifecycle-logged',
    status: 'active',
    section: '§8',
    specLine: S8_UIDS,
    check: checkUidLifecycle,
  },
  {
    id: 'rejected-or-stale-unchanged',
    status: 'active',
    section: '§8',
    specLine: S8_REJECTED,
    check: checkRejectedOrStale,
  },
  {
    id: 'catch-consumes-one-ball',
    status: 'active',
    section: '§8',
    specLine: 'Every catch attempt consumes exactly 1 Ball, and releasing consumes none.',
    check: checkCatchBalls,
  },
  {
    id: 'credited-lap-monotonic',
    status: 'active',
    section: '§6.5',
    specLine: 'movement stores a signed `routeProgress` and a monotonic `creditedLap`.',
    check: checkCreditedLap,
  },
  {
    // Pending until coin_transfer events carry an agreed Start-income reason code (issue #22).
    id: 'credited-lap-pays-once',
    status: 'pending',
    section: '§6.5',
    specLine: 'Being pushed or pulled, or re-crossing an old milestone, gives no reward.',
  },
  {
    id: 'replay-reproduces-state',
    status: 'active',
    section: '§8',
    specLine: S8_REPLAY,
    check: checkReplay,
  },
  {
    id: 'game-can-finish',
    status: 'active',
    section: '§8',
    specLine: 'The game can finish after an AI failure with any number of AIs.',
    check: checkGameCanFinish,
  },
  { id: 'deals-atomic', status: 'pending', section: '§8', specLine: S8_REJECTED },
  {
    id: 'move-debuff-until-next-move',
    status: 'pending',
    section: '§8',
    specLine: 'Move debuffs last until the next move.',
  },
  {
    id: 'tired-and-nurse-joy-useful',
    status: 'pending',
    section: '§8',
    specLine: 'Tired and Nurse Joy each have real use cases.',
  },
  {
    id: 'promise-closes-on-own-turn',
    status: 'pending',
    section: '§8',
    specLine: 'Promises close on the correct `ownTurnNo`.',
  },
  { id: 'resume-creates-nothing', status: 'pending', section: '§8', specLine: S8_REPLAY },
  {
    id: 'ability-once-per-instance-per-lap',
    status: 'pending',
    section: '§8',
    specLine: S8_ABILITIES,
  },
  { id: 'ability-once-per-player-turn', status: 'pending', section: '§8', specLine: S8_ABILITIES },
  { id: 'evolution-keeps-cooldowns', status: 'pending', section: '§8', specLine: S8_ABILITIES },
  {
    id: 'rescue-starter-no-coin-loop',
    status: 'pending',
    section: '§8',
    specLine: 'Rescue Starters cannot create a coin loop.',
  },
  {
    id: 'battle-reward-coins-or-evolution',
    status: 'pending',
    section: '§8',
    specLine: S8_BATTLE,
  },
  { id: 'evolution-one-stage-same-uid', status: 'pending', section: '§8', specLine: S8_BATTLE },
];

/**
 * Checks one engine step against every active invariant. `apply` re-runs the step for the replay
 * invariant; tests pass a deliberately broken engine so each mutation trips only its invariant.
 */
export function createInvariantChecker(apply: ApplyActionFn = applyAction) {
  return (before: GameState, action: unknown, result: ApplyActionResult): Violation[] => {
    const parsed = actionSchema.safeParse(action);
    const step: Step = {
      before,
      parsed: parsed.success ? parsed.data : null,
      result,
      apply,
    };
    return INVARIANTS.flatMap((invariant) =>
      invariant.status === 'active'
        ? invariant.check(step).map((message) => ({ invariant: invariant.id, message }))
        : [],
    );
  };
}

const checkWithEngine = createInvariantChecker();

/** Pure: no IO, no randomness. Call after every `applyAction` with its input and result. */
export function checkInvariants(
  before: GameState,
  action: unknown,
  result: ApplyActionResult,
): Violation[] {
  return checkWithEngine(before, action, result);
}
