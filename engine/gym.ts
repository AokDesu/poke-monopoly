import type { Action, EngineEvent, GameState, LegalActions } from './contract/schema.ts';
import { gymSnapshotSchema } from './contract/combat.ts';
import { gymSnapshot, resolveGym } from './combat.ts';
import { abilityChoices, applyAfterResolution, canReroll } from './abilities.ts';
import { sideModifiers } from './pvp.ts';
import { applyCoinLossProtection } from './protection.ts';
import { pendingRewardChoices, resolveReward } from './rewards.ts';
import { battleReadyMembers } from './status.ts';
import { publicRevision } from './revision.ts';

/** Every Gym loss pays the bank at most this many coins (§4.4). */
const GYM_LOSS_COINS = 3;

/** Landing on a Gym in Resolve opens its entry choice (Appendix C.3 D5 step 1). */
export function openGym(next: GameState, position: number): void {
  if (position !== 6 && position !== 12 && position !== 18) throw new RangeError('Not a Gym');
  next.phase = {
    kind: 'gym',
    battle: { battleId: `gym:${publicRevision(next)}`, position, step: 'entry' },
  };
}

/** Entry: challenge (needs a battle-ready member) or skip; the winner's reward choice (D5). */
export function pendingGymChoices(state: GameState, result: LegalActions): void {
  if (state.phase.kind !== 'gym') return;
  const battle = state.phase.battle;
  if (battle.step === 'entry') {
    const player = state.players.find((entry) => entry.seatIndex === state.activeSeatIndex)!;
    const challenge = { id: 'challenge-gym', kind: 'challenge_gym' as const, payload: {} };
    if (battleReadyMembers(player).length) result.enabled.push(challenge);
    else {
      result.disabled.push({
        ...challenge,
        reasonCode: 'NO_VALID_TARGET',
        reasonText: 'No battle-ready Pokémon',
      });
    }
    result.enabled.push({ id: 'skip', kind: 'skip', payload: {} });
  } else if (battle.step === 'reroll' && !battle.rerolling) {
    result.enabled.push({ id: 'keep-die', kind: 'skip', payload: {} });
  } else if (battle.step === 'window') {
    result.enabled.push({ id: 'pass-window', kind: 'skip', payload: {} });
  } else if (battle.step === 'reward') {
    pendingRewardChoices(state, battle.request, result);
  }
}

/** D5 step 3: freeze the snapshot after the window closes. */
export function confirmGym(next: GameState): EngineEvent[] {
  if (next.phase.kind !== 'gym') return [];
  const battle = next.phase.battle;
  if (battle.step !== 'entry' && battle.step !== 'window') return [];
  const snapshot = gymSnapshot(
    next,
    next.activeSeatIndex,
    battle.position,
    sideModifiers(next, next.activeSeatIndex, battle.modifiers),
  );
  next.phase.battle = { ...battle, step: 'roll', snapshot };
  return [{ kind: 'gym_confirmed', battleId: battle.battleId, snapshot }];
}

/** Close the Gym window after the challenger activated an Ability. */
export function closeGymWindow(next: GameState): EngineEvent[] {
  return next.phase.kind === 'gym' && next.phase.battle.step === 'window' ? confirmGym(next) : [];
}

/** D5 step 6: after-resolution consequences, then End. */
function leaveGym(next: GameState): EngineEvent[] {
  const consequences =
    next.phase.kind === 'gym' ? applyAfterResolution(next, next.phase.battle.afterResolution) : [];
  next.phase = { kind: 'end' };
  return [...consequences, { kind: 'phase_changed', from: 'gym', to: 'end' }];
}

/** Called only after the executor validated actor, revision and the complete choice. */
export function recordGymCommand(next: GameState, action: Action): EngineEvent[] {
  if (next.phase.kind !== 'gym') return [];
  const battle = next.phase.battle;
  if (battle.step === 'entry') {
    // Skipping costs nothing; a challenge spends no tactical action (D5).
    if (action.kind === 'skip') return leaveGym(next);
    if (action.kind !== 'challenge_gym') return [];
    // D5 step 2: the challenger's B window opens only with an eligible ready Ability.
    if (abilityChoices(next, next.activeSeatIndex, 'gym').length) {
      next.phase.battle = { ...battle, step: 'window' };
      return [];
    }
    return confirmGym(next);
  }
  if (battle.step === 'window' && action.kind === 'skip') return confirmGym(next);
  if (battle.step === 'reroll' && action.kind === 'skip') return resolveGymDie(next, battle.face);
  if (battle.step === 'reward' && action.kind === 'choose_reward') {
    const reward = resolveReward(next, battle.request, action.payload);
    if ('rejected' in reward) throw new Error('Validated Gym reward rejected');
    return [...reward.events, ...leaveGym(next)];
  }
  return [];
}

export function pendingGymRollPurpose(state: GameState): string | undefined {
  if (state.phase.kind !== 'gym') return;
  const battle = state.phase.battle;
  if (battle.step === 'roll') return `${battle.battleId}:challenger_roll`;
  if (battle.step === 'reroll' && battle.rerolling) return `${battle.battleId}:challenger_reroll`;
}

/** The Gym die; an eligible Calculate opens an A window before any result (D5 step 4, D11). */
export function recordGymRoll(next: GameState, value: number): EngineEvent[] {
  if (next.phase.kind !== 'gym') return [];
  const battle = next.phase.battle;
  if (battle.step === 'reroll' && battle.rerolling) return resolveGymDie(next, value);
  if (battle.step !== 'roll') return [];
  if (canReroll(next, next.activeSeatIndex)) {
    const snapshot = gymSnapshotSchema.parse(battle.snapshot);
    next.phase.battle = { ...battle, step: 'reroll', snapshot, face: value };
    return [];
  }
  return resolveGymDie(next, value);
}

/** A win grants exactly one badge before the reward choice; a loss pays the bank (§4.4, D5). */
function resolveGymDie(next: GameState, value: number): EngineEvent[] {
  if (next.phase.kind !== 'gym') return [];
  const battle = next.phase.battle;
  if (battle.step !== 'roll' && battle.step !== 'reroll') return [];
  const snapshot = gymSnapshotSchema.parse(battle.snapshot);
  const result = resolveGym(snapshot, value);
  const player = next.players.find((entry) => entry.seatIndex === next.activeSeatIndex)!;
  const resolved: EngineEvent = {
    kind: 'gym_resolved',
    battleId: battle.battleId,
    face: value,
    ...result,
  };
  if (result.outcome === 'win') {
    player.badges++;
    next.phase.battle = {
      battleId: battle.battleId,
      position: battle.position,
      ...(battle.modifiers ? { modifiers: battle.modifiers } : {}),
      ...(battle.afterResolution ? { afterResolution: battle.afterResolution } : {}),
      snapshot,
      step: 'reward',
      face: value,
      request: { rewardId: battle.battleId, winnerId: player.actorId, source: { kind: 'gym' } },
    };
    return [
      resolved,
      { kind: 'badge_awarded', battleId: battle.battleId, ownerId: player.actorId },
    ];
  }
  const amount = Math.min(GYM_LOSS_COINS, player.coins);
  // Only a battle-scoped shield (Shell Guard) covers a Gym loss; Price Shield and Nurse Joy do not.
  const protection = applyCoinLossProtection(next, player, {
    actorId: player.actorId,
    actionId: battle.battleId,
    source: 'gym_coin_loss',
    amount,
  });
  const events: EngineEvent[] = [resolved, ...protection.events];
  if (!protection.blocked && amount > 0) {
    player.coins -= amount;
    events.push({
      kind: 'coin_transfer',
      source: { kind: 'player', actorId: player.actorId },
      destination: { kind: 'bank' },
      amount,
      reason: 'gym_loss',
    });
  }
  return [...events, ...leaveGym(next)];
}
