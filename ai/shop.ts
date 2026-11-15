import { z } from 'zod';
import { decisionRequestSchema } from '../engine/contract/decision.ts';
import { createPolicyRng } from '../sim/policy.ts';
import type { DeciderAnswer } from './decider.ts';
import { FallbackPolicy, PERSONALITIES } from './fallback/index.ts';
import type { DecisionEvent } from './jev/decision-log.ts';

/** Additive C2 path: Shop has no Jev question (§5.2, §5.3); its decision is logged as non-Jev (§6 item 8). */
export const shopRequestSchema = z
  .strictObject({
    ...decisionRequestSchema.shape,
    decisionPoint: z.literal('shop'),
    personalityId: z.enum(['greedy']),
  })
  .superRefine((request, ctx) => {
    const { observation } = request;
    if (
      observation.own.seatIndex !== request.seatIndex ||
      observation.public.activeSeatIndex !== request.seatIndex
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['seatIndex'],
        message: 'Must match the deciding seat',
      });
    }
    if (observation.public.stateRevision !== request.stateRevision) {
      ctx.addIssue({
        code: 'custom',
        path: ['stateRevision'],
        message: 'Must match the observation',
      });
    }
    if (observation.public.phase.kind !== 'shop') {
      ctx.addIssue({
        code: 'custom',
        path: ['decisionPoint'],
        message: 'Must match the observed phase',
      });
    }
    const ids = request.enabledActions.map((choice) => choice.id);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: 'custom', path: ['enabledActions'], message: 'IDs must be unique' });
    }
  });

export function decideShop(request: z.infer<typeof shopRequestSchema>): DeciderAnswer {
  const choice = new FallbackPolicy(PERSONALITIES[request.personalityId]).decide(
    request.observation,
    { enabled: request.enabledActions, disabled: [] },
    createPolicyRng(`${request.gameId}:${request.turnKey}:${request.stateRevision}`),
  );
  // Shop's policy returns an enabled ID, never a Sell batch.
  if (typeof choice !== 'string') throw new Error('Shop policy returned a Sell batch');
  // `auto`: no Jev question exists for the Shop (§5.3), so this is not a fallback. The one event
  // puts the decision in the decision log with the other non-Jev decisions (§6 item 8).
  const event: DecisionEvent = {
    requestId: null,
    model: null,
    questionId: 'shop',
    choice,
    probabilities: null,
    confidence: null,
    sampled: null,
    fallbackReason: 'auto',
  };
  return { choice, source: 'fallback', fallbackReason: 'auto', events: [event] };
}
