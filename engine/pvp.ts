import type { Action, EngineEvent, GameState, LegalActions } from './contract/schema.ts';
import { pvpSnapshotSchema } from './contract/combat.ts';
import { pvpSnapshot, resolvePvp } from './combat.ts';
import { battleReadyMembers } from './status.ts';
import { rewardChoices, resolveReward } from './rewards.ts';

/** Strategy legality is independent of distance and willingness (§4.4). */
export function pvpChoices(state: GameState, result: LegalActions): void {
  const attacker = state.players.find((player) => player.seatIndex === state.activeSeatIndex)!;
  for (const target of state.players) {
    if (target === attacker) continue;
    const choice = {
      id: `declare-pvp:${target.seatIndex}`,
      kind: 'declare_pvp' as const,
      payload: { targetSeatIndex: target.seatIndex },
    };
    if (state.turnBudgets.tacticalAction === 0) {
      result.disabled.push({
        ...choice,
        reasonCode: 'ALREADY_USED_THIS_TURN',
        reasonText: 'Tactical action already used this turn',
      });
    } else if (!battleReadyMembers(attacker).length || !battleReadyMembers(target).length) {
      result.disabled.push({
        ...choice,
        reasonCode: 'NO_VALID_TARGET',
        reasonText: 'Both teams need a battle-ready Pokémon',
      });
    } else result.enabled.push(choice);
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
    for (const choice of rewardChoices(state, battle.request)) {
      result.enabled.push({
        id:
          choice.kind === 'coins'
            ? 'reward:coins'
            : `reward:evolve:${choice.instanceId}:${choice.nextFormId}`,
        kind: 'choose_reward',
        payload: choice,
      });
    }
  }
}

/** Called only after the public executor validates actor, revision and complete choice. */
export function recordPvpCommand(next: GameState, action: Action): EngineEvent[] {
  if (action.kind === 'declare_pvp') {
    const attacker = next.players.find((player) => player.seatIndex === next.activeSeatIndex)!;
    const defender = next.players.find(
      (player) => player.seatIndex === action.payload.targetSeatIndex,
    )!;
    const battleId = `pvp:${next.stateRevision}`;
    const attempt = {
      kind: 'attack_attempt' as const,
      attackId: battleId,
      actorId: attacker.actorId,
      targetId: defender.actorId,
      source: 'pvp_declaration' as const,
      actionSeq: next.stateRevision,
      globalTurnNo: next.globalTurnNo,
    };
    (next.attackHistory ??= []).push(attempt);
    next.turnBudgets.tacticalAction--;
    next.phase = {
      kind: 'pvp',
      battle: {
        battleId,
        attackerSeatIndex: attacker.seatIndex,
        defenderSeatIndex: defender.seatIndex,
        step: 'response',
      },
    };
    return [structuredClone(attempt), { kind: 'phase_changed', from: 'strategy', to: 'pvp' }];
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
    // Appendix C.3 D3/D4: no eligible implemented B/R Ability means both windows
    // auto-close in attacker/defender order. S10 adds choices here before this snapshot.
    const snapshot = pvpSnapshot(next, battle.attackerSeatIndex, battle.defenderSeatIndex);
    next.phase.battle = { ...battle, step: 'attacker_roll', snapshot };
    return [response, { kind: 'pvp_confirmed', battleId: battle.battleId, snapshot }];
  }
  if (action.kind === 'choose_reward' && battle.step === 'reward') {
    const reward = resolveReward(next, battle.request, action.payload);
    if ('rejected' in reward) throw new Error('Validated PvP reward rejected');
    next.phase = { kind: 'strategy' };
    return [...reward.events, { kind: 'phase_changed', from: 'pvp', to: 'strategy' }];
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
