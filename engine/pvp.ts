import type {
  Action,
  EngineEvent,
  GameState,
  LegalAction,
  LegalActions,
  Player,
} from './contract/schema.ts';
import { pvpSnapshotSchema } from './contract/combat.ts';
import { pvpSnapshot, resolvePvp } from './combat.ts';
import { battleReadyMembers } from './status.ts';
import { pendingRewardChoices, resolveReward } from './rewards.ts';
import {
  applyCoinLossProtection,
  declareHostileAction,
  recordAttackAttempt,
} from './protection.ts';

/** Shared readiness/action legality for every PvP source; null when legal (§4.4, D10). */
export function pvpDisabledReason(state: GameState, attacker: Player, target: Player) {
  if (state.turnBudgets.tacticalAction === 0) {
    return {
      reasonCode: 'ALREADY_USED_THIS_TURN' as const,
      reasonText: 'Tactical action already used this turn',
    };
  }
  if (!battleReadyMembers(attacker).length || !battleReadyMembers(target).length) {
    return {
      reasonCode: 'NO_VALID_TARGET' as const,
      reasonText: 'Both teams need a battle-ready Pokémon',
    };
  }
  return null;
}

/** Rival may force PvP once per credited Lap (Appendix A); only a new credited Lap resets it. */
function rivalForceAvailable(state: GameState, player: Player): boolean {
  return (
    state.content.classes.find((entry) => entry.id === player.classId)?.passive ===
      'combat_bonus' && player.forcePvpUsedLap !== player.creditedLap
  );
}

/** Strategy legality is independent of distance and willingness (§4.4). */
export function pvpChoices(state: GameState, result: LegalActions): void {
  const attacker = state.players.find((player) => player.seatIndex === state.activeSeatIndex)!;
  for (const target of state.players) {
    if (target === attacker) continue;
    const reason = pvpDisabledReason(state, attacker, target);
    const choices: LegalAction[] = [
      {
        id: `declare-pvp:${target.seatIndex}`,
        kind: 'declare_pvp',
        payload: { targetSeatIndex: target.seatIndex },
      },
    ];
    if (rivalForceAvailable(state, attacker)) {
      choices.push({
        id: `declare-pvp:${target.seatIndex}:rival`,
        kind: 'declare_pvp',
        payload: { targetSeatIndex: target.seatIndex, force: 'rival' },
      });
    }
    for (const choice of choices) {
      if (reason) result.disabled.push({ ...choice, ...reason });
      else result.enabled.push(choice);
    }
  }
}

export function pendingPvpChoices(state: GameState, result: LegalActions): void {
  if (state.phase.kind !== 'pvp') return;
  const battle = state.phase.battle;
  if (battle.step === 'response') {
    result.enabled.push(
      { id: 'accept-pvp', kind: 'respond_pvp', payload: { accept: true } },
      { id: 'decline-pvp', kind: 'respond_pvp', payload: { accept: false } },
    );
  } else if (battle.step === 'reward') {
    pendingRewardChoices(state, battle.request, result);
  }
}

/**
 * Open a validated challenge after its attack attempt and any protection are recorded (D4 steps
 * 1–3). Spends the tactical action; a voluntary challenge waits for the defender's response, a
 * forced one skips it (step 4) and goes straight to confirmation.
 */
export function beginPvp(
  next: GameState,
  attacker: Player,
  defender: Player,
  forced: boolean,
  spendTacticalAction = true,
): EngineEvent[] {
  if (spendTacticalAction) next.turnBudgets.tacticalAction--;
  const from = next.phase.kind;
  next.phase = {
    kind: 'pvp',
    battle: {
      battleId: `pvp:${next.stateRevision}`,
      attackerSeatIndex: attacker.seatIndex,
      defenderSeatIndex: defender.seatIndex,
      ...(forced ? { forced: true as const } : {}),
      step: 'response',
    },
  };
  const opened: EngineEvent = { kind: 'phase_changed', from, to: 'pvp' };
  return forced ? [opened, ...confirmPvp(next)] : [opened];
}

/** D4 steps 5–7: Ability windows then the frozen snapshot shared by odds and dice. */
function confirmPvp(next: GameState): EngineEvent[] {
  if (next.phase.kind !== 'pvp') return [];
  const battle = next.phase.battle;
  const snapshot = pvpSnapshot(next, battle.attackerSeatIndex, battle.defenderSeatIndex);
  next.phase.battle = { ...battle, step: 'attacker_roll', snapshot };
  return [{ kind: 'pvp_confirmed', battleId: battle.battleId, snapshot }];
}

/**
 * The forcePvP adapter (C.1 `forceChallenge`) for a bound Ability. It is a hostile Ability, so an
 * armed Price Shield blocks the whole action once the attempt is recorded; the tactical action
 * stays spent either way (D4 step 3, D6, D10). Callers check `pvpDisabledReason` first.
 */
export function forceChallenge(next: GameState, attacker: Player, defender: Player) {
  const declared = declareHostileAction(next, attacker, defender, 'hostile_ability');
  if (!declared.blocked) return [...declared.events, ...beginPvp(next, attacker, defender, true)];
  next.turnBudgets.tacticalAction--;
  return declared.events;
}

/** Called only after the public executor validates actor, revision and complete choice. */
export function recordPvpCommand(next: GameState, action: Action): EngineEvent[] {
  if (action.kind === 'declare_pvp') {
    const attacker = next.players.find((player) => player.seatIndex === next.activeSeatIndex)!;
    const defender = next.players.find(
      (player) => player.seatIndex === action.payload.targetSeatIndex,
    )!;
    // Rival's force is a public class passive, not a hostile item or Ability (D6).
    const forced = action.payload.force === 'rival';
    if (forced) attacker.forcePvpUsedLap = attacker.creditedLap;
    const attempt = recordAttackAttempt(
      next,
      attacker.actorId,
      defender.actorId,
      'pvp_declaration',
      `pvp:${next.stateRevision}`,
    );
    return [attempt, ...beginPvp(next, attacker, defender, forced)];
  }
  if (next.phase.kind !== 'pvp') return [];
  const battle = next.phase.battle;
  if (action.kind === 'respond_pvp' && battle.step === 'response') {
    const response: EngineEvent = {
      kind: 'pvp_response',
      battleId: battle.battleId,
      defenderId: action.actorId,
      accepted: action.payload.accept,
    };
    if (!action.payload.accept) {
      next.phase = { kind: 'strategy' };
      return [response, { kind: 'phase_changed', from: 'pvp', to: 'strategy' }];
    }
    return [response, ...confirmPvp(next)];
  }
  if (action.kind === 'choose_reward' && battle.step === 'reward') {
    const request = structuredClone(battle.request);
    const protection: EngineEvent[] = [];
    const source = request.source;
    if (action.payload.kind === 'coins' && source.kind === 'pvp') {
      // C.4: Nurse Joy first, then an armed shield; evolution is never a coin loss.
      const loser = next.players.find((player) => player.actorId === source.loserId)!;
      const applied = applyCoinLossProtection(next, loser, {
        actorId: request.winnerId,
        actionId: request.rewardId,
        source: 'pvp_coin_loss',
        amount: Math.min(6, loser.coins),
      });
      source.coinLossBlocked = applied.blocked;
      protection.push(...applied.events);
    }
    const reward = resolveReward(next, request, action.payload);
    if ('rejected' in reward) throw new Error('Validated PvP reward rejected');
    next.phase = { kind: 'strategy' };
    return [
      ...protection,
      ...reward.events,
      { kind: 'phase_changed', from: 'pvp', to: 'strategy' },
    ];
  }
  return [];
}

export function pendingPvpRollPurpose(state: GameState): string | undefined {
  if (state.phase.kind !== 'pvp') return;
  const battle = state.phase.battle;
  if (battle.step === 'attacker_roll' || battle.step === 'defender_roll') {
    return `${battle.battleId}:${battle.step}`;
  }
}

export function recordPvpRoll(next: GameState, value: number): EngineEvent[] {
  if (next.phase.kind !== 'pvp') return [];
  const battle = next.phase.battle;
  if (battle.step === 'attacker_roll') {
    const snapshot = pvpSnapshotSchema.parse(battle.snapshot);
    next.phase.battle = { ...battle, snapshot, step: 'defender_roll', attackerFace: value };
    return [];
  }
  if (battle.step !== 'defender_roll') return [];
  const result = resolvePvp(battle.snapshot, battle.attackerFace, value);
  const event: EngineEvent = {
    kind: 'pvp_resolved',
    battleId: battle.battleId,
    attackerFace: battle.attackerFace,
    defenderFace: value,
    ...result,
  };
  if (result.rewardSeatIndex === null) {
    next.phase = { kind: 'strategy' };
    return [event, { kind: 'phase_changed', from: 'pvp', to: 'strategy' }];
  }
  const winner = next.players.find((player) => player.seatIndex === result.rewardSeatIndex)!;
  const loserSeat =
    result.rewardSeatIndex === battle.attackerSeatIndex
      ? battle.defenderSeatIndex
      : battle.attackerSeatIndex;
  const loser = next.players.find((player) => player.seatIndex === loserSeat)!;
  next.phase.battle = {
    ...battle,
    snapshot: pvpSnapshotSchema.parse(battle.snapshot),
    step: 'reward',
    defenderFace: value,
    request: {
      rewardId: battle.battleId,
      winnerId: winner.actorId,
      source: { kind: 'pvp', loserId: loser.actorId, coinLossBlocked: false },
    },
  };
  return [event];
}
