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
  chatReplyRequestSchema,
  chatReplySchema,
  type ChatReply,
} from '../engine/contract/chat-reply.ts';
import { speakRequestSchema } from '../engine/contract/speech.ts';
import {
  fallbackAnswer,
  policyAnswer,
  isOption,
  jevStatus,
  createOrchestratorDecider,
  type Decider,
  type DeciderAnswer,
} from './decider.ts';
import { ChatLedger, createChatReplier, incomingMessage, type ChatReplier } from './chat-reply.ts';
import type { JevClient } from './jev/client.ts';
import { DecisionJournal } from './jev/decision-journal.ts';
import { fileDecisionLog, type DecisionLog } from './jev/decision-log.ts';
import { defaultUsageLedger, type UsageRecorder } from './jev/spend.ts';
import { createHaikuClient } from './haiku/client.ts';
import { speechStatus } from './haiku/status.ts';
import { presentationHeaders } from './presentation.ts';
import { decideShop, shopRequestSchema } from './shop.ts';
import { sameOriginJson } from './speech/guard.ts';
import { createSpeaker, InvalidSpeakRequest, type SpeakerOptions } from './speech/speak.ts';

/** Spec §6 item 2: the endpoint validates payload size before it reads the body. */
export const MAX_BODY_BYTES = 32 * 1024;
/** The speech route's request limit; an observation and a few IDs are far smaller. */
export const MAX_SPEAK_BODY_BYTES = 16 * 1024;

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
  /** The chat route's replier; defaults to the Jev-backed one over `jevClient` and `usage`. */
  chatReplier?: ChatReplier;
  /** The speech route's Haiku client (the real one by default), environment and deadline; fakes in tests. */
  speech?: Partial<SpeakerOptions>;
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
  speech,
  chatReplier = createChatReplier({ usage, ...(jevClient && { client: jevClient }) }),
  decider = createOrchestratorDecider({
    usage,
    ...(jevClient && { client: jevClient }),
  }),
}: AppOptions = {}) => {
  const app = new Hono();
  const journal = new DecisionJournal(decisionLog);
  const chats = new ChatLedger();
  const speaker = createSpeaker({
    client: createHaikuClient({ usage, ...(speech?.env && { env: speech.env }) }),
    usage,
    ...speech,
  });

  // Never a stack trace or an error message: either could carry request or key material.
  app.onError((_error, c) => c.json({ error: 'internal_error' }, 500));

  app.get('/api/ai/status', (c) =>
    c.json(aiStatusSchema.parse({ ...jevStatus(usage), speech: speechStatus(usage) })),
  );

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

  // A topic chat's reply (spec §4.8, §5.3): one line ID from the bank, as a record only the sender
  // and the recipient may read. Nothing about a chat is journaled or logged, and a refused message
  // is removed from every later decision request below.
  app.post(
    '/api/ai/chat',
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
      const parsed = chatReplyRequestSchema.safeParse(body);
      if (!parsed.success) {
        const paths = parsed.error.issues.map((issue) => issue.path.join('.'));
        return c.json({ error: 'invalid_request', paths }, 400);
      }
      const request = parsed.data;
      const message = incomingMessage(request.observation)!;
      const answer = await chats.reply(request.gameId, message, () =>
        chatReplier(request, { status: jevStatus(usage) }),
      );
      const reply: ChatReply = chatReplySchema.parse({
        ...answer,
        visibleToSeats: [answer.fromSeatIndex, answer.toSeatIndex],
        requestId: crypto.randomUUID(),
        latencyMs: Math.round(performance.now() - started),
      });
      return c.json(reply);
    },
  );

  // The first route that returns text, and the only paid one: it returns one screened line and
  // nothing else, and every failure past a valid request is still a 200 (the game never waits).
  app.post(
    '/api/ai/speak',
    sameOriginJson,
    bodyLimit({
      maxSize: MAX_SPEAK_BODY_BYTES,
      onError: (c) => c.json({ error: 'payload_too_large' }, 400),
    }),
    async (c) => {
      let body: unknown;
      try {
        body = await c.req.json();
      } catch {
        return c.json({ error: 'invalid_json' }, 400);
      }
      const parsed = speakRequestSchema.safeParse(body);
      if (!parsed.success) {
        const paths = parsed.error.issues.map((issue) => issue.path.join('.'));
        return c.json({ error: 'invalid_request', paths }, 400);
      }
      try {
        return c.json(await speaker.speak(parsed.data));
      } catch (error) {
        if (error instanceof InvalidSpeakRequest) {
          return c.json({ error: 'invalid_request', paths: [error.path] }, 400);
        }
        throw error;
      }
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
        // A refused chat message never reaches a decision's state (§5.3).
        const request =
          parsed.data.decisionPoint === 'shop'
            ? parsed.data
            : {
                ...parsed.data,
                observation: chats.scrub(parsed.data.gameId, parsed.data.observation),
              };
        if (request.decisionPoint === 'shop') {
          const answer = decideShop(request);
          // Like every other point, logged once the browser reports it applied (never the speculative one).
          if (path === '/api/ai/decide') journal.propose(request, answer, answer.events ?? []);
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
