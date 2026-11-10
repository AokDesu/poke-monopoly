import type { EngineEvent, Player, PokemonInstance } from './contract/schema.ts';

/** Status seam for effects and later combat debuffs. No battle implicitly applies Tired. */
export type PokemonStatus = 'tired';

export function applyStatus(
  owner: Player,
  instanceId: string,
  status: PokemonStatus,
  reason: string,
): EngineEvent[] {
  const pokemon = owner.team.find((entry) => entry.instanceId === instanceId);
  if (!pokemon) return [];
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
  if (!pokemon?.tired) return [];
  pokemon.tired = false;
  delete pokemon.tiredExpiresOwnTurnNo;
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
