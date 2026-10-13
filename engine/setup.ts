import {
  gameConfigSchema,
  contentSchema,
  type GameConfig,
  type Content,
  type GameState,
} from './contract/schema.ts';
import { createRng, RNG_VERSION } from './rng.ts';
import { ENGINE_VERSION } from './versions.ts';

/** Revision-zero snapshot: first-player rolls are subsequent logged commands (§3, §4.1). */
export function createGame(inputConfig: GameConfig, inputContent: Content): GameState {
  const config = gameConfigSchema.parse(inputConfig);
  const content = contentSchema.parse(inputContent);
  if (config.engineVersion !== ENGINE_VERSION || config.rngVersion !== RNG_VERSION) {
    throw new RangeError('Unsupported setup engine or RNG version');
  }
  config.seats.sort((a, b) => a.seatIndex - b.seatIndex);
  if (config.seats.some((seat, index) => seat.seatIndex !== index)) {
    throw new RangeError('Setup requires fixed seats numbered 0 through n-1');
  }
  if (new Set(config.seats.map((seat) => seat.actorId)).size !== config.seats.length) {
    throw new RangeError('Setup requires unique actors');
  }
  if (new Set(config.seats.map((seat) => seat.classId)).size !== config.seats.length) {
    throw new RangeError('Setup requires unique classes');
  }
  const players = config.seats.map((seat) => {
    const definition = content.classes.find((entry) => entry.id === seat.classId);
    if (!definition) throw new RangeError(`Unknown class: ${seat.classId}`);
    if (!seat.starterSpeciesId && definition.starterSpeciesIds.length !== 1) {
      throw new RangeError('Choose a class Starter when content lists alternatives');
    }
    const speciesId = seat.starterSpeciesId ?? definition.starterSpeciesIds[0]!;
    if (!definition.starterSpeciesIds.includes(speciesId)) {
      throw new RangeError('Selected species is not a class Starter');
    }
    const item = content.items.find((entry) => entry.id === definition.classItemId);
    if (!content.species.some((entry) => entry.id === speciesId) || !item) {
      throw new RangeError('Starting kit references missing content');
    }
    const balls = { poke: 5, great: 0, ultra: 0 };
    if (item.kind === 'ball') balls[item.ballType]++;
    return {
      actorId: seat.actorId,
      seatIndex: seat.seatIndex,
      classId: seat.classId,
      coins: 20,
      routeProgress: 0,
      creditedLap: 0,
      ownTurnNo: 0,
      team: [
        {
          instanceId: `starter:${seat.seatIndex}`,
          speciesId,
          origin: 'original_starter' as const,
          evolutionStage: 0,
          tired: false,
          abilityReady: true,
        },
      ],
      balls,
      items:
        item.kind === 'utility'
          ? [
              {
                instanceId: `class-item:${seat.seatIndex}`,
                itemId: item.id,
                name: item.name,
                visibility: 'public' as const,
              },
            ]
          : [],
      badges: 0,
      abilityUsedGlobalTurnNo: null,
      privateResults: [],
    };
  });
  return {
    config,
    content,
    players,
    stateRevision: 0,
    globalTurnNo: 0,
    activeSeatIndex: 0,
    phase: {
      kind: 'first_player_roll',
      contenders: config.seats.map((seat) => seat.seatIndex),
      rolls: [],
      awaitingResult: false,
    },
    turnBudgets: { tacticalAction: 0, catchAttempt: 0, pokemonAbility: 0 },
    finalTableRound: null,
    rng: createRng(config.seed),
    eventDeck: { drawPile: [], discardPile: [] },
  };
}
