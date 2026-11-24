import type { Personality } from '../content/personality-schema.ts';
import type { BallType, LegalActions, Observation } from '../engine/index.ts';
import type { Policy, PolicyFacts, PolicyGame, PolicyRng } from '../sim/policy.ts';
import { PERSONALITIES } from './fallback/index.ts';
import { createSdkJevClient, disabledJevClient, jevEnabled, type JevClient } from './jev/client.ts';
import { createChaosJevClient } from './jev/fake.ts';
import { HARD_ROLLOUT_MS } from './hard.ts';
import { costUsd, defaultUsageLedger, SPEND_CONFIG, type UsageRecorder } from './jev/spend.ts';
import { pendingPromise } from './promises.ts';
export { decisionRates, type DecisionRates } from './orchestrator.ts';
import {
  DecisionStats,
  Orchestrator,
  type DecideFacts,
  type Difficulty,
  type OrchestratorDecision,
} from './orchestrator.ts';

/**
 * The offline sim's decision deadline: short, so answers the chaos fake sends late cost little
 * wall time. The fake answers at once otherwise, so no on-time answer can miss it.
 */
export const OFFLINE_DECISION_MS = 20;

/**
 * Spec §5.6 through the sim's `Policy`: every decision goes through the per-game `Orchestrator`,
 * and the seat's `DecisionStats` report its fallbacks by cause.
 */
export class JevPolicy implements Policy {
  readonly wantsFacts = true;
  readonly #stats = new DecisionStats();
  /** Every decision this seat made, events included, for tests and logs. */
  readonly decisions: OrchestratorDecision[] = [];

  constructor(
    readonly orchestrator: Orchestrator,
    readonly personality: Personality,
    readonly difficulty: Difficulty = 'normal',
  ) {}

  async decide(
    observation: Observation,
    legalActions: LegalActions,
    rng: PolicyRng,
    facts: PolicyFacts = {},
  ) {
    const decision = await this.orchestrator.decide({
      turnKey: String(observation.public.globalTurnNo),
      observation,
      legalActions,
      facts: decideFacts(facts),
      // A pending Social offer this seat owes an answer to is the responder point, which the
      // orchestrator routes ahead of the phase (spec §4.8, §5.3, §8); the engine names the question.
      ...(pendingPromise(observation) && { decisionPoint: 'promise_response' as const }),
      difficulty: this.difficulty,
      personality: this.personality,
      rng,
    });
    this.#stats.record(decision);
    this.decisions.push(decision);
    return decision.choice;
  }

  counts() {
    return this.#stats.counts();
  }
}

/** The Encounter question's odds come from the engine's succeeding faces; Sell facts are not yet. */
function decideFacts(facts: PolicyFacts): DecideFacts {
  const faces = facts.catchSuccessFaces;
  if (!faces) return { policy: facts };
  const odds = Object.entries(faces).map(([ballType, successFaces]) => ({
    ballType: ballType as BallType,
    successFaces: successFaces!,
  }));
  return { policy: facts, encounter: { odds } };
}

/**
 * The sim's Jev client: none with `JEV_ENABLED=false`, the real service only when a person runs
 * the sim with the key in their environment, and otherwise the seeded chaos fake (tests and CI).
 * Only the real service writes the usage log and is held to the spend guard (§9).
 */
export function simJevClient(seed: number): {
  client: JevClient;
  decisionMs?: number;
  usage?: UsageRecorder;
} {
  if (!jevEnabled()) return { client: disabledJevClient };
  if (process.env.TYPESAFE_API_KEY?.trim()) {
    return { client: createSdkJevClient(), usage: defaultUsageLedger() };
  }
  return { client: createChaosJevClient(`jev:${seed}`), decisionMs: OFFLINE_DECISION_MS };
}

const orchestrators = new WeakMap<PolicyGame, Orchestrator>();

/** `--policy jev`: every seat plays Greedy on Normal, sharing one orchestrator per game. */
export function createJevPolicy(game: PolicyGame, difficulty: Difficulty = 'normal'): JevPolicy {
  let orchestrator = orchestrators.get(game);
  if (!orchestrator) {
    orchestrator = new Orchestrator(simJevClient(game.seed));
    orchestrators.set(game, orchestrator);
  }
  return new JevPolicy(orchestrator, PERSONALITIES.greedy, difficulty);
}

/**
 * `--policy jev-hard`: the same on Hard (spec §5.6), so every Strategy and Encounter question
 * carries the engine's rollout buckets. The sim draws every sample (no clock), so a run repeats.
 */
export const createHardJevPolicy = (game: PolicyGame): JevPolicy => createJevPolicy(game, 'hard');

/** `live`: the real service. `fake`: the seeded chaos client. `disabled`: `JEV_ENABLED=false`. */
export type JevRunMode = 'live' | 'fake' | 'disabled';

/**
 * How Jev decides in this process: disabled by the kill switch, live with the key in the
 * environment, otherwise the offline fake. `offline` ignores the key, for tests that must never
 * reach the service.
 */
export function jevRunMode(offline = false): JevRunMode {
  if (!jevEnabled()) return 'disabled';
  return !offline && process.env.TYPESAFE_API_KEY?.trim() ? 'live' : 'fake';
}

/** What a duel game's Jev requests cost, from the live usage lines it wrote; `null` offline. */
export type DuelUsage = {
  requests: number;
  inputTokens: number;
  estimatedRequests: number;
  thb: number;
} | null;

/** One duel game's orchestrator, shared by its seats like a server's, and its usage tally. */
export type DuelRun = {
  mode: JevRunMode;
  orchestrator: Orchestrator;
  /** Hard's rollout limit in this game, or `null` when the offline fake runs them untimed. */
  rolloutMs: number | null;
  usage(): DuelUsage;
};

/**
 * The G2 duel's Jev wiring (spec §5.6, §9). Live, the game gets the server's settings: a 1,500 ms
 * decision deadline and Hard's rollouts stopped at `HARD_ROLLOUT_MS` inside it, with each request
 * logged under `gameId` in `logs/jev-usage.jsonl` and held to the spend cap. Offline there is no
 * clock to cut rollouts, so they run untimed and a dry run measures their compute only.
 */
export function createDuelRun(gameId: string, seed: number, offline = false): DuelRun {
  const mode = jevRunMode(offline);
  const tally = { requests: 0, inputTokens: 0, estimated: 0, thb: 0 };
  if (mode === 'live') {
    const ledger = defaultUsageLedger();
    const counting: UsageRecorder = {
      record(line) {
        tally.requests += 1;
        tally.inputTokens += line.inputTokens;
        if (line.estimated) tally.estimated += 1;
        tally.thb += costUsd(line) * SPEND_CONFIG.thbPerUsd;
        ledger.record(line);
      },
      budgetExceeded: (provider) => ledger.budgetExceeded(provider),
    };
    return {
      mode,
      rolloutMs: HARD_ROLLOUT_MS,
      orchestrator: new Orchestrator({
        client: createSdkJevClient(),
        gameId,
        usage: counting,
        rolloutMs: HARD_ROLLOUT_MS,
      }),
      usage: () => ({
        requests: tally.requests,
        inputTokens: tally.inputTokens,
        estimatedRequests: tally.estimated,
        thb: tally.thb,
      }),
    };
  }
  const offlineClient =
    mode === 'disabled'
      ? { client: disabledJevClient }
      : { client: createChaosJevClient(`jev:${seed}`), decisionMs: OFFLINE_DECISION_MS };
  return {
    mode,
    rolloutMs: null,
    orchestrator: new Orchestrator({ ...offlineClient, gameId }),
    usage: () => null,
  };
}

/** A seat of a duel game: Greedy on `difficulty`, deciding through the game's one orchestrator. */
export const createDuelSeat = (run: DuelRun, difficulty: Difficulty): JevPolicy =>
  new JevPolicy(run.orchestrator, PERSONALITIES.greedy, difficulty);

/** The spend guard's answer for the live ledger (§9): true once the cap or daily budget is reached. */
export const jevBudgetExceeded = (): boolean => defaultUsageLedger().budgetExceeded();
