import {
  attackTarget,
  type EngineEvent,
  type GameState,
  type LegalActions,
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
  /** Accepted promises whose promiser held a public hostile item or hostile Ability chance against the recipient. */
  breachOpportunity: number;
  /** Accepted promises still unresolved, including those in aborted games. */
  pending: number;
};

/** Deal Cards by outcome (§4.8, #164): what the human seat proposed and how each exchange ended. */
export type DealSummary = {
  proposed: number;
  accepted: number;
  rejected: number;
  countered: number;
  cancelled: number;
  /** Deals that moved assets and coins (`deal_committed`). */
  committed: number;
};

export function emptyDealSummary(): DealSummary {
  return { proposed: 0, accepted: 0, rejected: 0, countered: 0, cancelled: 0, committed: 0 };
}

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

/**
 * Reporting counts only; gameplay numbers and legal attack classification come from engine/. Promise outcomes and
 * the breach-opportunity flag are read from the engine's own records (`state.promises`), never re-derived here.
 */
export function createInteractionMetrics() {
  const hostility = emptyHostilitySummary();
  const promises = emptyPromiseSummary();
  const deals = emptyDealSummary();
  const rows = new Map<string, HostilityRow>();
  const turns = new Set<string>();

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
    },
    step(
      before: GameState,
      after: GameState,
      events: readonly EngineEvent[],
      decision?: DecisionEvidence,
    ) {
      if (decision) decisionEvidence(before, events, decision);
      for (const event of events) {
        if (event.kind === 'deal_proposed') deals.proposed++;
        if (event.kind === 'deal_accepted') deals.accepted++;
        if (event.kind === 'deal_rejected') deals.rejected++;
        if (event.kind === 'deal_countered') deals.countered++;
        if (event.kind === 'deal_cancelled') deals.cancelled++;
        if (event.kind === 'deal_committed') deals.committed++;
        if (event.kind === 'promise_offered') promises.offered++;
        if (event.kind === 'promise_rejected') promises.rejected++;
        if (event.kind === 'promise_accepted') {
          promises.accepted++;
          promises.pending++;
        }
      }
      // The engine appends promises and records each one's outcome and chance once, so the step's changes are the
      // records that differ from `before`.
      (after.promises ?? []).forEach((promise, index) => {
        const was = before.promises?.[index];
        if (promise.chance && !was?.chance) promises.breachOpportunity++;
        if (!promise.settled || was?.settled) return;
        promises.pending--;
        const { outcome } = promise.settled;
        if (outcome === 'broken') promises.broken++;
        else if (outcome === 'closed_by_game_end') promises.closedByGameEnd++;
        else {
          promises.kept++;
          if (outcome === 'kept_with_chance') promises.keptWithOpportunity++;
          else promises.keptWithoutOpportunity++;
        }
      });
    },
    summary(): { hostility: HostilitySummary; promises: PromiseSummary; deals: DealSummary } {
      const rate = (counts: HostilityCounts) =>
        counts.legalHostileOpportunity === 0
          ? null
          : counts.hostileUsed / counts.legalHostileOpportunity;
      return {
        promises: { ...promises },
        deals: { ...deals },
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
