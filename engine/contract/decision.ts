import { z } from 'zod';
import { legalActionSchema, observationSchema } from './schema.ts';

// The AI decision endpoint's wire contract (spec §5.2, §6 item 2, §9): types and schemas only,
// so web/ and ai/ share it without importing each other.

const id = z.string().min(1);
const count = z.int().nonnegative();

export const decisionPointSchema = z.enum(['strategy', 'encounter', 'sell']);
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
    if (observation.public.phase.kind !== request.decisionPoint) {
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
  'missing_key',
  'not_an_option',
  'decider_error',
  'stub',
]);

const telemetry = {
  source: z.enum(['jev', 'fallback']),
  fallbackReason: decisionFallbackReasonSchema.optional(),
  requestId: id,
  latencyMs: count,
};

/** Only IDs and telemetry: never Jev's response body or any part of the key (spec §9). */
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
  );

/** `GET /api/ai/status`, for the "Backup bot mode" badge (spec §9 kill switch). */
export const aiStatusSchema = z.strictObject({
  jevEnabled: z.boolean(),
  backupOnly: z.boolean(),
  reason: z.enum(['disabled', 'missing_key']).nullable(),
});

export type DecisionPoint = z.infer<typeof decisionPointSchema>;
export type Difficulty = z.infer<typeof difficultySchema>;
export type DecisionFacts = z.infer<typeof decisionFactsSchema>;
export type DecisionRequest = z.infer<typeof decisionRequestSchema>;
export type DecisionFallbackReason = z.infer<typeof decisionFallbackReasonSchema>;
export type DecisionResponse = z.infer<typeof decisionResponseSchema>;
export type AiStatus = z.infer<typeof aiStatusSchema>;
