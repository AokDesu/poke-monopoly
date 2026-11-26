import { z } from 'zod';
import { gymSnapshotSchema, pvpSnapshotSchema } from './combat.ts';

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
  combatDebuffed: z.literal(true).optional(),
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
/** Engine-owned Ability effects (Appendix C.1/C.2); their operations live in engine/abilities.ts. */
export const abilityEffectIdSchema = z.enum([
  'vine_pull',
  'blaze',
  'quick_slash',
  'shell_guard',
  'adaptability',
  'lucky_splash',
  'scavenge',
  'intimidate',
  'heal_pulse',
  'string_shot',
  'calculate',
  'quick_flight',
  'dragon_rush',
  'challenge',
  'track',
  'thunder_shock',
  'confusion',
  'poison_sting',
  'block',
]);
/** Authored description plus, when the engine implements it, the effect it names. */
export const abilityDefinitionSchema = z.strictObject({
  name: id,
  text: id,
  // Names an engine-owned effect; prose is never parsed into a rule (D1).
  effect: abilityEffectIdSchema.optional(),
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
  // Event card IDs for the deck (§4.6). Optional for historical contract fixtures.
  events: z.array(z.strictObject({ id })).optional(),
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
  // The AI's concession budget for Deal Cards (§4.8). Optional for historical contract fixtures; real
  // authored content always supplies it, and when absent no budget is enforced.
  dealBudget: z.strictObject({ perDeal: count, perGame: count }).optional(),
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
  // Opens the human's Social window to chat messages (§4.2, §4.8); absent or false leaves Social a skip.
  socialWindow: z.boolean().optional(),
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
export const chatTopicSchema = z.enum(['truce', 'trade', 'point_leader', 'use_item', 'hold_item']);
/** `itemId` names a content item, never an instance, so asking cannot reveal a held item (§4.8). */
export const chatPayloadSchema = z.strictObject({
  targetSeatIndex: count,
  topic: chatTopicSchema,
  leaderSeatIndex: count.optional(),
  itemId: id.optional(),
});
export const chatMessageSchema = z.strictObject({
  fromSeatIndex: count,
  toSeatIndex: count,
  topic: chatTopicSchema,
  leaderSeatIndex: count.optional(),
  itemId: id.optional(),
  globalTurnNo: count,
});
/** `no_attack` (§4.8): the promiser will not attack the recipient until `closesOwnTurnNo` ends. */
export const promiseOutcomeSchema = z.enum([
  'broken',
  'kept_with_chance',
  'kept_without_chance',
  'closed_by_game_end',
]);
/** What a pair is told: `kept` hides whether the promiser had a chance to attack (§4.8 Privacy). */
export const promiseClosedOutcomeSchema = z.enum(['kept', 'broken', 'closed_by_game_end']);
export const noAttackPromiseSchema = z.strictObject({
  promiserSeatIndex: count,
  recipientSeatIndex: count,
  createdGlobalTurnNo: count,
  // The promiser's `ownTurnNo` whose end closes it: their `ownTurnNo` at confirmation plus 1.
  closesOwnTurnNo: count,
  // Engine-internal, never sent to a seat: the confirming record's sequence, which counts hidden chats (§6.3).
  acceptedActionSeq: count,
  // Engine-internal and private (§4.8 Privacy): the promiser had a public chance to attack the recipient in
  // the window. Set at most once, only from public facts (Q3, docs/engine-contract.md); absent otherwise.
  chance: z.literal(true).optional(),
  // Set once at End of the closing turn (or at game end); absent while the promise is open.
  settled: z.strictObject({ outcome: promiseOutcomeSchema, globalTurnNo: count }).optional(),
});
/** A promise as a seat sees it: no sequence, no opportunity flag, no kept-with/without-chance split. */
export const seatPromiseSchema = z.strictObject({
  promiserSeatIndex: count,
  recipientSeatIndex: count,
  createdGlobalTurnNo: count,
  closesOwnTurnNo: count,
  closed: z.strictObject({ outcome: promiseClosedOutcomeSchema, globalTurnNo: count }).optional(),
});
/** Directed trust (§4.8): how far `fromSeatIndex` (the recipient of a promise) trusts `toSeatIndex` (its promiser). */
export const trustSchema = z.strictObject({
  fromSeatIndex: count,
  toSeatIndex: count,
  value: z.int().min(-3).max(3),
  // Trust gained from kept promises with a chance, capped at 2 per pair per game.
  keptGain: z.int().min(0).max(2),
});
export const promiseDirectionSchema = z.enum(['offer', 'ask']);
/**
 * One side of a Deal Card (§4.8). The arrays hold at most one asset each; the shape stays open for the
 * Pokémon ↔ Pokémon format that §10 cuts, for which no path is built.
 */
export const dealSideSchema = z.strictObject({
  coins: count,
  pokemonInstanceIds: z.array(id).max(1),
  itemInstanceIds: z.array(id).max(1),
});
/** `give` is what the proposer hands over and `get` what it receives; a counter never swaps the roles. */
export const dealTermsSchema = z.strictObject({ give: dealSideSchema, get: dealSideSchema });
export const proposeDealPayloadSchema = z.strictObject({
  targetSeatIndex: count,
  give: dealSideSchema,
  get: dealSideSchema,
});
/** A counter keeps the asset and its direction and names a new coin amount (§4.8, #164 plan note). */
export const counterDealPayloadSchema = z.strictObject({ coins: z.int().positive() });
export const dealStageSchema = z.enum(['proposed', 'accepted', 'countered']);
/** Named buckets for a pending deal's valuation, never raw numbers (§5.4); the scheme of the Sell facts (§4.7). */
export const dealValueBucketSchema = z.enum(['low', 'medium', 'high']);
export const dealCountBucketSchema = z.enum(['none', 'one', 'few', 'many']);
/**
 * What the AI answering a Deal Card is told about it (§4.8, §5.4): the value it gives and receives, the concession
 * it would make, the budget it has left, its trust in the proposer and the counter that favours it. `budgetLeft` is
 * absent when the content sets no budget.
 */
export const dealTrustBucketSchema = z.enum(['low', 'neutral', 'high']);
export const dealFactsSchema = z.strictObject({
  valueGiven: dealValueBucketSchema,
  valueReceived: dealValueBucketSchema,
  concession: dealCountBucketSchema,
  budgetLeft: dealCountBucketSchema.optional(),
  /** The AI's trust in the proposer: low below 0, neutral at 0, high above 0 (§4.8). Never the number. */
  proposerTrust: dealTrustBucketSchema,
  /**
   * The `id` of the listed `counter_deal` whose price is nearest the current one and in this seat's favour (a
   * higher amount when the proposer pays, a lower one when this seat does); absent when none is listed. No amount.
   */
  favourableCounter: z.string().optional(),
});
// A Deal Card in progress (§4.8), told only to its two parties. `proposed`: the target owes accept, reject
// or counter. `accepted` or `countered`: the proposer owes confirm or cancel. `responderSeatIndex` is whoever
// owes the next command; the item named in the terms is shown here to the pair and nobody else.
const dealPendingSchema = z.strictObject({
  kind: z.literal('deal'),
  stage: dealStageSchema,
  initiatorSeatIndex: count,
  responderSeatIndex: count,
  targetSeatIndex: count,
  terms: dealTermsSchema,
  revealedItem: itemInstanceSchema.optional(),
  counterDepth: z.int().min(0).max(1),
});
/**
 * A question another seat owes an answer to before the game goes on (a pending decision, engine/decisions.ts).
 * `initiatorSeatIndex` is the seat whose turn it is; `responderSeatIndex` owes the next command.
 */
export const pendingResponseSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('promise_offer'),
    initiatorSeatIndex: count,
    responderSeatIndex: count,
    // `offer`: the initiator promises the responder; `ask`: the initiator asks the responder to promise.
    direction: promiseDirectionSchema,
  }),
  dealPendingSchema,
]);
/**
 * A pending question as its seat observes it: the AI answering a deal also gets the engine's buckets for it
 * (`facts`), which the proposer, a third seat and a spectator never do (the budget is the AI's own).
 */
export const observedPendingResponseSchema = z.discriminatedUnion('kind', [
  pendingResponseSchema.options[0],
  dealPendingSchema.extend({ facts: dealFactsSchema.optional() }),
]);
export const respondPayloadSchema = z.strictObject({ answer: z.enum(['accept', 'reject']) });
export const offerPromisePayloadSchema = z.strictObject({
  targetSeatIndex: count,
  direction: promiseDirectionSchema,
});
const privateResultSchema = z.strictObject({ kind: z.literal('peek'), eventId: id });
const eventRewardSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('item'), item: itemInstanceSchema }),
  z.strictObject({ kind: z.literal('ball'), ballType }),
]);
/** Public summary of the last Event; secret item identities never enter this shape (§4.6). */
const eventResolutionSchema = z.strictObject({
  seatIndex: count,
  eventId: id,
  result: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('encounter'), speciesId: id }),
    z.strictObject({ kind: z.literal('tired'), instanceId: id.nullable() }),
    z.strictObject({ kind: z.literal('item') }),
    z.strictObject({
      kind: z.literal('coins'),
      transfers: z.array(z.strictObject({ seatIndex: count, amount: z.int() })),
    }),
  ]),
});
/** One armed shield, independent of the consumed item UID (Appendix C.4 D6/D7). */
export const armedShieldSchema = z.strictObject({
  // `price` blocks a whole hostile item/Ability action or a PvP coin loss; `battle_coin_loss`
  // (Shell Guard) covers PvP or Gym coin loss. `pvp_pickpocket` is Snorlax's Block scope.
  scope: z.enum(['price', 'battle_coin_loss', 'pvp_pickpocket']),
  visibility: z.enum(['public', 'secret']),
});
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
  pendingSlows: z.array(z.enum(['repel', 'string_shot', 'sticky_web', 'thunder_shock'])).optional(),
  confused: z.literal(true).optional(),
  // At most one armed shield from any source (D7); absent when none.
  armedShield: armedShieldSchema.optional(),
  team: z.array(pokemonInstanceSchema),
  balls: ballPouchSchema,
  items: z.array(itemInstanceSchema).max(4),
  badges: count,
  abilityUsedGlobalTurnNo: count.nullable(),
  // `creditedLap` whose first-catch class bonus a real catch roll has used; absent until then.
  catchBonusUsedLap: count.optional(),
  // `creditedLap` whose Rival force (once per Lap) is used; absent until then (§4.4).
  forcePvpUsedLap: count.optional(),
  // Ability roll bonuses lasting until the end of a globalTurnNo (Adaptability, D2).
  rollEffects: z
    .array(z.strictObject({ scope: z.enum(['catch', 'combat']), n: z.int(), globalTurnNo: count }))
    .optional(),
  privateResults: z.array(privateResultSchema),
  // `creditedLap` whose one deal (§4.8, counting both sides) is used; absent until a deal commits.
  dealUsedLap: count.optional(),
  // Concession coins an AI seat has given away in committed Deal Cards (§4.8); charged on commit only, absent until the
  // first charge. Private to the seat: it reaches the AI only as a bucket (`dealFactsSchema`).
  dealConcessionSpent: count.optional(),
  // Accepted records this seat may not see (chats between two other seats, §4.8); absent when none.
  unseenRecords: count.optional(),
});
const shopOfferSchema = z.discriminatedUnion('kind', [
  z.strictObject({ id, itemId: id, kind: z.literal('ball'), ballType, price: count }),
  z.strictObject({ id, itemId: id, kind: z.literal('utility'), price: count }),
]);
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
/** One side's Ability terms for the current battle (§4.4 abilityBonus and debuffs). */
const battleModsSchema = z.strictObject({ abilityBonus: count, debuffs: count });
/** A post-resolution consequence: the source UID becomes Tired (C.1, D13). */
const afterResolutionSchema = z.strictObject({ seatIndex: count, instanceId: id });
const pvpParticipants = {
  battleId: id,
  attackerSeatIndex: count,
  defenderSeatIndex: count,
  // A forced challenge (Rival, Battle Ticket or forcePvP) has no decline; the source stays private.
  forced: z.literal(true).optional(),
  // Confirmed window choices, frozen into the snapshot (D4 steps 5–7).
  modifiers: z.strictObject({ attacker: battleModsSchema, defender: battleModsSchema }).optional(),
  afterResolution: z.array(afterResolutionSchema).optional(),
};
const pvpBattleSchema = z.discriminatedUnion('step', [
  z.strictObject({ ...pvpParticipants, step: z.literal('response') }),
  z.strictObject({ ...pvpParticipants, step: z.literal('attacker_window') }),
  z.strictObject({ ...pvpParticipants, step: z.literal('defender_window') }),
  z.strictObject({
    ...pvpParticipants,
    step: z.literal('attacker_roll'),
    snapshot: pvpSnapshotSchema,
  }),
  z.strictObject({
    ...pvpParticipants,
    step: z.literal('defender_roll'),
    snapshot: pvpSnapshotSchema,
    attackerFace: z.int().min(1).max(6),
  }),
  z.strictObject({
    ...pvpParticipants,
    // D4 step 9: challenger, then defender, may reroll its own die, each seeing both.
    step: z.literal('reroll'),
    snapshot: pvpSnapshotSchema,
    attackerFace: z.int().min(1).max(6),
    defenderFace: z.int().min(1).max(6),
    side: z.enum(['attacker', 'defender']),
    rerolling: z.literal(true).optional(),
  }),
  z.strictObject({
    ...pvpParticipants,
    step: z.literal('reward'),
    snapshot: pvpSnapshotSchema,
    attackerFace: z.int().min(1).max(6),
    defenderFace: z.int().min(1).max(6),
    request: rewardRequestSchema,
  }),
]);
const gymEntry = {
  battleId: id,
  position: z.union([z.literal(6), z.literal(12), z.literal(18)]),
  modifiers: battleModsSchema.optional(),
  afterResolution: z.array(afterResolutionSchema).optional(),
};
const gymBattleSchema = z.discriminatedUnion('step', [
  z.strictObject({ ...gymEntry, step: z.literal('entry') }),
  z.strictObject({ ...gymEntry, step: z.literal('window') }),
  z.strictObject({ ...gymEntry, step: z.literal('roll'), snapshot: gymSnapshotSchema }),
  z.strictObject({
    ...gymEntry,
    step: z.literal('reroll'),
    snapshot: gymSnapshotSchema,
    face: z.int().min(1).max(6),
    rerolling: z.literal(true).optional(),
  }),
  z.strictObject({
    ...gymEntry,
    step: z.literal('reward'),
    snapshot: gymSnapshotSchema,
    face: z.int().min(1).max(6),
    request: rewardRequestSchema,
  }),
]);
/** Canonical directed attack evidence. PvP declarations are public, including declines;
 * hostile item/Ability attempts are told only to their actor and target (§4.1, #37). */
export const attackAttemptSchema = z.strictObject({
  kind: z.literal('attack_attempt'),
  attackId: id,
  actorId: id,
  targetId: id,
  source: z.enum(['pvp_declaration', 'hostile_item', 'hostile_ability']),
  /** The global sequence of the declaring record: engine-internal, never sent to a seat (§6.3). */
  actionSeq: z.int().positive(),
  globalTurnNo: count,
});
/** An attack attempt as a seat sees it: the global `actionSeq` would count hidden chats (§4.8). */
export const seatAttackAttemptSchema = attackAttemptSchema.omit({ actionSeq: true });
export const phaseSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('pvp'), battle: pvpBattleSchema }),
  z.strictObject({ kind: z.literal('gym'), battle: gymBattleSchema }),
  z.strictObject({
    kind: z.literal('move'),
    awaitingResult: z.boolean().optional(),
    // Porygon's A window: the revealed die awaiting reroll or keep, then the pending reroll (D11).
    rolled: z.int().min(1).max(6).optional(),
    rerolling: z.literal(true).optional(),
    confusionReroll: z.literal(true).optional(),
  }),
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
    // Porygon's A window after the catch die (D11): revealed face, then the pending reroll.
    face: z.int().min(1).max(6).optional(),
    rerolling: z.literal(true).optional(),
  }),
  // The engine owes one logged d6 for this activation (Appendix C.1 and C.2).
  z.strictObject({
    kind: z.literal('chance_roll'),
    rollId: id,
    seatIndex: count,
    effect: z.discriminatedUnion('kind', [
      z.strictObject({ kind: z.literal('lucky_splash') }),
      z.strictObject({ kind: z.literal('scavenge') }),
      z.strictObject({
        kind: z.enum(['thunder_shock', 'confusion']),
        targetSeatIndex: count.optional(),
      }),
      z.strictObject({
        kind: z.literal('poison_sting'),
        targetSeatIndex: count.optional(),
        targetPokemonInstanceId: id.optional(),
      }),
    ]),
  }),
  z.strictObject({ kind: z.literal('sell'), destinationPosition: z.int().min(0).max(23) }),
  z.strictObject({ kind: z.literal('shop'), offers: z.array(shopOfferSchema) }),
]);
const finalTableRoundSchema = z
  .strictObject({ triggerSeatIndex: count, targetOwnTurnNo: count })
  .nullable();
export const pokemonStatusSchema = z.enum(['tired', 'combat_debuff']);
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
    // Present only when `config.socialWindow` is on: one interaction per human turn (§4.2).
    socialInteraction: count.optional(),
  }),
  // The unanswered question the game waits on, if any; the responder is then the acting seat.
  pendingResponse: pendingResponseSchema.optional(),
  // Every confirmed `no_attack` promise, oldest first; absent until a first one is accepted.
  promises: z.array(noAttackPromiseSchema).optional(),
  // Directed trust per pair that has settled a promise, clamped to -3..3 (§4.8); absent until the first.
  trust: z.array(trustSchema).optional(),
  // The last 3 chat messages of each pair, `seats` ordered low to high; absent until a first message.
  chats: z
    .array(
      z.strictObject({
        seats: z.tuple([count, count]),
        messages: z.array(chatMessageSchema).max(3),
      }),
    )
    .optional(),
  // Accepted chats, so instance IDs can skip them (§4.8); absent until a first message.
  chatsSent: count.optional(),
  // Accepted promise offers and answers, which no seat outside the pair sees (§4.8); same use.
  promiseRecords: count.optional(),
  // Accepted Deal Card records, which no seat outside the pair sees (§4.8); same use; absent until a first one.
  dealRecords: count.optional(),
  // Passing on a private Pickpocket reaction must not shift public IDs or bystander revisions.
  pickpocketPassRecords: count.optional(),
  pendingPickpocket: z.strictObject({ targetSeatIndex: count, attackId: id }).optional(),
  finalTableRound: finalTableRoundSchema,
  // Active-turn item effects, cleared when the next turn starts; absent when none.
  turnEffects: z
    .strictObject({
      itemBonus: z.int().optional(),
      // Quick Flight's replacement steps for this turn's move (C.1 `replaceRoll`).
      fixedMove: z.int().positive().optional(),
    })
    .optional(),
  rng: z.strictObject({ cursor: count, state: id }),
  eventDeck: z.strictObject({ drawPile: z.array(id), discardPile: z.array(id) }),
  lastEvent: eventResolutionSchema.optional(),
  lastEventReward: eventRewardSchema.optional(),
  // Durable idempotency receipts; absent before the first resolved reward.
  resolvedRewardIds: z.array(id).optional(),
  attackHistory: z.array(attackAttemptSchema).optional(),
});

// Player commands and engine-generated records share one sequence in the log.
const actionBodySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('challenge_gym'), payload: z.strictObject({}) }),
  z.object({
    kind: z.literal('activate_ability'),
    payload: z.strictObject({
      instanceId: id,
      targetSeatIndex: count.optional(),
      targetPokemonInstanceId: id.optional(),
      status: pokemonStatusSchema.optional(),
      scope: z.enum(['catch', 'combat']).optional(),
    }),
  }),
  z.object({
    kind: z.literal('declare_pvp'),
    payload: z.strictObject({ targetSeatIndex: count, force: z.literal('rival').optional() }),
  }),
  z.object({ kind: z.literal('respond_pvp'), payload: z.strictObject({ accept: z.boolean() }) }),
  z.object({ kind: z.literal('choose_reward'), payload: rewardChoiceSchema }),
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
      'promise',
    ]),
    payload: z.strictObject({}),
  }),
  z.object({ kind: z.literal('propose_deal'), payload: proposeDealPayloadSchema }),
  z.object({
    kind: z.literal('respond_deal'),
    payload: z.strictObject({ answer: z.enum(['accept', 'reject']) }),
  }),
  z.object({ kind: z.literal('counter_deal'), payload: counterDealPayloadSchema }),
  z.object({ kind: z.literal('confirm_deal'), payload: z.strictObject({}) }),
  z.object({ kind: z.literal('cancel_deal'), payload: z.strictObject({}) }),
  z.object({ kind: z.literal('chat'), payload: chatPayloadSchema }),
  z.object({ kind: z.literal('offer_promise'), payload: offerPromisePayloadSchema }),
  z.object({ kind: z.literal('respond'), payload: respondPayloadSchema }),
  z.object({ kind: z.literal('catch'), payload: z.strictObject({ ballType }) }),
  z.object({
    kind: z.literal('use_item'),
    payload: z.strictObject({
      itemInstanceId: id,
      targetSeatIndex: count.optional(),
      targetPokemonInstanceId: id.optional(),
      status: pokemonStatusSchema.optional(),
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
  // Ability reasons (§4.5, C.3, D10): the instance's Lap use and the player's per-turn allowance
  // stay distinct, and a window the Ability's timing does not cover is its own reason.
  'ABILITY_USED_THIS_LAP',
  'ABILITY_USED_THIS_GLOBAL_TURN',
  'ABILITY_WRONG_TIMING',
  // Deal Card reasons (§4.8): what the proposer may be told about a proposal the engine does not list. Never the
  // AI's own quota or budget, which the proposer sees as an ordinary refusal.
  'RESCUE_STARTER',
  'LAST_POKEMON',
  'DEAL_USED_THIS_LAP',
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
/**
 * Generated table talk (§5.7): presentation only. It is not an `EngineEvent`, so no action record
 * or fixture accepts it; it lives only in `GameLog.dialogueEvents`.
 */
export const aiSpeechEventSchema = z.strictObject({
  kind: z.literal('ai_speech'),
  speakerSeatIndex: count,
  addressedSeatIndex: count.optional(),
  source: z.enum(['haiku', 'bank']),
  lineId: id.optional(),
  // One short line; 280 is the chat free-text limit (§4.8).
  text: z.string().min(1).max(280),
  globalTurnNo: count,
});
export const engineEventSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('event_deck_shuffled'), cardCount: count }),
  z.strictObject({ kind: z.literal('item_gained'), ownerId: id, item: itemInstanceSchema }),
  z.strictObject({ kind: z.literal('event_drawn'), seatIndex: count, eventId: id }),
  z.strictObject({ kind: z.literal('event_resolved'), ...eventResolutionSchema.shape }),
  attackAttemptSchema,
  z.strictObject({
    kind: z.literal('ability_activated'),
    ownerId: id,
    instanceId: id,
    effect: abilityEffectIdSchema,
    targetId: id.optional(),
  }),
  // Told only to the owner: opponents never see a Ball pouch (§4.1, #37).
  z.strictObject({ kind: z.literal('ball_gained'), ownerId: id, ballType }),
  // Forced displacement (C.1 `displace`): no income, Lap credit, Ability reset, Sell or Resolve.
  z.strictObject({ kind: z.literal('player_displaced'), targetId: id, from: z.int(), to: z.int() }),
  // Qualifying owner Start credit makes every team instance ready again (§4.5, §4.7).
  z.strictObject({ kind: z.literal('abilities_reset'), ownerId: id, instanceIds: z.array(id) }),
  z.strictObject({ kind: z.literal('shield_armed'), ownerId: id, ...armedShieldSchema.shape }),
  z.strictObject({
    kind: z.literal('protection_applied'),
    actorId: id,
    targetId: id,
    actionId: id,
    source: z.enum([
      'hostile_item',
      'hostile_ability',
      'pvp_coin_loss',
      'gym_coin_loss',
      'pickpocket_coin_loss',
    ]),
    protection: z.enum(['price', 'battle_coin_loss', 'pvp_pickpocket', 'nurse_joy']),
  }),
  z.strictObject({ kind: z.literal('block_triggered'), ownerId: id }),
  z.strictObject({ kind: z.literal('gym_confirmed'), battleId: id, snapshot: gymSnapshotSchema }),
  z.strictObject({
    kind: z.literal('gym_resolved'),
    battleId: id,
    face: z.int().min(1).max(6),
    total: z.int(),
    dc: count,
    outcome: z.enum(['win', 'loss']),
    rewardSeatIndex: count.nullable(),
  }),
  z.strictObject({ kind: z.literal('badge_awarded'), battleId: id, ownerId: id }),
  z.strictObject({
    kind: z.literal('pvp_response'),
    battleId: id,
    defenderId: id,
    accepted: z.boolean(),
  }),
  z.strictObject({ kind: z.literal('pvp_confirmed'), battleId: id, snapshot: pvpSnapshotSchema }),
  z.strictObject({
    kind: z.literal('pvp_resolved'),
    battleId: id,
    attackerFace: z.int().min(1).max(6),
    defenderFace: z.int().min(1).max(6),
    attackerTotal: z.int(),
    defenderTotal: z.int(),
    outcome: z.enum(['win', 'tie', 'loss']),
    rewardSeatIndex: count.nullable(),
  }),
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
    status: pokemonStatusSchema,
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
  // Told only to the sender and the recipient (§4.8).
  z.strictObject({
    kind: z.literal('chat_sent'),
    fromSeatIndex: count,
    toSeatIndex: count,
    topic: chatTopicSchema,
    leaderSeatIndex: count.optional(),
    itemId: id.optional(),
  }),
  // Told only to the two seats of the offer (§4.8): the initiator and the responder.
  z.strictObject({
    kind: z.literal('promise_offered'),
    initiatorSeatIndex: count,
    responderSeatIndex: count,
    direction: promiseDirectionSchema,
  }),
  // The two parties' alone: a confirmed `no_attack` promise.
  z.strictObject({
    kind: z.literal('promise_accepted'),
    promiserSeatIndex: count,
    recipientSeatIndex: count,
    closesOwnTurnNo: count,
  }),
  z.strictObject({
    kind: z.literal('promise_rejected'),
    promiserSeatIndex: count,
    recipientSeatIndex: count,
  }),
  // A Deal Card's records are told only to its two parties (§4.8); `revealedItem` is the one item shown to them.
  z.strictObject({
    kind: z.literal('deal_proposed'),
    initiatorSeatIndex: count,
    targetSeatIndex: count,
    terms: dealTermsSchema,
    revealedItem: itemInstanceSchema.optional(),
  }),
  z.strictObject({
    kind: z.literal('deal_accepted'),
    initiatorSeatIndex: count,
    targetSeatIndex: count,
  }),
  z.strictObject({
    kind: z.literal('deal_rejected'),
    initiatorSeatIndex: count,
    targetSeatIndex: count,
  }),
  z.strictObject({
    kind: z.literal('deal_countered'),
    initiatorSeatIndex: count,
    targetSeatIndex: count,
    terms: dealTermsSchema,
  }),
  z.strictObject({
    kind: z.literal('deal_cancelled'),
    initiatorSeatIndex: count,
    targetSeatIndex: count,
  }),
  z.strictObject({
    kind: z.literal('deal_committed'),
    initiatorSeatIndex: count,
    targetSeatIndex: count,
    terms: dealTermsSchema,
    revealedItem: itemInstanceSchema.optional(),
  }),
  // The two parties' alone, at End of the promiser's closing turn or at game end: memory evidence (§4.8).
  z.strictObject({
    kind: z.literal('promise_closed'),
    promiserSeatIndex: count,
    recipientSeatIndex: count,
    outcome: promiseClosedOutcomeSchema,
    globalTurnNo: count,
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
        // Only a public shield is shown to other seats (D6).
        armedShield: armedShieldSchema.optional(),
        badges: count,
        abilityReady: z.boolean(),
      }),
    ),
    globalTurnNo: count,
    stateRevision: count,
    activeSeatIndex: count,
    attackHistory: z.array(seatAttackAttemptSchema).optional(),
    phase: phaseSchema,
    lapTarget: z.int().positive(),
    finalTableRound: finalTableRoundSchema,
    lastEvent: eventResolutionSchema.optional(),
  }),
  own: z.strictObject({
    seatIndex: count,
    items: z.array(itemInstanceSchema),
    armedShield: armedShieldSchema.optional(),
    balls: ballPouchSchema,
    privateResults: z.array(privateResultSchema),
    combatDebuffedPokemonIds: z.array(id).optional(),
    pickpocketReaction: z.literal(true).optional(),
    lastEventReward: eventRewardSchema.optional(),
    // Only messages this seat sent or received; present only when `config.socialWindow` is on.
    chats: z.array(chatMessageSchema).optional(),
    // Only promises this seat made or received, and the question it is part of; Social window only.
    promises: z.array(seatPromiseSchema).optional(),
    // This seat's trust in every other seat, -3..3 (§4.8); Social window only. Never another seat's trust.
    trust: z.array(z.strictObject({ seatIndex: count, value: z.int().min(-3).max(3) })).optional(),
    pendingResponse: observedPendingResponseSchema.optional(),
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
      .array(z.union([engineEventSchema, aiSpeechEventSchema]))
      .refine(
        (events) =>
          events.every(
            (event) =>
              event.kind === 'line_selected' ||
              event.kind === 'ai_speech' ||
              (event.kind === 'random_result' && event.purpose.startsWith('line:')),
          ),
        'Dialogue events must be line selections, line random results or AI speech',
      )
      .optional(),
  })
  .superRefine((log, ctx) => {
    for (const field of ['seed', 'engineVersion', 'contentVersion', 'rngVersion'] as const) {
      if (log[field] !== log.initialConfig[field]) {
        ctx.addIssue({ code: 'custom', path: [field], message: 'Must match initialConfig' });
      }
    }
    const seats = log.initialConfig.seats.map((seat) => seat.seatIndex);
    log.dialogueEvents?.forEach((event, index) => {
      if (event.kind !== 'ai_speech') return;
      const named = [event.speakerSeatIndex, event.addressedSeatIndex ?? event.speakerSeatIndex];
      if (!named.every((seat) => seats.includes(seat)) || named[0] === event.addressedSeatIndex) {
        ctx.addIssue({
          code: 'custom',
          path: ['dialogueEvents', index],
          message: 'Speech must name configured seats and cannot address its own speaker',
        });
      }
    });
  });

export type GameConfig = z.infer<typeof gameConfigSchema>;
export type LogHeader = z.infer<typeof logHeaderSchema>;
export type GameState = z.infer<typeof gameStateSchema>;
export type Player = z.infer<typeof playerSchema>;
export type Phase = z.infer<typeof phaseSchema>;
export type PokemonInstance = z.infer<typeof pokemonInstanceSchema>;
export type ChatTopic = z.infer<typeof chatTopicSchema>;
export type ChatPayload = z.infer<typeof chatPayloadSchema>;
export type ChatMessage = z.infer<typeof chatMessageSchema>;
export type RewardRequest = z.infer<typeof rewardRequestSchema>;
export type RewardChoice = z.infer<typeof rewardChoiceSchema>;
export type NoAttackPromise = z.infer<typeof noAttackPromiseSchema>;
export type SeatPromise = z.infer<typeof seatPromiseSchema>;
export type PromiseOutcome = z.infer<typeof promiseOutcomeSchema>;
export type Trust = z.infer<typeof trustSchema>;
export type PendingResponse = z.infer<typeof pendingResponseSchema>;
export type DealFacts = z.infer<typeof dealFactsSchema>;
export type DealTerms = z.infer<typeof dealTermsSchema>;
export type ProposeDealPayload = z.infer<typeof proposeDealPayloadSchema>;
export type ItemInstance = z.infer<typeof itemInstanceSchema>;
export type BallPouch = z.infer<typeof ballPouchSchema>;
export type Action = z.infer<typeof actionSchema>;
export type EngineEvent = z.infer<typeof engineEventSchema>;
export type AiSpeechEvent = z.infer<typeof aiSpeechEventSchema>;
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

export type AttackAttempt = z.infer<typeof attackAttemptSchema>;
export type SeatAttackAttempt = z.infer<typeof seatAttackAttemptSchema>;
export type AbilityEffectId = z.infer<typeof abilityEffectIdSchema>;
