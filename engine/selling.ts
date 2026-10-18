import { classBonus } from './classes.ts';
import type {
  Content,
  EngineEvent,
  GameState,
  Player,
  PokemonInstance,
} from './contract/schema.ts';

/** Starter origin stays attached to the instance when its species/stage changes. */
export function saleBasis(content: Content, pokemon: PokemonInstance): number {
  if (pokemon.origin === 'rescue_starter') return 0;
  if (pokemon.origin === 'original_starter' && pokemon.evolutionStage === 0) return 5;
  return content.species.find((entry) => entry.id === pokemon.speciesId)!.base;
}

/** Price parts for one atomic batch; the class bonus follows the tired adjustment (§4.7 step 2). */
export function salePrices(
  state: GameState,
  player: Player,
  pokemon: PokemonInstance[],
): { basePrice: number; classBonus: number }[] {
  const batch = pokemon.map((entry) => ({
    pokemon: entry,
    basis: saleBasis(state.content, entry),
  }));
  return batch.map(({ pokemon: entry, basis }) => ({
    basePrice: entry.tired ? Math.round(basis * 0.8) : basis,
    classBonus: classBonus(state.content, player.classId, { kind: 'sale', pokemon: entry, batch }),
  }));
}

/** Validate the complete selection before the executor clones or changes anything. */
export function validSale(state: GameState, ids: string[]): boolean {
  if (state.phase.kind !== 'sell' || new Set(ids).size !== ids.length) return false;
  const player = state.players.find((entry) => entry.seatIndex === state.activeSeatIndex)!;
  const pokemon = ids.map((id) => player.team.find((entry) => entry.instanceId === id));
  if (pokemon.some((entry) => !entry)) return false;
  let coins = player.coins;
  return salePrices(state, player, pokemon as PokemonInstance[]).every(
    ({ basePrice, classBonus }) => {
      coins += basePrice + classBonus;
      return Number.isSafeInteger(coins) && coins >= 0;
    },
  );
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
  const sold = ids.map((id) => player.team.find((entry) => entry.instanceId === id)!);
  const prices = salePrices(next, player, sold);
  for (const [index, id] of ids.entries()) {
    const sale = prices[index]!;
    const amount = sale.basePrice + sale.classBonus;
    player.coins += amount;
    events.push(
      {
        kind: 'coin_transfer',
        source: { kind: 'bank' },
        destination: { kind: 'player', actorId: player.actorId },
        amount,
        reason: 'pokemon_sale',
        sale,
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
