import { createRng, int } from '../../engine/index.ts';
import {
  PINNED_JEV_MODEL,
  type JevAnswer,
  type JevClient,
  type JevRequest,
  type JevResult,
} from './client.ts';

export interface FakeJevClient extends JevClient {
  /** Every request that reached the fake, in order. */
  readonly requests: JevRequest[];
}

/**
 * A `JevClient` for tests that answers from `respond` without the SDK, a key or the network.
 * Like the real client, it returns `timeout` once the decision signal has fired.
 */
export const createFakeJevClient = (
  respond: (request: JevRequest) => JevResult | Promise<JevResult>,
): FakeJevClient => {
  const requests: JevRequest[] = [];
  return {
    requests,
    async ask(request, { decisionSignal }) {
      if (decisionSignal.aborted)
        return { ok: false, fallbackReason: 'timeout', requestSent: false };
      requests.push(request);
      const result = await respond(request);
      return decisionSignal.aborted ? { ok: false, fallbackReason: 'timeout' } : result;
    },
  };
};

/** What the chaos fake answers, one seeded draw per request. */
export const CHAOS_OUTCOMES = Object.freeze([
  'valid',
  'valid',
  'valid',
  'invalid_choice',
  'late',
  'timeout',
  'rate_limited',
  'server_error',
] as const);

/**
 * A seeded `JevClient` for the offline `--policy jev` sim (spec §8): random valid answers, choices
 * that were not offered, answers that land only after the decision deadline, and failures.
 */
export const createChaosJevClient = (seed: number | string): FakeJevClient => {
  let rng = createRng(seed);
  const next = (n: number) => {
    const draw = int(rng, n, 'chaos');
    rng = draw.rng;
    return draw.value;
  };
  const answer = (request: JevRequest, invalid: boolean): JevResult => {
    const answers: Record<string, JevAnswer> = {};
    for (const [name, question] of Object.entries(request.questions)) {
      if (question.type === 'noul') {
        answers[name] = { type: 'noul', noul: next(101) / 100 };
        continue;
      }
      const labels = Object.keys(question.criteria);
      const weights = labels.map(() => 1 + next(100));
      const total = weights.reduce((sum, weight) => sum + weight, 0);
      const probabilities = Object.fromEntries(
        labels.map((label, index) => [label, weights[index]! / total]),
      );
      const peak = Math.max(...Object.values(probabilities));
      const n = labels.length;
      const confidence = n > 1 ? (n * peak - 1) / (n - 1) : 1;
      const top = labels.find((label) => probabilities[label] === peak)!;
      answers[name] =
        question.type === 'choice'
          ? { type: 'choice', choice: invalid ? 'not_an_option' : top, confidence, probabilities }
          : { type: 'score', score: labels.indexOf(top), confidence, probabilities };
    }
    const inputTokens = Math.ceil(JSON.stringify(request).length / 4);
    return {
      ok: true,
      answers,
      requestId: `chaos-${next(2 ** 32)}`,
      model: PINNED_JEV_MODEL,
      latencyMs: 0,
      usage: { inputTokens, outputTokens: 0 },
    };
  };
  const requests: JevRequest[] = [];
  return {
    requests,
    async ask(request, { decisionSignal }) {
      if (decisionSignal.aborted)
        return { ok: false, fallbackReason: 'timeout', requestSent: false };
      requests.push(request);
      const outcome = CHAOS_OUTCOMES[next(CHAOS_OUTCOMES.length)]!;
      switch (outcome) {
        case 'valid':
        case 'invalid_choice':
          return answer(request, outcome === 'invalid_choice');
        case 'late': {
          // Ignores the deadline, like a slow network: the caller must discard this answer.
          const late = answer(request, false);
          await new Promise((resolve) =>
            decisionSignal.addEventListener('abort', resolve, { once: true }),
          );
          return late;
        }
        case 'timeout':
          return { ok: false, fallbackReason: 'timeout' };
        case 'rate_limited':
          return { ok: false, fallbackReason: 'rate_limited', status: 429 };
        case 'server_error':
          return { ok: false, fallbackReason: 'server_error', status: 500 };
      }
    },
  };
};
