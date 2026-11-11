import type {
  AiStatus,
  DecisionFallbackReason,
  DecisionRequest,
} from '../engine/contract/decision.ts';
import { createPolicyRng, type PolicyChoice, type PolicyFacts } from '../sim/policy.ts';
import { FallbackPolicy, PERSONALITIES } from './fallback/index.ts';
import { createSdkJevClient, jevEnabled, type JevClient } from './jev/client.ts';
import { defaultUsageLedger, type UsageRecorder } from './jev/spend.ts';
import { Orchestrator, type DecideFacts, type OrchestratorDecision } from './orchestrator.ts';

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

/** How many games keep an orchestrator (and so a per-game token budget) at once. */
export const MAX_CACHED_GAMES = 64;

export interface OrchestratorDeciderOptions {
  /** The Jev client, made on first use and only when Jev is enabled with a key; defaults to the SDK. */
  client?: () => JevClient;
  /** The usage log and spend guard each orchestrator writes to; none for fakes. */
  usage?: () => UsageRecorder | undefined;
  /** The decision deadline; defaults to 1,500 ms (spec §5.6). */
  decisionMs?: number;
  maxGames?: number;
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

/**
 * Spec §5.2, §5.6, §9: one `Orchestrator` per game, from a bounded cache, so the per-turn request
 * limit and the per-game token budget hold across requests. The real client is made only when Jev
 * is enabled with a key and the spend guard is not tripped; otherwise the fallback policy decides
 * and the status reason (`disabled`, `missing_key`, `budget_exceeded`) is reported.
 */
export const createOrchestratorDecider = ({
  client = createSdkJevClient,
  usage = defaultUsageLedger,
  decisionMs,
  maxGames = MAX_CACHED_GAMES,
}: OrchestratorDeciderOptions = {}): Decider => {
  const games = new Map<string, Orchestrator>();
  let jev: JevClient | undefined;

  const orchestratorFor = (gameId: string): Orchestrator => {
    let orchestrator = games.get(gameId);
    if (orchestrator)
      games.delete(gameId); // re-inserted below: the Map's order is recency.
    else {
      jev ??= client();
      const recorder = usage();
      orchestrator = new Orchestrator({
        client: jev,
        gameId,
        ...(decisionMs !== undefined && { decisionMs }),
        ...(recorder && { usage: recorder }),
      });
    }
    games.set(gameId, orchestrator);
    for (const oldest of games.keys()) {
      if (games.size <= maxGames) break;
      games.delete(oldest);
    }
    return orchestrator;
  };

  return async (request, { status }) => {
    if (status.backupOnly) return policyAnswer(request, status.reason ?? 'disabled');
    const decision = await orchestratorFor(request.gameId).decide({
      turnKey: request.turnKey,
      observation: request.observation,
      legalActions: { enabled: request.enabledActions, disabled: [] },
      facts: toFacts(request),
      // Hard waits for gate G2 (spec §5.6): until then it plays as Normal.
      difficulty: request.difficulty === 'easy' ? 'easy' : 'normal',
      personality: personalityFor(request.personalityId),
      rng: rngFor(request),
    });
    return fromDecision(request, decision);
  };
};
