import type { Personality } from '../content/personality-schema.ts';
import type { LegalAction, LegalActions, Observation } from '../engine/index.ts';
import type { PolicyChoice, PolicyFacts, PolicyRng } from '../sim/policy.ts';
import { decideWithFallback, FallbackPolicy, saleDesire } from './fallback/index.ts';
import {
  DECISION_DEADLINE_MS,
  jevEnabled,
  type FallbackReason as JevFailureReason,
  type JevAnswer,
  type JevClient,
  type JevRequest,
  type JevSuccess,
} from './jev/client.ts';
import { UsageMeter } from './jev/usage.ts';
import {
  buildEncounterQuestion,
  buildSellQuestions,
  buildStrategyQuestion,
  decideSales,
  REQUESTS_PER_TURN,
  sellAnswers,
  type EncounterFacts,
  type SellFacts,
} from './questions/index.ts';

/** The Choice decision points; a confidence floor applies only to these (spec §5.6). */
export type ChoiceQuestion = 'strategy' | 'encounter';

/**
 * A Choice's confidence floor by option count: `few` up to `fewMax` options, falling in a straight
 * line to `many` at `manyFrom` options and beyond. Jev reports confidence as (n·peak − 1)/(n − 1),
 * so the same peak scores higher with more options and a flat floor would reject most 12-option
 * Strategy answers (§5.6). These are starting values; cycle 4 tunes them on the eval set.
 */
export type FloorCurve = Readonly<{ few: number; fewMax: number; many: number; manyFrom: number }>;

/** Orchestrator limits and AI tuning, not gameplay rules (spec §5.6, §9). */
export const ORCHESTRATOR_CONFIG = Object.freeze({
  /** §9: at most 3 Jev requests per AI turn; later decisions in that turn use the fallback. */
  requestsPerTurn: REQUESTS_PER_TURN,
  /** §9: input tokens per game; once reached, every later decision uses the fallback. */
  inputTokensPerGame: 600_000,
  /** §5.6 default curve: 0.6 up to 4 options, falling to 0.5 at 12 (the Strategy shortlist cap). */
  confidenceFloor: Object.freeze({
    strategy: Object.freeze({ few: 0.6, fewMax: 4, many: 0.5, manyFrom: 12 }),
    encounter: Object.freeze({ few: 0.6, fewMax: 4, many: 0.5, manyFrom: 12 }),
  }) satisfies Readonly<Record<ChoiceQuestion, FloorCurve>>,
});

export type OrchestratorConfig = {
  requestsPerTurn: number;
  inputTokensPerGame: number;
  confidenceFloor: Readonly<Record<ChoiceQuestion, FloorCurve>>;
};

/** The floor a Choice answer's confidence must reach on Normal, by question type and option count. */
export function confidenceFloor(
  question: ChoiceQuestion,
  optionCount: number,
  config: OrchestratorConfig = ORCHESTRATOR_CONFIG,
): number {
  const { few, fewMax, many, manyFrom } = config.confidenceFloor[question];
  if (optionCount <= fewMax) return few;
  if (optionCount >= manyFrom) return many;
  return few + ((many - few) * (optionCount - fewMax)) / (manyFrom - fewMax);
}

/**
 * Why a decision did not apply Jev's own answer (spec §3.1, §5.6, §9), beyond the client's
 * failures: an answer not among the options, a stale revision, low confidence, the per-turn
 * request limit, the per-game token budget, or engine facts the question needs but did not get.
 */
export type OrchestratorFallbackReason =
  | JevFailureReason
  | 'invalid_choice'
  | 'revision_mismatch'
  | 'low_confidence'
  | 'request_limit'
  | 'token_budget'
  | 'missing_facts';

/** Engine numbers a decision point's question or the fallback policy reads (§5.2). */
export interface DecideFacts {
  /** For the fallback policy: catch chances and sale values. */
  policy?: PolicyFacts;
  /** For the Encounter question: the engine's `oddsForAllBalls`. */
  encounter?: EncounterFacts;
  /** For the Sell Phase Nouls: sale prices, class bonuses and keep values. */
  sell?: SellFacts;
}

export type Difficulty = 'easy' | 'normal';

export interface DecideRequest {
  /** One AI turn: up to `requestsPerTurn` Jev requests share it. */
  turnKey: string;
  /** The seat's role-scoped observation; its `stateRevision` is the one the answer must match. */
  observation: Observation;
  legalActions: LegalActions;
  facts: DecideFacts;
  difficulty: Difficulty;
  personality: Personality;
  /** Seeded choice source for Easy sampling and the fallback policy's tie-breaks. */
  rng: PolicyRng;
  /** The game's revision when the answer arrives; defaults to the observed one. */
  currentRevision?: () => number;
}

/**
 * Spec §6.8: one event per question asked, or one for the decision point when no Jev answer was
 * used. `choice` is the engine action ID applied (`"true"`/`"false"` for a Sell Noul, and
 * `sell:<ids>` for a batch), and `probabilities` are keyed the same way. `sampled` is Easy's
 * seeded draw out of 2^32; `null` when the choice was not sampled.
 */
export interface JevDecisionEvent {
  requestId: string | null;
  model: string | null;
  questionId: string;
  choice: string;
  probabilities: Record<string, number> | null;
  confidence: number | null;
  sampled: number | null;
  fallbackReason: OrchestratorFallbackReason | null;
}

/**
 * `jev`: Jev's answer applied. `fallback`: the fallback policy chose, for `fallbackReason`.
 * `auto`: no question to ask (one legal action, or a phase without a Jev question such as the
 * Shop), so the policy chose without counting as a fallback.
 */
export type DecisionSource = 'jev' | 'fallback' | 'auto';

export interface OrchestratorDecision {
  choice: PolicyChoice;
  source: DecisionSource;
  fallbackReason: OrchestratorFallbackReason | null;
  /** Jev requests this decision made. */
  requests: number;
  /** For the caller to append to the game log; replay reads them and never calls Jev. */
  events: JevDecisionEvent[];
}

export interface OrchestratorOptions {
  client: JevClient;
  config?: OrchestratorConfig;
  /** The decision deadline; tests and the offline sim shorten it. Defaults to 1,500 ms (§5.6). */
  decisionMs?: number;
}

const SAMPLE_RANGE = 2 ** 32;

type Answered = { results: JevSuccess[]; requests: number };
type Asked = Answered | { fallbackReason: OrchestratorFallbackReason; requests: number };

/**
 * Spec §5.3, §5.6, §9: turns one AI decision into at most a few bundled Jev requests and applies
 * the answer or the fallback policy. Create one per game: the token budget is per game and the
 * request counter per AI turn. Every unusable answer falls back at once; nothing is retried.
 */
export class Orchestrator {
  readonly usage = new UsageMeter();
  readonly #client: JevClient;
  readonly #config: OrchestratorConfig;
  readonly #decisionMs: number;
  #turn = { key: '', requests: 0 };

  constructor({ client, config = ORCHESTRATOR_CONFIG, decisionMs }: OrchestratorOptions) {
    this.#client = client;
    this.#config = config;
    this.#decisionMs = decisionMs ?? DECISION_DEADLINE_MS;
  }

  async decide(request: DecideRequest): Promise<OrchestratorDecision> {
    if (this.#turn.key !== request.turnKey) this.#turn = { key: request.turnKey, requests: 0 };
    const { phase } = request.observation.public;
    if (phase.kind === 'strategy' || phase.kind === 'encounter') {
      return this.#decideChoice(request, phase.kind);
    }
    if (phase.kind === 'sell') return this.#decideSell(request);
    return policyDecision(request, 'auto', null);
  }

  async #decideChoice(
    request: DecideRequest,
    question: ChoiceQuestion,
  ): Promise<OrchestratorDecision> {
    const { observation, legalActions, personality, facts } = request;
    const enabled = legalActions.enabled;
    let decision;
    if (question === 'strategy') {
      decision = buildStrategyQuestion(observation, enabled, personality);
    } else {
      if (!facts.encounter && enabled.length > 1) {
        return policyDecision(request, 'fallback', this.#blocked() ?? 'missing_facts');
      }
      decision = buildEncounterQuestion(
        observation,
        enabled,
        facts.encounter ?? { odds: [] },
        personality,
      );
    }
    if (decision.kind !== 'ask') return policyDecision(request, 'auto', null);
    const blocked = this.#blocked();
    if (blocked) return policyDecision(request, 'fallback', blocked);
    const asked = await this.#askAll(request, [decision]);
    if (!('results' in asked)) return this.#fellBack(request, asked.fallbackReason, asked);
    const [result] = asked.results;
    const answer = result!.answers[question];
    const labels = Object.keys(decision.options);
    if (answer?.type !== 'choice') return this.#fellBack(request, 'schema_mismatch', asked);
    if (
      !labels.includes(answer.choice) ||
      !Object.keys(answer.probabilities).every((label) => labels.includes(label))
    ) {
      return this.#fellBack(request, 'invalid_choice', asked);
    }
    const probabilities = Object.fromEntries(
      labels.map((label) => [decision.options[label]!, answer.probabilities[label] ?? 0]),
    );
    const ids = labels.map((label) => decision.options[label]!);
    if (!ids.every((id) => enabled.some((action) => action.id === id))) {
      return this.#fellBack(request, 'invalid_choice', asked);
    }
    const event = (choice: string, extra: Partial<JevDecisionEvent>): JevDecisionEvent => ({
      requestId: result!.requestId ?? null,
      model: result!.model,
      questionId: question,
      choice,
      probabilities,
      confidence: answer.confidence,
      sampled: null,
      fallbackReason: null,
      ...extra,
    });
    if (request.difficulty === 'easy') {
      const draw = request.rng.int(SAMPLE_RANGE);
      const choice = sample(ids, probabilities, draw);
      if (choice === undefined) return this.#fellBack(request, 'invalid_choice', asked);
      return jevDecision(choice, asked.requests, [event(choice, { sampled: draw })]);
    }
    // Normal: the highest-probability option; ties keep the engine's order.
    const top = ids.reduce((best, id) => (probabilities[id]! > probabilities[best]! ? id : best));
    const fallback = decideWithFallback({
      personality,
      observation,
      legalActions,
      rng: request.rng,
      facts: facts.policy,
      jev: { choice: top, probabilities, confidence: answer.confidence },
      confidenceFloor: confidenceFloor(question, labels.length, this.#config),
    });
    const choice = fallback.choice as string;
    if (fallback.fallbackReason === null) {
      return jevDecision(choice, asked.requests, [event(choice, {})]);
    }
    return {
      choice,
      source: 'fallback',
      fallbackReason: 'low_confidence',
      requests: asked.requests,
      events: [event(choice, { fallbackReason: 'low_confidence' })],
    };
  }

  async #decideSell(request: DecideRequest): Promise<OrchestratorDecision> {
    const { observation, legalActions, personality, facts } = request;
    const sales = legalActions.enabled.filter((action) => action.kind === 'sell');
    if (sales.length === 0) return policyDecision(request, 'auto', null);
    if (!facts.sell) {
      return policyDecision(request, 'fallback', this.#blocked() ?? 'missing_facts');
    }
    const blocked = this.#blocked();
    if (blocked) return policyDecision(request, 'fallback', blocked);
    const left = this.#config.requestsPerTurn - this.#turn.requests;
    const { requests, fallbackIds } = buildSellQuestions(
      observation,
      facts.sell,
      personality,
      left,
    );
    if (requests.length === 0) return policyDecision(request, 'auto', null);
    const asked = await this.#askAll(request, requests);
    if (!('results' in asked)) return this.#fellBack(request, asked.fallbackReason, asked);
    const answers: Record<string, JevAnswer> = {};
    const events: JevDecisionEvent[] = [];
    for (const [index, sellRequest] of requests.entries()) {
      const result = asked.results[index]!;
      for (const label of Object.keys(sellRequest.questions)) {
        const answer = result.answers[label];
        if (answer?.type !== 'noul') return this.#fellBack(request, 'schema_mismatch', asked);
        const sell = decideSales({ [label]: answer }, personality).length > 0;
        events.push({
          requestId: result.requestId ?? null,
          model: result.model,
          questionId: label,
          choice: String(sell),
          probabilities: { true: answer.noul, false: 1 - answer.noul },
          confidence: null,
          sampled: null,
          fallbackReason: null,
        });
      }
      Object.assign(answers, sellAnswers(sellRequest, result.answers));
    }
    // Pokémon over the request budget follow the fallback policy's sale rule (§5.3).
    const overBudget = fallbackIds.filter(
      (id) => saleDesire(observation, id, facts.policy ?? {}) >= personality.sellThreshold,
    );
    const sellUids = [...decideSales(answers, personality), ...overBudget];
    const choice = sellChoice(legalActions.enabled, sellUids);
    if (choice === undefined) return this.#fellBack(request, 'invalid_choice', asked);
    return jevDecision(choice, asked.requests, events);
  }

  /** A reason no request may go out now: the kill switch, the token budget or the turn limit. */
  #blocked(): OrchestratorFallbackReason | undefined {
    if (!jevEnabled()) return 'disabled';
    if (this.usage.totals().inputTokens >= this.#config.inputTokensPerGame) return 'token_budget';
    if (this.#turn.requests >= this.#config.requestsPerTurn) return 'request_limit';
    return undefined;
  }

  /**
   * Sends each request in turn under one decision deadline. Any unusable result, a late answer or
   * a revision that moved while waiting discards every answer of the decision.
   */
  async #askAll(request: DecideRequest, asks: readonly JevRequest[]): Promise<Asked> {
    const deadline = new AbortController();
    const timer = setTimeout(() => deadline.abort(), this.#decisionMs);
    const expired = new Promise<undefined>((resolve) =>
      deadline.signal.addEventListener('abort', () => resolve(undefined), { once: true }),
    );
    const results: JevSuccess[] = [];
    let requests = 0;
    try {
      for (const { state, questions } of asks) {
        if (this.#turn.requests >= this.#config.requestsPerTurn) {
          return { fallbackReason: 'request_limit', requests };
        }
        this.#turn.requests++;
        requests++;
        const call = this.#client.ask({ state, questions }, { decisionSignal: deadline.signal });
        // A late answer still counts its tokens against the game's budget.
        void call.then((result) => this.usage.record(result));
        // §5.6: return at the deadline even if the client does not, and never apply an answer
        // that lands after it, even a valid one.
        const result = await Promise.race([call, expired]);
        if (result === undefined || deadline.signal.aborted) {
          return { fallbackReason: 'timeout', requests };
        }
        if (!result.ok) return { fallbackReason: result.fallbackReason, requests };
        results.push(result);
      }
    } finally {
      clearTimeout(timer);
    }
    const revision = request.observation.public.stateRevision;
    if ((request.currentRevision?.() ?? revision) !== revision) {
      return { fallbackReason: 'revision_mismatch', requests };
    }
    return { results, requests };
  }

  #fellBack(
    request: DecideRequest,
    reason: OrchestratorFallbackReason,
    asked: Asked,
  ): OrchestratorDecision {
    const decision = policyDecision(request, 'fallback', reason);
    const [first] = 'results' in asked ? asked.results : [];
    decision.events[0] = {
      ...decision.events[0]!,
      requestId: first?.requestId ?? null,
      model: first?.model ?? null,
    };
    return { ...decision, requests: asked.requests };
  }
}

/** Easy: the option whose share of the probability mass holds `draw` out of 2^32. */
function sample(
  ids: readonly string[],
  probabilities: Readonly<Record<string, number>>,
  draw: number,
): string | undefined {
  const total = ids.reduce((sum, id) => sum + probabilities[id]!, 0);
  if (!(total > 0)) return undefined;
  let target = (draw / SAMPLE_RANGE) * total;
  for (const id of ids) {
    if (target < probabilities[id]!) return id;
    target -= probabilities[id]!;
  }
  return ids.findLast((id) => probabilities[id]! > 0);
}

/** The listed action for this sale: `finish_sell` for none, the one-Pokémon sale, or a batch. */
function sellChoice(enabled: readonly LegalAction[], sellUids: string[]): PolicyChoice | undefined {
  if (sellUids.length === 0) return enabled.find((action) => action.kind === 'finish_sell')?.id;
  const sales = enabled.filter((action) => action.kind === 'sell');
  const single = (id: string) =>
    sales.find(
      (action) =>
        action.payload.pokemonInstanceIds.length === 1 &&
        action.payload.pokemonInstanceIds[0] === id,
    );
  if (!sellUids.every((id) => single(id))) return undefined;
  return sellUids.length === 1 ? single(sellUids[0]!)!.id : { sellUids };
}

function jevDecision(
  choice: PolicyChoice,
  requests: number,
  events: JevDecisionEvent[],
): OrchestratorDecision {
  return { choice, source: 'jev', fallbackReason: null, requests, events };
}

/** The fallback policy's choice, logged as one event for the decision point. */
function policyDecision(
  request: DecideRequest,
  source: Exclude<DecisionSource, 'jev'>,
  fallbackReason: OrchestratorFallbackReason | null,
): OrchestratorDecision {
  const { observation, legalActions, rng, facts, personality } = request;
  const choice = new FallbackPolicy(personality).decide(
    observation,
    legalActions,
    rng,
    facts.policy,
  );
  return {
    choice,
    source,
    fallbackReason,
    requests: 0,
    events: [
      {
        requestId: null,
        model: null,
        questionId: observation.public.phase.kind,
        choice: typeof choice === 'string' ? choice : `sell:${choice.sellUids.join('+')}`,
        probabilities: null,
        confidence: null,
        sampled: null,
        fallbackReason,
      },
    ],
  };
}

/** Invalid outputs are answers Jev returned that could not be used (§5.6 metrics). */
const INVALID_OUTPUTS: ReadonlySet<OrchestratorFallbackReason> = new Set([
  'schema_mismatch',
  'invalid_choice',
]);

/**
 * Counts over decisions for the §5.6 metrics: `decisions` that reached a Jev decision point (not
 * `auto`), `requests` sent, `invalid_outputs`, and `fallback:<reason>` per cause.
 */
export class DecisionStats {
  readonly #counts: Record<string, number> = { decisions: 0, requests: 0, invalid_outputs: 0 };

  record(decision: OrchestratorDecision): void {
    this.#counts.requests! += decision.requests;
    if (decision.source === 'auto') return;
    this.#counts.decisions! += 1;
    const reason = decision.fallbackReason;
    if (reason === null) return;
    this.#counts[`fallback:${reason}`] = (this.#counts[`fallback:${reason}`] ?? 0) + 1;
    if (INVALID_OUTPUTS.has(reason)) this.#counts.invalid_outputs! += 1;
  }

  counts(): Record<string, number> {
    return { ...this.#counts };
  }
}

export interface DecisionRates {
  decisions: number;
  requests: number;
  /** Unusable Jev answers per request sent; apart from `illegalAppliedActionCount` (§5.6). */
  invalidOutputRate: number;
  /** Fallback decisions per decision, overall and by cause. */
  fallbackRate: { total: number; byCause: Record<string, number> };
}

const rate = (count: number, total: number) =>
  total === 0 ? 0 : Math.round((count / total) * 10_000) / 10_000;

/** The §5.6 rates from `DecisionStats` counts, which may be summed over seats and games first. */
export function decisionRates(counts: Readonly<Record<string, number>>): DecisionRates {
  const decisions = counts.decisions ?? 0;
  const requests = counts.requests ?? 0;
  const byCause: Record<string, number> = {};
  let fallbacks = 0;
  for (const [key, count] of Object.entries(counts)) {
    if (!key.startsWith('fallback:')) continue;
    fallbacks += count;
    byCause[key.slice('fallback:'.length)] = rate(count, decisions);
  }
  return {
    decisions,
    requests,
    invalidOutputRate: rate(counts.invalid_outputs ?? 0, requests),
    fallbackRate: { total: rate(fallbacks, decisions), byCause },
  };
}
