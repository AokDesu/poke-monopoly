import { toEngineContent } from '../../content/schema.ts';
import {
  speakResponseSchema,
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
import { LINES, type Situation } from '../lines.ts';
import { CONTENT } from '../questions/content.ts';
import {
  buildSpeechBrief,
  resolveSpeech,
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
  /** One line per rejected reply: the reason and a running count, never the text. */
  log?: (message: string) => void;
}

export interface Speaker {
  /** Throws `InvalidSpeakRequest` for a request that does not fit the game; otherwise always answers. */
  speak(request: SpeakRequest): Promise<SpeakResponse>;
  /** Output-screen rejections so far, by reason. */
  rejections(): Partial<Record<SpeechRejection, number>>;
}

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
  log = (message) => console.info(message),
}: SpeakerOptions): Speaker => {
  const quotas = new Map<string, SpeechQuota>();
  const rejected: Partial<Record<SpeechRejection, number>> = {};

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

  return {
    rejections: () => ({ ...rejected }),
    async speak(request) {
      const started = performance.now();
      const requestId = crypto.randomUUID();
      const { gameId, seatIndex, observation, situation, addressedSeat, turnKey } = request;

      if (!Object.hasOwn(PERSONALITIES, request.personalityId)) {
        throw new InvalidSpeakRequest('personalityId');
      }
      const personality = PERSONALITIES[request.personalityId as keyof typeof PERSONALITIES];
      if (!isSituation(situation)) throw new InvalidSpeakRequest('situation');
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
        if (spoken.rejection) {
          const count = (rejected[spoken.rejection] = (rejected[spoken.rejection] ?? 0) + 1);
          log(`Speech line rejected: ${spoken.rejection} (${count} so far).`);
        }
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
        const status = speechStatus(usage, env);
        if (!status.enabled) return fromBank(status.reason!);
        const limit = limitReason(gameId);
        if (limit) return fromBank(limit);
        const quota = quotas.get(gameId)!;

        const haikuRequest: HaikuRequest = {
          gameId,
          turnKey,
          system: SPEECH_INSTRUCTION,
          prompt: JSON.stringify(brief),
        };
        quota.inFlight = true;
        // Counted when it settles, even after the deadline: a late answer's tokens were spent.
        const call: Promise<HaikuResult> = (async () => client.write(haikuRequest))()
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
        const { promise: expired, resolve: expire } = Promise.withResolvers<'expired'>();
        const timer = setTimeout(() => expire('expired'), deadlineMs);
        const outcome = await Promise.race([call, expired]).finally(() => clearTimeout(timer));

        if (outcome === 'expired') return fromBank('timeout');
        if (!outcome.ok) return fromBank(outcome.fallbackReason);
        return answer(resolve(outcome.text), undefined);
      } catch {
        return fromBank('internal_error');
      }
    },
  };
};
