import type { Content, EngineEvent, Player } from './contract/schema.ts';
import { evolvedForm } from './forms.ts';

/** Internal mutation seam, used only on a caller's detached next snapshot (§4.5).
 * Validate the complete step first; every other UID-bound field survives unchanged.
 */
export function evolvePokemon(
  content: Content,
  owner: Player,
  instanceId: string,
  nextFormId: string,
): EngineEvent[] {
  const pokemon = owner.team.find((entry) => entry.instanceId === instanceId);
  if (!pokemon) throw new RangeError('Unknown evolution instance');
  evolvedForm(content, pokemon.speciesId, nextFormId);
  const evolutionStage = pokemon.evolutionStage + 1;
  if (!Number.isSafeInteger(evolutionStage)) throw new RangeError('Unsafe evolution stage');
  const fromFormId = pokemon.speciesId;
  pokemon.speciesId = nextFormId;
  pokemon.evolutionStage = evolutionStage;
  return [
    {
      kind: 'pokemon_evolved',
      ownerId: owner.actorId,
      instanceId,
      fromFormId,
      toFormId: nextFormId,
      evolutionStage,
    },
  ];
}
