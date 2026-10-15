import type { EngineEvent, GameState } from './contract/schema.ts';
import { saleBasis } from './selling.ts';

/**
 * Setup presets (§1): Quick 2 Laps is core; Standard 3 Laps stays closed to players until the
 * playtest confirms the session length. `enabled` gates the setup screen only; the engine and
 * sim still run any positive Lap target.
 */
export const GAME_PRESETS = {
  quick: { lapTarget: 2, enabled: true },
  standard: { lapTarget: 3, enabled: false },
} as const;

/** Paid Laps that trigger the Final Table Round for each preset. */
export const LAP_TARGETS = {
  quick: GAME_PRESETS.quick.lapTarget,
  standard: GAME_PRESETS.standard.lapTarget,
} as const;

/**
 * Auto-sells every remaining non-Rescue Pokémon at half Sale Basis with no class bonus, then
 * finishes the game. Rescue Starters and items stay unconverted. Operates on the executor's
 * detached next snapshot.
 */
export function finishGame(next: GameState): EngineEvent[] {
  const events: EngineEvent[] = [];
  for (const player of [...next.players].sort((a, b) => a.seatIndex - b.seatIndex)) {
    for (const pokemon of player.team) {
      if (pokemon.origin === 'rescue_starter') continue;
      // Math.round rounds halves up for these nonnegative prices (§4.7).
      const amount = Math.round(saleBasis(next.content, pokemon) * 0.5);
      player.coins += amount;
      events.push(
        {
          kind: 'coin_transfer',
          source: { kind: 'bank' },
          destination: { kind: 'player', actorId: player.actorId },
          amount,
          reason: 'final_sale',
        },
        {
          kind: 'uid_destroyed',
          instanceId: pokemon.instanceId,
          entity: 'pokemon',
          reason: 'final_sale',
        },
      );
    }
    player.team = player.team.filter((pokemon) => pokemon.origin === 'rescue_starter');
  }
  next.phase = { kind: 'finished' };
  return [...events, { kind: 'phase_changed', from: 'end', to: 'finished' }];
}

export type WinnerResult = {
  /** Actor IDs in seat order. */
  winners: string[];
  reason: 'coins' | 'badges' | 'co_winners';
};

/** Most coins, then badges, then co-winners; Pokémon and evolution counts never break ties. */
export function winner(state: GameState): WinnerResult {
  const players = [...state.players].sort((a, b) => a.seatIndex - b.seatIndex);
  const coins = Math.max(...players.map((player) => player.coins));
  const richest = players.filter((player) => player.coins === coins);
  if (richest.length === 1) return { winners: [richest[0]!.actorId], reason: 'coins' };
  const badges = Math.max(...richest.map((player) => player.badges));
  const decorated = richest.filter((player) => player.badges === badges);
  return {
    winners: decorated.map((player) => player.actorId),
    reason: decorated.length === 1 ? 'badges' : 'co_winners',
  };
}
