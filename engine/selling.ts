import type { Content, EngineEvent, GameState, PokemonInstance } from './contract/schema.ts';

/** Starter origin stays attached to the instance when its species/stage changes. */
export function saleBasis(content: Content, pokemon: PokemonInstance): number {
  if (pokemon.origin === 'rescue_starter') return 0;
  if (pokemon.origin === 'original_starter' && pokemon.evolutionStage === 0) return 5;
  return content.species.find((entry) => entry.id === pokemon.speciesId)!.base;
}

/** Class passives are deferred; bonuses belong after the tired adjustment. */
export function classSaleBonus(): number {
  return 0;
}

export function salePrice(content: Content, pokemon: PokemonInstance): number {
  if (pokemon.origin === 'rescue_starter') return 0;
  const basis = saleBasis(content, pokemon);
  return (pokemon.tired ? Math.round(basis * 0.8) : basis) + classSaleBonus();
}

/** Validate the complete selection before the executor clones or changes anything. */
export function validSale(state: GameState, ids: string[]): boolean {
  if (state.phase.kind !== 'sell' || new Set(ids).size !== ids.length) return false;
  const player = state.players.find((entry) => entry.seatIndex === state.activeSeatIndex)!;
  let coins = player.coins;
  return ids.every((id) => {
    const pokemon = player.team.find((entry) => entry.instanceId === id);
    if (!pokemon) return false;
    coins += salePrice(state.content, pokemon);
    return Number.isSafeInteger(coins) && coins >= 0;
  });
}

/** Operates only on the executor's detached next snapshot. */
export function recordSale(next: GameState, ids: string[]): EngineEvent[] {
  const player = next.players.find((entry) => entry.seatIndex === next.activeSeatIndex)!;
  const occupied = new Set(
    next.players.flatMap((entry) =>
      [...entry.team, ...entry.items].map((instance) => instance.instanceId),
    ),
  );
  const events: EngineEvent[] = [];
  for (const id of ids) {
    const pokemon = player.team.find((entry) => entry.instanceId === id)!;
    const amount = salePrice(next.content, pokemon);
    player.coins += amount;
    events.push(
      {
        kind: 'coin_transfer',
        source: { kind: 'bank' },
        destination: { kind: 'player', actorId: player.actorId },
        amount,
        reason: 'pokemon_sale',
      },
      { kind: 'uid_destroyed', instanceId: id, entity: 'pokemon', reason: 'sold' },
    );
  }
  player.team = player.team.filter((pokemon) => !ids.includes(pokemon.instanceId));
  if (player.team.length === 0) {
    const seat = next.config.seats.find((entry) => entry.seatIndex === player.seatIndex)!;
    const definition = next.content.classes.find((entry) => entry.id === player.classId)!;
    const prefix = `rescue:${player.seatIndex}:${next.stateRevision}`;
    let instanceId = prefix;
    for (let suffix = 1; occupied.has(instanceId); suffix++) instanceId = `${prefix}:${suffix}`;
    player.team.push({
      instanceId,
      speciesId: seat.starterSpeciesId ?? definition.starterSpeciesIds[0]!,
      origin: 'rescue_starter',
      evolutionStage: 0,
      tired: false,
      abilityReady: true,
      tradeable: false,
    });
    events.push({ kind: 'uid_created', instanceId, entity: 'pokemon', ownerId: player.actorId });
  }
  next.phase = { kind: 'resolve' };
  events.push({ kind: 'phase_changed', from: 'sell', to: 'resolve' });
  return events;
}
