import type { Personality } from '../content/personality-schema.ts';
import type { BallType, LegalActions, Observation } from '../engine/index.ts';
import type { Policy, PolicyFacts, PolicyGame, PolicyRng } from '../sim/policy.ts';
import { PERSONALITIES } from './fallback/index.ts';
import { createSdkJevClient, disabledJevClient, jevEnabled, type JevClient } from './jev/client.ts';
import { createChaosJevClient } from './jev/fake.ts';
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
 */
export function simJevClient(seed: number): { client: JevClient; decisionMs?: number } {
  if (!jevEnabled()) return { client: disabledJevClient };
  if (process.env.TYPESAFE_API_KEY?.trim()) return { client: createSdkJevClient() };
  return { client: createChaosJevClient(`jev:${seed}`), decisionMs: OFFLINE_DECISION_MS };
}

const orchestrators = new WeakMap<PolicyGame, Orchestrator>();

/** `--policy jev`: every seat plays Greedy on Normal, sharing one orchestrator per game. */
export function createJevPolicy(game: PolicyGame): JevPolicy {
  let orchestrator = orchestrators.get(game);
  if (!orchestrator) {
    orchestrator = new Orchestrator(simJevClient(game.seed));
    orchestrators.set(game, orchestrator);
  }
  return new JevPolicy(orchestrator, PERSONALITIES.greedy);
}
