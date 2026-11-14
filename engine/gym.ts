import type { Action, EngineEvent, GameState, LegalActions } from './contract/schema.ts';
import { gymSnapshotSchema } from './contract/combat.ts';
import { gymSnapshot, resolveGym } from './combat.ts';
import { applyCoinLossProtection } from './protection.ts';
import { pendingRewardChoices, resolveReward } from './rewards.ts';
import { battleReadyMembers } from './status.ts';

/** Every Gym loss pays the bank at most this many coins (§4.4). */
const GYM_LOSS_COINS = 3;

/** Landing on a Gym in Resolve opens its entry choice (Appendix C.3 D5 step 1). */
export function openGym(next: GameState, position: number): void {
  if (position !== 6 && position !== 12 && position !== 18) throw new RangeError('Not a Gym');
  next.phase = {
    kind: 'gym',
    battle: { battleId: `gym:${next.stateRevision}`, position, step: 'entry' },
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
  } else if (battle.step === 'reward') {
    pendingRewardChoices(state, battle.request, result);
  }
}

function leaveGym(next: GameState): EngineEvent {
  next.phase = { kind: 'end' };
  return { kind: 'phase_changed', from: 'gym', to: 'end' };
}

/** Called only after the executor validated actor, revision and the complete choice. */
export function recordGymCommand(next: GameState, action: Action): EngineEvent[] {
  if (next.phase.kind !== 'gym') return [];
  const battle = next.phase.battle;
  if (battle.step === 'entry') {
    // Skipping costs nothing; a challenge spends no tactical action (D5).
    if (action.kind === 'skip') return [leaveGym(next)];
    if (action.kind !== 'challenge_gym') return [];
    const snapshot = gymSnapshot(next, next.activeSeatIndex, battle.position);
    next.phase.battle = { ...battle, step: 'roll', snapshot };
    return [{ kind: 'gym_confirmed', battleId: battle.battleId, snapshot }];
  }
  if (battle.step === 'reward' && action.kind === 'choose_reward') {
    const reward = resolveReward(next, battle.request, action.payload);
    if ('rejected' in reward) throw new Error('Validated Gym reward rejected');
    return [...reward.events, leaveGym(next)];
  }
  return [];
}

export function pendingGymRollPurpose(state: GameState): string | undefined {
  if (state.phase.kind === 'gym' && state.phase.battle.step === 'roll') {
    return `${state.phase.battle.battleId}:challenger_roll`;
  }
}

/** A win grants exactly one badge before the reward choice; a loss pays the bank (§4.4, D5). */
export function recordGymRoll(next: GameState, value: number): EngineEvent[] {
  if (next.phase.kind !== 'gym' || next.phase.battle.step !== 'roll') return [];
  const battle = next.phase.battle;
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
      ...battle,
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
  return [...events, leaveGym(next)];
}
