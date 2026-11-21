import type {
  JevStatus,
  DecisionFallbackReason,
  DecisionRequest,
} from '../engine/contract/decision.ts';
import { createRng } from '../engine/index.ts';
import { createPolicyRng, type PolicyChoice, type PolicyFacts } from '../sim/policy.ts';
import { LINES, selectLine, type Situation } from './lines.ts';
import { FallbackPolicy, PERSONALITIES } from './fallback/index.ts';
import { createSdkJevClient, jevEnabled, type JevClient } from './jev/client.ts';
import type { DecisionEvent } from './jev/decision-log.ts';
import { defaultUsageLedger, type UsageRecorder } from './jev/spend.ts';
import { pendingDeal, trustBucket, type SellFacts } from './questions/index.ts';
import {
  GameQuota,
  Orchestrator,
  type DecideFacts,
  type OrchestratorDecision,
} from './orchestrator.ts';

/** What a decider picks: an action ID, or the Pokémon to sell at the Sell Phase. */
export type DeciderPick = { choice: string } | { sellUids: string[] };

export type DeciderAnswer = DeciderPick & {
  lineId?: string;
  /** The §6.8 events of this answer, for the app to journal; they never leave the server. */
  events?: readonly DecisionEvent[];
} & ({ source: 'jev' } | { source: 'fallback'; fallbackReason: DecisionFallbackReason });

export interface DeciderContext {
  status: JevStatus;
}

/** The pluggable seam `POST /api/ai/decide` calls; `createOrchestratorDecider` is the default. */
export type Decider = (request: DecisionRequest, context: DeciderContext) => Promise<DeciderAnswer>;

/**
 * Spec §9 kill switch, key presence and spend guard, read per call so the badge tells the truth.
 * The usage ledger is opened only once a key is set, so a keyless server never reads the log.
 */
export const jevStatus = (
  usage: () => Pick<UsageRecorder, 'budgetExceeded'> = defaultUsageLedger,
): JevStatus => {
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
  // A Deal Card is never accepted by a last resort: the safe answer is the refusal (§3 fallback table).
  const refusal =
    request.decisionPoint === 'deal_response'
      ? request.enabledActions.find(
          (action) => action.kind === 'respond_deal' && action.payload.answer === 'reject',
        )
      : undefined;
  const first = refusal ?? request.enabledActions[0]!;
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

export interface OrchestratorDeciderOptions {
  /** The Jev client, made on first use and only when Jev is enabled with a key; defaults to the SDK. */
  client?: () => JevClient;
  /** The usage log and spend guard each orchestrator writes to; none for fakes. */
  usage?: () => UsageRecorder | undefined;
  /** The decision deadline; defaults to 1,500 ms (spec §5.6). */
  decisionMs?: number;
  maxGames?: number;
}

/**
 * The Sell Phase facts, only when the wire gives a row for every sellable Pokémon and none else;
 * a partial or foreign set is as good as none, so the Sell Phase falls back as `missing_facts`
 * instead of asking Jev about a team it cannot fully price.
 */
const sellFactsOf = (
  request: DecisionRequest,
):
  | { facts: SellFacts; saleValue: Record<string, number>; keepValue: Record<string, number> }
  | undefined => {
  const rows = request.facts.sell;
  if (!rows || request.decisionPoint !== 'sell') return undefined;
  const sellable = new Set(
    request.enabledActions.flatMap((action) =>
      action.kind === 'sell' ? action.payload.pokemonInstanceIds : [],
    ),
  );
  const given = new Set(rows.map((row) => row.instanceId));
  if (given.size !== rows.length || given.size !== sellable.size) return undefined;
  if (![...given].every((instanceId) => sellable.has(instanceId))) return undefined;
  return {
    facts: {
      pokemon: rows.map(
        ({ instanceId, salePrice, classBonusAlone, classBonusTogether, keepValue }) => ({
          instanceId,
          salePrice,
          classBonusAlone,
          classBonusTogether,
          keepValue,
        }),
      ),
    },
    saleValue: Object.fromEntries(rows.map((row) => [row.instanceId, row.saleValue])),
    keepValue: Object.fromEntries(rows.map((row) => [row.instanceId, row.keepValue])),
  };
};

/**
 * The engine numbers the wire carries: catch odds for the Encounter question and the policy, and
 * the Sell Phase's prices for the Sell Nouls and the policy's sale values.
 */
const toFacts = (request: DecisionRequest): DecideFacts => {
  if (request.decisionPoint === 'deal_response') {
    // The engine's buckets for the AI's own pending deal: its own observation first, the wire's only
    // when the observation carries none (§5.4).
    const pending = request.observation.own.pendingResponse;
    const deal = (pending?.kind === 'deal' ? pending.facts : undefined) ?? request.facts.deal;
    return deal ? { deal } : {};
  }
  const sale = sellFactsOf(request);
  if (sale)
    return { policy: { saleValue: sale.saleValue, keepValue: sale.keepValue }, sell: sale.facts };
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

export const personalityFor = (id: string) =>
  Object.hasOwn(PERSONALITIES, id)
    ? PERSONALITIES[id as keyof typeof PERSONALITIES]
    : PERSONALITIES.greedy;

/**
 * Spec §5.7: the line a seat says with its answer to a Deal Card, from `deal_accept` or `deal_reject`. It is a
 * seeded pick by the proposer's trust bucket (the engine's number, `trustBucket`), not a choice Jev makes, so it
 * costs no request. A bucket with no authored lines for this personality (today only `neutral` is authored) uses
 * `neutral`. Picked by a seeded draw on a presentation RNG apart from the game's, so a retried decision says the
 * same line. A counter has no line, by decision: the Deal Card shows its new terms as an engine record, not as speech.
 */
const lineFor = (request: DecisionRequest, choice: string): { lineId?: string } => {
  if (request.decisionPoint !== 'deal_response') return {};
  const action = request.enabledActions.find((entry) => entry.id === choice);
  const situation: Situation | undefined =
    action?.kind !== 'respond_deal'
      ? undefined
      : action.payload.answer === 'accept'
        ? 'deal_accept'
        : 'deal_reject';
  if (!situation) return {};
  const personalityId = personalityFor(request.personalityId).id;
  const pending = pendingDeal(request.observation);
  const bucket = trustBucket(
    request.observation.own.trust?.find((entry) => entry.seatIndex === pending?.initiatorSeatIndex)
      ?.value ?? 0,
  );
  const authored = LINES[situation].some(
    (line) => line.personality === personalityId && line.trust === bucket,
  );
  const { lineId } = selectLine(
    situation,
    personalityId,
    authored ? bucket : 'neutral',
    createRng(`${request.gameId}:${request.turnKey}:${request.stateRevision}:deal-line`),
  );
  return { lineId };
};

/** A wire answer from a policy choice; the Sell Phase answers in Pokémon, never an action ID. */
const answerFor = (
  request: DecisionRequest,
  choice: PolicyChoice,
  meta: { source: 'jev' } | { source: 'fallback'; fallbackReason: DecisionFallbackReason },
): DeciderAnswer => {
  if (request.decisionPoint !== 'sell') {
    // Only the Sell Phase has batches; the app turns this into a `decider_error` fallback.
    if (typeof choice !== 'string') throw new Error('A Sell batch outside the Sell Phase');
    return { choice, ...lineFor(request, choice), ...meta };
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
        // The wire has no `auto` source: a decision with no Jev question reports it as a reason. The
        // logged-only `over_budget` (code's refusal of a deal the AI cannot afford) is `auto` here too.
        fallbackReason:
          decision.source === 'auto' || decision.fallbackReason === 'over_budget'
            ? 'auto'
            : (decision.fallbackReason ?? 'auto'),
      });

/** An event for a decision the fallback policy made without the orchestrator (spec §6.8). */
const policyEvent = (request: DecisionRequest, answer: DeciderAnswer): DecisionEvent => ({
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
 * Spec §5.2, §5.6, §9: one `Orchestrator` per game, from a bounded cache, over a game's `GameQuota`
 * that is never evicted (a few counters per game, kept while the server runs), so the per-turn
 * request limit, the per-game token budget and the decision numbers hold across requests and
 * across evictions. The real client is made only when Jev is enabled with a key and the spend
 * guard is not tripped; otherwise, and when the client cannot be made, the fallback policy decides.
 * Each answer carries its §6.8 `events` for the app's `DecisionJournal`.
 */
export const createOrchestratorDecider = ({
  client = createSdkJevClient,
  usage = defaultUsageLedger,
  decisionMs,
  maxGames = MAX_CACHED_GAMES,
}: OrchestratorDeciderOptions = {}): Decider => {
  const games = new Map<string, Orchestrator>();
  const quotas = new Map<string, GameQuota>();
  let jev: JevClient | undefined;

  const orchestratorFor = (gameId: string): Orchestrator => {
    let quota = quotas.get(gameId);
    if (!quota) quotas.set(gameId, (quota = new GameQuota()));
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

  const policy = (request: DecisionRequest, reason: DecisionFallbackReason): DeciderAnswer => {
    const answer = policyAnswer(request, reason);
    return { ...answer, events: [policyEvent(request, answer)] };
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
      decisionPoint: request.decisionPoint,
      rng: rngFor(request),
    });
    return { ...fromDecision(request, decision), events: decision.events };
  };
};
