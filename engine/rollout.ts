import { matchOwnState, sampleBelief } from './belief.ts';
import { applyAction, legalActions, observe } from './contract/stubs.ts';
import type {
  Action,
  GameState,
  LegalAction,
  LegalActions,
  Observation,
} from './contract/schema.ts';
import { pendingDecision } from './decisions.ts';
import { oddsForAllBalls } from './odds.ts';
import { advanceAutomatically } from './pipeline.ts';
import { createRng, int, type RngState } from './rng.ts';
import { saleFacts } from './selling.ts';
import { actorRevision } from './visibility.ts';

/**
 * Rollout settings and bucket edges (spec §5.6 Hard). Like the Normal buckets (§5.4) these are
 * presentation thresholds, not game rules, and they are the reviewed defaults of #61: the spec
 * leaves the number of rollouts, the horizon and the bucket edges open.
 */
export const ROLLOUT_CONFIG = Object.freeze({
  /** Sampled worlds per option. */
  samples: 16,
  /** Fewer than this many finished samples and no buckets are sent (Hard then plays as Normal). */
  minSamples: 4,
  /** A rollout ends when the deciding seat starts this many of its own turns later: one table round. */
  horizonTurns: 1,
  /** Engine steps (decisions and automatic records) one rollout may take before it is cut off. */
  maxSteps: 400,
  /** Mean change in the seat's coins over the horizon. */
  coins: Object.freeze({ fallsBelow: -1, flatMax: 1, risesMax: 6 }),
  /** Share of sampled worlds in which the seat leads the table in coins at the horizon (a tie counts half). */
  lead: Object.freeze({ lowBelow: 1 / 3, highFrom: 2 / 3 }),
});

export type ExpectedCoins = 'falls' | 'flat' | 'rises' | 'rises a lot';
export type LeadChance = 'low' | 'medium' | 'high';

export function bucketExpectedCoins(meanChange: number): ExpectedCoins {
  if (!Number.isFinite(meanChange)) throw new RangeError('Expected a finite coin change');
  const { fallsBelow, flatMax, risesMax } = ROLLOUT_CONFIG.coins;
  if (meanChange < fallsBelow) return 'falls';
  if (meanChange <= flatMax) return 'flat';
  return meanChange <= risesMax ? 'rises' : 'rises a lot';
}

export function bucketLeadChance(share: number): LeadChance {
  if (!Number.isFinite(share) || share < 0 || share > 1) {
    throw new RangeError('Expected a share between 0 and 1');
  }
  const { lowBelow, highFrom } = ROLLOUT_CONFIG.lead;
  if (share < lowBelow) return 'low';
  return share < highFrom ? 'medium' : 'high';
}

/** The expected outcome of taking one option now, as named buckets; never a number (§5.4). */
export type OptionOutcome = { expected_coins: ExpectedCoins; lead_chance: LeadChance };

export type RolloutResult = {
  /** Keyed by engine action ID, in the order the options were given. */
  outcomes: Record<string, OptionOutcome>;
  /** Sampled worlds each outcome comes from. */
  samples: number;
};

/** What a seat chooses: an enabled action's ID, or the Pokémon of one atomic Sell batch (§4.7). */
export type RolloutChoice = string | { sellUids: readonly string[] };

/** Engine numbers the observation lacks, as `PolicyFacts` carries them to a policy (§5.2). */
export type RolloutFacts = {
  catchChance?: Readonly<Partial<Record<'poke' | 'great' | 'ultra', number>>>;
  catchSuccessFaces?: Readonly<Partial<Record<'poke' | 'great' | 'ultra', number>>>;
  saleValue?: Readonly<Record<string, number>>;
  keepValue?: Readonly<Record<string, number>>;
};

/**
 * How a simulated seat plays on. It is handed only that seat's observation, its legal actions, a
 * seeded choice source and engine facts, the same view a real seat has, so a policy cannot read
 * the sampled world's deck or seed either.
 */
export type RolloutPolicy = (
  seatIndex: number,
  observation: Observation,
  legalActions: LegalActions,
  rng: { int(n: number): number },
  facts: RolloutFacts,
) => RolloutChoice;

export type RolloutRequest = {
  /** The deciding seat's own observation: the only view of the real game a rollout gets. */
  observation: Observation;
  /** The seat's enabled options now; a sampled world must offer exactly these (its own spent budgets are matched to them). */
  legalActions: LegalActions;
  /** The enabled option IDs to roll out; every enabled option when absent. */
  options?: readonly string[];
  /** The game's public content. */
  content: GameState['content'];
  policy: RolloutPolicy;
  /** Names the sampled worlds and policy draws; never the game's seed. */
  seed: number | string;
  samples?: number;
  /** Checked between samples; the ones finished so far are used (a deadline, not the engine's clock). */
  shouldStop?: () => boolean;
};

/** Catch odds in an Encounter and sale values at the Sell Phase for the seat deciding now (§5.2). */
export function rolloutFacts(state: GameState, seatIndex: number): RolloutFacts {
  if (seatIndex !== state.activeSeatIndex) return {};
  if (state.phase.kind === 'encounter' && !state.phase.catchRoll) {
    const odds = oddsForAllBalls(state, seatIndex);
    return {
      catchChance: Object.fromEntries(odds.map((entry) => [entry.ballType, entry.probability])),
      catchSuccessFaces: Object.fromEntries(
        odds.map((entry) => [entry.ballType, entry.successFaces]),
      ),
    };
  }
  if (state.phase.kind !== 'sell') return {};
  const rows = saleFacts(state, seatIndex);
  return {
    saleValue: Object.fromEntries(rows.map((row) => [row.instanceId, row.saleValue])),
    keepValue: Object.fromEntries(rows.map((row) => [row.instanceId, row.keepValue])),
  };
}

function policyRng(seed: string) {
  let rng: RngState = createRng(seed);
  return {
    int(n: number) {
      const draw = int(rng, n, 'rollout:policy');
      rng = draw.rng;
      return draw.value;
    },
  };
}

function commandFor(state: GameState, actorId: string, choice: LegalAction): Action {
  const revision = actorRevision(state, actorId);
  return {
    actorId,
    actionSeq: revision + 1,
    stateRevisionBefore: revision,
    kind: choice.kind,
    payload: choice.payload,
  } as Action;
}

/** The enabled action a choice names, or the whole-batch sale it composes; the first option otherwise. */
function resolve(legal: LegalActions, picked: RolloutChoice): LegalAction {
  const { enabled } = legal;
  if (typeof picked === 'string')
    return enabled.find((entry) => entry.id === picked) ?? enabled[0]!;
  const sellable = new Set(
    enabled.flatMap((entry) => (entry.kind === 'sell' ? entry.payload.pokemonInstanceIds : [])),
  );
  const ids = [...picked.sellUids];
  if (new Set(ids).size === ids.length && ids.every((id) => sellable.has(id))) {
    return { id: `sell:${ids.join('+')}`, kind: 'sell', payload: { pokemonInstanceIds: ids } };
  }
  return enabled[0]!;
}

function apply(state: GameState, actorId: string, choice: LegalAction): GameState | undefined {
  const result = applyAction(state, commandFor(state, actorId, choice));
  return 'rejected' in result ? undefined : result.state;
}

/** Plays every seat on until the deciding seat starts its next turn, the game ends or steps run out. */
function playOn(state: GameState, seat: number, policy: RolloutPolicy, seed: string): GameState {
  const rng = policyRng(seed);
  const target = state.players.find((player) => player.seatIndex === seat)!.ownTurnNo;
  let current = state;
  for (let steps = 0; steps < ROLLOUT_CONFIG.maxSteps; steps++) {
    const me = current.players.find((player) => player.seatIndex === seat)!;
    if (current.phase.kind === 'finished' || me.ownTurnNo >= target + ROLLOUT_CONFIG.horizonTurns) {
      break;
    }
    const automatic = advanceAutomatically(current);
    if (automatic.records.length > 0) {
      current = automatic.state;
      continue;
    }
    const decision = pendingDecision(current);
    if (!decision) break;
    const legal = legalActions(current, decision.seatIndex);
    if (legal.enabled.length === 0) break;
    const picked = policy(
      decision.seatIndex,
      observe(current, decision.seatIndex),
      legal,
      rng,
      rolloutFacts(current, decision.seatIndex),
    );
    // An unusable pick never aborts a rollout: the seat takes its first enabled option instead.
    const next =
      apply(current, decision.actorId, resolve(legal, picked)) ??
      apply(current, decision.actorId, legal.enabled[0]!);
    if (!next) break;
    current = next;
  }
  return current;
}

/** The seat's coin change over the rollout, and its share of the lead (a tie counts half). */
function measure(end: GameState, seat: number, coinsBefore: number) {
  const mine = end.players.find((player) => player.seatIndex === seat)!;
  const others = end.players.filter((player) => player.seatIndex !== seat);
  const best = Math.max(...others.map((player) => player.coins));
  return {
    change: mine.coins - coinsBefore,
    lead: mine.coins > best ? 1 : mine.coins === best ? 0.5 : 0,
  };
}

/**
 * Spec §5.6 Hard, §8: Monte Carlo rollouts from the belief state. For each sampled world
 * (`sampleBelief`, unknowns drawn from known information only), every enabled option is applied in
 * turn and every seat plays on under `policy` until the deciding seat's next turn begins. Each
 * option's mean coin change and lead share become named buckets. The same sampled world and policy
 * draws serve every option, so options differ by the option alone.
 *
 * It takes an observation, never a `GameState`, so it cannot read the real deck or seed; it is
 * deterministic under `seed`. Returns `undefined`, and the caller plays as Normal, when a sampled
 * world cannot offer the seat's own options or fewer than `ROLLOUT_CONFIG.minSamples` finish.
 */
export function rolloutOptions(request: RolloutRequest): RolloutResult | undefined {
  const steps = rolloutSteps(request);
  let step = steps.next();
  while (!step.done) step = steps.next();
  return step.value;
}

/**
 * `rolloutOptions` one option's rollout at a time: it yields after each option of each sampled world
 * and returns the result, so a caller that must not hold its thread (a server answering other requests) may
 * pause between worlds. Still pure and no IO; running it to the end gives `rolloutOptions`'s result
 * exactly, since the worlds, draws and order do not depend on when it is resumed (§5.6, #64).
 */
export function* rolloutSteps(request: RolloutRequest): Generator<void, RolloutResult | undefined> {
  const { observation, content, policy, seed, shouldStop } = request;
  const enabled = request.legalActions.enabled;
  const rolled = request.options && new Set(request.options);
  const options = rolled ? enabled.filter((option) => rolled.has(option.id)) : enabled;
  const seat = observation.own.seatIndex;
  const asked = request.samples ?? ROLLOUT_CONFIG.samples;
  const hints = matchOwnState(
    observation,
    content,
    enabled.map((option) => option.id),
  );
  if (!hints) return undefined;
  const coinsBefore = observation.public.players.find((player) => player.seatIndex === seat)!.coins;
  const totals = new Map(options.map((option) => [option.id, { change: 0, lead: 0 }]));
  let finished = 0;
  for (let index = 0; index < asked; index++) {
    if (shouldStop?.()) break;
    const world = sampleBelief(observation, content, `${seed}:${index}`, hints);
    const actorId = world.players.find((player) => player.seatIndex === seat)!.actorId;
    const results: { change: number; lead: number }[] = [];
    for (const option of options) {
      const after = apply(structuredClone(world), actorId, option);
      const result =
        after && measure(playOn(after, seat, policy, `${seed}:${index}`), seat, coinsBefore);
      if (!result) return undefined;
      results.push(result);
      // One option's rollout is the unit of work between pauses (a caller may resume or not).
      yield;
    }
    options.forEach((option, row) => {
      const total = totals.get(option.id)!;
      total.change += results[row]!.change;
      total.lead += results[row]!.lead;
    });
    finished++;
  }
  if (finished < ROLLOUT_CONFIG.minSamples) return undefined;
  return {
    samples: finished,
    outcomes: Object.fromEntries(
      options.map((option) => {
        const total = totals.get(option.id)!;
        return [
          option.id,
          {
            expected_coins: bucketExpectedCoins(total.change / finished),
            lead_chance: bucketLeadChance(total.lead / finished),
          },
        ];
      }),
    ),
  };
}
