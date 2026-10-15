import { classBonus } from './classes.ts';
import { int, weightedPick } from './rng.ts';
import type { Action, EngineEvent, GameState, Player } from './contract/schema.ts';

type BallType = keyof Player['balls'];

type CatchRoll = NonNullable<Extract<GameState['phase'], { kind: 'encounter' }>['catchRoll']>;

// Reserved hooks: real Ability and item effects are deferred beyond this cycle.
function abilityBonus(): number {
  return 0;
}
function itemBonus(): number {
  return 0;
}

/**
 * The modifiers a catch with `ballType` would snapshot for `player` in the current Encounter.
 * Confirmation and the odds API share it, so displayed odds cannot drift from the real roll.
 */
export function catchSnapshot(state: GameState, player: Player, ballType: BallType): CatchRoll {
  if (state.phase.kind !== 'encounter') throw new RangeError('No Pokémon to catch');
  const { speciesId } = state.phase.pokemon;
  // The encounter's species is fixed before the player confirms their chosen Ball.
  const definition = state.content.species.find((entry) => entry.id === speciesId)!;
  return {
    ballType,
    catchDC: definition.dc,
    classBonus: classBonus(state.content, player.classId, { kind: 'catch' }),
    ballBonus: { poke: 0, great: 1, ultra: 2 }[ballType],
    abilityBonus: abilityBonus(),
    itemBonus: itemBonus(),
  };
}

/** The catch resolver: `d6 + bonuses >= catchDC`, so equality succeeds (§4.3). */
export function catchSucceeds(roll: CatchRoll, face: number): boolean {
  const { catchDC, classBonus, ballBonus, abilityBonus, itemBonus } = roll;
  return face + classBonus + ballBonus + abilityBonus + itemBonus >= catchDC;
}

export function confirmCatch(next: GameState, action: Action): EngineEvent[] {
  if (next.phase.kind !== 'encounter') return [];
  if (action.kind === 'release') {
    next.phase = { kind: 'end' };
    return [{ kind: 'phase_changed', from: 'encounter', to: 'end' }];
  }
  if (action.kind !== 'catch') return [];
  const player = next.players.find((entry) => entry.seatIndex === next.activeSeatIndex)!;
  next.phase.catchRoll = catchSnapshot(next, player, action.payload.ballType);
  player.balls[action.payload.ballType]--;
  next.turnBudgets.catchAttempt--;
  return [];
}

export function recordCatchRoll(next: GameState, value: number): EngineEvent[] {
  if (next.phase.kind !== 'encounter' || !next.phase.catchRoll) return [];
  const events: EngineEvent[] = [];
  if (catchSucceeds(next.phase.catchRoll, value)) {
    const player = next.players.find((entry) => entry.seatIndex === next.activeSeatIndex)!;
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

/** Species only: an encounter is not an owned asset and has no instance UID. */
export function drawEncounter(next: GameState): EngineEvent[] {
  const pool = next.content.species.filter(
    (species) => !['bulbasaur', 'charmander', 'squirtle', 'porygon'].includes(species.id),
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
