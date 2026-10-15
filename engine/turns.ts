import type { GameState, EngineEvent } from './contract/schema.ts';
import { ENGINE_VERSION } from './versions.ts';
import { drawEncounter } from './catching.ts';
import { openShop } from './shop.ts';
import { slowedSteps } from './items.ts';
import { positionOf } from './contract/position.ts';

/** Internal transitions operate only on the executor's detached next snapshot. */
function startTurn(next: GameState, seatIndex: number): void {
  next.activeSeatIndex = seatIndex;
  next.globalTurnNo++;
  next.players.find((player) => player.seatIndex === seatIndex)!.ownTurnNo++;
  next.turnBudgets = { tacticalAction: 1, catchAttempt: 1, pokemonAbility: 1 };
  delete next.turnEffects;
  next.phase = { kind: 'start' };
}

export function firstPlayerRollPurpose(state: GameState): string {
  return `first-player:${state.activeSeatIndex}`;
}

export function pendingRollPurpose(state: GameState): string | undefined {
  if (state.phase.kind === 'encounter' && state.phase.catchRoll) {
    return `catch:${state.activeSeatIndex}:${state.globalTurnNo}`;
  }
  if (state.phase.kind === 'first_player_roll' && state.phase.awaitingResult) {
    return firstPlayerRollPurpose(state);
  }
  if (state.phase.kind === 'move' && state.phase.awaitingResult) {
    return `move:${state.activeSeatIndex}:${state.globalTurnNo}`;
  }
}

export function recordMoveRoll(next: GameState, value: number): EngineEvent[] {
  if (next.phase.kind !== 'move' || !next.phase.awaitingResult) return [];
  const player = next.players.find((entry) => entry.seatIndex === next.activeSeatIndex)!;
  const previousMilestone = Math.floor(player.routeProgress / 24);
  player.routeProgress += slowedSteps(player, value);
  const milestone = Math.floor(player.routeProgress / 24);
  const highestRewardedMilestone = player.highestRewardedMilestone ?? player.creditedLap;
  if (milestone > previousMilestone && milestone > highestRewardedMilestone) {
    player.coins += 5;
    player.creditedLap++;
    player.highestRewardedMilestone = milestone;
    next.phase = { kind: 'sell', destinationPosition: positionOf(player.routeProgress) };
    return [
      {
        kind: 'coin_transfer',
        source: { kind: 'bank' },
        destination: { kind: 'player', actorId: player.actorId },
        amount: 5,
        reason: 'start_income',
      },
      { kind: 'phase_changed', from: 'move', to: 'sell' },
    ];
  }
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
      return [...resolveDestination(next), { kind: 'phase_changed', from, to: next.phase.kind }];
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

/** Resolve the destination after any Start-crossing Sell phase. */
function resolveDestination(next: GameState): EngineEvent[] {
  const player = next.players.find((entry) => entry.seatIndex === next.activeSeatIndex)!;
  const position = positionOf(player.routeProgress);
  const space = next.content.board.find((entry) => entry.position === position);
  if (!space) throw new RangeError('Destination space is missing');
  switch (space.kind) {
    case 'wild':
      return [
        { kind: 'space_resolved', seatIndex: player.seatIndex, position },
        ...drawEncounter(next),
      ];
    case 'shop':
      return [{ kind: 'space_resolved', seatIndex: player.seatIndex, position }, ...openShop(next)];
    case 'start':
    case 'event':
    case 'gym':
      return [{ kind: 'space_resolved', seatIndex: player.seatIndex, position }];
  }
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
