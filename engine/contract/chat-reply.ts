import { z } from 'zod';
import { chatTopicSchema, observationSchema } from './schema.ts';

// `POST /api/ai/chat` wire contract (spec §4.8, §5.3, §5.7): types and schemas only, so web/ and
// ai/ share it without importing each other.

const id = z.string().min(1);
const count = z.int().nonnegative();

/**
 * One topic message a human sent to an AI seat, answered by that seat. The observation is the
 * recipient's own, so it holds the message only when the recipient is in the chat (§4.8): a seat
 * outside the chat has nothing to ask with. The server replies to the newest message addressed to
 * `seatIndex`; the request names no other seat's data.
 */
export const chatReplyRequestSchema = z
  .strictObject({
    gameId: id,
    /** The recipient: the AI seat that replies. */
    seatIndex: count,
    stateRevision: count,
    observation: observationSchema,
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
    const addressed = (observation.own.chats ?? []).some(
      (message) => message.toSeatIndex === request.seatIndex,
    );
    if (!addressed) {
      ctx.addIssue({
        code: 'custom',
        path: ['observation', 'own', 'chats'],
        message: 'Holds no message addressed to this seat',
      });
    }
  });

/** Why the reply came from the fallback policy rather than Jev (spec §5.6). */
export const chatReplyFallbackReasonSchema = z.enum([
  'timeout',
  'rate_limited',
  'server_error',
  'auth',
  'network',
  'schema_mismatch',
  'disabled',
  'budget_exceeded',
  'missing_key',
  'invalid_choice',
  'low_confidence',
  'decider_error',
]);

/**
 * A reply, as a role-scoped record: only `visibleToSeats` (the sender and the recipient) may read
 * it, so a client keeps it in those seats' feeds alone. It names a line-bank line, never text, and
 * carries no number, item or holding.
 */
export const chatReplySchema = z
  .strictObject({
    fromSeatIndex: count,
    toSeatIndex: count,
    /** The seat that sent the topic and the one that replied, in that order. */
    visibleToSeats: z.tuple([count, count]),
    topic: chatTopicSchema,
    /** `manipulation_refused` when the message was refused; otherwise `chat_reply_<topic>`. */
    situation: z.enum([
      'chat_reply_truce',
      'chat_reply_trade',
      'chat_reply_point_leader',
      'chat_reply_use_item',
      'chat_reply_hold_item',
      'manipulation_refused',
    ]),
    lineId: id,
    refused: z.boolean(),
    source: z.enum(['jev', 'fallback']),
    fallbackReason: chatReplyFallbackReasonSchema.optional(),
    requestId: id,
    latencyMs: count,
  })
  .refine((reply) => (reply.source === 'fallback') === (reply.fallbackReason !== undefined), {
    message: 'A fallback names its reason; a Jev answer has none',
  });

export type ChatReplyRequest = z.infer<typeof chatReplyRequestSchema>;
export type ChatReply = z.infer<typeof chatReplySchema>;
export type ChatReplyFallbackReason = z.infer<typeof chatReplyFallbackReasonSchema>;
