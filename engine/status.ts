import type {
  EngineEvent,
  Player,
  PokemonInstance,
  pokemonStatusSchema,
} from './contract/schema.ts';
import type { z } from 'zod';

export type PokemonStatus = z.infer<typeof pokemonStatusSchema>;

export function pokemonStatuses(pokemon: PokemonInstance): PokemonStatus[] {
  const statuses: PokemonStatus[] = [];
  if (pokemon.tired) statuses.push('tired');
  if (pokemon.combatDebuffed) statuses.push('combat_debuff');
  return statuses;
}

export function applyStatus(
  owner: Player,
  instanceId: string,
  status: PokemonStatus,
  reason: string,
): EngineEvent[] {
  const pokemon = owner.team.find((entry) => entry.instanceId === instanceId);
  if (!pokemon) return [];
  if (status === 'combat_debuff') {
    if (pokemon.combatDebuffed) return [];
    pokemon.combatDebuffed = true;
    return [
      {
        kind: 'status_changed',
        ownerId: owner.actorId,
        instanceId,
        status,
        operation: 'applied',
        reason,
      },
    ];
  }
  const operation = pokemon.tired ? 'reapplied' : 'applied';
  pokemon.tired = true;
  pokemon.tiredExpiresOwnTurnNo = Math.max(pokemon.tiredExpiresOwnTurnNo ?? 0, owner.ownTurnNo + 1);
  return [
    {
      kind: 'status_changed',
      ownerId: owner.actorId,
      instanceId,
      status,
      operation,
      expiresOwnTurnNo: pokemon.tiredExpiresOwnTurnNo,
      reason,
    },
  ];
}

/** Clear exactly the selected status on one owned UID; absent targets are unchanged. */
export function healStatus(
  owner: Player,
  instanceId: string,
  status: PokemonStatus,
  reason: string,
): EngineEvent[] {
  const pokemon = owner.team.find((entry) => entry.instanceId === instanceId);
  if (!pokemon || !pokemonStatuses(pokemon).includes(status)) return [];
  if (status === 'combat_debuff') delete pokemon.combatDebuffed;
  else {
    pokemon.tired = false;
    delete pokemon.tiredExpiresOwnTurnNo;
  }
  return [
    {
      kind: 'status_changed',
      ownerId: owner.actorId,
      instanceId,
      status,
      operation: 'cleared',
      reason,
    },
  ];
}

export function expireStatuses(owner: Player): EngineEvent[] {
  return owner.team.flatMap((pokemon) =>
    pokemon.tiredExpiresOwnTurnNo !== undefined && pokemon.tiredExpiresOwnTurnNo <= owner.ownTurnNo
      ? healStatus(owner, pokemon.instanceId, 'tired', 'expired')
      : [],
  );
}

export function battleReadyMembers(player: Pick<Player, 'team'>): PokemonInstance[] {
  return player.team.filter((pokemon) => !pokemon.tired);
}
