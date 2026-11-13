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
  // UID-bound lifetime, measured in the owner's turns (§4.4).
  tiredExpiresOwnTurnNo: count.optional(),
  abilityReady: z.boolean(),
  // Historical instances omit this; newly granted Rescue Starters explicitly forbid trading.
  tradeable: z.boolean().optional(),
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
/** Authored descriptions only; executable Ability primitives are a later slice. */
export const abilityDefinitionSchema = z.strictObject({
  name: id,
  text: id,
  timing: z.enum([
    'OWN_STRATEGY',
    'CHALLENGE_DECLARE',
    'BEFORE_OWN_ROLL',
    'AFTER_OWN_ROLL',
    'REACTION',
  ]),
});
export const evolutionStageSchema = z
  .strictObject({ forms: z.array(id).min(1), choice: z.literal('player').optional() })
  .refine((stage) => stage.forms.length > 1 === (stage.choice === 'player'), {
    message:
      'a stage with several forms needs choice: "player", and a single form must not have it',
  });
export const evolutionsSchema = z.strictObject({
  forms: z.array(z.strictObject({ id, name: id })),
  lines: z.array(z.strictObject({ speciesId: id, stages: z.array(evolutionStageSchema).min(1) })),
});

export const contentSchema = z.strictObject({
  board: boardSchema,
  // Optional for historical contract fixtures; real authored content always supplies this.
  evolutions: evolutionsSchema.optional(),
  species: z.array(
    z.strictObject({
      id,
      name: id,
      rarity: z.enum(['common', 'uncommon', 'rare']),
      dc: count,
      battle: count,
      base: count,
      tags: z.array(id),
      ability: abilityDefinitionSchema.optional(),
    }),
  ),
  classes: z.array(
    z.strictObject({
      id,
      name: id,
      starterSpeciesIds: z.array(id).min(1),
      classItemId: id,
      // Names an engine-owned passive; its numbers and timing live in engine/classes.ts.
      passive: z
        .enum([
          'lap_first_sale_bonus',
          'lap_first_catch_bonus',
          'water_catch_bonus',
          'bug_catch_sale_bonus',
          'turn_start_team_heal',
          'combat_bonus',
        ])
        .optional(),
    }),
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
        actorId: id.refine(
          (value) => value !== 'engine',
          'engine is reserved for generated actions',
        ),
        seatIndex: count,
        classId: id,
        starterSpeciesId: id.optional(),
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
export const logHeaderSchema = z
  .strictObject({
    initialConfig: gameConfigSchema,
    seed: gameConfigSchema.shape.seed,
    engineVersion: id,
    contentVersion: id,
    rngVersion: id,
  })
  .superRefine((header, ctx) => {
    for (const field of ['seed', 'engineVersion', 'contentVersion', 'rngVersion'] as const) {
      if (header[field] !== header.initialConfig[field]) {
        ctx.addIssue({ code: 'custom', path: [field], message: 'Must match initialConfig' });
      }
    }
  });
const privateResultSchema = z.strictObject({ kind: z.literal('peek'), eventId: id });
export const playerSchema = z.strictObject({
  actorId: id,
  seatIndex: count,
  classId: id,
  coins: count,
  routeProgress: z.int(),
  creditedLap: count,
  // Optional only for historical contract snapshots; new games always initialize it.
  highestRewardedMilestone: count.optional(),
  ownTurnNo: count,
  // Slowing effects waiting for this player's next actual move (§4.6); absent when none.
  pendingSlows: z.array(z.enum(['repel'])).optional(),
  team: z.array(pokemonInstanceSchema),
  balls: ballPouchSchema,
  items: z.array(itemInstanceSchema).max(4),
  badges: count,
  abilityUsedGlobalTurnNo: count.nullable(),
  // `creditedLap` whose first-catch class bonus a real catch roll has used; absent until then.
  catchBonusUsedLap: count.optional(),
  privateResults: z.array(privateResultSchema),
});
const shopOfferSchema = z.discriminatedUnion('kind', [
  z.strictObject({ id, itemId: id, kind: z.literal('ball'), ballType, price: count }),
  z.strictObject({ id, itemId: id, kind: z.literal('utility'), price: count }),
]);
export const phaseSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('move'), awaitingResult: z.boolean().optional() }),
  z.strictObject({
    kind: z.literal('first_player_roll'),
    contenders: z.array(count).min(1),
    rolls: z.array(z.strictObject({ seatIndex: count, value: z.int().min(1).max(6) })),
    awaitingResult: z.boolean(),
  }),
  z.strictObject({
    kind: z.enum([
      'start',
      'social',
      'strategy',
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
  z.strictObject({
    kind: z.literal('encounter'),
    // Historical fixtures used an instance; live draws have only a species until caught.
    pokemon: z.union([pokemonInstanceSchema, z.strictObject({ speciesId: id })]),
    catchRoll: z
      .strictObject({
        ballType,
        catchDC: count,
        classBonus: z.int(),
        ballBonus: z.int(),
        abilityBonus: z.int(),
        itemBonus: z.int(),
      })
      .optional(),
  }),
  z.strictObject({ kind: z.literal('sell'), destinationPosition: z.int().min(0).max(23) }),
  z.strictObject({ kind: z.literal('shop'), offers: z.array(shopOfferSchema) }),
]);
const finalTableRoundSchema = z
  .strictObject({ triggerSeatIndex: count, targetOwnTurnNo: count })
  .nullable();
/** Internal reward context supplied by the battle/Gym caller after a win. */
export const rewardSourceSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('pvp'), loserId: id, coinLossBlocked: z.boolean() }),
  z.strictObject({ kind: z.literal('gym') }),
]);
export const rewardRequestSchema = z.strictObject({
  rewardId: id,
  winnerId: id,
  source: rewardSourceSchema,
});
export const rewardChoiceSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('coins') }),
  z.strictObject({ kind: z.literal('evolve'), instanceId: id, nextFormId: id }),
]);
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
  // Active-turn item effects, cleared when the next turn starts; absent when none.
  turnEffects: z.strictObject({ itemBonus: z.int() }).optional(),
  rng: z.strictObject({ cursor: count, state: id }),
  eventDeck: z.strictObject({ drawPile: z.array(id), discardPile: z.array(id) }),
  // Durable idempotency receipts; absent before the first resolved reward.
  resolvedRewardIds: z.array(id).optional(),
});

// Player commands and engine-generated records share one sequence in the log.
const actionBodySchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.enum([
      'roll',
      'skip',
      'release',
      'finish_sell',
      'skip_shop',
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
  z.object({
    kind: z.literal('use_item'),
    payload: z.strictObject({
      itemInstanceId: id,
      targetSeatIndex: count.optional(),
      targetPokemonInstanceId: id.optional(),
      status: z.literal('tired').optional(),
    }),
  }),
  z.object({
    kind: z.literal('sell'),
    payload: z.strictObject({ pokemonInstanceIds: z.array(id) }),
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
  'NO_VALID_TARGET',
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
const lineSelectedEventSchema = z.strictObject({
  kind: z.literal('line_selected'),
  situation: id,
  personalityId: id,
  trustBucket: id,
  lineId: id,
});
export const engineEventSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('pokemon_evolved'),
    ownerId: id,
    instanceId: id,
    fromFormId: id,
    toFormId: id,
    evolutionStage: count,
  }),
  z.strictObject({
    kind: z.literal('battle_reward_resolved'),
    ...rewardRequestSchema.shape,
    choice: rewardChoiceSchema,
    coinAmount: count,
  }),
  z.strictObject({
    kind: z.literal('status_changed'),
    ownerId: id,
    instanceId: id,
    status: z.literal('tired'),
    operation: z.enum(['applied', 'reapplied', 'cleared']),
    expiresOwnTurnNo: count.optional(),
    reason: id,
  }),
  lineSelectedEventSchema,
  z.strictObject({
    kind: z.literal('random_result'),
    purpose: id,
    result: z.union([z.int(), id, z.array(id)]),
    // Issue #3 fixtures predate counted draws; new RNG events always supply this.
    drawCounter: z.int().positive().optional(),
  }),
  z.strictObject({
    kind: z.literal('coin_transfer'),
    source: coinEndpointSchema,
    destination: coinEndpointSchema,
    amount: count,
    reason: id,
    // Current-version Pokémon sales show their parts, e.g. base 8 + class bonus 3.
    sale: z.strictObject({ basePrice: count, classBonus: count }).optional(),
    rewardId: id.optional(),
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
    effect: z.literal('none_yet').optional(),
  }),
  z.strictObject({ kind: z.literal('phase_changed'), from: id, to: id }),
  // Told only to the user and target of a hostile item (§4.1, §4.4).
  z.strictObject({
    kind: z.literal('hostile_item_used'),
    userSeatIndex: count,
    targetSeatIndex: count,
    itemId: id,
  }),
  z.strictObject({
    kind: z.literal('final_table_round'),
    triggerSeatIndex: count,
    targetOwnTurnNo: count,
  }),
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
export const actionRecordSchema = z.strictObject({
  action: actionSchema,
  events: z.array(engineEventSchema),
  auto: z.literal(true).optional(),
});
export const gameLogSchema = z
  .strictObject({
    ...logHeaderSchema.shape,
    logVersion: z.literal('command-log-v1'),
    initialState: gameStateSchema,
    actions: z.array(actionRecordSchema),
    // Presentation draws use a separate RNG and never alter command replay.
    dialogueEvents: z
      .array(engineEventSchema)
      .refine(
        (events) =>
          events.every(
            (event) =>
              event.kind === 'line_selected' ||
              (event.kind === 'random_result' && event.purpose.startsWith('line:')),
          ),
        'Dialogue events must be line selections or line random results',
      )
      .optional(),
  })
  .superRefine((log, ctx) => {
    for (const field of ['seed', 'engineVersion', 'contentVersion', 'rngVersion'] as const) {
      if (log[field] !== log.initialConfig[field]) {
        ctx.addIssue({ code: 'custom', path: [field], message: 'Must match initialConfig' });
      }
    }
  });

export type GameConfig = z.infer<typeof gameConfigSchema>;
export type LogHeader = z.infer<typeof logHeaderSchema>;
export type GameState = z.infer<typeof gameStateSchema>;
export type Player = z.infer<typeof playerSchema>;
export type Phase = z.infer<typeof phaseSchema>;
export type PokemonInstance = z.infer<typeof pokemonInstanceSchema>;
export type RewardRequest = z.infer<typeof rewardRequestSchema>;
export type RewardChoice = z.infer<typeof rewardChoiceSchema>;
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
export type ActionRecord = z.infer<typeof actionRecordSchema>;
export type GameLog = z.infer<typeof gameLogSchema>;
export type ApplyActionResult =
  | { accepted: true; state: GameState; events: EngineEvent[]; record: ActionRecord }
  | {
      rejected: true;
      state: GameState;
      reason:
        | 'stale_revision'
        | 'wrong_actor'
        | 'malformed_action'
        | 'illegal_action'
        | 'invalid_sequence';
    };
