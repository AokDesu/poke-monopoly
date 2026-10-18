import type { Content, PokemonInstance } from './contract/schema.ts';

export type ClassBonusHook =
  | { kind: 'catch' }
  | {
      kind: 'sale';
      pokemon: PokemonInstance;
      batch: { pokemon: PokemonInstance; basis: number }[];
    };

/**
 * Content names each class passive; amounts and timing stay in the engine (§4.7, Appendix A).
 * Sale hooks run only in the Start Sell Phase, so other sale paths must not call them.
 */
export function classBonus(content: Content, classId: string, hook: ClassBonusHook): number {
  const passive = content.classes.find((entry) => entry.id === classId)?.passive;
  switch (passive) {
    case 'lap_first_sale_bonus':
      return hook.kind === 'sale' && lapSaleBonusTarget(hook.batch) === hook.pokemon.instanceId
        ? 3
        : 0;
    case undefined:
      return 0;
  }
}

/**
 * Each Sell Phase follows exactly one credited Lap, so once per phase is once per Lap.
 * Highest sale basis wins, then lowest instance ID, independent of the listed order.
 * Rescue Starters skip every class bonus (§4.5).
 */
function lapSaleBonusTarget(
  batch: { pokemon: PokemonInstance; basis: number }[],
): string | undefined {
  let best: { pokemon: PokemonInstance; basis: number } | undefined;
  for (const entry of batch) {
    if (entry.pokemon.origin === 'rescue_starter') continue;
    if (
      !best ||
      entry.basis > best.basis ||
      (entry.basis === best.basis && entry.pokemon.instanceId < best.pokemon.instanceId)
    ) {
      best = entry;
    }
  }
  return best?.pokemon.instanceId;
}
