import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import {
  aiStatusSchema,
  decisionOutcomeSchema,
  decisionRequestSchema,
  decisionResponseSchema,
  type DecisionResponse,
} from '../engine/contract/decision.ts';
import {
  fallbackAnswer,
  policyAnswer,
  isOption,
  jevStatus,
  createOrchestratorDecider,
  type Decider,
  type DeciderAnswer,
} from './decider.ts';
import type { JevClient } from './jev/client.ts';
import { DecisionJournal } from './jev/decision-journal.ts';
import { fileDecisionLog, type DecisionLog } from './jev/decision-log.ts';
import { defaultUsageLedger, type UsageRecorder } from './jev/spend.ts';
import { presentationHeaders } from './presentation.ts';
import { decideShop, shopRequestSchema } from './shop.ts';

/** Spec §6 item 2: the endpoint validates payload size before it reads the body. */
export const MAX_BODY_BYTES = 32 * 1024;

export interface AppOptions {
  /** Defaults to the orchestrator-backed decider over `jevClient` and `usage`. */
  decider?: Decider;
  /** The spend guard and usage log; defaults to the ledger over `logs/jev-usage.jsonl`. */
  usage?: () => UsageRecorder;
  /** Made on first use, only with Jev enabled and a key; defaults to the real SDK client. */
  jevClient?: () => JevClient;
  /**
   * Receives the §6.8 events of each decision once the browser reports what it applied
   * (`POST /api/ai/outcome`); none by default (the server below logs to a file).
   */
  decisionLog?: DecisionLog;
}

/** Copies only IDs and telemetry, so nothing else a decider returns can reach the browser. */
const toResponse = (answer: DeciderAnswer, requestId: string, started: number): DecisionResponse =>
  decisionResponseSchema.parse({
    ...('choice' in answer ? { choice: answer.choice } : { sellUids: answer.sellUids }),
    source: answer.source,
    ...(answer.source === 'fallback' && { fallbackReason: answer.fallbackReason }),
    requestId,
    latencyMs: Math.round(performance.now() - started),
  });

export const createApp = ({
  usage = defaultUsageLedger,
  jevClient,
  decisionLog,
  decider = createOrchestratorDecider({
    usage,
    ...(jevClient && { client: jevClient }),
  }),
}: AppOptions = {}) => {
  const app = new Hono();
  const journal = new DecisionJournal(decisionLog);

  // Never a stack trace or an error message: either could carry request or key material.
  app.onError((_error, c) => c.json({ error: 'internal_error' }, 500));

  app.get('/api/ai/status', (c) => c.json(aiStatusSchema.parse(jevStatus(usage))));

  // The browser reports the outcome it applied: the answer here, or its own fallback at the
  // deadline. Only then is the decision logged (spec §6.8); the speculative fallback never is.
  app.post(
    '/api/ai/outcome',
    bodyLimit({
      maxSize: MAX_BODY_BYTES,
      onError: (c) => c.json({ error: 'payload_too_large' }, 413),
    }),
    async (c) => {
      let body: unknown;
      try {
        body = await c.req.json();
      } catch {
        return c.json({ error: 'invalid_json' }, 400);
      }
      const parsed = decisionOutcomeSchema.safeParse(body);
      if (!parsed.success) {
        return c.json(
          { error: 'invalid_request', paths: parsed.error.issues.map((i) => i.path.join('.')) },
          400,
        );
      }
      journal.applied(parsed.data, parsed.data);
      return c.body(null, 204);
    },
  );

  for (const path of ['/api/ai/decide', '/api/ai/fallback'])
    app.post(
      path,
      bodyLimit({
        maxSize: MAX_BODY_BYTES,
        onError: (c) => c.json({ error: 'payload_too_large' }, 413),
      }),
      async (c) => {
        const started = performance.now();
        let body: unknown;
        try {
          body = await c.req.json();
        } catch {
          return c.json({ error: 'invalid_json' }, 400);
        }
        const parsed = decisionRequestSchema.or(shopRequestSchema).safeParse(body);
        if (!parsed.success) {
          const paths = parsed.error.issues.map((issue) => issue.path.join('.'));
          return c.json({ error: 'invalid_request', paths }, 400);
        }
        const request = parsed.data;
        if (request.decisionPoint === 'shop') {
          const answer = decideShop(request);
          return c.json(
            toResponse(answer, crypto.randomUUID(), started),
            200,
            presentationHeaders(request, answer),
          );
        }
        if (path === '/api/ai/fallback') {
          const answer = policyAnswer(request, jevStatus(usage).reason ?? 'timeout');
          return c.json(
            toResponse(answer, crypto.randomUUID(), started),
            200,
            presentationHeaders(request, answer),
          );
        }
        let answer: DeciderAnswer;
        // Events belong only to an answer the decider itself gave and the engine's options allow.
        let events: DeciderAnswer['events'];
        try {
          answer = await decider(request, { status: jevStatus(usage) });
          events = answer.events;
          if (!isOption(request, answer)) {
            answer = fallbackAnswer(request, 'not_an_option');
            events = undefined;
          }
        } catch {
          answer = fallbackAnswer(request, 'decider_error');
        }
        journal.propose(request, answer, events ?? []);
        return c.json(
          toResponse(answer, crypto.randomUUID(), started),
          200,
          presentationHeaders(request, answer),
        );
      },
    );

  return app;
};

export const app = createApp({ decisionLog: fileDecisionLog() });
