import type { Action, EngineEvent, GameState } from './contract/schema.ts';

// Reserved hooks: real class, Ability and item effects are deferred beyond this cycle.
function classBonus(): number {
  return 0;
}
function abilityBonus(): number {
  return 0;
}
function itemBonus(): number {
  return 0;
}

export function confirmCatch(next: GameState, action: Action): EngineEvent[] {
  if (next.phase.kind !== 'encounter') return [];
  if (action.kind === 'release') {
    next.phase = { kind: 'end' };
    return [{ kind: 'phase_changed', from: 'encounter', to: 'end' }];
  }
  if (action.kind !== 'catch') return [];
  const player = next.players.find((entry) => entry.seatIndex === next.activeSeatIndex)!;
  // The encounter's species is fixed before the player confirms their chosen Ball.
  const definition = next.content.species.find(
    (entry) => next.phase.kind === 'encounter' && entry.id === next.phase.pokemon.speciesId,
  )!;
  const ballBonus = { poke: 0, great: 1, ultra: 2 }[action.payload.ballType];
  next.phase.catchRoll = {
    ballType: action.payload.ballType,
    catchDC: definition.dc,
    classBonus: classBonus(),
    ballBonus,
    abilityBonus: abilityBonus(),
    itemBonus: itemBonus(),
  };
  player.balls[action.payload.ballType]--;
  next.turnBudgets.catchAttempt--;
  return [];
}

export function recordCatchRoll(next: GameState, value: number): EngineEvent[] {
  if (next.phase.kind !== 'encounter' || !next.phase.catchRoll) return [];
  const { catchDC, classBonus, ballBonus, abilityBonus, itemBonus } = next.phase.catchRoll;
  const events: EngineEvent[] = [];
  if (value + classBonus + ballBonus + abilityBonus + itemBonus >= catchDC) {
    const player = next.players.find((entry) => entry.seatIndex === next.activeSeatIndex)!;
    const instanceId = `caught:${next.activeSeatIndex}:${next.stateRevision}`;
    player.team.push({
      instanceId,
      speciesId: next.phase.pokemon.speciesId,
      origin: 'caught',
      evolutionStage: 0,
      tired: false,
      abilityReady: true,
    });
    events.push({ kind: 'uid_created', instanceId, entity: 'pokemon', ownerId: player.actorId });
  }
  next.phase = { kind: 'end' };
  return [...events, { kind: 'phase_changed', from: 'encounter', to: 'end' }];
}
