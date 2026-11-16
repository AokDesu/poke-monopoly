import { z } from 'zod';
import { observationSchema } from './schema.ts';

const id = z.string().min(1);
const count = z.int().nonnegative();

/**
 * `POST /api/ai/speak` (spec §5.7, §6 item 2): one line of speech for one AI seat. Code has already
 * chosen the speaker, the addressed seat and the situation; the observation is the speaker's own,
 * and the revision is the one that seat observes.
 */
export const speakRequestSchema = z
  .strictObject({
    gameId: id,
    seatIndex: count,
    stateRevision: count,
    observation: observationSchema,
    /** A line-bank situation (`ai/lines.ts`); the route refuses one the voice file has no topic for. */
    situation: z.string().regex(/^[a-z]+(_[a-z]+)*$/),
    /** The addressed seat; omit to speak to the table. */
    addressedSeat: count.optional(),
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
  });

/**
 * Why a line did not come from Haiku: the client's reasons, the output screen's rejections and the
 * route's own limits (spec §5.7, §9). Reasons only, never text.
 */
export const speakFallbackReasonSchema = z.enum([
  'disabled',
  'missing_key',
  'budget_exceeded',
  'timeout',
  'network',
  'rate_limited',
  'server_error',
  'auth',
  'refused',
  'unsafe_response',
  'empty',
  'multiline',
  'too_long',
  'digit',
  'number_word',
  'link',
  'markup',
  'characters',
  'item_name',
  'unknown_name',
  'commitment',
  'probe',
  'echo',
  // This game's 60 calls or 80,000 input tokens are spent.
  'call_limit',
  'token_limit',
  // Another call for this game has not finished.
  'in_flight',
  // The server already tracks as many games as it keeps limits for.
  'game_limit',
  'internal_error',
]);

const telemetry = { requestId: id, latencyMs: count };
const line = z.string().min(1).max(200);

/**
 * Exactly one line and nothing else. A `bank` line's `text` is the bank template with its `{slot}`s
 * still in place: the engine's facts fill them (spec §5.7), never this route. `none`: the personality
 * has no bank line for the situation. Every failure is still a 200 with a `bank` or `none` answer.
 */
export const speakResponseSchema = z.union([
  z.strictObject({ source: z.literal('haiku'), text: line, ...telemetry }),
  z.strictObject({
    source: z.literal('bank'),
    text: line,
    lineId: id,
    fallbackReason: speakFallbackReasonSchema,
    ...telemetry,
  }),
  z.strictObject({
    source: z.literal('none'),
    fallbackReason: speakFallbackReasonSchema,
    ...telemetry,
  }),
]);

export type SpeakRequest = z.infer<typeof speakRequestSchema>;
export type SpeakFallbackReason = z.infer<typeof speakFallbackReasonSchema>;
export type SpeakResponse = z.infer<typeof speakResponseSchema>;
