import type {
  DealTerms,
  EngineEvent,
  GameState,
  ItemInstance,
  LegalAction,
  LegalActions,
  PendingResponse,
  Player,
  ProposeDealPayload,
} from './contract/schema.ts';
import { concessionWithinBudget, dealValuation } from './deal-facts.ts';
import { hideFromBystanders, socialOpen } from './social.ts';

/**
 * Deal Cards (§4.8): the human offers one Pokémon or one revealed item for coins, or asks for one, to an AI seat.
 * The AI answers accept, reject or counter (once); the human confirms or cancels; only a confirm commits, and a
 * commit moves everything or nothing. The question lives beside the Social phase as a `pendingResponse` owned by
 * the seat that owes the next command (as for a promise), and the turn's one social interaction is spent when the
 * exchange ends, never the tactical action (§4.2). Values are computed in `deal-facts.ts`: this file only checks
 * the AI's concession budget at the answer and the confirm, and charges it on commit.
 */

/** The reasons a deal is not legal, for the legality check below and the tests that name each. */
export type DealProblem =
  | 'format'
  | 'duplicate'
  | 'not_held'
  | 'secret_item'
  | 'not_tradeable'
  | 'last_pokemon'
  | 'not_enough_coins'
  | 'items_full'
  | 'quota'
  | 'budget';

/** Coin amounts offered as ready-made proposals; `propose_deal` itself accepts any amount that is legal. */
export const DEAL_COIN_LADDER = [1, 2, 5] as const;

type DealPending = Extract<PendingResponse, { kind: 'deal' }>;

const player = (state: GameState, seatIndex: number): Player | undefined =>
  state.players.find((entry) => entry.seatIndex === seatIndex);

const emptySide = () => ({ coins: 0, pokemonInstanceIds: [], itemInstanceIds: [] });

function assetCount(terms: DealTerms): number {
  return ['give', 'get'].reduce((total, key) => {
    const side = terms[key as 'give' | 'get'];
    return total + side.pokemonInstanceIds.length + side.itemInstanceIds.length;
  }, 0);
}

/**
 * Whether the proposer's quota is spent: one successful deal per Lap per player, counting both sides (§4.8). A
 * player's Lap is its own `creditedLap`, as for the Rival force (§4.4).
 */
function quotaSpent(who: Player): boolean {
  return who.dealUsedLap === who.creditedLap;
}

/**
 * Why `terms` is not a legal deal between `initiator` (who gives `give` and gets `get`) and `target`, or `null`.
 * `targetQuota` is false when the offer is being made: whether the target already dealt this Lap, and whether the
 * deal is within its concession budget (§4.8), are the target's own and not public, so neither is asked then; both
 * are checked when the target answers and again when the human confirms.
 */
export function dealProblem(
  state: GameState,
  initiatorSeatIndex: number,
  targetSeatIndex: number,
  terms: DealTerms,
  { targetQuota }: { targetQuota: boolean },
): DealProblem | null {
  const initiator = player(state, initiatorSeatIndex);
  const target = player(state, targetSeatIndex);
  if (!initiator || !target || initiator === target) return 'format';
  // Formats (§4.8, §10): one Pokémon or one item against coins, the coins on the other side. Pokémon ↔ Pokémon is cut.
  if (assetCount(terms) !== 1) return 'format';
  const assetSide = terms.give.pokemonInstanceIds.length + terms.give.itemInstanceIds.length > 0;
  const asset = assetSide ? terms.give : terms.get;
  const coinSide = assetSide ? terms.get : terms.give;
  if (asset.coins !== 0 || coinSide.coins < 1) return 'format';
  if (coinSide.pokemonInstanceIds.length + coinSide.itemInstanceIds.length > 0) return 'format';
  const ids = [...asset.pokemonInstanceIds, ...asset.itemInstanceIds];
  if (new Set(ids).size !== ids.length) return 'duplicate';

  const giver = assetSide ? initiator : target;
  const receiver = assetSide ? target : initiator;
  const payer = receiver;
  for (const instanceId of asset.pokemonInstanceIds) {
    const pokemon = giver.team.find((entry) => entry.instanceId === instanceId);
    if (!pokemon) return 'not_held';
    // A Rescue Starter is untradeable (§4.5); historical instances without the field are tradeable.
    if (pokemon.tradeable === false || pokemon.origin === 'rescue_starter') return 'not_tradeable';
    // The giver keeps a Pokémon: an empty team has no rescue outside the Sell Phase (§4.5).
    if (giver.team.length < 2) return 'last_pokemon';
  }
  for (const instanceId of asset.itemInstanceIds) {
    const item = giver.items.find((entry) => entry.instanceId === instanceId);
    if (!item) return 'not_held';
    // The AI's secret items are never requestable: asking would reveal whether it holds one (§4.8).
    if (giver === target && item.visibility !== 'public') return 'secret_item';
    if (receiver.items.length + 1 > 4) return 'items_full';
  }
  if (payer.coins < coinSide.coins) return 'not_enough_coins';
  if (quotaSpent(initiator) || (targetQuota && quotaSpent(target))) return 'quota';
  // The target's concession must fit its budget (§4.8): over budget, only a reject is legal.
  if (targetQuota) {
    const { concession } = dealValuation(state, initiatorSeatIndex, targetSeatIndex, terms);
    if (!concessionWithinBudget(state, target, concession)) return 'budget';
  }
  return null;
}

/** The proposer's Pokémon or item named in the terms, if it is an item, as it would be shown to the pair. */
function revealedItem(
  state: GameState,
  initiatorSeatIndex: number,
  targetSeatIndex: number,
  terms: DealTerms,
): ItemInstance | undefined {
  const holders = [player(state, initiatorSeatIndex), player(state, targetSeatIndex)];
  const itemId = [...terms.give.itemInstanceIds, ...terms.get.itemInstanceIds][0];
  if (itemId === undefined) return undefined;
  return holders
    .flatMap((holder) => holder?.items ?? [])
    .find((item) => item.instanceId === itemId);
}

/** The payload's terms as stored, copied so the record never shares arrays with the action. */
function normalizedTerms(payload: ProposeDealPayload): DealTerms {
  const side = (one: ProposeDealPayload['give']) => ({
    coins: one.coins,
    pokemonInstanceIds: [...one.pokemonInstanceIds],
    itemInstanceIds: [...one.itemInstanceIds],
  });
  return { give: side(payload.give), get: side(payload.get) };
}

/** Whether the active human may offer this Deal Card now: an AI target, an open window, legal terms. */
export function validDealProposal(
  state: GameState,
  seatIndex: number,
  payload: ProposeDealPayload,
): boolean {
  if (!socialOpen(state, seatIndex)) return false;
  const target = state.config.seats.find((seat) => seat.seatIndex === payload.targetSeatIndex);
  if (!target || target.controller !== 'ai' || target.seatIndex === seatIndex) return false;
  return (
    dealProblem(state, seatIndex, payload.targetSeatIndex, normalizedTerms(payload), {
      targetQuota: false,
    }) === null
  );
}

function proposal(
  targetSeatIndex: number,
  terms: DealTerms,
  describe: string,
  coins: number,
): LegalAction {
  return {
    id: `deal:seat-${targetSeatIndex}:${describe}:coins-${coins}`,
    kind: 'propose_deal',
    payload: { targetSeatIndex, give: terms.give, get: terms.get },
  };
}

/**
 * The ready-made proposals the active human is offered: for each AI seat, each Pokémon of its own to sell and
 * each item of its own to reveal, and each Pokémon or **public** item of the AI to buy, at a few coin amounts.
 * A secret item of the AI is never listed, and nothing depends on what the AI holds beyond its public team,
 * public items, item count and coins (§4.8 hidden items). Any other legal amount is also accepted.
 */
export function dealProposalChoices(state: GameState, seatIndex: number, result: LegalActions) {
  if (!socialOpen(state, seatIndex)) return;
  const me = player(state, seatIndex)!;
  for (const seat of state.config.seats) {
    if (seat.seatIndex === seatIndex || seat.controller !== 'ai') continue;
    const them = player(state, seat.seatIndex)!;
    const offers: {
      describe: string;
      side: 'give' | 'get';
      kind: 'pokemon' | 'item';
      id: string;
    }[] = [
      ...me.team.map((pokemon) => ({
        describe: `give:pokemon:${pokemon.instanceId}`,
        side: 'give' as const,
        kind: 'pokemon' as const,
        id: pokemon.instanceId,
      })),
      ...me.items.map((item) => ({
        describe: `give:item:${item.instanceId}`,
        side: 'give' as const,
        kind: 'item' as const,
        id: item.instanceId,
      })),
      ...them.team.map((pokemon) => ({
        describe: `get:pokemon:${pokemon.instanceId}`,
        side: 'get' as const,
        kind: 'pokemon' as const,
        id: pokemon.instanceId,
      })),
      ...them.items
        .filter((item) => item.visibility === 'public')
        .map((item) => ({
          describe: `get:item:${item.instanceId}`,
          side: 'get' as const,
          kind: 'item' as const,
          id: item.instanceId,
        })),
    ];
    for (const offer of offers) {
      for (const coins of DEAL_COIN_LADDER) {
        const asset = {
          coins: 0,
          pokemonInstanceIds: offer.kind === 'pokemon' ? [offer.id] : [],
          itemInstanceIds: offer.kind === 'item' ? [offer.id] : [],
        };
        const money = { ...emptySide(), coins };
        const terms: DealTerms =
          offer.side === 'give' ? { give: asset, get: money } : { give: money, get: asset };
        const action = proposal(seat.seatIndex, terms, offer.describe, coins);
        if (dealProblem(state, seatIndex, seat.seatIndex, terms, { targetQuota: false }) === null) {
          result.enabled.push(action);
        }
      }
    }
  }
}

/** The terms with the coin side set to `coins`: a counter keeps the asset and its direction. */
function withCoins(terms: DealTerms, coins: number): DealTerms {
  const coinSide = terms.give.coins > 0 ? 'give' : 'get';
  return { ...terms, [coinSide]: { ...terms[coinSide], coins } };
}

function currentCoins(terms: DealTerms): number {
  return terms.give.coins > 0 ? terms.give.coins : terms.get.coins;
}

/**
 * The pending question's choices for its responder (§4.8): the target answers accept, reject or counter once;
 * the proposer then confirms or cancels. Over a spent quota or any change that made the terms illegal, the
 * target's only answer is reject, which looks like any other refusal to the proposer.
 */
export function dealResponseChoices(
  state: GameState,
  pending: PendingResponse,
  result: LegalActions,
): void {
  if (pending.kind !== 'deal') return;
  const legal =
    dealProblem(state, pending.initiatorSeatIndex, pending.targetSeatIndex, pending.terms, {
      targetQuota: true,
    }) === null;
  if (pending.stage === 'proposed') {
    if (legal) {
      result.enabled.push({
        id: 'respond-deal:accept',
        kind: 'respond_deal',
        payload: { answer: 'accept' },
      });
    }
    result.enabled.push({
      id: 'respond-deal:reject',
      kind: 'respond_deal',
      payload: { answer: 'reject' },
    });
    if (pending.counterDepth < 1) {
      const payer = player(
        state,
        pending.terms.give.coins > 0 ? pending.initiatorSeatIndex : pending.targetSeatIndex,
      )!;
      for (let coins = 1; coins <= payer.coins; coins++) {
        if (coins === currentCoins(pending.terms)) continue;
        const countered = withCoins(pending.terms, coins);
        if (
          dealProblem(state, pending.initiatorSeatIndex, pending.targetSeatIndex, countered, {
            targetQuota: true,
          }) === null
        ) {
          result.enabled.push({
            id: `counter-deal:coins-${coins}`,
            kind: 'counter_deal',
            payload: { coins },
          });
        }
      }
    }
    return;
  }
  // The proposer's turn to settle it: confirm commits what both have seen, cancel walks away.
  if (legal) result.enabled.push({ id: 'confirm-deal', kind: 'confirm_deal', payload: {} });
  result.enabled.push({ id: 'cancel-deal', kind: 'cancel_deal', payload: {} });
}

function pendingDeal(next: GameState): DealPending {
  const pending = next.pendingResponse;
  if (pending?.kind !== 'deal') throw new RangeError('No Deal Card is pending');
  return pending;
}

function record(next: GameState, seatA: number, seatB: number) {
  hideFromBystanders(next, seatA, seatB);
  next.dealRecords = (next.dealRecords ?? 0) + 1;
}

/** Ends the exchange: it spends the turn's social interaction and clears the question (never the tactical action). */
function close(next: GameState): void {
  delete next.pendingResponse;
  next.turnBudgets.socialInteraction = (next.turnBudgets.socialInteraction ?? 0) - 1;
}

/** Opens the question. Nothing moves; the exchange's end spends the interaction. */
export function proposeDeal(next: GameState, payload: ProposeDealPayload): EngineEvent[] {
  const initiatorSeatIndex = next.activeSeatIndex;
  const terms = normalizedTerms(payload);
  const item = revealedItem(next, initiatorSeatIndex, payload.targetSeatIndex, terms);
  next.pendingResponse = {
    kind: 'deal',
    stage: 'proposed',
    initiatorSeatIndex,
    responderSeatIndex: payload.targetSeatIndex,
    targetSeatIndex: payload.targetSeatIndex,
    terms,
    ...(item && { revealedItem: structuredClone(item) }),
    counterDepth: 0,
  };
  record(next, initiatorSeatIndex, payload.targetSeatIndex);
  return [
    {
      kind: 'deal_proposed',
      initiatorSeatIndex,
      targetSeatIndex: payload.targetSeatIndex,
      terms: structuredClone(terms),
      ...(item && { revealedItem: structuredClone(item) }),
    },
  ];
}

/** The target's accept or reject. Accepting hands the question to the proposer; rejecting ends it. */
export function respondDeal(next: GameState, answer: 'accept' | 'reject'): EngineEvent[] {
  const pending = pendingDeal(next);
  const { initiatorSeatIndex, targetSeatIndex } = pending;
  record(next, initiatorSeatIndex, targetSeatIndex);
  if (answer === 'reject') {
    close(next);
    return [{ kind: 'deal_rejected', initiatorSeatIndex, targetSeatIndex }];
  }
  pending.stage = 'accepted';
  pending.responderSeatIndex = initiatorSeatIndex;
  return [{ kind: 'deal_accepted', initiatorSeatIndex, targetSeatIndex }];
}

/** The target's one counter: same asset and direction, a new coin amount; the proposer then decides. */
export function counterDeal(next: GameState, coins: number): EngineEvent[] {
  const pending = pendingDeal(next);
  const { initiatorSeatIndex, targetSeatIndex } = pending;
  pending.terms = withCoins(pending.terms, coins);
  pending.stage = 'countered';
  pending.counterDepth = 1;
  pending.responderSeatIndex = initiatorSeatIndex;
  record(next, initiatorSeatIndex, targetSeatIndex);
  return [
    {
      kind: 'deal_countered',
      initiatorSeatIndex,
      targetSeatIndex,
      terms: structuredClone(pending.terms),
    },
  ];
}

/** The proposer walks away. Nothing moves, and the interaction is spent. */
export function cancelDeal(next: GameState): EngineEvent[] {
  const { initiatorSeatIndex, targetSeatIndex } = pendingDeal(next);
  record(next, initiatorSeatIndex, targetSeatIndex);
  close(next);
  return [{ kind: 'deal_cancelled', initiatorSeatIndex, targetSeatIndex }];
}

/**
 * Remaining Tired turns are the pair's own: a Tired Pokémon expires at the end of its owner's next turn (§4.4),
 * so it keeps as many of its new owner's turns as it had left with the old one.
 */
function rebaseTired(pokemon: ItemInstance | Player['team'][number], from: Player, to: Player) {
  if (!('tired' in pokemon) || pokemon.tiredExpiresOwnTurnNo === undefined) return;
  pokemon.tiredExpiresOwnTurnNo =
    to.ownTurnNo + Math.max(1, pokemon.tiredExpiresOwnTurnNo - from.ownTurnNo);
}

/**
 * The proposer's confirm: re-checks every rule against the current state, then moves the asset and the coins
 * in this one action. The executor has already refused a confirm whose re-check fails (state unchanged), so a
 * failure here is a bug, and it throws before any transfer, never half of one.
 */
export function confirmDeal(next: GameState): EngineEvent[] {
  const pending = pendingDeal(next);
  const { initiatorSeatIndex, targetSeatIndex, terms } = pending;
  if (
    dealProblem(next, initiatorSeatIndex, targetSeatIndex, terms, { targetQuota: true }) !== null
  ) {
    throw new RangeError('The Deal Card is no longer legal');
  }
  // Valued before the asset moves: it is read from the giver's holdings.
  const { concession } = dealValuation(next, initiatorSeatIndex, targetSeatIndex, terms);
  const initiator = player(next, initiatorSeatIndex)!;
  const target = player(next, targetSeatIndex)!;
  const assetSide = terms.give.pokemonInstanceIds.length + terms.give.itemInstanceIds.length > 0;
  const [giver, receiver] = assetSide ? [initiator, target] : [target, initiator];
  const asset = assetSide ? terms.give : terms.get;
  const coins = assetSide ? terms.get.coins : terms.give.coins;
  for (const instanceId of asset.pokemonInstanceIds) {
    const index = giver.team.findIndex((entry) => entry.instanceId === instanceId);
    const [pokemon] = giver.team.splice(index, 1);
    rebaseTired(pokemon!, giver, receiver);
    receiver.team.push(pokemon!);
  }
  for (const instanceId of asset.itemInstanceIds) {
    const index = giver.items.findIndex((entry) => entry.instanceId === instanceId);
    receiver.items.push(...giver.items.splice(index, 1));
  }
  // The receiver pays: the one coin side is its alone.
  receiver.coins -= coins;
  giver.coins += coins;
  // The AI's concession is charged to its budget here and nowhere else (§4.8): a reject or a cancel costs nothing.
  if (concession > 0) target.dealConcessionSpent = (target.dealConcessionSpent ?? 0) + concession;
  initiator.dealUsedLap = initiator.creditedLap;
  target.dealUsedLap = target.creditedLap;
  const item = pending.revealedItem;
  record(next, initiatorSeatIndex, targetSeatIndex);
  close(next);
  return [
    {
      kind: 'coin_transfer',
      source: { kind: 'player', actorId: receiver.actorId },
      destination: { kind: 'player', actorId: giver.actorId },
      amount: coins,
      reason: 'deal',
    },
    {
      kind: 'deal_committed',
      initiatorSeatIndex,
      targetSeatIndex,
      terms: structuredClone(terms),
      ...(item && { revealedItem: structuredClone(item) }),
    },
  ];
}
