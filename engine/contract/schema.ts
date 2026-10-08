import { z } from 'zod';

const id = z.string().min(1);
const count = z.int().nonnegative();
const ballType = z.enum(['poke', 'great', 'ultra']);
export const ballPouchSchema = z.strictObject({ poke: count, great: count, ultra: count });
export const pokemonInstanceSchema = z.strictObject({
  instanceId: id,
  speciesId: id,
  origin: z.enum(['original_starter', 'rescue_starter', 'caught']),
  evolutionStage: count,
  tired: z.boolean(),
  abilityReady: z.boolean(),
});
export const itemInstanceSchema = z.strictObject({
  instanceId: id,
  itemId: id,
  name: id,
  visibility: z.enum(['public', 'secret']),
});
const boardSpaceSchema = z.strictObject({
  position: z.int().min(0).max(23),
  kind: z.enum(['start', 'wild', 'event', 'shop', 'gym']),
  name: id,
});
const boardSchema = z.array(boardSpaceSchema).length(24);
export const contentSchema = z.strictObject({
  board: boardSchema,
  species: z.array(
    z.strictObject({
      id,
      name: id,
      rarity: z.enum(['common', 'uncommon', 'rare']),
      dc: count,
      battle: count,
      base: count,
      tags: z.array(id),
    }),
  ),
  classes: z.array(
    z.strictObject({ id, name: id, starterSpeciesIds: z.array(id).min(1), classItemId: id }),
  ),
  items: z.array(
    z.discriminatedUnion('kind', [
      z.strictObject({ id, name: id, kind: z.literal('ball'), price: count, ballType }),
      z.strictObject({ id, name: id, kind: z.literal('utility'), price: count }),
    ]),
  ),
});
export const gameConfigSchema = z.strictObject({
  seats: z
    .array(
      z.strictObject({
        actorId: id,
        seatIndex: count,
        classId: id,
        controller: z.enum(['human', 'ai']),
      }),
    )
    .min(2)
    .max(4),
  seed: z.union([z.int(), id]),
  lapTarget: z.int().positive(),
  engineVersion: id,
  contentVersion: id,
  rngVersion: id,
});
const privateResultSchema = z.strictObject({ kind: z.literal('peek'), eventId: id });
export const playerSchema = z.strictObject({
  actorId: id,
  seatIndex: count,
  classId: id,
  coins: count,
  routeProgress: z.int(),
  creditedLap: count,
  ownTurnNo: count,
  team: z.array(pokemonInstanceSchema),
  balls: ballPouchSchema,
  items: z.array(itemInstanceSchema).max(4),
  badges: count,
  abilityUsedGlobalTurnNo: count.nullable(),
  privateResults: z.array(privateResultSchema),
});
const shopOfferSchema = z.discriminatedUnion('kind', [
  z.strictObject({ id, itemId: id, kind: z.literal('ball'), ballType, price: count }),
  z.strictObject({ id, itemId: id, kind: z.literal('utility'), price: count }),
]);
export const phaseSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.enum([
      'start',
      'social',
      'strategy',
      'move',
      'resolve',
      'end',
      'finished',
      'combat',
      'gym',
      'ability',
      'deal',
      'promise',
      'chat',
    ]),
  }),
  z.strictObject({ kind: z.literal('encounter'), pokemon: pokemonInstanceSchema }),
  z.strictObject({ kind: z.literal('sell'), destinationPosition: z.int().min(0).max(23) }),
  z.strictObject({ kind: z.literal('shop'), offers: z.array(shopOfferSchema) }),
]);
const finalTableRoundSchema = z
  .strictObject({ triggerSeatIndex: count, targetOwnTurnNo: count })
  .nullable();
export const gameStateSchema = z.strictObject({
  config: gameConfigSchema,
  content: contentSchema,
  stateRevision: count,
  globalTurnNo: count,
  activeSeatIndex: count,
  players: z.array(playerSchema).min(2).max(4),
  phase: phaseSchema,
  turnBudgets: z.strictObject({
    tacticalAction: count,
    catchAttempt: count,
    pokemonAbility: count,
  }),
  finalTableRound: finalTableRoundSchema,
  rng: z.strictObject({ cursor: count, state: id }),
  eventDeck: z.strictObject({ drawPile: z.array(id), discardPile: z.array(id) }),
});

// Player commands and engine-generated records share one sequence in the log.
const actionBodySchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.enum([
      'roll',
      'skip',
      'release',
      'finish_sell',
      'combat',
      'gym',
      'ability',
      'deal',
      'promise',
      'chat',
    ]),
    payload: z.strictObject({}),
  }),
  z.object({ kind: z.literal('catch'), payload: z.strictObject({ ballType }) }),
  z.object({ kind: z.literal('use_item'), payload: z.strictObject({ itemInstanceId: id }) }),
  z.object({
    kind: z.literal('sell'),
    payload: z.strictObject({ pokemonInstanceIds: z.array(id).min(1) }),
  }),
  z.object({ kind: z.literal('buy'), payload: z.strictObject({ offerId: id }) }),
  z.object({
    kind: z.literal('dice_result'),
    payload: z.strictObject({ purpose: id, value: z.int().min(1).max(6) }),
  }),
  z.object({
    kind: z.literal('shuffle'),
    payload: z.strictObject({ deckId: id, order: z.array(id) }),
  }),
  z.object({ kind: z.literal('event_draw'), payload: z.strictObject({ eventId: id }) }),
]);
export const actionSchema = z
  .object({
    actorId: id,
    actionSeq: z.int().positive(),
    stateRevisionBefore: count,
  })
  .and(actionBodySchema);
export const legalActionSchema = z.object({ id }).and(actionBodySchema);
export const reasonCodeSchema = z.enum([
  'NO_BALL',
  'NOT_ENOUGH_COINS',
  'ITEMS_FULL',
  'NOT_YOUR_TURN',
  'ALREADY_USED_THIS_TURN',
]);
export const disabledActionSchema = legalActionSchema.and(
  z.object({ reasonCode: reasonCodeSchema, reasonText: id }),
);
export const legalActionsSchema = z.strictObject({
  enabled: z.array(legalActionSchema),
  disabled: z.array(disabledActionSchema),
});
const coinEndpointSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('bank') }),
  z.strictObject({ kind: z.literal('player'), actorId: id }),
]);
export const engineEventSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('random_result'),
    purpose: id,
    result: z.union([z.int(), id, z.array(id)]),
  }),
  z.strictObject({
    kind: z.literal('coin_transfer'),
    source: coinEndpointSchema,
    destination: coinEndpointSchema,
    amount: count,
    reason: id,
  }),
  z.strictObject({
    kind: z.literal('uid_created'),
    instanceId: id,
    entity: z.enum(['pokemon', 'item']),
    ownerId: id,
  }),
  z.strictObject({
    kind: z.literal('uid_destroyed'),
    instanceId: id,
    entity: z.enum(['pokemon', 'item']),
    reason: id,
  }),
  z.strictObject({
    kind: z.literal('space_resolved'),
    seatIndex: count,
    position: z.int().min(0).max(23),
  }),
  z.strictObject({ kind: z.literal('phase_changed'), from: id, to: id }),
]);
export const observationSchema = z.strictObject({
  public: z.strictObject({
    board: boardSchema,
    players: z.array(
      z.strictObject({
        actorId: id,
        seatIndex: count,
        classId: id,
        coins: count,
        position: z.int().min(0).max(23),
        creditedLap: count,
        ownTurnNo: count,
        team: z.array(pokemonInstanceSchema),
        itemCount: count,
        knownItems: z.array(itemInstanceSchema.extend({ visibility: z.literal('public') })),
        badges: count,
        abilityReady: z.boolean(),
      }),
    ),
    globalTurnNo: count,
    stateRevision: count,
    activeSeatIndex: count,
    phase: phaseSchema,
    lapTarget: z.int().positive(),
    finalTableRound: finalTableRoundSchema,
  }),
  own: z.strictObject({
    seatIndex: count,
    items: z.array(itemInstanceSchema),
    balls: ballPouchSchema,
    privateResults: z.array(privateResultSchema),
  }),
});
export const fixtureSchema = z.strictObject({
  name: id,
  state: gameStateSchema,
  legalActions: z.record(z.string(), legalActionsSchema),
  observation: z.record(z.string(), observationSchema),
  log: z.array(z.strictObject({ action: actionSchema, events: z.array(engineEventSchema) })),
});

export type GameConfig = z.infer<typeof gameConfigSchema>;
export type GameState = z.infer<typeof gameStateSchema>;
export type Player = z.infer<typeof playerSchema>;
export type Phase = z.infer<typeof phaseSchema>;
export type PokemonInstance = z.infer<typeof pokemonInstanceSchema>;
export type ItemInstance = z.infer<typeof itemInstanceSchema>;
export type BallPouch = z.infer<typeof ballPouchSchema>;
export type Action = z.infer<typeof actionSchema>;
export type EngineEvent = z.infer<typeof engineEventSchema>;
export type Observation = z.infer<typeof observationSchema>;
export type LegalAction = z.infer<typeof legalActionSchema>;
export type DisabledAction = z.infer<typeof disabledActionSchema>;
export type LegalActions = z.infer<typeof legalActionsSchema>;
export type ReasonCode = z.infer<typeof reasonCodeSchema>;
export type Content = z.infer<typeof contentSchema>;
export type Fixture = z.infer<typeof fixtureSchema>;
export type ApplyActionResult =
  | { accepted: true; state: GameState; events: EngineEvent[] }
  | { rejected: true; reason: 'not_implemented' };
