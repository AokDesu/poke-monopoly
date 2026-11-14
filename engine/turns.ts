import { openGym, pendingGymRollPurpose } from './gym.ts';
import { pendingPvpRollPurpose } from './pvp.ts';
import { canReroll, pendingChanceRollPurpose, resetAbilities } from './abilities.ts';
import type { GameState, EngineEvent, Player } from './contract/schema.ts';
import { expireStatuses } from './status.ts';
import { startTurnClassPassive } from './classes.ts';
import { ENGINE_VERSION } from './versions.ts';
import { drawEncounter } from './catching.ts';
import { finishGame } from './game-end.ts';
import { openShop } from './shop.ts';
import { slowedSteps } from './slows.ts';
import { positionOf } from './contract/position.ts';

/** Internal transitions operate only on the executor's detached next snapshot. */
function startTurn(next: GameState, seatIndex: number): EngineEvent[] {
  next.activeSeatIndex = seatIndex;
  next.globalTurnNo++;
  next.players.find((player) => player.seatIndex === seatIndex)!.ownTurnNo++;
  next.turnBudgets = { tacticalAction: 1, catchAttempt: 1, pokemonAbility: 1 };
  delete next.turnEffects;
  next.phase = { kind: 'start' };
  return startTurnClassPassive(
    next,
    next.players.find((player) => player.seatIndex === seatIndex)!,
  );
}

export function firstPlayerRollPurpose(state: GameState): string {
  return `first-player:${state.activeSeatIndex}`;
}

export function pendingRollPurpose(state: GameState): string | undefined {
  const chance = pendingChanceRollPurpose(state);
  if (chance) return chance;
  const gym = pendingGymRollPurpose(state);
  if (gym) return gym;
  const pvp = pendingPvpRollPurpose(state);
  if (pvp) return pvp;
  if (state.phase.kind === 'encounter' && state.phase.catchRoll) {
    const purpose = `catch:${state.activeSeatIndex}:${state.globalTurnNo}`;
    if (state.phase.rerolling) return `${purpose}:reroll`;
    if (state.phase.face === undefined) return purpose;
  }
  if (state.phase.kind === 'first_player_roll' && state.phase.awaitingResult) {
    return firstPlayerRollPurpose(state);
  }
  if (state.phase.kind === 'move' && state.phase.awaitingResult) {
    const purpose = `move:${state.activeSeatIndex}:${state.globalTurnNo}`;
    return state.phase.rerolling ? `${purpose}:reroll` : purpose;
  }
}

export function recordMoveRoll(next: GameState, value: number): EngineEvent[] {
  if (next.phase.kind !== 'move' || !next.phase.awaitingResult) return [];
  // C.3 move order: an eligible A window follows the die before slows and movement (D11).
  if (!next.phase.rerolling && canReroll(next, next.activeSeatIndex)) {
    next.phase = { kind: 'move', rolled: value };
    return [];
  }
  return applyMove(next, value);
}

/** Owner movement by `value` before slows: Start credit, Sell, then Resolve (§4.2, §4.7). */
function applyMove(next: GameState, value: number): EngineEvent[] {
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
      // §4.7 step 1: +5, creditedLap +1, reset Abilities, then Sell.
      ...resetAbilities(player),
      ...announceFinalTableRound(next, player),
      { kind: 'phase_changed', from: 'move', to: 'sell' },
    ];
  }
  next.phase = { kind: 'resolve' };
  return [{ kind: 'phase_changed', from: 'move', to: 'resolve' }];
}

/** Only the first player to reach the Lap target fixes the round; later arrivals change nothing. */
function announceFinalTableRound(next: GameState, player: Player): EngineEvent[] {
  if (next.finalTableRound || player.creditedLap < next.config.lapTarget) return [];
  next.finalTableRound = { triggerSeatIndex: player.seatIndex, targetOwnTurnNo: player.ownTurnNo };
  return [{ kind: 'final_table_round', ...next.finalTableRound }];
}

export function recordTurnCommand(next: GameState, kind: string): EngineEvent[] {
  // Historical contract fixtures retain their illustrative choices and no gameplay effects.
  if (next.config.engineVersion !== ENGINE_VERSION) return [];
  if (kind === 'roll' && next.phase.kind === 'move') {
    // A replaceRoll Ability draws no die; pending slows still apply to its steps (D8).
    const fixed = next.turnEffects?.fixedMove;
    if (fixed !== undefined) return applyMove(next, fixed);
    next.phase.awaitingResult = true;
    return [];
  }
  if (kind !== 'skip') return [];
  // Keeping Porygon's revealed move die moves by it (D11).
  if (next.phase.kind === 'move' && next.phase.rolled !== undefined) {
    return applyMove(next, next.phase.rolled);
  }
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
      const expired = expireStatuses(
        next.players.find((player) => player.seatIndex === next.activeSeatIndex)!,
      );
      const round = next.finalTableRound;
      if (round && next.players.every((player) => player.ownTurnNo >= round.targetOwnTurnNo)) {
        return [...expired, ...finishGame(next)];
      }
      const seats = [...next.config.seats].sort((a, b) => a.seatIndex - b.seatIndex);
      const current = seats.findIndex((seat) => seat.seatIndex === next.activeSeatIndex);
      const healed = startTurn(next, seats[(current + 1) % seats.length]!.seatIndex);
      return [...expired, ...healed, { kind: 'phase_changed', from, to: next.phase.kind }];
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
    case 'gym':
      openGym(next, position);
      return [{ kind: 'space_resolved', seatIndex: player.seatIndex, position }];
    case 'event':
      // Events remain explicit placeholders until their own slice.
      return [
        { kind: 'space_resolved', seatIndex: player.seatIndex, position, effect: 'none_yet' },
      ];
    case 'shop':
      return [{ kind: 'space_resolved', seatIndex: player.seatIndex, position }, ...openShop(next)];
    case 'start':
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
  const healed = startTurn(next, leaders[0]!);
  return [...healed, { kind: 'phase_changed', from: 'first_player_roll', to: 'start' }];
}
