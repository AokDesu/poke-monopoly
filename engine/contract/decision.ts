import { z } from 'zod';
import { dealFactsSchema, legalActionSchema, observationSchema } from './schema.ts';

// The AI decision endpoint's wire contract (spec §5.2, §6 item 2, §9): types and schemas only,
// so web/ and ai/ share it without importing each other.

const id = z.string().min(1);
const count = z.int().nonnegative();

export const decisionPointSchema = z.enum([
  'strategy',
  'encounter',
  'sell',
  // Responder decisions (§4.8, §6 item 2): asked of the engine's pending-decision seat, which is not
  // always the active one. S12–S14 add `pvp_response`, `reaction` and `reward` the same way.
  'promise_response',
  'deal_response',
]);
/** The decision points a pending responder answers, rather than the active seat's own phase. */
export const responderDecisionPointSchema = z.enum(['promise_response', 'deal_response']);
/**
 * The decision point a pending question (`own.pendingResponse.kind`) is answered at. S05 adds the
 * deal kind here; until then no deal question exists to ask.
 */
const responderPointOfPending: Readonly<Record<string, DecisionPoint | undefined>> = {
  promise_offer: 'promise_response',
};
/**
 * An outcome may also name the Shop, which has no Jev question (spec §5.3) but whose decision the
 * log still records, as a non-Jev decision (§6 item 8). A request names it through the Shop's own
 * additive schema.
 */
export const outcomeDecisionPointSchema = z.enum([...decisionPointSchema.options, 'shop']);
export const difficultySchema = z.enum(['easy', 'normal', 'hard']);

// `legalActionSchema` strips unknown top-level keys; the strict outer shape rejects them instead.
const enabledActionSchema = z
  .strictObject({ id, kind: id, payload: z.unknown() })
  .pipe(legalActionSchema);

/** Engine-computed numbers; ai/ turns them into buckets and never computes its own. */
export const decisionFactsSchema = z.strictObject({
  catchOdds: z
    .array(
      z.strictObject({
        ballType: z.enum(['poke', 'great', 'ultra']),
        needed: z.int(),
        successFaces: z.int().min(0).max(6),
        probability: z.number().min(0).max(1),
        percent: z.int().min(0).max(100),
      }),
    )
    .optional(),
  /**
   * The Sell Phase's engine prices, one row per Pokémon on the team (spec §4.7, §5.4): `saleFacts`
   * from the engine, never client arithmetic. ai/ turns them into named buckets for Jev's Sell
   * Nouls and into the fallback policy's sale values; missing or partial rows are not used.
   */
  sell: z
    .array(
      z.strictObject({
        instanceId: id,
        salePrice: count,
        classBonusAlone: count,
        classBonusTogether: count,
        saleValue: count,
        keepValue: count,
      }),
    )
    .max(64)
    .optional(),
  /**
   * The engine's buckets for a pending deal, for the AI answering it (spec §4.8, §5.4): the value it gives and
   * receives, the concession it would make and the budget it has left, as named buckets and never numbers.
   * `dealFacts` from the engine; ai/ passes them on and computes nothing.
   */
  deal: dealFactsSchema.optional(),
});

export const decisionRequestSchema = z
  .strictObject({
    gameId: id,
    seatIndex: count,
    decisionPoint: decisionPointSchema,
    stateRevision: count,
    /** The AI seat's role-scoped observation from `observe()`, never the full game state. */
    observation: observationSchema,
    enabledActions: z.array(enabledActionSchema).min(1),
    facts: decisionFactsSchema,
    difficulty: difficultySchema,
    personalityId: id,
    turnKey: id,
  })
  .superRefine((request, ctx) => {
    const { observation } = request;
    if (observation.own.seatIndex !== request.seatIndex) {
      ctx.addIssue({ code: 'custom', path: ['seatIndex'], message: 'Must match the observation' });
    }
    if (observation.public.stateRevision !== request.stateRevision) {
      ctx.addIssue({
        code: 'custom',
        path: ['stateRevision'],
        message: 'Must match the observation',
      });
    }
    if (responderDecisionPointSchema.safeParse(request.decisionPoint).success) {
      // Only the pending-decision seat may be asked: the responder of the question it is part of.
      const pending = observation.own.pendingResponse;
      if (
        !pending ||
        pending.responderSeatIndex !== request.seatIndex ||
        responderPointOfPending[pending.kind] !== request.decisionPoint
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['decisionPoint'],
          message: 'Must be the pending responder answering its own question',
        });
      }
      if (request.enabledActions.some((action) => action.kind !== 'respond')) {
        ctx.addIssue({
          code: 'custom',
          path: ['enabledActions'],
          message: 'A responder decision offers only respond actions',
        });
      }
    } else if (observation.public.phase.kind !== request.decisionPoint) {
      ctx.addIssue({
        code: 'custom',
        path: ['decisionPoint'],
        message: 'Must match the observed phase',
      });
    }
    const ids = request.enabledActions.map((action) => action.id);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: 'custom', path: ['enabledActions'], message: 'IDs must be unique' });
    }
  });

/** Why the answer came from the fallback policy rather than Jev (spec §3.1, §5.6). */
export const decisionFallbackReasonSchema = z.enum([
  'timeout',
  'rate_limited',
  'server_error',
  'auth',
  'network',
  'schema_mismatch',
  'disabled',
  'budget_exceeded',
  'missing_key',
  'not_an_option',
  'decider_error',
  'stub',
  // The orchestrator's own reasons (spec §5.6, §9), beyond the client's failures above.
  'invalid_choice',
  'revision_mismatch',
  'low_confidence',
  'request_limit',
  'token_budget',
  'missing_facts',
  // No Jev question was asked (one legal action, or a phase with none such as the Shop), so the
  // fallback policy chose. It is not a fallback in the §5.6 metrics.
  'auto',
]);

/**
 * The detail of a Jev decision for the demo's "What Jev chose" panel (spec §11 step 3, issue #220):
 * Jev's probability for each option, its confidence and the question it answered. Option IDs are
 * the request's own action IDs; at the Sell Phase, where Jev answers one yes/no question per
 * Pokémon, they are the Pokémon's instance IDs and each probability is that Pokémon's chance of
 * being sold. The numbers are copied from Jev's answer, never computed. PROPOSED: no server emits
 * this yet; stream B owns the field and may change this shape (issue #65).
 */
export const decisionDetailSchema = z.strictObject({
  questionId: id,
  confidence: z.number().min(0).max(1),
  options: z
    .array(z.strictObject({ id, probability: z.number().min(0).max(1) }))
    .min(1)
    .max(255),
});

const telemetry = {
  source: z.enum(['jev', 'fallback']),
  fallbackReason: decisionFallbackReasonSchema.optional(),
  requestId: id,
  latencyMs: count,
  /** Only a Jev answer from a server in demo mode carries it (spec §1: it shows private options). */
  detail: decisionDetailSchema.optional(),
};

/**
 * Only IDs, telemetry and, in demo mode, the optional `detail` numbers: never Jev's response body
 * or any part of the key (spec §9).
 */
export const decisionResponseSchema = z
  .union([
    z.strictObject({ choice: id, ...telemetry }),
    z.strictObject({ sellUids: z.array(id), ...telemetry }),
  ])
  .refine(
    (response) => (response.source === 'fallback') === (response.fallbackReason !== undefined),
    {
      message: 'A fallback names its reason; a Jev answer has none',
    },
  )
  .refine((response) => response.source === 'jev' || response.detail === undefined, {
    message: 'Only a Jev answer carries a detail',
  });

/**
 * `POST /api/ai/outcome` (spec §6.8): what the browser actually applied for one decision, which is
 * the server's answer only when that arrived in time. IDs only; it names the decision by the
 * request's own identifiers and carries the answer and the reason the browser used.
 */
const outcomeBase = {
  gameId: id,
  seatIndex: count,
  turnKey: id,
  stateRevision: count,
  decisionPoint: outcomeDecisionPointSchema,
  source: z.enum(['jev', 'fallback']),
  fallbackReason: decisionFallbackReasonSchema.optional(),
};
export const decisionOutcomeSchema = z
  .union([
    z.strictObject({ choice: id, ...outcomeBase }),
    z.strictObject({ sellUids: z.array(id), ...outcomeBase }),
  ])
  .refine((outcome) => (outcome.source === 'fallback') === (outcome.fallbackReason !== undefined), {
    message: 'A fallback names its reason; a Jev answer has none',
  });

const statusReason = z.enum(['disabled', 'budget_exceeded', 'missing_key']);

/** The speech writer's state for the "Voice off" badge (spec §9 Haiku kill switch and caps). */
export const speechStatusSchema = z.strictObject({
  enabled: z.boolean(),
  reason: statusReason.nullable(),
});

/**
 * `GET /api/ai/status`, for the "Backup bot mode" and "Voice off" badges (spec §9 kill switches
 * and spend caps).
 */
export const aiStatusSchema = z.strictObject({
  jevEnabled: z.boolean(),
  backupOnly: z.boolean(),
  reason: statusReason.nullable(),
  speech: speechStatusSchema,
});

export type DecisionPoint = z.infer<typeof decisionPointSchema>;
export type Difficulty = z.infer<typeof difficultySchema>;
export type DecisionFacts = z.infer<typeof decisionFactsSchema>;
export type DecisionRequest = z.infer<typeof decisionRequestSchema>;
export type DecisionFallbackReason = z.infer<typeof decisionFallbackReasonSchema>;
export type DecisionResponse = z.infer<typeof decisionResponseSchema>;
export type DecisionDetail = z.infer<typeof decisionDetailSchema>;
export type DecisionOutcome = z.infer<typeof decisionOutcomeSchema>;
export type AiStatus = z.infer<typeof aiStatusSchema>;
/** The Jev half of the status, which the decider needs; the speech half is the Haiku client's. */
export type JevStatus = Omit<AiStatus, 'speech'>;
export type SpeechStatus = z.infer<typeof speechStatusSchema>;
