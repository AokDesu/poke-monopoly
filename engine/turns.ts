import type { GameState, EngineEvent } from './contract/schema.ts';
import { ENGINE_VERSION } from './versions.ts';

/** Internal transitions operate only on the executor's detached next snapshot. */
function startTurn(next: GameState, seatIndex: number): void {
  next.activeSeatIndex = seatIndex;
  next.globalTurnNo++;
  next.players.find((player) => player.seatIndex === seatIndex)!.ownTurnNo++;
  next.turnBudgets = { tacticalAction: 1, catchAttempt: 1, pokemonAbility: 1 };
  next.phase = { kind: 'start' };
}

export function firstPlayerRollPurpose(state: GameState): string {
  return `first-player:${state.activeSeatIndex}`;
}

export function pendingRollPurpose(state: GameState): string | undefined {
  if (state.phase.kind === 'first_player_roll' && state.phase.awaitingResult) {
    return firstPlayerRollPurpose(state);
  }
  if (state.phase.kind === 'move' && state.phase.awaitingResult) {
    return `move:${state.activeSeatIndex}:${state.globalTurnNo}`;
  }
}

export function recordMoveRoll(next: GameState): EngineEvent[] {
  if (next.phase.kind !== 'move' || !next.phase.awaitingResult) return [];
  next.phase = { kind: 'resolve' };
  return [{ kind: 'phase_changed', from: 'move', to: 'resolve' }];
}

export function recordTurnCommand(next: GameState, kind: string): EngineEvent[] {
  // Historical contract fixtures retain their illustrative choices and no gameplay effects.
  if (next.config.engineVersion !== ENGINE_VERSION) return [];
  if (kind === 'roll' && next.phase.kind === 'move') {
    next.phase.awaitingResult = true;
    return [];
  }
  if (kind !== 'skip') return [];
  const from = next.phase.kind;
  switch (from) {
    case 'start':
      next.phase = { kind: 'social' };
      break;
    case 'social':
      next.phase = { kind: 'strategy' };
      break;
    case 'strategy':
      next.phase = { kind: 'move' };
      break;
    case 'resolve':
      next.phase = { kind: 'end' };
      break;
    case 'end': {
      const seats = [...next.config.seats].sort((a, b) => a.seatIndex - b.seatIndex);
      const current = seats.findIndex((seat) => seat.seatIndex === next.activeSeatIndex);
      startTurn(next, seats[(current + 1) % seats.length]!.seatIndex);
      break;
    }
    default:
      return [];
  }
  return [{ kind: 'phase_changed', from, to: next.phase.kind }];
}

export function recordFirstPlayerRoll(next: GameState, value: number): EngineEvent[] {
  if (next.phase.kind !== 'first_player_roll') return [];
  const phase = next.phase;
  phase.rolls.push({ seatIndex: next.activeSeatIndex, value });
  phase.awaitingResult = false;
  if (phase.rolls.length < phase.contenders.length) {
    next.activeSeatIndex = phase.contenders[phase.rolls.length]!;
    return [];
  }
  const highest = Math.max(...phase.rolls.map((roll) => roll.value));
  const leaders = phase.rolls
    .filter((roll) => roll.value === highest)
    .map((roll) => roll.seatIndex);
  if (leaders.length > 1) {
    phase.contenders = leaders;
    phase.rolls = [];
    next.activeSeatIndex = leaders[0]!;
    return [];
  }
  startTurn(next, leaders[0]!);
  return [{ kind: 'phase_changed', from: 'first_player_roll', to: 'start' }];
}
