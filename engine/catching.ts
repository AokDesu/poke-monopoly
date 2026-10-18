import { classBonus, useCatchClassBonus } from './classes.ts';
import { int, weightedPick } from './rng.ts';
import type { Action, EngineEvent, GameState } from './contract/schema.ts';

// Reserved hook: real Ability effects are deferred beyond this cycle.
function abilityBonus(): number {
  return 0;
}
/** Lucky Egg's +1 lasts until the end of the turn it was used in (Appendix A). */
function itemBonus(state: GameState): number {
  return state.turnEffects?.itemBonus ?? 0;
}

export function confirmCatch(next: GameState, action: Action): EngineEvent[] {
  if (next.phase.kind !== 'encounter') return [];
  if (action.kind === 'release') {
    next.phase = { kind: 'end' };
    return [{ kind: 'phase_changed', from: 'encounter', to: 'end' }];
  }
  if (action.kind !== 'catch') return [];
  const player = next.players.find((entry) => entry.seatIndex === next.activeSeatIndex)!;
  // The encounter's species is fixed before the player confirms their chosen Ball.
  const definition = next.content.species.find(
    (entry) => next.phase.kind === 'encounter' && entry.id === next.phase.pokemon.speciesId,
  )!;
  const ballBonus = { poke: 0, great: 1, ultra: 2 }[action.payload.ballType];
  next.phase.catchRoll = {
    ballType: action.payload.ballType,
    catchDC: definition.dc,
    classBonus: classBonus(next.content, player.classId, { kind: 'catch', player }),
    ballBonus,
    abilityBonus: abilityBonus(),
    itemBonus: itemBonus(next),
  };
  player.balls[action.payload.ballType]--;
  next.turnBudgets.catchAttempt--;
  return [];
}

export function recordCatchRoll(next: GameState, value: number): EngineEvent[] {
  if (next.phase.kind !== 'encounter' || !next.phase.catchRoll) return [];
  const { catchDC, classBonus, ballBonus, abilityBonus, itemBonus } = next.phase.catchRoll;
  const events: EngineEvent[] = [];
  const player = next.players.find((entry) => entry.seatIndex === next.activeSeatIndex)!;
  useCatchClassBonus(next.content, player);
  if (value + classBonus + ballBonus + abilityBonus + itemBonus >= catchDC) {
    const instanceId = `caught:${next.activeSeatIndex}:${next.stateRevision}`;
    player.team.push({
      instanceId,
      speciesId: next.phase.pokemon.speciesId,
      origin: 'caught',
      evolutionStage: 0,
      tired: false,
      abilityReady: true,
    });
    events.push({ kind: 'uid_created', instanceId, entity: 'pokemon', ownerId: player.actorId });
  }
  next.phase = { kind: 'end' };
  return [...events, { kind: 'phase_changed', from: 'encounter', to: 'end' }];
}

export const WILD_EXCLUDED_SPECIES_IDS = ['bulbasaur', 'charmander', 'squirtle', 'porygon'];
export const WILD_RARITIES = ['common', 'uncommon', 'rare'] as const;

/** Species only: an encounter is not an owned asset and has no instance UID. */
export function drawEncounter(next: GameState): EngineEvent[] {
  const pool = next.content.species.filter(
    (species) => !WILD_EXCLUDED_SPECIES_IDS.includes(species.id),
  );
  const rarity = weightedPick(
    next.rng,
    [
      { value: 'common', weight: 50 },
      { value: 'uncommon', weight: 33 },
      { value: 'rare', weight: 17 },
    ],
    'encounter:rarity',
  );
  const species = pool.filter((entry) => entry.rarity === rarity.value);
  const pick = int(rarity.rng, species.length, 'encounter:species');
  next.rng = pick.rng;
  next.phase = { kind: 'encounter', pokemon: { speciesId: species[pick.value]!.id } };
  return [...rarity.events, ...pick.events];
}
