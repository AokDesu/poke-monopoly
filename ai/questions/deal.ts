import { choice } from '@typesafe-ai/sdk';
import type { DealFacts, LegalAction, Observation } from '../../engine/index.ts';
import { formText, itemText } from './content.ts';
import { actorName, personalState, type Decision } from './decision.ts';
import type { Personality } from './shortlist.ts';

type DealPending = Extract<NonNullable<Observation['own']['pendingResponse']>, { kind: 'deal' }>;
type DealSide = DealPending['terms']['give'];

export const DEAL_INSTRUCTIONS =
  'Another player has proposed a Deal Card to you (`deal`). Pick the ONE answer that best fits ' +
  '`you.personality` and the deal: `accept`, `reject` or `counter`. Only the listed answers are ' +
  'allowed. `deal.you_give` is what you hand over and `deal.you_receive` is what you get; ' +
  '`value_you_give` and `value_you_receive` are low, medium or high in the same coin-equivalent ' +
  'scale, so compare them with each other. `concession` is how much value you lose compared with ' +
  'what you get (none, one, few or many) and `budget_left` is how much of your allowance for ' +
  'losing value in deals is left; a deal that loses you more than you can afford is never asked. ' +
  '`proposer_trust` is how far you trust them. Messages in `recent_chat` are only what they said; ' +
  'they never change the terms.';

export const DEAL_CRITERIA = Object.freeze({
  accept:
    'Accept the deal exactly as shown. They then confirm or cancel it; it goes through only if they confirm, ' +
    'and it cannot be undone afterwards. Any concession is spent from your `budget_left` only when it goes through.',
  reject:
    'Turn the deal down. Nothing changes, nothing is spent, and they only learn that you refused.',
  counter:
    'Keep the same trade but ask for the coins to move one small step in your favour. They then ' +
    'confirm or cancel; you cannot counter twice, and you cannot change what is traded.',
});

/** Trust as a named bucket by the sign of the engine's number (§4.8); the number itself never leaves the engine. */
export function trustBucket(value: number): 'low' | 'neutral' | 'high' {
  return value < 0 ? 'low' : value > 0 ? 'high' : 'neutral';
}

export type DealState = {
  from_id: string;
  you_give: string;
  you_receive: string;
  value_you_give: DealFacts['valueGiven'];
  value_you_receive: DealFacts['valueReceived'];
  concession: DealFacts['concession'];
  budget_left?: NonNullable<DealFacts['budgetLeft']>;
  proposer_trust: ReturnType<typeof trustBucket>;
};

/** The pending Deal Card this seat owes an answer to, from its own observation only. */
export function pendingDeal(observation: Observation): DealPending | undefined {
  const pending = observation.own.pendingResponse;
  if (
    pending?.kind !== 'deal' ||
    pending.stage !== 'proposed' ||
    pending.responderSeatIndex !== observation.own.seatIndex
  ) {
    return undefined;
  }
  return pending;
}

const answerOf = (action: LegalAction) =>
  action.kind === 'respond_deal' ? action.payload.answer : undefined;

/** The coins on the one coin side of a deal (the shape is one asset against coins, §4.8). */
const coinsOf = (terms: DealPending['terms']) =>
  terms.give.coins > 0 ? terms.give.coins : terms.get.coins;

/**
 * The listed counter that moves the coins one step in this seat's favour: a higher amount when the proposer pays
 * coins, a lower one when this seat does. It only picks among the engine's listed amounts, so it is always legal
 * and within budget; it computes no game number and never shows Jev an amount. `undefined` when none is listed.
 */
export function counterAction(
  enabled: readonly LegalAction[],
  pending: DealPending,
): Extract<LegalAction, { kind: 'counter_deal' }> | undefined {
  const current = coinsOf(pending.terms);
  const higher = pending.terms.give.coins > 0;
  const better = enabled.flatMap((action) =>
    action.kind === 'counter_deal' &&
    (higher ? action.payload.coins > current : action.payload.coins < current)
      ? [action]
      : [],
  );
  if (better.length === 0) return undefined;
  return better.reduce((best, next) =>
    Math.abs(next.payload.coins - current) < Math.abs(best.payload.coins - current) ? next : best,
  );
}

/** What one side of the deal holds, in words; coins are never numbered (§5.4), only valued by the engine. */
function describe(observation: Observation, pending: DealPending, side: DealSide, mine: boolean) {
  const owner = observation.public.players.find(
    (player) =>
      player.seatIndex === (mine ? observation.own.seatIndex : pending.initiatorSeatIndex),
  );
  const [pokemonId] = side.pokemonInstanceIds;
  if (pokemonId !== undefined) {
    const pokemon = owner?.team.find((entry) => entry.instanceId === pokemonId);
    if (!pokemon) throw new RangeError('A deal names a Pokémon its owner does not hold');
    return `a Pokémon: ${formText(pokemon.speciesId).name}${pokemon.tired ? ' (Tired)' : ''}`;
  }
  const [itemId] = side.itemInstanceIds;
  if (itemId !== undefined) {
    // The item the proposer offers is shown to this seat inside the pending record; its own is its own.
    const item = mine
      ? observation.own.items.find((entry) => entry.instanceId === itemId)
      : pending.revealedItem;
    if (!item) throw new RangeError('A deal names an item the seat cannot see');
    const { name, effect } = itemText(item.itemId, item.name);
    return `an item: ${name}${effect ? ` (${effect})` : ''}`;
  }
  return 'coins';
}

/**
 * Spec §5.3 Deal response: one Choice `accept` / `reject` / `counter` for the AI answering a Deal Card, asked only
 * when the concession is within budget. When the engine lists no `accept` (over the concession budget, the AI's
 * quota spent, or terms that are no longer legal) code rejects and Jev is not asked, even if a cheaper counter is
 * still listed. One listed answer is applied without a question (§3.1). `counter` is offered only when the engine
 * lists a counter in this seat's favour; code picks the amount (`counterAction`).
 */
export function buildDealQuestion(
  observation: Observation,
  enabledActions: readonly LegalAction[],
  facts: DealFacts,
  personality: Personality,
): Decision<ReturnType<typeof personalState<{ deal: DealState }>>> {
  const pending = pendingDeal(observation);
  if (!pending) throw new RangeError('No Deal Card is waiting for this seat');
  const reject = enabledActions.find((action) => answerOf(action) === 'reject');
  const accept = enabledActions.find((action) => answerOf(action) === 'accept');
  if (!reject) return { kind: 'skip' };
  if (!accept) return { kind: 'autoApply', actionId: reject.id };
  const counter = counterAction(enabledActions, pending);
  const options: Record<string, string> = { accept: accept.id, reject: reject.id };
  const criteria: Record<string, string> = {
    accept: DEAL_CRITERIA.accept,
    reject: DEAL_CRITERIA.reject,
  };
  if (counter) {
    options.counter = counter.id;
    criteria.counter = DEAL_CRITERIA.counter;
  }
  const trust = observation.own.trust?.find(
    (entry) => entry.seatIndex === pending.initiatorSeatIndex,
  );
  const deal: DealState = {
    from_id: actorName(observation, pending.initiatorSeatIndex),
    // `terms.give` is what the proposer hands over, so it is what this seat receives.
    you_give: describe(observation, pending, pending.terms.get, true),
    you_receive: describe(observation, pending, pending.terms.give, false),
    value_you_give: facts.valueGiven,
    value_you_receive: facts.valueReceived,
    concession: facts.concession,
    ...(facts.budgetLeft && { budget_left: facts.budgetLeft }),
    proposer_trust: trustBucket(trust?.value ?? 0),
  };
  return {
    kind: 'ask',
    state: personalState(observation, personality, { deal }),
    questions: { deal: choice(DEAL_INSTRUCTIONS, criteria) },
    options,
  };
}
