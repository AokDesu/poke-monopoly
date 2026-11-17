import { toEngineContent } from '../../content/schema.ts';
import type { SpeakRequest } from '../../engine/contract/speech.ts';
import { createGame, createGameConfig, observe } from '../../engine/index.ts';
import { PINNED_HAIKU_MODEL, type HaikuClient, type HaikuResult } from '../haiku/client.ts';
import { costUsd, SPEND_CONFIG } from '../jev/spend.ts';
import type { Situation } from '../lines.ts';
import { CONTENT } from '../questions/content.ts';
import { createSpeaker, type SpeakerOptions } from './speak.ts';

const content = toEngineContent(CONTENT);

/** Three fixed briefs: a line to the table, one to another seat, and one about a sale. */
export const SMOKE_BRIEFS: readonly { situation: Situation; addressedSeat?: number }[] = [
  { situation: 'game_start' },
  { situation: 'catch_success', addressedSeat: 1 },
  { situation: 'sold_pokemon' },
];

const smokeObservation = () => {
  const seats = ['main-character', 'rival', 'nurse-joy'].map((classId, seatIndex) => ({
    actorId: `player-${seatIndex}`,
    seatIndex,
    classId,
    starterSpeciesId: content.classes.find((entry) => entry.id === classId)!.starterSpeciesIds[0]!,
    controller: 'ai' as const,
  }));
  const state = createGame(
    createGameConfig({ seats, seed: 'speech-smoke', lapTarget: 3 }),
    content,
  );
  return observe(state, 0);
};

export interface SmokeCall {
  situation: Situation;
  source: 'haiku' | 'bank' | 'none';
  /** The line as the route returned it: Haiku's, or the bank template. */
  text: string | null;
  fallbackReason: string | null;
  /** Reported by the provider, or the configured estimate for a timeout; `null` if nothing went out. */
  inputTokens: number | null;
  outputTokens: number | null;
  thb: number | null;
  latencyMs: number;
}

export interface SmokeSummary {
  calls: number;
  /** Calls that went out to Haiku (the rest never left this machine). */
  sent: number;
  haikuLines: number;
  latencyP50Ms: number | null;
  latencyP95Ms: number | null;
  inputTokensPerCall: number | null;
  thbPerCall: number | null;
}

/** Nearest-rank percentile of a list; `null` for none. */
export const percentile = (values: readonly number[], p: number): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)]!;
};

export const summarize = (calls: readonly SmokeCall[]): SmokeSummary => {
  const sent = calls.filter((call) => call.inputTokens !== null);
  const mean = (values: number[]) =>
    values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;
  const latencies = sent.map((call) => call.latencyMs);
  return {
    calls: calls.length,
    sent: sent.length,
    haikuLines: calls.filter((call) => call.source === 'haiku').length,
    latencyP50Ms: percentile(latencies, 50),
    latencyP95Ms: percentile(latencies, 95),
    inputTokensPerCall: mean(sent.map((call) => call.inputTokens!)),
    thbPerCall: mean(sent.map((call) => call.thb!)),
  };
};

/**
 * Spec §9: sends each fixed brief `rounds` times, one after another, through the route's own
 * speaker (brief, deadline, screen, limits), and reports every call. With the real client this
 * spends real credit: only the repository owner runs it (`npm run speech:smoke`).
 */
export async function runSmoke(
  options: Pick<SpeakerOptions, 'client'> & Partial<SpeakerOptions>,
  rounds: number,
  gameId = `smoke-${Date.now()}`,
): Promise<SmokeCall[]> {
  // The client's own answer, awaited after the route's: the route may answer at the deadline first.
  const writes: Promise<HaikuResult>[] = [];
  const client: HaikuClient = {
    write: (request) => {
      const call = options.client.write(request);
      writes.push(call);
      return call;
    },
  };
  const speaker = createSpeaker({ ...options, client });
  const observation = smokeObservation();
  const calls: SmokeCall[] = [];
  for (let round = 0; round < rounds; round++) {
    for (const brief of SMOKE_BRIEFS) {
      const before = writes.length;
      const request: SpeakRequest = {
        gameId,
        seatIndex: 0,
        stateRevision: observation.public.stateRevision,
        observation,
        situation: brief.situation,
        ...(brief.addressedSeat !== undefined && { addressedSeat: brief.addressedSeat }),
        personalityId: 'greedy',
        turnKey: `smoke:${calls.length}`,
      };
      const response = await speaker.speak(request);
      const result = writes.length > before ? await writes.at(-1) : undefined;
      const usage =
        result && (result.ok || result.requestSent !== false) ? result.usage : undefined;
      calls.push({
        situation: brief.situation,
        source: response.source,
        text: response.source === 'none' ? null : response.text,
        fallbackReason: response.source === 'haiku' ? null : response.fallbackReason,
        inputTokens: usage?.inputTokens ?? null,
        outputTokens: usage?.outputTokens ?? null,
        thb: usage
          ? costUsd({ ...usage, provider: 'haiku', model: PINNED_HAIKU_MODEL }) *
            SPEND_CONFIG.thbPerUsd
          : null,
        latencyMs: response.latencyMs,
      });
    }
  }
  return calls;
}
