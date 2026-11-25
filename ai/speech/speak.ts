import { toEngineContent } from '../../content/schema.ts';
import {
  replyResponseSchema,
  speakResponseSchema,
  type ChatSpeechRequest,
  type ReplyRequest,
  type ReplyResponse,
  type SpeakFallbackReason,
  type SpeakRequest,
  type SpeakResponse,
} from '../../engine/contract/speech.ts';
import { createRng } from '../../engine/index.ts';
import { PERSONALITIES } from '../fallback/index.ts';
import {
  HAIKU_DEADLINE_MS,
  type HaikuClient,
  type HaikuFailure,
  type HaikuRequest,
  type HaikuResult,
} from '../haiku/client.ts';
import { speechStatus } from '../haiku/status.ts';
import { SPEND_CONFIG, type SpendConfig, type UsageRecorder } from '../jev/spend.ts';
import type { RequestWindow } from '../jev/window.ts';
import { LINES, type Situation } from '../lines.ts';
import { CONTENT } from '../questions/content.ts';
import {
  CHAT_DECISION_TEXT,
  CHAT_REPLY_RULES,
  CHAT_TOPIC_TEXT,
  chatSituation,
  contradictsDecision,
  echoesAny,
} from './chat.ts';
import type { ManipulationGate } from './gate.ts';
import {
  buildSpeechBrief,
  resolveSpeech,
  screenSpeech,
  SPEECH_INSTRUCTION,
  VOICE,
  type SpeechRejection,
  type SpokenLine,
} from './index.ts';

const content = toEngineContent(CONTENT);

/** How many games keep speech limits at once; a game past this is never given a fresh count. */
export const MAX_SPEECH_GAMES = 1_000;

/** The request names something the server cannot speak about; the route answers 400. */
export class InvalidSpeakRequest extends Error {
  constructor(readonly path: string) {
    super(`Invalid speech request: ${path}`);
  }
}

/** A game's lifetime Haiku accounting (spec §9); a few counters, never evicted, so a game cannot reset its own limits. */
class SpeechQuota {
  calls = 0;
  inputTokens = 0;
  inFlight = false;
}

export interface SpeakerOptions {
  client: HaikuClient;
  /** The Haiku cap's ledger; defaults to the shared one inside `speechStatus`. */
  usage?: () => Pick<UsageRecorder, 'budgetExceeded'>;
  /** `ANTHROPIC_API_KEY` and `HAIKU_ENABLED`; defaults to the server's environment. */
  env?: NodeJS.ProcessEnv;
  deadlineMs?: number;
  config?: SpendConfig;
  /**
   * Asks Jev whether a line tries to sway the AI that would quote it (spec §5.3). Without one, no
   * reply is ever written: a line nobody checked is never quoted.
   */
  gate?: ManipulationGate;
  /**
   * The server-wide Haiku window (spec §9, #64): past it a line is `rate_limited` and nothing is
   * sent, whatever game ID the request names. None by default.
   */
  window?: RequestWindow;
  /** One line per rejected reply: the reason and a running count, never the text. */
  log?: (message: string) => void;
}

export interface Speaker {
  /** Throws `InvalidSpeakRequest` for a request that does not fit the game; otherwise always answers. */
  speak(request: SpeakRequest): Promise<SpeakResponse>;
  /**
   * The addressed AI's answer to one line (spec §5.7). The quote is screened, then asked of the
   * manipulation gate, and only then reaches the listener's prompt; every failure is `none`.
   * Throws `InvalidSpeakRequest` like `speak`.
   */
  reply(request: ReplyRequest): Promise<ReplyResponse>;
  /**
   * The rival's own words for a topic message and the decision already made about it (spec §4.8,
   * §5.7). No quote, so no gate: the line is screened like any other and must not contradict the
   * decision. A haiku line or `none`, never a bank line (the browser holds the chat route's own).
   * Throws `InvalidSpeakRequest` like `speak`.
   */
  chatReply(request: ChatSpeechRequest): Promise<ReplyResponse>;
  /** Output-screen rejections so far, by reason. */
  rejections(): Partial<Record<Rejection, number>>;
}

/** The output screen's reasons, and the one chat replies add. */
type Rejection = SpeechRejection | 'contradiction';

const isSituation = (name: string): name is Situation =>
  Object.hasOwn(LINES, name) && Object.hasOwn(VOICE.topics, name);

/**
 * Spec §5.7, §9: one screened line for one AI seat, within one deadline. Haiku's line when it is
 * ready and clean; otherwise a line-bank line, otherwise nothing. The game's calls, input tokens and
 * one-call-in-flight limits are hard stops that never reach the network; the shared Haiku and
 * total caps are checked first. A late answer is never returned but its tokens still count.
 */
export const createSpeaker = ({
  client,
  usage,
  env = process.env,
  deadlineMs = HAIKU_DEADLINE_MS,
  config = SPEND_CONFIG,
  gate,
  window,
  log = (message) => console.info(message),
}: SpeakerOptions): Speaker => {
  const quotas = new Map<string, SpeechQuota>();
  const rejected: Partial<Record<Rejection, number>> = {};

  const limitReason = (gameId: string): SpeakFallbackReason | undefined => {
    let quota = quotas.get(gameId);
    if (!quota) {
      if (quotas.size >= MAX_SPEECH_GAMES) return 'game_limit';
      quotas.set(gameId, (quota = new SpeechQuota()));
    }
    if (quota.inFlight) return 'in_flight';
    if (quota.calls >= config.haikuMaxCallsPerGame) return 'call_limit';
    // The call is counted by what it reports afterwards, so reserve the estimate for it now.
    const reserve = config.estimatedHaikuInputTokensPerRequest;
    if (quota.inputTokens + reserve > config.haikuMaxInputTokensPerGame) return 'token_limit';
    return undefined;
  };

  const noteRejection = (reason: Rejection) => {
    const count = (rejected[reason] = (rejected[reason] ?? 0) + 1);
    log(`Speech line rejected: ${reason} (${count} so far).`);
  };

  type Generated = { ok: true; text: string } | { ok: false; reason: SpeakFallbackReason };

  /**
   * One Haiku call under the kill switches, the game's limits and the deadline: the core of a line
   * and of a reply. `before` runs after the limits and ahead of the call, with the game's one
   * in-flight slot held; a reason it returns stops the call and nothing is sent.
   */
  const generate = async (args: {
    gameId: string;
    turnKey: string;
    prompt: string;
    before?: () => Promise<SpeakFallbackReason | undefined>;
  }): Promise<Generated> => {
    const { gameId, turnKey, prompt, before } = args;
    const status = speechStatus(usage, env);
    if (!status.enabled) return { ok: false, reason: status.reason! };
    const limit = limitReason(gameId);
    if (limit) return { ok: false, reason: limit };
    const quota = quotas.get(gameId)!;

    const haikuRequest: HaikuRequest = { gameId, turnKey, system: SPEECH_INSTRUCTION, prompt };
    quota.inFlight = true;
    let call: Promise<HaikuResult> | undefined;
    try {
      const stop = await before?.();
      if (stop) return { ok: false, reason: stop };
      if (window && !window.take()) return { ok: false, reason: 'rate_limited' };
      // Counted when it settles, even after the deadline: a late answer's tokens were spent.
      call = (async () => client.write(haikuRequest))()
        .catch((): HaikuFailure => ({ ok: false, fallbackReason: 'network' }))
        .then((result) => {
          if (result.ok || result.requestSent !== false) {
            quota.calls += 1;
            quota.inputTokens += result.usage?.inputTokens ?? 0;
          }
          return result;
        })
        .finally(() => {
          quota.inFlight = false;
        });
    } finally {
      // The call frees the slot itself once it settles; a call never made frees it here.
      if (!call) quota.inFlight = false;
    }
    const { promise: expired, resolve: expire } = Promise.withResolvers<'expired'>();
    const timer = setTimeout(() => expire('expired'), deadlineMs);
    const outcome = await Promise.race([call, expired]).finally(() => clearTimeout(timer));

    if (outcome === 'expired') return { ok: false, reason: 'timeout' };
    if (!outcome.ok) return { ok: false, reason: outcome.fallbackReason };
    return { ok: true, text: outcome.text };
  };

  /** The personality and situation a request names, or the 400 for one the server cannot speak about. */
  const resolveSetup = (request: { personalityId: string; situation: string }) => {
    if (!Object.hasOwn(PERSONALITIES, request.personalityId)) {
      throw new InvalidSpeakRequest('personalityId');
    }
    const personality = PERSONALITIES[request.personalityId as keyof typeof PERSONALITIES];
    if (!isSituation(request.situation)) throw new InvalidSpeakRequest('situation');
    return { personality, situation: request.situation };
  };

  return {
    rejections: () => ({ ...rejected }),
    async speak(request) {
      const started = performance.now();
      const requestId = crypto.randomUUID();
      const { gameId, seatIndex, observation, addressedSeat, turnKey } = request;

      const { personality, situation } = resolveSetup(request);
      if (
        addressedSeat !== undefined &&
        (addressedSeat === seatIndex ||
          !observation.public.players.some((player) => player.seatIndex === addressedSeat))
      ) {
        throw new InvalidSpeakRequest('addressedSeat');
      }
      let brief;
      try {
        brief = buildSpeechBrief({
          observation,
          // Events are not sent yet: the brief says nothing about recent play until a caller has them.
          events: [],
          situation,
          addressedSeat,
          personality,
          content,
          voice: VOICE,
        });
      } catch {
        // Never the error text: it names request data.
        throw new InvalidSpeakRequest('observation');
      }

      const answer = (
        spoken: SpokenLine,
        reason: SpeakFallbackReason | undefined,
      ): SpeakResponse => {
        const base = { requestId, latencyMs: Math.round(performance.now() - started) };
        if (spoken.kind === 'haiku')
          return speakResponseSchema.parse({ source: 'haiku', ...base, text: spoken.text });
        if (spoken.rejection) noteRejection(spoken.rejection);
        const fallbackReason = spoken.rejection ?? reason ?? 'internal_error';
        return speakResponseSchema.parse(
          spoken.kind === 'bank'
            ? {
                source: 'bank',
                ...base,
                text: spoken.selection.template,
                lineId: spoken.selection.lineId,
                fallbackReason,
              }
            : { source: 'none', ...base, fallbackReason },
        );
      };
      // The same presentation RNG seed as the decision route's notice, plus the seat that speaks.
      const rng = createRng(
        `${gameId}:${turnKey}:${observation.public.stateRevision}:${seatIndex}:speech`,
      );
      const resolve = (reply: string | null) =>
        resolveSpeech({ reply, brief, content, personalityId: personality.id, rng });
      const fromBank = (reason: SpeakFallbackReason) => answer(resolve(null), reason);

      try {
        const generated = await generate({ gameId, turnKey, prompt: JSON.stringify(brief) });
        if (!generated.ok) return fromBank(generated.reason);
        return answer(resolve(generated.text), undefined);
      } catch {
        return fromBank('internal_error');
      }
    },

    async reply(request) {
      const started = performance.now();
      const { gameId, seatIndex, observation, speakerSeat, turnKey } = request;

      const { personality, situation } = resolveSetup(request);
      if (
        speakerSeat === seatIndex ||
        !observation.public.players.some((player) => player.seatIndex === speakerSeat)
      ) {
        throw new InvalidSpeakRequest('speakerSeat');
      }
      const setup = {
        observation,
        events: [],
        situation,
        addressedSeat: speakerSeat,
        personality,
        content,
        voice: VOICE,
      };
      let screening;
      try {
        screening = buildSpeechBrief(setup);
      } catch {
        throw new InvalidSpeakRequest('observation');
      }

      const none = (fallbackReason: SpeakFallbackReason): ReplyResponse =>
        replyResponseSchema.parse({
          source: 'none',
          requestId: crypto.randomUUID(),
          latencyMs: Math.round(performance.now() - started),
          fallbackReason,
        });

      try {
        // The quote reaches this route from the browser, so it passes the output screen again
        // before anything is spent on it: a line that never could have been shown is not quoted.
        const quote = screenSpeech(request.quote, screening, content);
        if (!quote.ok) {
          noteRejection(quote.reason);
          return none(quote.reason);
        }
        if (!gate) return none('gate_unavailable');
        const brief = buildSpeechBrief({ ...setup, quote: quote.text });
        const generated = await generate({
          gameId,
          turnKey,
          prompt: JSON.stringify(brief),
          before: async () => {
            const verdict = await gate.check({
              gameId,
              turnKey: `${turnKey}:gate`,
              from: brief.reply_to!.name,
              to: brief.speaker.name,
              text: quote.text,
            });
            if (verdict === 'manipulation') {
              log('Exchange line refused by the manipulation gate.');
              return 'manipulation';
            }
            return verdict === 'unavailable' ? 'gate_unavailable' : undefined;
          },
        });
        if (!generated.ok) return none(generated.reason);
        const screened = screenSpeech(generated.text, brief, content);
        if (!screened.ok) {
          noteRejection(screened.reason);
          return none(screened.reason);
        }
        return replyResponseSchema.parse({
          source: 'haiku',
          requestId: crypto.randomUUID(),
          latencyMs: Math.round(performance.now() - started),
          text: screened.text,
        });
      } catch {
        return none('internal_error');
      }
    },

    async chatReply(request) {
      const started = performance.now();
      const { gameId, observation, addressedSeat, topic, decision, turnKey } = request;

      if (!Object.hasOwn(PERSONALITIES, request.personalityId)) {
        throw new InvalidSpeakRequest('personalityId');
      }
      const personality = PERSONALITIES[request.personalityId as keyof typeof PERSONALITIES];
      if (!observation.public.players.some((player) => player.seatIndex === addressedSeat)) {
        throw new InvalidSpeakRequest('addressedSeat');
      }
      let brief;
      try {
        brief = buildSpeechBrief({
          observation,
          events: [],
          situation: chatSituation(decision),
          addressedSeat,
          chat: { topic, decision },
          personality,
          content,
          voice: VOICE,
        });
      } catch {
        throw new InvalidSpeakRequest('observation');
      }

      const none = (fallbackReason: SpeakFallbackReason): ReplyResponse =>
        replyResponseSchema.parse({
          source: 'none',
          requestId: crypto.randomUUID(),
          latencyMs: Math.round(performance.now() - started),
          fallbackReason,
        });

      try {
        const generated = await generate({ gameId, turnKey, prompt: JSON.stringify(brief) });
        if (!generated.ok) return none(generated.reason);
        const screened = screenSpeech(generated.text, brief, content);
        if (!screened.ok) {
          noteRejection(screened.reason);
          return none(screened.reason);
        }
        // The topic and decision text is data the writer was given; a line that repeats it, or says
        // the opposite of the decision, is not shown.
        const given = [CHAT_TOPIC_TEXT[topic], CHAT_DECISION_TEXT[decision], CHAT_REPLY_RULES];
        if (echoesAny(screened.text, given)) {
          noteRejection('echo');
          return none('echo');
        }
        if (contradictsDecision(screened.text, decision)) {
          noteRejection('contradiction');
          return none('contradiction');
        }
        return replyResponseSchema.parse({
          source: 'haiku',
          requestId: crypto.randomUUID(),
          latencyMs: Math.round(performance.now() - started),
          text: screened.text,
        });
      } catch {
        return none('internal_error');
      }
    },
  };
};
