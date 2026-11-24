import {
  advanceAutomatically,
  applyAction,
  legalActions,
  observe,
  type GameState,
  type PokemonInstance,
} from '../../engine/index.ts';
import { content, game } from './scenario-kit.ts';
import { createGame, createGameConfig } from '../../engine/index.ts';

/** One seat's team change: extra caught Pokémon, appended after its Starter. */
export type TeamExtras = readonly string[];

export interface BattleTable {
  seed: number;
  /** The human attacker's class; the AI (seat 0) is the Main Character with a Charmander. */
  humanClass?: string;
  /** Species added to the AI's team and to the human's, in order, as caught Pokémon. */
  aiExtras?: TeamExtras;
  humanExtras?: TeamExtras;
  /** The AI's coins and the human's. */
  coins?: readonly [number, number];
}

const caughtOf = (seat: number, n: number, speciesId: string): PokemonInstance => ({
  instanceId: `caught:${seat}:${n}`,
  speciesId,
  origin: 'caught' as const,
  evolutionStage: 0,
  tired: false,
  abilityReady: true,
  tradeable: true,
});

/** A two-seat table in the human's Strategy: seat 1 (human) is active, seat 0 is the AI (spec §4.4). */
function humanStrategy({
  seed,
  humanClass = 'rival',
  aiExtras = [],
  humanExtras = [],
  coins = [12, 14],
}: BattleTable): GameState {
  const state = createGame(
    createGameConfig({
      seats: ['main-character', humanClass].map((classId, seatIndex) => ({
        classId,
        ...(classId === 'main-character' && { starterSpeciesId: 'charmander' }),
        actorId: `P${seatIndex + 1}`,
        seatIndex,
        controller: seatIndex === 0 ? ('ai' as const) : ('human' as const),
      })),
      seed,
      lapTarget: 2,
    }),
    content,
  );
  state.globalTurnNo = 5;
  state.activeSeatIndex = 1;
  state.phase = { kind: 'strategy' };
  state.players.forEach((player) => {
    player.ownTurnNo = player.seatIndex === 1 ? 3 : 2;
    player.routeProgress = 30;
    player.creditedLap = 1;
    player.coins = coins[player.seatIndex]!;
  });
  state.turnBudgets = { tacticalAction: 1, catchAttempt: 1, pokemonAbility: 1 };
  aiExtras.forEach((id, n) => state.players[0]!.team.push(caughtOf(0, n + 1, id)));
  humanExtras.forEach((id, n) => state.players[1]!.team.push(caughtOf(1, n + 1, id)));
  return state;
}

/** One engine action by a seat's listed choice ID; a scenario table is built only from legal moves. */
export function take(state: GameState, seat: number, id: string): GameState {
  const choice = legalActions(state, seat).enabled.find((entry) => entry.id === id);
  if (!choice) throw new Error(`battle-kit: seat ${seat} has no enabled action "${id}"`);
  const actorId = state.config.seats.find((entry) => entry.seatIndex === seat)!.actorId;
  const revision = observe(state, seat).public.stateRevision;
  const result = applyAction(state, {
    actorId,
    kind: choice.kind,
    payload: choice.payload,
    actionSeq: revision + 1,
    stateRevisionBefore: revision,
  } as Parameters<typeof applyAction>[1]);
  if ('rejected' in result) throw new Error(`battle-kit: ${id}: ${result.reason}`);
  return result.state;
}

/** The human (seat 1) has declared a PvP battle on the AI: seat 0 owes accept or decline. */
export function pvpChallenge(table: BattleTable): GameState {
  return take(humanStrategy(table), 1, 'declare-pvp:0');
}

/** The AI accepted: the human's attacker window is next, then the AI's defender window. */
export function pvpDefenderWindow(table: BattleTable): GameState {
  let state = take(pvpChallenge(table), 0, 'accept-pvp');
  // The human (attacker) passes its window; the AI's defender window opens.
  state = take(state, 1, 'pass-window');
  return state;
}

/** The human used Pickpocket on the AI, which holds a ready Block: seat 0 owes its reaction. */
export function pickpocketReaction(table: BattleTable, itemInstanceId = 'bought:1:0'): GameState {
  const state = humanStrategy({ ...table, aiExtras: ['snorlax'] });
  state.players[1]!.items.push({
    instanceId: itemInstanceId,
    itemId: 'pickpocket',
    name: 'Pickpocket',
    visibility: 'secret',
  });
  return take(state, 1, `use-item:${itemInstanceId}:seat-0`);
}

const MAX_SEEDS = 400;

/** Drives a battle to its reward with every window passed, for the first seed on which `wanted` wins. */
function toReward(build: (seed: number) => GameState, winnerSeat: number): GameState {
  for (let seed = 1; seed <= MAX_SEEDS; seed++) {
    let state = build(seed);
    for (let step = 0; step < 24; step++) {
      state = advanceAutomatically(state).state;
      const { phase } = state;
      if ((phase.kind === 'pvp' || phase.kind === 'gym') && phase.battle.step === 'reward') break;
      if (phase.kind !== 'pvp' && phase.kind !== 'gym') break;
      const pending = [0, 1].find((seat) => {
        const ids = legalActions(state, seat).enabled.map((entry) => entry.id);
        return ids.includes('pass-window') || ids.includes('keep-die');
      });
      // No window is open: the engine owes a die, which the next step draws.
      if (pending === undefined) continue;
      const ids = legalActions(state, pending).enabled.map((entry) => entry.id);
      state = take(state, pending, ids.includes('pass-window') ? 'pass-window' : 'keep-die');
    }
    const { phase } = state;
    if ((phase.kind !== 'pvp' && phase.kind !== 'gym') || phase.battle.step !== 'reward') continue;
    const { winnerId } = phase.battle.request;
    const winner = state.players.find((player) => player.actorId === winnerId);
    if (winner?.seatIndex === winnerSeat) return state;
  }
  throw new Error(`battle-kit: no seed up to ${MAX_SEEDS} gives seat ${winnerSeat} the win`);
}

/** The AI won a PvP battle it accepted and owes its reward choice. */
export function pvpReward(table: BattleTable): GameState {
  return toReward((salt) => {
    const state = take(pvpChallenge({ ...table, seed: table.seed + salt }), 0, 'accept-pvp');
    return state;
  }, 0);
}

/** The AI, active at a Gym, won it and owes its reward choice. */
export function gymReward(table: BattleTable): GameState {
  return toReward((salt) => {
    const state = game(['main-character', 'rival'], table.seed + salt);
    state.phase = { kind: 'gym', battle: { step: 'entry', battleId: 'gym:1', position: 6 } };
    state.players.forEach((player) => {
      player.coins = (table.coins ?? [12, 14])[player.seatIndex]!;
    });
    (table.aiExtras ?? []).forEach((id, n) => state.players[0]!.team.push(caughtOf(0, n + 1, id)));
    return take(state, 0, 'challenge-gym');
  }, 0);
}
