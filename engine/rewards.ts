import {
  rewardChoiceSchema,
  rewardRequestSchema,
  type EngineEvent,
  type GameState,
  type RewardChoice,
  type RewardRequest,
} from './contract/schema.ts';
import { nextEvolutionForms } from './forms.ts';
import { evolvePokemon } from './evolution.ts';

/** The caller supplies confirmed protection; this module neither arms nor consumes shields. */
function rewardContext(state: GameState, request: RewardRequest) {
  const winner = state.players.find((player) => player.actorId === request.winnerId);
  if (!winner) throw new RangeError('Unknown reward winner');
  const source = request.source;
  const loser =
    source.kind === 'pvp'
      ? state.players.find((player) => player.actorId === source.loserId)
      : undefined;
  if (request.source.kind === 'pvp' && (!loser || loser === winner)) {
    throw new RangeError('Invalid reward loser');
  }
  const amount =
    request.source.kind === 'gym'
      ? 6
      : request.source.coinLossBlocked
        ? 0
        : Math.min(6, loser!.coins);
  return { winner, loser, amount };
}

/** Internal options seam. Only a confirmed win creates a request; ties create none.
 * Branches are explicit, including each Eevee form. Tired members may evolve.
 */
export function rewardChoices(state: GameState, input: RewardRequest): RewardChoice[] {
  const request = rewardRequestSchema.parse(input);
  if (state.resolvedRewardIds?.includes(request.rewardId)) return [];
  const { winner, amount } = rewardContext(state, request);
  const choices: RewardChoice[] = [];
  if (Number.isSafeInteger(winner.coins + amount)) choices.push({ kind: 'coins' });
  for (const pokemon of winner.team) {
    if (!Number.isSafeInteger(pokemon.evolutionStage + 1)) continue;
    for (const nextFormId of nextEvolutionForms(state.content, pokemon.speciesId)) {
      choices.push({ kind: 'evolve', instanceId: pokemon.instanceId, nextFormId });
    }
  }
  return choices;
}

export type RewardResolution =
  | { accepted: true; events: EngineEvent[] }
  | { rejected: true; reason: 'invalid_reward' | 'invalid_choice' | 'already_resolved' };

/** Mutates only the caller's detached snapshot, after complete validation.
 * S06/S09 own pending requests, actor/revision validation, logging and continuation.
 * Reuse the same rewardId on retries and persist the returned events with the snapshot.
 */
export function resolveReward(
  next: GameState,
  input: unknown,
  selection: unknown,
): RewardResolution {
  const parsed = rewardRequestSchema.safeParse(input);
  if (!parsed.success) return { rejected: true, reason: 'invalid_reward' };
  const request = parsed.data;
  if (next.resolvedRewardIds?.includes(request.rewardId)) {
    return { rejected: true, reason: 'already_resolved' };
  }
  const selected = rewardChoiceSchema.safeParse(selection);
  if (!selected.success) return { rejected: true, reason: 'invalid_choice' };
  const choice = selected.data;
  let context: ReturnType<typeof rewardContext>;
  try {
    context = rewardContext(next, request);
    if (
      !rewardChoices(next, request).some(
        (option) => JSON.stringify(option) === JSON.stringify(choice),
      )
    ) {
      return { rejected: true, reason: 'invalid_choice' };
    }
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    return { rejected: true, reason: 'invalid_reward' };
  }
  const { winner, loser, amount } = context;
  const events: EngineEvent[] = [];
  if (choice.kind === 'evolve') {
    events.push(...evolvePokemon(next.content, winner, choice.instanceId, choice.nextFormId));
  } else if (amount > 0) {
    winner.coins += amount;
    if (loser) loser.coins -= amount;
    events.push({
      kind: 'coin_transfer',
      source: loser ? { kind: 'player', actorId: loser.actorId } : { kind: 'bank' },
      destination: { kind: 'player', actorId: winner.actorId },
      amount,
      reason: loser ? 'pvp_reward' : 'gym_reward',
      rewardId: request.rewardId,
    });
  }
  (next.resolvedRewardIds ??= []).push(request.rewardId);
  events.push({
    kind: 'battle_reward_resolved',
    ...request,
    choice,
    coinAmount: choice.kind === 'coins' ? amount : 0,
  });
  return { accepted: true, events };
}
