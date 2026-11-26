import type {
  DealTerms,
  DisabledAction,
  ItemInstance,
  LegalAction,
  LegalActions,
  Observation,
  SeatEvent,
} from '../../../engine/index.ts';
import type { SeatFeedEntry, SeatView } from './store.ts';

/**
 * What the Deal Card screen reads (spec §4.8). Every fact is read from the human seat's own observation,
 * its legal actions or its seat-visible feed. Nothing here decides legality, a price or a willingness:
 * a proposal exists because the engine listed it, and one it will not allow is greyed out with the
 * engine's own reason. Nothing is read about a rival that the seat could not see (no secret item).
 */

export type DealProposal = Extract<LegalAction, { kind: 'propose_deal' }>;
type DisabledDeal = Extract<DisabledAction, { kind: 'propose_deal' }>;
type EventOf<K extends SeatEvent['kind']> = Extract<SeatEvent, { kind: K }>;

/** `sell`: the human hands over the asset for coins; `buy`: the human pays coins for the rival's asset. */
export type DealDirection = 'sell' | 'buy';

export interface DealAsset {
  readonly kind: 'pokemon' | 'item';
  readonly instanceId: string;
}

/** One ready-made proposal as the engine lists it, enabled or greyed out, with its parts read out. */
export interface DealOption {
  readonly id: string;
  readonly rivalSeatIndex: number;
  readonly direction: DealDirection;
  readonly asset: DealAsset;
  readonly coins: number;
  readonly payload: DealProposal['payload'];
  /** The engine's own code and words when it did not list this proposal; absent when it did. */
  readonly reason?: { readonly code: DisabledAction['reasonCode']; readonly text: string };
}

/** The asset and the coins of terms the engine accepted (one asset against coins, §4.8). */
export function readTerms(terms: DealTerms): {
  direction: DealDirection;
  asset: DealAsset;
  coins: number;
} {
  const sells = terms.give.pokemonInstanceIds.length + terms.give.itemInstanceIds.length > 0;
  const side = sells ? terms.give : terms.get;
  const pokemon = side.pokemonInstanceIds[0];
  return {
    direction: sells ? 'sell' : 'buy',
    asset:
      pokemon !== undefined
        ? { kind: 'pokemon', instanceId: pokemon }
        : { kind: 'item', instanceId: side.itemInstanceIds[0] ?? '' },
    coins: (sells ? terms.get : terms.give).coins,
  };
}

const optionOf = (action: DealProposal, reason?: DisabledDeal): DealOption => {
  const { direction, asset, coins } = readTerms(action.payload);
  return {
    id: action.id,
    rivalSeatIndex: action.payload.targetSeatIndex,
    direction,
    asset,
    coins,
    payload: action.payload,
    ...(reason && { reason: { code: reason.reasonCode, text: reason.reasonText } }),
  };
};

/** Every proposal the engine lists now, enabled ones first; a greyed-out one carries the engine's reason. */
export const dealOptions = (legal: LegalActions): DealOption[] => [
  ...legal.enabled
    .filter((action): action is DealProposal => action.kind === 'propose_deal')
    .map((action) => optionOf(action)),
  ...legal.disabled
    .filter((action): action is DisabledDeal => action.kind === 'propose_deal')
    .map((action) => optionOf(action, action)),
];

/** A Deal Card in progress that this seat proposed. Only the two parties ever hold it (engine contract). */
export interface PendingDeal {
  readonly stage: 'proposed' | 'accepted' | 'countered';
  readonly rivalSeatIndex: number;
  readonly terms: DealTerms;
  readonly revealedItem?: ItemInstance;
}

export function pendingDeal(observation: Observation): PendingDeal | null {
  const pending = observation.own.pendingResponse;
  if (pending?.kind !== 'deal' || pending.initiatorSeatIndex !== observation.own.seatIndex) {
    return null;
  }
  return {
    stage: pending.stage,
    rivalSeatIndex: pending.targetSeatIndex,
    terms: pending.terms,
    ...(pending.revealedItem && { revealedItem: pending.revealedItem }),
  };
}

/** Whether these are the terms a Confirm was rendered for: the same asset, direction and coins. */
export const sameTerms = (a: DealTerms, b: DealTerms): boolean =>
  JSON.stringify(
    [a.give, a.get].map((side) => [side.coins, side.pokemonInstanceIds, side.itemInstanceIds]),
  ) ===
  JSON.stringify(
    [b.give, b.get].map((side) => [side.coins, side.pokemonInstanceIds, side.itemInstanceIds]),
  );

/** How this turn's Deal Card ended, from the seat's own feed. Null while none has ended in this window. */
export interface DealOutcome {
  readonly kind: 'declined' | 'cancelled' | 'committed';
  readonly rivalSeatIndex: number;
  /** The terms it ended on: the committed ones, or the last ones put to the rival. */
  readonly terms: DealTerms;
  readonly revealedItem?: ItemInstance;
}

/** The deal events of this turn, newest first. Another turn's deal is never this window's. */
function dealEvents(feed: readonly SeatFeedEntry[], globalTurnNo: number): SeatEvent[] {
  const events: SeatEvent[] = [];
  for (const entry of feed.toReversed()) {
    if (entry.before.globalTurnNo !== globalTurnNo) break;
    events.push(...entry.record.events.toReversed());
  }
  return events.filter((event) => event.kind.startsWith('deal_'));
}

export function dealOutcomeThisTurn(
  feed: readonly SeatFeedEntry[],
  globalTurnNo: number,
): DealOutcome | null {
  const events = dealEvents(feed, globalTurnNo);
  const ended = events.find((event) =>
    ['deal_rejected', 'deal_cancelled', 'deal_committed'].includes(event.kind),
  ) as EventOf<'deal_rejected'> | EventOf<'deal_cancelled'> | EventOf<'deal_committed'> | undefined;
  if (!ended) return null;
  if (ended.kind === 'deal_committed') {
    return {
      kind: 'committed',
      rivalSeatIndex: ended.targetSeatIndex,
      terms: ended.terms,
      ...(ended.revealedItem && { revealedItem: ended.revealedItem }),
    };
  }
  const last = events.find(
    (event): event is EventOf<'deal_countered'> | EventOf<'deal_proposed'> =>
      event.kind === 'deal_countered' || event.kind === 'deal_proposed',
  );
  if (!last) return null;
  return {
    kind: ended.kind === 'deal_rejected' ? 'declined' : 'cancelled',
    rivalSeatIndex: ended.targetSeatIndex,
    terms: last.terms,
    ...(last.kind === 'deal_proposed' && last.revealedItem && { revealedItem: last.revealedItem }),
  };
}

/** The terms first put to the rival this turn, the price a counter is measured against; null if not seen. */
export function dealOfferThisTurn(
  feed: readonly SeatFeedEntry[],
  globalTurnNo: number,
): { terms: DealTerms; revealedItem?: ItemInstance } | null {
  const proposed = dealEvents(feed, globalTurnNo).find(
    (event): event is EventOf<'deal_proposed'> => event.kind === 'deal_proposed',
  );
  return proposed
    ? {
        terms: proposed.terms,
        ...(proposed.revealedItem && { revealedItem: proposed.revealedItem }),
      }
    : null;
}

/** Whether a Deal Card is the human's open question now, or one that ended in this window. */
export const dealCardOpen = (view: Pick<SeatView, 'observation' | 'feed'>): boolean =>
  pendingDeal(view.observation) !== null ||
  dealOutcomeThisTurn(view.feed, view.observation.public.globalTurnNo) !== null;
