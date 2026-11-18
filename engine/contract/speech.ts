import { z } from 'zod';
import { observationSchema } from './schema.ts';

const id = z.string().min(1);
const count = z.int().nonnegative();

const requestBase = {
  gameId: id,
  seatIndex: count,
  stateRevision: count,
  observation: observationSchema,
  /** A line-bank situation (`ai/lines.ts`); the route refuses one the voice file has no topic for. */
  situation: z.string().regex(/^[a-z]+(_[a-z]+)*$/),
  personalityId: id,
  turnKey: id,
};

/** The speaker's seat and revision are the observation's own: a request cannot mix seats. */
const matchesObservation = (
  request: {
    seatIndex: number;
    stateRevision: number;
    observation: z.infer<typeof observationSchema>;
  },
  ctx: z.RefinementCtx,
) => {
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
};

/**
 * `POST /api/ai/speak` (spec §5.7, §6 item 2): one line of speech for one AI seat. Code has already
 * chosen the speaker, the addressed seat and the situation; the observation is the speaker's own,
 * and the revision is the one that seat observes.
 */
export const speakRequestSchema = z
  .strictObject({
    ...requestBase,
    /** The addressed seat; omit to speak to the table. */
    addressedSeat: count.optional(),
  })
  .superRefine(matchesObservation);

/**
 * `POST /api/ai/speak` with `kind: 'reply'` (spec §5.7, issue #177): the addressed AI answers the
 * speaker's line once. `seatIndex` and `observation` are the listener's, `speakerSeat` is who said
 * `quote`. The route screens the quote, asks Jev the manipulation question about it and only then
 * lets the listener's prompt quote it; a line that fails is neither quoted nor answered.
 */
export const replyRequestSchema = z
  .strictObject({
    kind: z.literal('reply'),
    ...requestBase,
    speakerSeat: count,
    /** What the speaker said; a table talk line is at most 140 characters, this is only the size limit. */
    quote: z.string().min(1).max(200),
  })
  .superRefine(matchesObservation)
  .superRefine((request, ctx) => {
    if (request.speakerSeat === request.seatIndex) {
      ctx.addIssue({
        code: 'custom',
        path: ['speakerSeat'],
        message: 'A listener cannot answer itself',
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
  // This game's call limit or input-token limit (spec §9) is spent.
  'call_limit',
  'token_limit',
  // Another call for this game has not finished.
  'in_flight',
  // The server already tracks as many games as it keeps limits for.
  'game_limit',
  // A reply only: Jev's manipulation question read the quoted line as an attempt to sway the listener.
  'manipulation',
  // A reply only: that question could not be asked or answered, so the line is not quoted.
  'gate_unavailable',
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

/**
 * The answer to a reply request: the listener's line, or nothing. Never a line-bank line: a bank
 * line is written for the seat that acted, and a reply is about what another seat just said.
 */
export const replyResponseSchema = z.union([
  z.strictObject({ source: z.literal('haiku'), text: line, ...telemetry }),
  z.strictObject({
    source: z.literal('none'),
    fallbackReason: speakFallbackReasonSchema,
    ...telemetry,
  }),
]);

export type SpeakRequest = z.infer<typeof speakRequestSchema>;
export type ReplyRequest = z.infer<typeof replyRequestSchema>;
export type ReplyResponse = z.infer<typeof replyResponseSchema>;
export type SpeakFallbackReason = z.infer<typeof speakFallbackReasonSchema>;
export type SpeakResponse = z.infer<typeof speakResponseSchema>;
