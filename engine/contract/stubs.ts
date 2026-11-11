import { positionOf } from './position.ts';
import { actionSchema } from './schema.ts';
import { d6, shuffle, RNG_VERSION } from '../rng.ts';
import {
  firstPlayerRollPurpose,
  pendingRollPurpose,
  recordFirstPlayerRoll,
  recordMoveRoll,
  recordTurnCommand,
} from '../turns.ts';
import { confirmCatch, recordCatchRoll } from '../catching.ts';
import { confirmShop } from '../shop.ts';
import { itemChoices, useItem } from '../items.ts';
import { ENGINE_VERSION } from '../versions.ts';
import { recordSale, validSale } from '../selling.ts';
import { chatChoices, chatsOf, recordChat, validChat } from '../social.ts';
import { answerPromise, offerPromise, promiseOfferChoices, promisesOf } from '../promises.ts';
import { actingSeatIndex, responseChoices } from '../responses.ts';
import type {
  GameState,
  Observation,
  LegalActions,
  LegalAction,
  ApplyActionResult,
} from './schema.ts';

/** Explicit allowlist: snapshots and logs must never be passed to AI as observations. */
export function observe(state: GameState, seatIndex: number): Observation {
  const ownPlayer = state.players.find((player) => player.seatIndex === seatIndex);
  if (!ownPlayer) throw new RangeError('Unknown seat index');
  return structuredClone({
    public: {
      board: state.content.board,
      players: state.players.map((player) => ({
        actorId: player.actorId,
        seatIndex: player.seatIndex,
        classId: player.classId,
        coins: player.coins,
        position: positionOf(player.routeProgress),
        creditedLap: player.creditedLap,
        ownTurnNo: player.ownTurnNo,
        team: player.team,
        itemCount: player.items.length,
        knownItems: player.items
          .filter((item) => item.visibility === 'public')
          .map((item) => ({ ...item, visibility: 'public' as const })),
        badges: player.badges,
        abilityReady: player.abilityUsedGlobalTurnNo !== state.globalTurnNo,
      })),
      globalTurnNo: state.globalTurnNo,
      stateRevision: state.stateRevision,
      activeSeatIndex: state.activeSeatIndex,
      phase: state.phase,
      lapTarget: state.config.lapTarget,
      finalTableRound: state.finalTableRound,
    },
    own: {
      seatIndex,
      items: ownPlayer.items,
      balls: ownPlayer.balls,
      privateResults: ownPlayer.privateResults,
      // Only conversations this seat is part of; the key exists only when the Social window is on.
      ...(state.config.socialWindow === true && {
        chats: chatsOf(state, seatIndex),
        promises: promisesOf(state, seatIndex),
      }),
      // A question is its two parties' alone (§4.8): a third seat never learns one was asked.
      ...(state.pendingResponse &&
        (state.pendingResponse.initiatorSeatIndex === seatIndex ||
          state.pendingResponse.responderSeatIndex === seatIndex) && {
          pendingResponse: state.pendingResponse,
        }),
    },
  });
}

/** Turn-skeleton choices plus historical fixture-facing choices for later gameplay. */
export function legalActions(state: GameState, seatIndex: number): LegalActions {
  const player = state.players.find((candidate) => candidate.seatIndex === seatIndex);
  if (!player) throw new RangeError('Unknown seat index');
  const result: LegalActions = { enabled: [], disabled: [] };
  // While a response is pending its responder acts and the active seat waits (responding-seat seam).
  if (seatIndex !== actingSeatIndex(state)) {
    result.disabled.push({
      id: 'skip',
      kind: 'skip',
      payload: {},
      reasonCode: 'NOT_YOUR_TURN',
      reasonText: 'Not your turn',
    });
    return result;
  }
  if (state.pendingResponse) {
    responseChoices(state.pendingResponse, seatIndex, result);
    return result;
  }
  if (state.phase.kind === 'first_player_roll' && !state.phase.awaitingResult) {
    result.enabled.push({ id: 'roll', kind: 'roll', payload: {} });
  }
  if (state.phase.kind === 'strategy') {
    if (state.config.engineVersion === ENGINE_VERSION) itemChoices(state, seatIndex, result);
    // Historical fixtures retain their illustrative untargeted item choices.
    for (const item of state.config.engineVersion === ENGINE_VERSION ? [] : player.items) {
      result.enabled.push({
        id: `use-item:${item.instanceId}`,
        kind: 'use_item',
        payload: { itemInstanceId: item.instanceId },
      });
    }
    result.enabled.push({ id: 'skip', kind: 'skip', payload: {} });
  }
  if (state.phase.kind === 'move' && !state.phase.awaitingResult) {
    result.enabled.push({ id: 'roll', kind: 'roll', payload: {} });
  }
  if (
    state.config.engineVersion === ENGINE_VERSION &&
    ['start', 'social', 'resolve', 'end'].includes(state.phase.kind)
  ) {
    result.enabled.push({ id: 'skip', kind: 'skip', payload: {} });
  }
  if (state.phase.kind === 'social') {
    chatChoices(state, seatIndex, result);
    promiseOfferChoices(state, seatIndex, result);
  }
  if (state.phase.kind === 'encounter' && !state.phase.catchRoll) {
    for (const ballType of ['poke', 'great', 'ultra'] as const) {
      const action: LegalAction = { id: `catch:${ballType}`, kind: 'catch', payload: { ballType } };
      if (player.balls[ballType] === 0) {
        result.disabled.push({ ...action, reasonCode: 'NO_BALL', reasonText: 'No Ball' });
      } else if (
        state.config.engineVersion === ENGINE_VERSION &&
        state.turnBudgets.catchAttempt === 0
      ) {
        result.disabled.push({
          ...action,
          reasonCode: 'ALREADY_USED_THIS_TURN',
          reasonText: 'Catch already used this turn',
        });
      } else {
        result.enabled.push(action);
      }
    }
    result.enabled.push({ id: 'release', kind: 'release', payload: {} });
  }
  if (state.phase.kind === 'sell') {
    for (const pokemon of player.team) {
      if (state.config.engineVersion === ENGINE_VERSION && !validSale(state, [pokemon.instanceId]))
        continue;
      result.enabled.push({
        id: `sell:${pokemon.instanceId}`,
        kind: 'sell',
        payload: { pokemonInstanceIds: [pokemon.instanceId] },
      });
    }
    result.enabled.push(
      state.config.engineVersion === ENGINE_VERSION
        ? { id: 'finish-sell', kind: 'sell', payload: { pokemonInstanceIds: [] } }
        : { id: 'finish-sell', kind: 'finish_sell', payload: {} },
    );
  }
  if (state.phase.kind === 'shop') {
    for (const offer of state.phase.offers) {
      const action: LegalAction = {
        id: `buy:${offer.id}`,
        kind: 'buy',
        payload: { offerId: offer.id },
      };
      // Approved §3.1 rule: a full hand disables item offers, never Balls.
      if (offer.kind === 'utility' && player.items.length >= 4) {
        result.disabled.push({ ...action, reasonCode: 'ITEMS_FULL', reasonText: 'Items full' });
      } else if (player.coins < offer.price) {
        result.disabled.push({
          ...action,
          reasonCode: 'NOT_ENOUGH_COINS',
          reasonText: 'Not enough coins',
        });
      } else {
        result.enabled.push(action);
      }
    }
    result.enabled.push(
      state.config.engineVersion === ENGINE_VERSION
        ? { id: 'skip-shop', kind: 'skip_shop', payload: {} }
        : { id: 'skip', kind: 'skip', payload: {} },
    );
  }
  return result;
}

/** Immutable command executor; implemented gameplay scope is documented in docs/engine-contract.md. */
export function applyAction(state: GameState, input: unknown): ApplyActionResult {
  const parsed = actionSchema.safeParse(input);
  if (!parsed.success) return { rejected: true, reason: 'malformed_action', state };
  const action = parsed.data;
  if (action.stateRevisionBefore !== state.stateRevision) {
    return { rejected: true, reason: 'stale_revision', state };
  }
  if (action.actionSeq !== state.stateRevision + 1) {
    return { rejected: true, reason: 'invalid_sequence', state };
  }
  // A finished game accepts nothing more, including engine-generated records.
  if (state.phase.kind === 'finished') return { rejected: true, reason: 'illegal_action', state };
  if (action.actorId === 'engine' && action.kind === 'dice_result') {
    if (
      state.phase.kind === 'first_player_roll' &&
      (!state.phase.awaitingResult || action.payload.purpose !== firstPlayerRollPurpose(state))
    ) {
      return { rejected: true, reason: 'illegal_action', state };
    }
    const pendingPurpose = pendingRollPurpose(state);
    if (
      (action.payload.purpose.startsWith('first-player:') ||
        action.payload.purpose.startsWith('move:') ||
        action.payload.purpose.startsWith('catch:')) &&
      action.payload.purpose !== pendingPurpose
    ) {
      return { rejected: true, reason: 'illegal_action', state };
    }
    if (pendingPurpose && action.payload.purpose !== pendingPurpose) {
      return { rejected: true, reason: 'illegal_action', state };
    }
    if (state.config.rngVersion !== RNG_VERSION) {
      return { rejected: true, reason: 'illegal_action', state };
    }
    const draw = d6(state.rng, action.payload.purpose);
    if (draw.value !== action.payload.value) {
      return { rejected: true, reason: 'illegal_action', state };
    }
    const next = structuredClone(state);
    next.stateRevision = action.actionSeq;
    next.rng = draw.rng;
    const events = [
      ...draw.events,
      ...recordFirstPlayerRoll(next, draw.value),
      ...recordMoveRoll(next, draw.value),
      ...recordCatchRoll(next, draw.value),
    ];
    return {
      accepted: true,
      state: next,
      events,
      record: { action, events: structuredClone(events) },
    };
  }
  if (action.actorId === 'engine' && action.kind === 'shuffle') {
    if (action.payload.deckId !== 'events' || state.config.rngVersion !== RNG_VERSION) {
      return { rejected: true, reason: 'illegal_action', state };
    }
    const draw = shuffle(state.rng, state.eventDeck.drawPile, 'shuffle:events');
    if (JSON.stringify(draw.value) !== JSON.stringify(action.payload.order)) {
      return { rejected: true, reason: 'illegal_action', state };
    }
    const next = structuredClone(state);
    next.stateRevision = action.actionSeq;
    next.rng = { ...draw.rng };
    next.eventDeck.drawPile = draw.value;
    return {
      accepted: true,
      state: next,
      events: draw.events,
      record: { action, events: structuredClone(draw.events) },
    };
  }
  if (action.actorId === 'engine' && action.kind === 'event_draw') {
    if (state.eventDeck.drawPile[0] !== action.payload.eventId) {
      return { rejected: true, reason: 'illegal_action', state };
    }
    const next = structuredClone(state);
    next.stateRevision = action.actionSeq;
    next.eventDeck.drawPile.shift();
    next.eventDeck.discardPile.push(action.payload.eventId);
    return { accepted: true, state: next, events: [], record: { action, events: [] } };
  }
  const acting = actingSeatIndex(state);
  const actor = state.config.seats.find((seat) => seat.seatIndex === acting);
  if (!actor || action.actorId !== actor.actorId) {
    return { rejected: true, reason: 'wrong_actor', state };
  }
  // Batch selection is validated as a whole rather than enumerating a team's power set.
  // Retain #22's finish_sell command as an empty-sale compatibility alias.
  const saleIds =
    state.config.engineVersion === ENGINE_VERSION
      ? action.kind === 'sell'
        ? action.payload.pokemonInstanceIds
        : action.kind === 'finish_sell'
          ? []
          : undefined
      : undefined;
  if (
    !(action.kind === 'chat'
      ? validChat(state, acting, action.payload)
      : saleIds !== undefined
        ? validSale(state, saleIds)
        : legalActions(state, acting).enabled.some(
            (choice) =>
              choice.kind === action.kind &&
              JSON.stringify(choice.payload) === JSON.stringify(action.payload),
          ))
  ) {
    return { rejected: true, reason: 'illegal_action', state };
  }
  const next = structuredClone(state);
  next.stateRevision = action.actionSeq;
  if (next.phase.kind === 'first_player_roll' && action.kind === 'roll') {
    next.phase.awaitingResult = true;
  }
  const events =
    action.kind === 'chat'
      ? recordChat(next, action.payload)
      : action.kind === 'offer_promise'
        ? offerPromise(next, action.payload)
        : action.kind === 'respond'
          ? answerPromise(next, action.payload.answer)
          : saleIds !== undefined
            ? recordSale(next, saleIds)
            : next.config.engineVersion !== ENGINE_VERSION
              ? recordTurnCommand(next, action.kind)
              : next.phase.kind === 'encounter'
                ? confirmCatch(next, action)
                : next.phase.kind === 'shop'
                  ? confirmShop(next, action)
                  : action.kind === 'use_item'
                    ? useItem(next, action)
                    : recordTurnCommand(next, action.kind);
  return {
    accepted: true,
    state: next,
    events,
    record: { action, events: structuredClone(events) },
  };
}
