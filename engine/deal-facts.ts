import type { Content, DealTerms, GameState, Player } from './contract/schema.ts';
import { itemEffectStatus } from './items.ts';
import { saleBasePrice } from './selling.ts';

/**
 * The numbers behind a Deal Card (§4.8, §5.4), computed here and nowhere else. The AI seat's side of a deal has a
 * value given, a value received and a concession, in one coin-equivalent valuation, and a budget that the concession
 * is charged to on commit. They reach the AI answering as named buckets only, never as numbers to compare.
 */

/** The AI seat's valuation of the terms in front of it, in coins. */
export interface DealValuation {
  /** What the AI seat hands over: coins, or the asset's value. */
  valueGiven: number;
  /** What the AI seat gets: the asset's value, or coins. */
  valueReceived: number;
  /** `max(0, valueGiven − valueReceived)` (§4.8): what the AI seat concedes. */
  concession: number;
}

/** The content's budget and what an AI seat has left of it; `undefined` when the content sets none. */
export interface DealBudgetState {
  perDeal: number;
  perGame: number;
  /** Concession already charged to the seat by committed deals. */
  spent: number;
  /** `perGame − spent`, floored at 0. */
  remaining: number;
  /** The most one deal may concede now: `min(perDeal, remaining)`. */
  room: number;
}

const holds = (side: DealTerms['give']): boolean =>
  side.pokemonInstanceIds.length + side.itemInstanceIds.length > 0;

/**
 * Whether `item` can still be used legally by `holder` (§4.8: an item with no legal use window left is worth 0).
 * A window is gone when the item's effect is only planned (held, but no legal use exists, §4.6), when the game is
 * finished, or when the Final Table Round has been announced and the holder has no turn left: it has played its
 * `targetOwnTurnNo` turns and is not the active seat, whose Strategy phase is still ahead of the Social window.
 * A Potion with no Tired Pokémon on the holder's team has no use either on the holder's last turn. Only the
 * public Tired status counts: a combat debuff is private (§4.1, §5.4), so it never changes a Deal's value.
 */
export function itemUseWindow(state: GameState, holder: Player, itemId: string): boolean {
  const content = state.content.items.find((entry) => entry.id === itemId);
  if (!content || itemEffectStatus(content) === 'planned') return false;
  if (state.phase.kind === 'finished') return false;
  const round = state.finalTableRound;
  if (!round) return true;
  const turnLeft = holder.ownTurnNo < round.targetOwnTurnNo;
  // With no Tired Pokémon on the holder's team, nothing can change that before the Strategy phase still ahead, so
  // a Potion is guaranteed unusable unless a later turn of the holder remains. Tired is the public status; the
  // private combat debuff is deliberately ignored (§4.8).
  if (itemId === 'potion' && !holder.team.some((pokemon) => pokemon.tired)) {
    return turnLeft;
  }
  const strategyAhead =
    state.activeSeatIndex === holder.seatIndex &&
    ['start', 'social', 'strategy'].includes(state.phase.kind);
  return strategyAhead || turnLeft;
}

function itemPrice(content: Content, itemId: string): number {
  return content.items.find((entry) => entry.id === itemId)?.price ?? 0;
}

/**
 * The coin value of the one asset in `terms`: a Pokémon is worth its sale price now (§4.7: sale basis, Tired
 * `round(×0.8)`, no class bonus); an item is worth its content price, or 0 when `receiver` has no use window left.
 */
function assetValue(
  state: GameState,
  giver: Player,
  receiver: Player,
  assetSide: DealTerms['give'],
): number {
  const [pokemonId] = assetSide.pokemonInstanceIds;
  if (pokemonId !== undefined) {
    const pokemon = giver.team.find((entry) => entry.instanceId === pokemonId);
    return pokemon ? saleBasePrice(state.content, pokemon) : 0;
  }
  const [itemId] = assetSide.itemInstanceIds;
  const item = giver.items.find((entry) => entry.instanceId === itemId);
  if (!item || !itemUseWindow(state, receiver, item.itemId)) return 0;
  return itemPrice(state.content, item.itemId);
}

/**
 * The AI seat's valuation of a one-asset-for-coins deal between the proposer and that seat (§4.8). The seat gives
 * the asset when the proposer asks for it (`get`) and gives coins when the proposer offers the asset (`give`).
 */
export function dealValuation(
  state: GameState,
  initiatorSeatIndex: number,
  aiSeatIndex: number,
  terms: DealTerms,
): DealValuation {
  const initiator = state.players.find((entry) => entry.seatIndex === initiatorSeatIndex)!;
  const ai = state.players.find((entry) => entry.seatIndex === aiSeatIndex)!;
  const proposerGivesAsset = holds(terms.give);
  const coins = proposerGivesAsset ? terms.get.coins : terms.give.coins;
  const asset = proposerGivesAsset
    ? assetValue(state, initiator, ai, terms.give)
    : assetValue(state, ai, initiator, terms.get);
  const valueGiven = proposerGivesAsset ? coins : asset;
  const valueReceived = proposerGivesAsset ? asset : coins;
  return { valueGiven, valueReceived, concession: Math.max(0, valueGiven - valueReceived) };
}

/** The AI seat's budget (§4.8), read from content config; `undefined` when the content sets none. */
export function dealBudgetState(state: GameState, ai: Player): DealBudgetState | undefined {
  const budget = state.content.dealBudget;
  if (!budget) return undefined;
  const spent = ai.dealConcessionSpent ?? 0;
  const remaining = Math.max(0, budget.perGame - spent);
  return { ...budget, spent, remaining, room: Math.min(budget.perDeal, remaining) };
}

/** Whether the AI seat could concede this much without passing its per-deal cap or what it has left of the game's. */
export function concessionWithinBudget(state: GameState, ai: Player, concession: number): boolean {
  const budget = dealBudgetState(state, ai);
  return !budget || concession <= budget.room;
}
