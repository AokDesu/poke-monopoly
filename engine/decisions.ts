import type { GameState } from './contract/schema.ts';
import { pendingRollPurpose } from './turns.ts';

/** The seat entitled to answer now, separate from the owner of the current turn (§6.4).
 * null means the engine owes a result or the game has finished.
 */
export function pendingDecision(state: GameState): { seatIndex: number; actorId: string } | null {
  if (state.phase.kind === 'finished' || pendingRollPurpose(state)) return null;
  let seatIndex = state.activeSeatIndex;
  // A promise question (§4.8) is answered by its responder while the active seat waits.
  if (state.pendingResponse) seatIndex = state.pendingResponse.responderSeatIndex;
  else if (state.pendingPickpocket) seatIndex = state.pendingPickpocket.targetSeatIndex;
  else if (state.phase.kind === 'pvp') {
    const battle = state.phase.battle;
    if (battle.step === 'response' || battle.step === 'defender_window') {
      seatIndex = battle.defenderSeatIndex;
    } else if (battle.step === 'attacker_window') seatIndex = battle.attackerSeatIndex;
    else if (battle.step === 'reroll') {
      seatIndex = battle.side === 'attacker' ? battle.attackerSeatIndex : battle.defenderSeatIndex;
    } else if (battle.step === 'reward') {
      const winner = state.players.find((player) => player.actorId === battle.request.winnerId);
      if (!winner) return null;
      seatIndex = winner.seatIndex;
    } else return null;
  }
  const seat = state.config.seats.find((entry) => entry.seatIndex === seatIndex);
  return seat ? { seatIndex, actorId: seat.actorId } : null;
}

/**
 * The kind of decision pending, for Stream B question builders and Stream C screens (§5.3, §6.4).
 * `null` when the engine owes a die or the game has finished.
 */
export type EngineDecisionPoint =
  | 'first_player_roll'
  | 'turn_step'
  | 'strategy'
  | 'move'
  | 'encounter'
  | 'sell'
  | 'shop'
  | 'pvp_response'
  | 'ability_window'
  | 'reroll'
  | 'reward'
  | 'gym_entry';

export function decisionPoint(state: GameState): EngineDecisionPoint | null {
  if (!pendingDecision(state)) return null;
  if (state.pendingPickpocket) return 'ability_window';
  const phase = state.phase;
  switch (phase.kind) {
    case 'pvp':
      if (phase.battle.step === 'response') return 'pvp_response';
      if (phase.battle.step === 'reroll') return 'reroll';
      return phase.battle.step === 'reward' ? 'reward' : 'ability_window';
    case 'gym':
      if (phase.battle.step === 'entry') return 'gym_entry';
      if (phase.battle.step === 'reroll') return 'reroll';
      return phase.battle.step === 'reward' ? 'reward' : 'ability_window';
    case 'encounter':
      return phase.face !== undefined ? 'reroll' : 'encounter';
    case 'move':
      return phase.rolled !== undefined ? 'reroll' : 'move';
    case 'first_player_roll':
    case 'strategy':
    case 'sell':
    case 'shop':
      return phase.kind;
    default:
      return 'turn_step';
  }
}

export { socialTargets } from './social.ts';
