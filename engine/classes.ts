import { effectiveForm } from './forms.ts';
import { healStatus } from './status.ts';
import type {
  EngineEvent,
  GameState,
  Content,
  Player,
  PokemonInstance,
} from './contract/schema.ts';

export type ClassBonusHook =
  | { kind: 'catch'; player: Player; speciesTags: readonly string[] }
  | { kind: 'combat' }
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
  if (hook.kind === 'sale' && hook.pokemon.origin === 'rescue_starter') return 0;
  const passive = content.classes.find((entry) => entry.id === classId)?.passive;
  switch (passive) {
    case 'lap_first_sale_bonus':
      return hook.kind === 'sale' && lapSaleBonusTarget(hook.batch) === hook.pokemon.instanceId
        ? 3
        : 0;
    case 'lap_first_catch_bonus':
      return hook.kind === 'catch' && hook.player.catchBonusUsedLap !== hook.player.creditedLap
        ? 1
        : 0;
    case 'water_catch_bonus':
      return hook.kind === 'catch' && hook.speciesTags.includes('water') ? 2 : 0;
    case 'bug_catch_sale_bonus':
      if (hook.kind === 'catch') return hook.speciesTags.includes('bug') ? 1 : 0;
      return hook.kind === 'sale' &&
        effectiveForm(content, hook.pokemon.speciesId).tags.includes('bug')
        ? 2
        : 0;
    case 'combat_bonus':
      return hook.kind === 'combat' ? 1 : 0;
    case 'turn_start_team_heal':
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

/**
 * A real catch roll uses the Lap's first-catch bonus even when it fails; releasing never does.
 * The next credited Start crossing advances `creditedLap`, which makes the bonus available again.
 */
export function useCatchClassBonus(content: Content, player: Player): void {
  const passive = content.classes.find((entry) => entry.id === player.classId)?.passive;
  if (passive === 'lap_first_catch_bonus') player.catchBonusUsedLap = player.creditedLap;
}

/** Nurse Joy heals the whole team only as its owner's turn starts (§4.2 step 1). */
export function startTurnClassPassive(state: GameState, player: Player): EngineEvent[] {
  if (
    state.content.classes.find((entry) => entry.id === player.classId)?.passive !==
    'turn_start_team_heal'
  )
    return [];
  return player.team.flatMap((pokemon) =>
    healStatus(player, pokemon.instanceId, 'tired', 'nurse_joy'),
  );
}
