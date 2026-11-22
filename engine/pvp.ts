import type {
  Action,
  EngineEvent,
  GameState,
  LegalAction,
  LegalActions,
  Player,
} from './contract/schema.ts';
import { pvpSnapshotSchema, type PvpSnapshot } from './contract/combat.ts';
import { consumeCombatDebuff, pvpSnapshot, resolvePvp, type CombatModifiers } from './combat.ts';
import { abilityChoices, applyAfterResolution, canReroll } from './abilities.ts';
import { battleReadyMembers } from './status.ts';
import { pendingRewardChoices, pvpCoinLoss, resolveReward } from './rewards.ts';
import {
  applyCoinLossProtection,
  declareHostileAction,
  recordAttackAttempt,
} from './protection.ts';
import { publicRevision } from './revision.ts';

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
  } else if (battle.step === 'reroll' && !battle.rerolling) {
    result.enabled.push({ id: 'keep-die', kind: 'skip', payload: {} });
  } else if (battle.step === 'attacker_window' || battle.step === 'defender_window') {
    // Choosing none spends nothing (D10); activations come from abilityChoices.
    result.enabled.push({ id: 'pass-window', kind: 'skip', payload: {} });
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
      battleId: `pvp:${publicRevision(next)}`,
      attackerSeatIndex: attacker.seatIndex,
      defenderSeatIndex: defender.seatIndex,
      ...(forced ? { forced: true as const } : {}),
      step: 'response',
    },
  };
  const opened: EngineEvent = { kind: 'phase_changed', from, to: 'pvp' };
  return forced ? [opened, ...openPvpWindows(next)] : [opened];
}

/**
 * D4 steps 5–6: the attacker's window, then the defender's (who sees step 5). A window opens only
 * for a seat with an eligible ready Ability (C.3); otherwise the engine continues without asking.
 * Steps never reopen.
 */
function openPvpWindows(next: GameState, after?: 'attacker_window'): EngineEvent[] {
  if (next.phase.kind !== 'pvp') return [];
  const battle = next.phase.battle;
  if (!after && abilityChoices(next, battle.attackerSeatIndex, 'attacker').length) {
    next.phase.battle = { ...battle, step: 'attacker_window' };
    return [];
  }
  if (abilityChoices(next, battle.defenderSeatIndex, 'defender').length) {
    next.phase.battle = { ...battle, step: 'defender_window' };
    return [];
  }
  return confirmPvp(next);
}

/** Close the current window after its owner activated or passed. */
export function closePvpWindow(next: GameState): EngineEvent[] {
  if (next.phase.kind !== 'pvp') return [];
  const step = next.phase.battle.step;
  if (step === 'attacker_window') return openPvpWindows(next, step);
  return step === 'defender_window' ? confirmPvp(next) : [];
}

/** One side's frozen Ability terms: this battle's window choices plus turn-long roll effects. */
export function sideModifiers(
  next: GameState,
  seatIndex: number,
  mods: { abilityBonus: number; debuffs: number } | undefined,
): CombatModifiers {
  const player = next.players.find((entry) => entry.seatIndex === seatIndex)!;
  const turnLong = (player.rollEffects ?? [])
    .filter((effect) => effect.scope === 'combat' && effect.globalTurnNo === next.globalTurnNo)
    .reduce((sum, effect) => sum + effect.n, 0);
  return { abilityBonus: (mods?.abilityBonus ?? 0) + turnLong, debuffs: mods?.debuffs ?? 0 };
}

/** D4 step 7: the frozen snapshot shared by odds and dice. */
function confirmPvp(next: GameState): EngineEvent[] {
  if (next.phase.kind !== 'pvp') return [];
  const battle = next.phase.battle;
  const snapshot = pvpSnapshot(next, battle.attackerSeatIndex, battle.defenderSeatIndex, {
    attacker: sideModifiers(next, battle.attackerSeatIndex, battle.modifiers?.attacker),
    defender: sideModifiers(next, battle.defenderSeatIndex, battle.modifiers?.defender),
  });
  next.phase.battle = { ...battle, step: 'attacker_roll', snapshot };
  return [
    { kind: 'pvp_confirmed', battleId: battle.battleId, snapshot },
    ...consumeCombatDebuff(next, snapshot.attacker),
    ...consumeCombatDebuff(next, snapshot.defender),
  ];
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
      `pvp:${publicRevision(next)}`,
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
    return [response, ...openPvpWindows(next)];
  }
  if (action.kind === 'skip') {
    return battle.step === 'reroll' ? keepPvpDie(next) : closePvpWindow(next);
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
        amount: pvpCoinLoss(loser),
      });
      source.coinLossBlocked = applied.blocked;
      protection.push(...applied.events);
    }
    const reward = resolveReward(next, request, action.payload);
    if ('rejected' in reward) throw new Error('Validated PvP reward rejected');
    return [...protection, ...reward.events, ...leavePvp(next)];
  }
  return [];
}

export function pendingPvpRollPurpose(state: GameState): string | undefined {
  if (state.phase.kind !== 'pvp') return;
  const battle = state.phase.battle;
  if (battle.step === 'attacker_roll' || battle.step === 'defender_roll') {
    return `${battle.battleId}:${battle.step}`;
  }
  if (battle.step === 'reroll' && battle.rerolling)
    return `${battle.battleId}:${battle.side}_reroll`;
}

type Faces = { attackerFace: number; defenderFace: number };

export function recordPvpRoll(next: GameState, value: number): EngineEvent[] {
  if (next.phase.kind !== 'pvp') return [];
  const battle = next.phase.battle;
  if (battle.step === 'attacker_roll') {
    const snapshot = pvpSnapshotSchema.parse(battle.snapshot);
    next.phase.battle = { ...battle, snapshot, step: 'defender_roll', attackerFace: value };
    return [];
  }
  if (battle.step === 'defender_roll') {
    return offerReroll(next, { attackerFace: battle.attackerFace, defenderFace: value });
  }
  if (battle.step !== 'reroll' || !battle.rerolling) return [];
  // The new die replaces the old one, even when worse (D11).
  const faces = {
    attackerFace: battle.side === 'attacker' ? value : battle.attackerFace,
    defenderFace: battle.side === 'defender' ? value : battle.defenderFace,
  };
  return offerReroll(next, faces, battle.side);
}

/** Keep the revealed die in the current reroll window (D11). */
function keepPvpDie(next: GameState): EngineEvent[] {
  if (next.phase.kind !== 'pvp' || next.phase.battle.step !== 'reroll') return [];
  const { attackerFace, defenderFace, side } = next.phase.battle;
  return offerReroll(next, { attackerFace, defenderFace }, side);
}

/**
 * D4 step 9: the challenger, then the defender, may reroll its own die once with an eligible
 * Calculate; each sees both dice. No result applies before both windows close.
 */
function offerReroll(next: GameState, faces: Faces, done?: 'attacker' | 'defender'): EngineEvent[] {
  if (next.phase.kind !== 'pvp') return [];
  const battle = next.phase.battle;
  if (battle.step !== 'defender_roll' && battle.step !== 'reroll') return [];
  const snapshot = pvpSnapshotSchema.parse(battle.snapshot);
  const participants = {
    battleId: battle.battleId,
    attackerSeatIndex: battle.attackerSeatIndex,
    defenderSeatIndex: battle.defenderSeatIndex,
    ...(battle.forced ? { forced: battle.forced } : {}),
    ...(battle.modifiers ? { modifiers: battle.modifiers } : {}),
    ...(battle.afterResolution ? { afterResolution: battle.afterResolution } : {}),
  };
  for (const side of ['attacker', 'defender'] as const) {
    if (done === 'defender' || (done === 'attacker' && side === 'attacker')) continue;
    const seat = side === 'attacker' ? battle.attackerSeatIndex : battle.defenderSeatIndex;
    if (canReroll(next, seat)) {
      next.phase.battle = { ...participants, step: 'reroll', snapshot, ...faces, side };
      return [];
    }
  }
  return resolveBattle(next, snapshot, faces);
}

/** D4 steps 10–12: result, the winner's reward request, or a tie straight to consequences. */
function resolveBattle(next: GameState, snapshot: PvpSnapshot, faces: Faces): EngineEvent[] {
  if (next.phase.kind !== 'pvp') return [];
  const battle = next.phase.battle;
  const result = resolvePvp(snapshot, faces.attackerFace, faces.defenderFace);
  const event: EngineEvent = {
    kind: 'pvp_resolved',
    battleId: battle.battleId,
    ...faces,
    ...result,
  };
  if (result.rewardSeatIndex === null) return [event, ...leavePvp(next)];
  const winner = next.players.find((player) => player.seatIndex === result.rewardSeatIndex)!;
  const loserSeat =
    result.rewardSeatIndex === battle.attackerSeatIndex
      ? battle.defenderSeatIndex
      : battle.attackerSeatIndex;
  const loser = next.players.find((player) => player.seatIndex === loserSeat)!;
  next.phase.battle = {
    battleId: battle.battleId,
    attackerSeatIndex: battle.attackerSeatIndex,
    defenderSeatIndex: battle.defenderSeatIndex,
    ...(battle.forced ? { forced: battle.forced } : {}),
    ...(battle.modifiers ? { modifiers: battle.modifiers } : {}),
    ...(battle.afterResolution ? { afterResolution: battle.afterResolution } : {}),
    snapshot,
    step: 'reward',
    ...faces,
    request: {
      rewardId: battle.battleId,
      winnerId: winner.actorId,
      source: { kind: 'pvp', loserId: loser.actorId, coinLossBlocked: false },
    },
  };
  return [event];
}

/** D4 step 12: after-resolution consequences, then back to the challenger's Strategy. */
function leavePvp(next: GameState): EngineEvent[] {
  if (next.phase.kind !== 'pvp') return [];
  const consequences = applyAfterResolution(next, next.phase.battle.afterResolution);
  next.phase = { kind: 'strategy' };
  return [...consequences, { kind: 'phase_changed', from: 'pvp', to: 'strategy' }];
}
