import { bucketLeadChance, type LeadChance, type Observation } from '../engine/index.ts';
import type { DecisionPoint } from '../engine/contract/decision.ts';

export {
  ownBattle,
  wireBattleFacts,
  type OwnBattle,
  type WireBattleFacts,
} from './fallback/battle-facts.ts';

/** The named bucket a chance is shown as to Jev (spec §5.4): never the number. */
export const chanceBucket = (share: number): LeadChance => bucketLeadChance(share);

export type ChanceBucket = LeadChance;

/** The PvP challenge this seat owes an answer to (§4.4). */
export function pendingPvpResponse(observation: Observation): boolean {
  const { phase } = observation.public;
  return (
    phase.kind === 'pvp' &&
    phase.battle.step === 'response' &&
    phase.battle.defenderSeatIndex === observation.own.seatIndex
  );
}

/** The battle reward this seat, the winner, owes a choice of (§4.4). */
export function pendingReward(observation: Observation): boolean {
  const { phase, players } = observation.public;
  if ((phase.kind !== 'pvp' && phase.kind !== 'gym') || phase.battle.step !== 'reward')
    return false;
  const { winnerId } = phase.battle.request;
  return (
    players.find((player) => player.actorId === winnerId)?.seatIndex === observation.own.seatIndex
  );
}

/** An Ability window open for this seat: a battle window or a private Pickpocket reaction (§4.4). */
export function openAbilityWindow(observation: Observation): boolean {
  const { phase, activeSeatIndex } = observation.public;
  const me = observation.own.seatIndex;
  if (observation.own.pickpocketReaction) return true;
  if (phase.kind === 'pvp') {
    const { step, attackerSeatIndex, defenderSeatIndex } = phase.battle;
    return (
      (step === 'attacker_window' && attackerSeatIndex === me) ||
      (step === 'defender_window' && defenderSeatIndex === me)
    );
  }
  return phase.kind === 'gym' && phase.battle.step === 'window' && activeSeatIndex === me;
}

/**
 * The battle decision point an observation owes an answer to, or undefined: the engine names it, the
 * caller (a sim policy, the browser) passes it on as the wire's `decisionPoint` (spec §4.4, §5.3).
 */
export function battleDecisionPoint(
  observation: Observation,
): Extract<DecisionPoint, 'pvp_response' | 'ability_window' | 'reward'> | undefined {
  if (pendingPvpResponse(observation)) return 'pvp_response';
  if (pendingReward(observation)) return 'reward';
  if (openAbilityWindow(observation)) return 'ability_window';
  return undefined;
}
