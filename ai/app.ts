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
import {
  chatSpeechRequestSchema,
  replyRequestSchema,
  speakRequestSchema,
} from '../engine/contract/speech.ts';
import { JevAdmission, QuotaBook } from './admission.ts';
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
import { createSdkJevClient, type JevClient } from './jev/client.ts';
import { DecisionJournal } from './jev/decision-journal.ts';
import { fileDecisionLog, type DecisionLog } from './jev/decision-log.ts';
import { defaultUsageLedger, errorClass, type UsageRecorder } from './jev/spend.ts';
import { RequestWindow, SERVER_LIMITS } from './jev/window.ts';
import { createHaikuClient } from './haiku/client.ts';
import { speechStatus } from './haiku/status.ts';
import { presentationHeaders } from './presentation.ts';
import { apiRateLimit, securityHeaders } from './security.ts';
import { decideShop, shopRequestSchema } from './shop.ts';
import { createManipulationGate } from './speech/gate.ts';
import { loopbackHost, sameOriginJson } from './speech/guard.ts';
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
  /**
   * The speech route's Haiku client (the real one by default), environment and deadline, and the
   * manipulation gate for replies (over `jevClient` and `usage` by default); fakes in tests.
   */
  speech?: Partial<SpeakerOptions>;
  /**
   * The limits the ID-keyed counts cannot give (spec §9, #64), shared by every route: the games'
   * quotas and the server-wide Jev and Haiku windows. Fresh ones with `SERVER_LIMITS` by default.
   */
  limits?: {
    quotas?: QuotaBook;
    jevWindow?: RequestWindow;
    haikuWindow?: RequestWindow;
    apiWindow?: RequestWindow;
  };
}

/** Copies only IDs and telemetry, so nothing else a decider returns can reach the browser. */
const toResponse = (answer: DeciderAnswer, requestId: string, started: number): DecisionResponse =>
  decisionResponseSchema.parse({
    // Spec §3, §1: private options leave the server only in demo mode, and only from a Jev answer.
    ...(answer.source === 'jev' && answer.detail && demoMode() && { detail: answer.detail }),
    ...('choice' in answer ? { choice: answer.choice } : { sellUids: answer.sellUids }),
    source: answer.source,
    ...(answer.source === 'fallback' && { fallbackReason: answer.fallbackReason }),
    requestId,
    latencyMs: Math.round(performance.now() - started),
  });

/** Spec §3 demo mode: a server switch, read per call; only the exact strings "1" and "true" mean on. */
const demoMode = (): boolean => {
  const value = process.env.DEMO_MODE;
  return value === '1' || value === 'true';
};

export const createApp = ({
  usage = defaultUsageLedger,
  jevClient,
  decisionLog,
  speech,
  limits,
  chatReplier,
  decider,
}: AppOptions = {}) => {
  const quotas = limits?.quotas ?? new QuotaBook();
  const jevWindow = limits?.jevWindow ?? new RequestWindow(SERVER_LIMITS.jevRequestsPerWindow);
  const haikuWindow = limits?.haikuWindow ?? new RequestWindow(SERVER_LIMITS.haikuCallsPerWindow);
  const limited = apiRateLimit(
    limits?.apiWindow ?? new RequestWindow(SERVER_LIMITS.apiRequestsPerWindow),
  );
  const admission = new JevAdmission({ usage, quotas, window: jevWindow });
  chatReplier ??= createChatReplier({
    usage,
    admission,
    ...(jevClient && { client: jevClient }),
  });
  decider ??= createOrchestratorDecider({
    usage,
    quotas,
    window: jevWindow,
    ...(jevClient && { client: jevClient }),
  });
  const app = new Hono();
  app.use('*', securityHeaders);
  const journal = new DecisionJournal(decisionLog);
  const chats = new ChatLedger();
  const speaker = createSpeaker({
    client: createHaikuClient({ usage, ...(speech?.env && { env: speech.env }) }),
    usage,
    // Spec §5.7: an AI line is checked by the same Jev question as the player's chat before another AI quotes it.
    gate: createManipulationGate({ client: jevClient ?? createSdkJevClient, usage, admission }),
    window: haikuWindow,
    ...speech,
  });

  // Never a stack trace or an error message: either could carry request or key material. The
  // class is logged, so a 500 is never silent (spec §9).
  app.onError((error, c) => {
    console.warn(`A request failed unexpectedly (${errorClass(error)}) on ${c.req.path}.`);
    return c.json({ error: 'internal_error' }, 500);
  });

  app.get('/api/ai/status', loopbackHost, limited, (c) =>
    c.json(
      aiStatusSchema.parse({
        ...jevStatus(usage),
        speech: speechStatus(usage),
        demo: demoMode(),
      }),
    ),
  );

  // The browser reports the outcome it applied: the answer here, or its own fallback at the
  // deadline. Only then is the decision logged (spec §6.8); the speculative fallback never is.
  app.post(
    '/api/ai/outcome',
    sameOriginJson,
    limited,
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
    sameOriginJson,
    limited,
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
    limited,
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
      // A reply and a chat reply name their kind; a line for the table or one seat has none.
      const kind =
        typeof body === 'object' && body !== null && 'kind' in body ? body.kind : undefined;
      const parsed =
        kind === 'reply'
          ? replyRequestSchema.safeParse(body)
          : kind === 'chat_reply'
            ? chatSpeechRequestSchema.safeParse(body)
            : speakRequestSchema.safeParse(body);
      if (!parsed.success) {
        const paths = parsed.error.issues.map((issue) => issue.path.join('.'));
        return c.json({ error: 'invalid_request', paths }, 400);
      }
      try {
        const request = parsed.data;
        return c.json(
          !('kind' in request)
            ? await speaker.speak(request)
            : request.kind === 'reply'
              ? await speaker.reply(request)
              : await speaker.chatReply(request),
        );
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
      sameOriginJson,
      limited,
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
        } catch (error) {
          console.warn(
            `A decider failed unexpectedly (${errorClass(error)}); the first option stands.`,
          );
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
