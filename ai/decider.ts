import type {
  AiStatus,
  DecisionFallbackReason,
  DecisionRequest,
} from '../engine/contract/decision.ts';
import { createPolicyRng, type PolicyChoice, type PolicyFacts } from '../sim/policy.ts';
import { FallbackPolicy, PERSONALITIES } from './fallback/index.ts';
import { createSdkJevClient, jevEnabled, type JevClient } from './jev/client.ts';
import type { DecisionLog, DecisionRecord } from './jev/decision-log.ts';
import { defaultUsageLedger, type UsageRecorder } from './jev/spend.ts';
import {
  GameQuota,
  Orchestrator,
  type DecideFacts,
  type OrchestratorDecision,
} from './orchestrator.ts';

/** What a decider picks: an action ID, or the Pokémon to sell at the Sell Phase. */
export type DeciderPick = { choice: string } | { sellUids: string[] };

export type DeciderAnswer = DeciderPick & { lineId?: string } & (
    { source: 'jev' } | { source: 'fallback'; fallbackReason: DecisionFallbackReason }
  );

export interface DeciderContext {
  status: AiStatus;
}

/** The pluggable seam `POST /api/ai/decide` calls; `createOrchestratorDecider` is the default. */
export type Decider = (request: DecisionRequest, context: DeciderContext) => Promise<DeciderAnswer>;

/**
 * Spec §9 kill switch, key presence and spend guard, read per call so the badge tells the truth.
 * The usage ledger is opened only once a key is set, so a keyless server never reads the log.
 */
export const jevStatus = (
  usage: () => Pick<UsageRecorder, 'budgetExceeded'> = defaultUsageLedger,
): AiStatus => {
  if (!jevEnabled()) return { jevEnabled: false, backupOnly: true, reason: 'disabled' };
  if (!process.env.TYPESAFE_API_KEY?.trim()) {
    return { jevEnabled: true, backupOnly: true, reason: 'missing_key' };
  }
  if (usage().budgetExceeded()) {
    return { jevEnabled: true, backupOnly: true, reason: 'budget_exceeded' };
  }
  return { jevEnabled: true, backupOnly: false, reason: null };
};

/** The first enabled action; at the Sell Phase, the Pokémon that action sells. The last resort. */
export const fallbackAnswer = (
  request: DecisionRequest,
  fallbackReason: DecisionFallbackReason,
): DeciderAnswer => {
  const first = request.enabledActions[0]!;
  if (request.decisionPoint === 'sell') {
    const sellUids = first.kind === 'sell' ? first.payload.pokemonInstanceIds : [];
    return { sellUids, source: 'fallback', fallbackReason };
  }
  return { choice: first.id, source: 'fallback', fallbackReason };
};

/** Spec §3.1: an answer that is not among the engine's options is discarded. */
export const isOption = (request: DecisionRequest, pick: DeciderPick): boolean => {
  if ('choice' in pick) {
    return (
      request.decisionPoint !== 'sell' &&
      request.enabledActions.some((action) => action.id === pick.choice)
    );
  }
  const sellable = new Set(
    request.enabledActions.flatMap((action) =>
      action.kind === 'sell' ? action.payload.pokemonInstanceIds : [],
    ),
  );
  return (
    request.decisionPoint === 'sell' &&
    new Set(pick.sellUids).size === pick.sellUids.length &&
    pick.sellUids.every((uid) => sellable.has(uid))
  );
};

/** How many games keep an orchestrator at once; an idle one is dropped and made again on demand. */
export const MAX_CACHED_GAMES = 64;

/**
 * How many games keep their quota (token budget and requests per turn). Much larger than the
 * orchestrator cache and separate from it: dropping an orchestrator never resets a game's limits.
 */
export const MAX_TRACKED_GAMES = 10_000;

export interface OrchestratorDeciderOptions {
  /** The Jev client, made on first use and only when Jev is enabled with a key; defaults to the SDK. */
  client?: () => JevClient;
  /** The usage log and spend guard each orchestrator writes to; none for fakes. */
  usage?: () => UsageRecorder | undefined;
  /** The decision deadline; defaults to 1,500 ms (spec §5.6). */
  decisionMs?: number;
  maxGames?: number;
  maxTrackedGames?: number;
  /** Receives each decision's §6.8 events; none by default. A failing log never fails a decision. */
  log?: DecisionLog;
}

/** The engine numbers the wire carries: catch odds for the Encounter question and the policy. */
const toFacts = (request: DecisionRequest): DecideFacts => {
  const odds = request.facts.catchOdds;
  if (!odds) return {};
  const catchChance: Partial<Record<'poke' | 'great' | 'ultra', number>> = {};
  const catchSuccessFaces: Partial<Record<'poke' | 'great' | 'ultra', number>> = {};
  for (const { ballType, probability, successFaces } of odds) {
    catchChance[ballType] = probability;
    catchSuccessFaces[ballType] = successFaces;
  }
  const policy: PolicyFacts = { catchChance, catchSuccessFaces };
  return {
    policy,
    encounter: { odds: odds.map(({ ballType, successFaces }) => ({ ballType, successFaces })) },
  };
};

/** Seeded by the opaque IDs, so a retried decision gets the same choice without the engine's RNG. */
const rngFor = (request: DecisionRequest) =>
  createPolicyRng(`${request.gameId}:${request.turnKey}:${request.stateRevision}`);

const personalityFor = (id: string) =>
  Object.hasOwn(PERSONALITIES, id)
    ? PERSONALITIES[id as keyof typeof PERSONALITIES]
    : PERSONALITIES.greedy;

/** A wire answer from a policy choice; the Sell Phase answers in Pokémon, never an action ID. */
const answerFor = (
  request: DecisionRequest,
  choice: PolicyChoice,
  meta: { source: 'jev' } | { source: 'fallback'; fallbackReason: DecisionFallbackReason },
): DeciderAnswer => {
  if (request.decisionPoint !== 'sell') {
    // Only the Sell Phase has batches; the app turns this into a `decider_error` fallback.
    if (typeof choice !== 'string') throw new Error('A Sell batch outside the Sell Phase');
    return { choice, ...meta };
  }
  if (typeof choice !== 'string') return { sellUids: [...choice.sellUids], ...meta };
  const action = request.enabledActions.find((entry) => entry.id === choice);
  return { sellUids: action?.kind === 'sell' ? action.payload.pokemonInstanceIds : [], ...meta };
};

/** Spec §5.2: the fallback policy over the engine's options, for when Jev is not asked. */
export const policyAnswer = (
  request: DecisionRequest,
  fallbackReason: DecisionFallbackReason,
): DeciderAnswer => {
  const choice = new FallbackPolicy(personalityFor(request.personalityId)).decide(
    request.observation,
    { enabled: request.enabledActions, disabled: [] },
    rngFor(request),
    toFacts(request).policy,
  );
  return answerFor(request, choice, { source: 'fallback', fallbackReason });
};

const fromDecision = (request: DecisionRequest, decision: OrchestratorDecision): DeciderAnswer =>
  decision.source === 'jev'
    ? answerFor(request, decision.choice, { source: 'jev' })
    : answerFor(request, decision.choice, {
        source: 'fallback',
        // The wire has no `auto` source: a decision with no Jev question reports it as a reason.
        fallbackReason: decision.fallbackReason ?? 'auto',
      });

/** What a §6.8 event carries, apart from the decision it belongs to; `JevDecisionEvent` fits it. */
type EventFields = Pick<
  DecisionRecord,
  | 'requestId'
  | 'model'
  | 'questionId'
  | 'choice'
  | 'probabilities'
  | 'confidence'
  | 'sampled'
  | 'fallbackReason'
>;

/** An event for a decision the fallback policy made without the orchestrator (spec §6.8). */
const policyEvent = (request: DecisionRequest, answer: DeciderAnswer): EventFields => ({
  requestId: null,
  model: null,
  questionId: request.decisionPoint,
  choice: 'choice' in answer ? answer.choice : `sell:${answer.sellUids.join('+')}`,
  probabilities: null,
  confidence: null,
  sampled: null,
  fallbackReason: answer.source === 'fallback' ? answer.fallbackReason : null,
});

/** Least recently used first: reading a key moves it to the end, and the front is dropped. */
const touch = <V>(cache: Map<string, V>, key: string, make: () => V, max: number): V => {
  const found = cache.get(key);
  const value = found ?? make();
  cache.delete(key);
  cache.set(key, value);
  for (const oldest of cache.keys()) {
    if (cache.size <= max) break;
    cache.delete(oldest);
  }
  return value;
};

/**
 * Spec §5.2, §5.6, §9: one `Orchestrator` per game, from a bounded cache, over a game's quota that
 * outlives it, so the per-turn request limit and the per-game token budget hold across requests
 * and across evictions. The real client is made only when Jev is enabled with a key and the spend
 * guard is not tripped; otherwise, and when the client cannot be made, the fallback policy decides.
 * Each decision's events go to `log` (spec §6.8).
 */
export const createOrchestratorDecider = ({
  client = createSdkJevClient,
  usage = defaultUsageLedger,
  decisionMs,
  maxGames = MAX_CACHED_GAMES,
  maxTrackedGames = MAX_TRACKED_GAMES,
  log,
}: OrchestratorDeciderOptions = {}): Decider => {
  const games = new Map<string, Orchestrator>();
  const quotas = new Map<string, GameQuota>();
  let jev: JevClient | undefined;

  const orchestratorFor = (gameId: string): Orchestrator => {
    // The quota first, so it is kept even when this game's orchestrator is dropped later.
    const quota = touch(quotas, gameId, () => new GameQuota(), maxTrackedGames);
    return touch(
      games,
      gameId,
      () => {
        jev ??= client();
        const recorder = usage();
        return new Orchestrator({
          client: jev,
          gameId,
          quota,
          ...(decisionMs !== undefined && { decisionMs }),
          ...(recorder && { usage: recorder }),
        });
      },
      maxGames,
    );
  };

  const record = (request: DecisionRequest, events: readonly EventFields[]) => {
    if (!log) return;
    const time = new Date().toISOString();
    for (const event of events) {
      // An explicit list, so nothing else an event or request carries can reach the log.
      const line: DecisionRecord = {
        time,
        gameId: request.gameId,
        seatIndex: request.seatIndex,
        turnKey: request.turnKey,
        stateRevision: request.stateRevision,
        decisionPoint: request.decisionPoint,
        requestId: event.requestId,
        model: event.model,
        questionId: event.questionId,
        choice: event.choice,
        probabilities: event.probabilities,
        confidence: event.confidence,
        sampled: event.sampled,
        fallbackReason: event.fallbackReason,
      };
      try {
        log(line);
      } catch {
        // Never the error itself: it could carry a path or request material.
        console.warn('Could not write the Jev decision log.');
      }
    }
  };

  const policy = (request: DecisionRequest, reason: DecisionFallbackReason): DeciderAnswer => {
    const answer = policyAnswer(request, reason);
    record(request, [policyEvent(request, answer)]);
    return answer;
  };

  return async (request, { status }) => {
    if (status.backupOnly) return policy(request, status.reason ?? 'disabled');
    let orchestrator: Orchestrator;
    try {
      orchestrator = orchestratorFor(request.gameId);
    } catch {
      // The client could not be made (for example an unpinned JEV_MODEL): never the first action.
      return policy(request, 'decider_error');
    }
    const decision = await orchestrator.decide({
      turnKey: request.turnKey,
      observation: request.observation,
      legalActions: { enabled: request.enabledActions, disabled: [] },
      facts: toFacts(request),
      // Hard waits for gate G2 (spec §5.6): until then it plays as Normal.
      difficulty: request.difficulty === 'easy' ? 'easy' : 'normal',
      personality: personalityFor(request.personalityId),
      rng: rngFor(request),
    });
    record(request, decision.events);
    return fromDecision(request, decision);
  };
};
