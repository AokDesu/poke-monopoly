import { createHash } from 'node:crypto';
import { applyAction } from '../../engine/index.ts';
import {
  PINNED_JEV_MODEL,
  type JevAnswer,
  type JevClient,
  type JevRequest,
  type JevResult,
  type JevSuccess,
} from '../../ai/jev/client.ts';
import type { UsageRecorder } from '../../ai/jev/spend.ts';
import {
  confidenceFloor,
  Orchestrator,
  type OrchestratorDecision,
  type OrchestratorFallbackReason,
} from '../../ai/orchestrator.ts';
import {
  buildEncounterQuestion,
  buildSellQuestions,
  buildStrategyQuestion,
} from '../../ai/questions/index.ts';
import { command, resolveChoice } from '../../sim/runner.ts';
import { fixtureSchema, requestHash, validateFixture, type Fixture } from './fixture.ts';
import { decideRequest, type EvalScenario } from './scenarios.ts';

export interface ScenarioRun {
  decisionPoint: 'strategy' | 'encounter' | 'sell';
  decision: OrchestratorDecision;
  /** Every request the orchestrator sent, and what the client answered. */
  requests: JevRequest[];
  results: JevResult[];
  /** The scenario's acceptable answers as question labels, for the fixture's `acceptable`. */
  acceptable: Record<string, string[]>;
  /** 1 when the applied choice was not among the legal options, or the engine rejected it. */
  illegalApplied: number;
}

/**
 * Replays a scenario's answers from fixtures only, never the network, so the kill switch, which
 * stops live calls, does not apply; a recording still goes through the client's own check.
 */
async function withJevOn<T>(run: () => Promise<T>): Promise<T> {
  const saved = process.env.JEV_ENABLED;
  delete process.env.JEV_ENABLED;
  try {
    return await run();
  } finally {
    if (saved !== undefined) process.env.JEV_ENABLED = saved;
  }
}

/** One decision through the real orchestrator, its choice applied by the engine (spec §3.1, §5.6). */
export async function runScenario(
  scenario: EvalScenario,
  client: JevClient,
  usage?: UsageRecorder,
): Promise<ScenarioRun> {
  const { state, request } = decideRequest(scenario);
  const decisionPoint = request.observation.public.phase.kind;
  if (decisionPoint !== 'strategy' && decisionPoint !== 'encounter' && decisionPoint !== 'sell') {
    throw new RangeError(`${scenario.id}: no Jev decision point in phase "${decisionPoint}"`);
  }
  const requests: JevRequest[] = [];
  const results: JevResult[] = [];
  const capture: JevClient = {
    async ask(jevRequest, options) {
      requests.push(jevRequest);
      const result = await client.ask(jevRequest, options);
      results.push(result);
      return result;
    },
  };
  const decision = await withJevOn(() =>
    new Orchestrator({ client: capture, usage }).decide(request),
  );
  const { choice, enabled } = resolveChoice(request.legalActions, decision.choice);
  const actorId = state.config.seats.find((seat) => seat.seatIndex === 0)!.actorId;
  const applied = choice && applyAction(state, command(state, actorId, choice));
  return {
    decisionPoint,
    decision,
    requests,
    results,
    acceptable: acceptableLabels(scenario, request),
    illegalApplied: enabled && applied && !('rejected' in applied) ? 0 : 1,
  };
}

/** Maps the scenario's acceptable action or Pokémon IDs to the labels its question offers. */
function acceptableLabels(
  scenario: EvalScenario,
  { observation, legalActions, facts, personality }: ReturnType<typeof decideRequest>['request'],
): Record<string, string[]> {
  const { acceptable } = scenario;
  const phase = observation.public.phase.kind;
  if (phase === 'sell') {
    if (Array.isArray(acceptable))
      throw new TypeError(`${scenario.id}: Sell needs per-Pokémon sets`);
    const [first] = buildSellQuestions(observation, facts.sell!, personality).requests;
    return Object.fromEntries(
      Object.entries(first!.options).map(([label, instanceId]) => {
        const answers = (acceptable as Record<string, readonly string[]>)[instanceId];
        if (!answers)
          throw new RangeError(`${scenario.id}: no acceptable answer for ${instanceId}`);
        return [label, [...answers]];
      }),
    );
  }
  if (!Array.isArray(acceptable)) throw new TypeError(`${scenario.id}: needs action IDs`);
  const decision =
    phase === 'strategy'
      ? buildStrategyQuestion(observation, legalActions.enabled, personality)
      : buildEncounterQuestion(observation, legalActions.enabled, facts.encounter!, personality);
  if (decision.kind !== 'ask') throw new RangeError(`${scenario.id}: asks no question`);
  const labels = Object.entries(decision.options).flatMap(([label, id]) =>
    acceptable.includes(id) ? [label] : [],
  );
  if (labels.length !== acceptable.length) {
    throw new RangeError(`${scenario.id}: an acceptable action is not on the shortlist`);
  }
  return { [phase]: labels };
}

/**
 * The fallback reason the orchestrator must give for this answer: `low_confidence` when a Choice
 * is below its floor (§5.6), and none otherwise; a Noul has no confidence floor.
 */
export function expectedFallback(
  run: Pick<ScenarioRun, 'decisionPoint' | 'requests'>,
  result: JevSuccess,
): OrchestratorFallbackReason | null {
  const question = run.decisionPoint;
  if (question === 'sell') return null;
  const answer = result.answers[question];
  const criteria = run.requests[0]!.questions[question];
  if (answer?.type !== 'choice' || criteria?.type !== 'choice') return null;
  const floor = confidenceFloor(question, Object.keys(criteria.criteria).length);
  return answer.confidence < floor ? 'low_confidence' : null;
}

const unanswered: JevClient = {
  ask: async () => ({ ok: false, fallbackReason: 'network', requestSent: false }),
};

/** The request the orchestrator would send for a scenario now, built without calling Jev. */
export async function scenarioRequest(scenario: EvalScenario): Promise<JevRequest> {
  const run = await runScenario(scenario, unanswered);
  if (run.requests.length !== 1) {
    throw new RangeError(
      `${scenario.id}: must ask exactly 1 Jev request, asked ${run.requests.length}`,
    );
  }
  return run.requests[0]!;
}

/** A fixture for a scenario and its answer; `synthetic` unless a person recorded it live. */
export function scenarioFixture(
  scenario: EvalScenario,
  run: ScenarioRun,
  recorded: JevSuccess,
  synthetic: boolean,
): Fixture {
  const request = run.requests[0]!;
  const fixture = fixtureSchema.parse({
    id: scenario.id,
    description: scenario.description,
    tags: { decisionPoint: run.decisionPoint, personality: scenario.personality.name },
    request,
    acceptable: run.acceptable,
    synthetic,
    requestHash: requestHash(request),
    recorded,
  });
  validateFixture(fixture);
  return fixture;
}

/**
 * A seeded stand-in answer that proves the harness until a person records the scenario. It is
 * derived from the fixture ID, not from any model, so its accuracy means nothing.
 */
export function placeholderResult(id: string, request: JevRequest): JevSuccess {
  const bytes = createHash('sha256').update(id).digest();
  let next = 0;
  const draw = () => bytes[next++ % bytes.length]!;
  const answers: Record<string, JevAnswer> = {};
  for (const [name, question] of Object.entries(request.questions)) {
    if (question.type === 'noul') {
      answers[name] = { type: 'noul', noul: Math.round((draw() / 255) * 100) / 100 };
      continue;
    }
    const labels = Object.keys(question.criteria);
    const weights = labels.map(() => (1 + draw()) ** 2);
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    const probabilities = Object.fromEntries(
      labels.map((label, index) => [label, Math.round((weights[index]! / total) * 1000) / 1000]),
    );
    const peak = Math.max(...Object.values(probabilities));
    const n = labels.length;
    const confidence = Math.max(0, Math.round(((n * peak - 1) / (n - 1)) * 1000) / 1000);
    const top = labels.find((label) => probabilities[label] === peak)!;
    answers[name] =
      question.type === 'choice'
        ? { type: 'choice', choice: top, confidence, probabilities }
        : { type: 'score', score: labels.indexOf(top), confidence, probabilities };
  }
  return {
    ok: true,
    answers,
    requestId: `synthetic-${id}`,
    model: PINNED_JEV_MODEL,
    latencyMs: 0,
    usage: { inputTokens: 0, outputTokens: 0 },
  };
}
