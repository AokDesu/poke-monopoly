import { healStatus } from './status.ts';
import { armShield, declareHostileAction } from './protection.ts';
import type {
  Action,
  EngineEvent,
  GameState,
  LegalAction,
  LegalActions,
  Player,
} from './contract/schema.ts';

// Hostile items cannot target the user and ignore board distance (§4.6).
const HOSTILE = ['repel', 'pickpocket'];

/** Strategy choices for each held usable item, one per opponent for hostile items. */
export function itemChoices(state: GameState, seatIndex: number, result: LegalActions): void {
  const player = state.players.find((entry) => entry.seatIndex === seatIndex)!;
  for (const item of player.items) {
    if (item.itemId === 'potion') {
      const targets = player.team.filter((pokemon) => pokemon.tired);
      const choices: LegalAction[] = targets.length
        ? targets.map((pokemon) => ({
            id: `use-item:${item.instanceId}:${pokemon.instanceId}:tired`,
            kind: 'use_item',
            payload: {
              itemInstanceId: item.instanceId,
              targetPokemonInstanceId: pokemon.instanceId,
              status: 'tired',
            },
          }))
        : [
            {
              id: `use-item:${item.instanceId}`,
              kind: 'use_item',
              payload: { itemInstanceId: item.instanceId },
            },
          ];
      for (const action of choices) {
        const reason =
          disabledReason(state, item.itemId, undefined) ??
          (!targets.length
            ? {
                reasonCode: 'NO_VALID_TARGET' as const,
                reasonText: 'No tired or debuffed Pokémon to heal',
              }
            : undefined);
        if (reason) result.disabled.push({ ...action, ...reason });
        else result.enabled.push(action);
      }
      continue;
    }
    if (!['lucky-egg', 'price-shield', ...HOSTILE].includes(item.itemId)) continue;
    const targets = !HOSTILE.includes(item.itemId)
      ? [undefined]
      : state.players.filter((target) => target.seatIndex !== seatIndex);
    for (const target of targets) {
      const action: LegalAction = target
        ? {
            id: `use-item:${item.instanceId}:seat-${target.seatIndex}`,
            kind: 'use_item',
            payload: { itemInstanceId: item.instanceId, targetSeatIndex: target.seatIndex },
          }
        : {
            id: `use-item:${item.instanceId}`,
            kind: 'use_item',
            payload: { itemInstanceId: item.instanceId },
          };
      const reason = disabledReason(state, item.itemId, target);
      if (reason) result.disabled.push({ ...action, ...reason });
      else result.enabled.push(action);
    }
  }
}

function disabledReason(state: GameState, itemId: string, target: Player | undefined) {
  if (state.turnBudgets.tacticalAction === 0) {
    return {
      reasonCode: 'ALREADY_USED_THIS_TURN' as const,
      reasonText: 'Tactical action already used this turn',
    };
  }
  const user = state.players.find((entry) => entry.seatIndex === state.activeSeatIndex)!;
  if (itemId === 'price-shield' && user.armedShield) {
    return { reasonCode: 'NO_VALID_TARGET' as const, reasonText: 'A shield is already armed' };
  }
  if (itemId === 'pickpocket' && target?.coins === 0) {
    return { reasonCode: 'NO_VALID_TARGET' as const, reasonText: 'Target has no coins' };
  }
  // The same slowing kind never stacks on a target that still has it pending.
  if (itemId === 'repel' && target?.pendingSlows?.includes('repel')) {
    return { reasonCode: 'NO_VALID_TARGET' as const, reasonText: 'Target is already slowed' };
  }
}

/** Apply a validated item use; the executor has already checked the choice is enabled. */
export function useItem(next: GameState, action: Action): EngineEvent[] {
  if (next.phase.kind !== 'strategy' || action.kind !== 'use_item') return [];
  const player = next.players.find((entry) => entry.seatIndex === next.activeSeatIndex)!;
  const itemInstanceId = action.payload.itemInstanceId;
  const item = player.items.find((entry) => entry.instanceId === itemInstanceId)!;
  const itemId = item.itemId;
  player.items = player.items.filter((item) => item.instanceId !== itemInstanceId);
  next.turnBudgets.tacticalAction--;
  const destroyed: EngineEvent = {
    kind: 'uid_destroyed',
    instanceId: itemInstanceId,
    entity: 'item',
    reason: 'used',
  };
  if (itemId === 'price-shield') {
    // D6: using Price Shield arms it; a secret one stays secret until it blocks something.
    return [...armShield(player, { scope: 'price', visibility: item.visibility }), destroyed];
  }
  if (itemId === 'potion') {
    return [
      ...healStatus(player, action.payload.targetPokemonInstanceId!, 'tired', 'potion'),
      destroyed,
    ];
  }
  if (itemId === 'lucky-egg') {
    // +1 to this turn's own catch/combat; no movement bonus (Appendix A).
    next.turnEffects = { itemBonus: 1 };
    return [destroyed];
  }
  const target = next.players.find((entry) => entry.seatIndex === action.payload.targetSeatIndex)!;
  const used: EngineEvent = {
    kind: 'hostile_item_used',
    userSeatIndex: player.seatIndex,
    targetSeatIndex: target.seatIndex,
    itemId,
  };
  // The declaration counts as an attack even when a shield blocks the whole action (§4.6, D6).
  const declared = declareHostileAction(next, player, target, 'hostile_item');
  if (declared.blocked) return [used, ...declared.events, destroyed];
  if (itemId === 'repel') {
    target.pendingSlows = [...(target.pendingSlows ?? []), 'repel'];
    return [used, ...declared.events, destroyed];
  }
  const amount = Math.min(5, target.coins);
  target.coins -= amount;
  player.coins += amount;
  return [
    {
      kind: 'coin_transfer',
      source: { kind: 'player', actorId: target.actorId },
      destination: { kind: 'player', actorId: player.actorId },
      amount,
      reason: 'pickpocket',
    },
    used,
    ...declared.events,
    destroyed,
  ];
}

/** Squares for an actual d6 move after pending slows, which that move clears (§4.6). */
export function slowedSteps(player: Player, value: number): number {
  const steps = player.pendingSlows?.includes('repel') ? Math.max(1, value - 2) : value;
  delete player.pendingSlows;
  return steps;
}
