import {
  attackTarget,
  promiseWindowStatus,
  type EngineEvent,
  type GameState,
  type LegalActions,
  type NoAttackPromise,
} from '../engine/index.ts';

export type DecisionEvidence = {
  seatIndex: number;
  legal: LegalActions;
  personalityId: string;
};

type HostilityCounts = { hostileUsed: number; legalHostileOpportunity: number };
export type HostilityRow = HostilityCounts & {
  personalityId: string;
  lap: number;
  usedPerOpportunity: number | null;
};
export type HostilitySummary = HostilityCounts & {
  usedPerOpportunity: number | null;
  byPersonalityLap: HostilityRow[];
};

export type PromiseSummary = {
  offered: number;
  accepted: number;
  rejected: number;
  broken: number;
  kept: number;
  keptWithOpportunity: number;
  keptWithoutOpportunity: number;
  closedByGameEnd: number;
  /** Accepted promises with at least one enabled attack against their recipient. */
  breachOpportunity: number;
  /** Accepted promises still unresolved, including those in aborted games. */
  pending: number;
};

export function emptyHostilitySummary(): HostilitySummary {
  return {
    hostileUsed: 0,
    legalHostileOpportunity: 0,
    usedPerOpportunity: null,
    byPersonalityLap: [],
  };
}

export function emptyPromiseSummary(): PromiseSummary {
  return {
    offered: 0,
    accepted: 0,
    rejected: 0,
    broken: 0,
    kept: 0,
    keptWithOpportunity: 0,
    keptWithoutOpportunity: 0,
    closedByGameEnd: 0,
    breachOpportunity: 0,
    pending: 0,
  };
}

type TrackedPromise = { promise: NoAttackPromise; opportunity: boolean };

/** Reporting counts only; gameplay numbers and legal attack classification come from engine/. */
export function createInteractionMetrics() {
  const hostility = emptyHostilitySummary();
  const promises = emptyPromiseSummary();
  const rows = new Map<string, HostilityRow>();
  const turns = new Set<string>();
  const active = new Set<TrackedPromise>();

  function decisionEvidence(
    before: GameState,
    events: readonly EngineEvent[],
    { seatIndex, legal, personalityId }: DecisionEvidence,
  ) {
    const player = before.players.find((entry) => entry.seatIndex === seatIndex)!;
    const attacks = legal.enabled.flatMap((choice) => {
      const attack = attackTarget(before, seatIndex, choice);
      return attack ? [attack] : [];
    });
    for (const tracked of active) {
      if (
        !tracked.opportunity &&
        tracked.promise.promiserSeatIndex === seatIndex &&
        attacks.some((attack) => attack.targetSeatIndex === tracked.promise.recipientSeatIndex)
      ) {
        tracked.opportunity = true;
        promises.breachOpportunity++;
      }
    }
    const used = events.filter(
      (event) =>
        event.kind === 'attack_attempt' &&
        event.source === 'hostile_item' &&
        event.actorId === player.actorId,
    ).length;
    const turn = `${seatIndex}:${player.ownTurnNo}`;
    const opportunity =
      attacks.some((attack) => attack.source === 'hostile_item') && !turns.has(turn);
    if (!opportunity && used === 0) return;
    const key = JSON.stringify([personalityId, player.creditedLap]);
    let row = rows.get(key);
    if (!row) {
      row = {
        personalityId,
        lap: player.creditedLap,
        hostileUsed: 0,
        legalHostileOpportunity: 0,
        usedPerOpportunity: null,
      };
      rows.set(key, row);
    }
    if (opportunity) {
      turns.add(turn);
      hostility.legalHostileOpportunity++;
      row.legalHostileOpportunity++;
    }
    hostility.hostileUsed += used;
    row.hostileUsed += used;
  }

  return {
    startGame() {
      turns.clear();
      active.clear();
    },
    step(
      before: GameState,
      after: GameState,
      events: readonly EngineEvent[],
      decision?: DecisionEvidence,
    ) {
      if (decision) decisionEvidence(before, events, decision);
      for (const event of events) {
        if (event.kind === 'promise_offered') promises.offered++;
        if (event.kind === 'promise_rejected') promises.rejected++;
        if (event.kind === 'promise_accepted') {
          promises.accepted++;
          promises.pending++;
          active.add({
            promise: {
              promiserSeatIndex: event.promiserSeatIndex,
              recipientSeatIndex: event.recipientSeatIndex,
              closesOwnTurnNo: event.closesOwnTurnNo,
              createdGlobalTurnNo: after.globalTurnNo,
            },
            opportunity: false,
          });
        }
        if (event.kind === 'attack_attempt') {
          for (const tracked of active) {
            const { promise } = tracked;
            const promiser = before.players.find(
              (player) => player.seatIndex === promise.promiserSeatIndex,
            )!;
            const recipient = before.players.find(
              (player) => player.seatIndex === promise.recipientSeatIndex,
            )!;
            if (event.actorId === promiser.actorId && event.targetId === recipient.actorId) {
              promises.broken++;
              promises.pending--;
              active.delete(tracked);
            }
          }
        }
      }
      for (const tracked of active) {
        const status = promiseWindowStatus(after, tracked.promise);
        if (status === 'active') continue;
        if (status === 'closed_by_game_end') promises.closedByGameEnd++;
        else {
          promises.kept++;
          if (tracked.opportunity) promises.keptWithOpportunity++;
          else promises.keptWithoutOpportunity++;
        }
        promises.pending--;
        active.delete(tracked);
      }
    },
    summary(): { hostility: HostilitySummary; promises: PromiseSummary } {
      const rate = (counts: HostilityCounts) =>
        counts.legalHostileOpportunity === 0
          ? null
          : counts.hostileUsed / counts.legalHostileOpportunity;
      return {
        promises: { ...promises },
        hostility: {
          ...hostility,
          usedPerOpportunity: rate(hostility),
          byPersonalityLap: [...rows.values()]
            .sort((a, b) => a.personalityId.localeCompare(b.personalityId) || a.lap - b.lap)
            .map((row) => ({ ...row, usedPerOpportunity: rate(row) })),
        },
      };
    },
  };
}
