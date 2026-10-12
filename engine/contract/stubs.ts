import { positionOf } from './position.ts';
import { actionSchema } from './schema.ts';
import { d6, shuffle, RNG_VERSION } from '../rng.ts';
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
    },
  });
}

/** Minimal fixture-facing choices; this scaffold does not execute game rules. */
export function legalActions(state: GameState, seatIndex: number): LegalActions {
  const player = state.players.find((candidate) => candidate.seatIndex === seatIndex);
  if (!player) throw new RangeError('Unknown seat index');
  const result: LegalActions = { enabled: [], disabled: [] };
  if (seatIndex !== state.activeSeatIndex) {
    result.disabled.push({
      id: 'skip',
      kind: 'skip',
      payload: {},
      reasonCode: 'NOT_YOUR_TURN',
      reasonText: 'Not your turn',
    });
    return result;
  }
  if (state.phase.kind === 'strategy') {
    for (const item of player.items) {
      result.enabled.push({
        id: `use-item:${item.instanceId}`,
        kind: 'use_item',
        payload: { itemInstanceId: item.instanceId },
      });
    }
    result.enabled.push({ id: 'skip', kind: 'skip', payload: {} });
  }
  if (state.phase.kind === 'move') {
    result.enabled.push({ id: 'roll', kind: 'roll', payload: {} });
  }
  if (state.phase.kind === 'encounter') {
    for (const ballType of ['poke', 'great', 'ultra'] as const) {
      const action: LegalAction = { id: `catch:${ballType}`, kind: 'catch', payload: { ballType } };
      if (player.balls[ballType] === 0) {
        result.disabled.push({ ...action, reasonCode: 'NO_BALL', reasonText: 'No Ball' });
      } else {
        result.enabled.push(action);
      }
    }
    result.enabled.push({ id: 'release', kind: 'release', payload: {} });
  }
  if (state.phase.kind === 'sell') {
    for (const pokemon of player.team) {
      result.enabled.push({
        id: `sell:${pokemon.instanceId}`,
        kind: 'sell',
        payload: { pokemonInstanceIds: [pokemon.instanceId] },
      });
    }
    result.enabled.push({ id: 'finish-sell', kind: 'finish_sell', payload: {} });
  }
  if (state.phase.kind === 'shop') {
    for (const offer of state.phase.offers) {
      const action: LegalAction = {
        id: `buy:${offer.id}`,
        kind: 'buy',
        payload: { offerId: offer.id },
      };
      if (player.coins < offer.price) {
        result.disabled.push({
          ...action,
          reasonCode: 'NOT_ENOUGH_COINS',
          reasonText: 'Not enough coins',
        });
      } else {
        result.enabled.push(action);
      }
    }
    result.enabled.push({ id: 'skip', kind: 'skip', payload: {} });
  }
  return result;
}

/** Immutable command plumbing; gameplay effects are deferred to later rule issues. */
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
  if (action.actorId === 'engine' && action.kind === 'dice_result') {
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
    return {
      accepted: true,
      state: next,
      events: draw.events,
      record: { action, events: structuredClone(draw.events) },
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
  const actor = state.config.seats.find((seat) => seat.seatIndex === state.activeSeatIndex);
  if (!actor || action.actorId !== actor.actorId) {
    return { rejected: true, reason: 'wrong_actor', state };
  }
  if (
    !legalActions(state, state.activeSeatIndex).enabled.some(
      (choice) =>
        choice.kind === action.kind &&
        JSON.stringify(choice.payload) === JSON.stringify(action.payload),
    )
  ) {
    return { rejected: true, reason: 'illegal_action', state };
  }
  const next = structuredClone(state);
  next.stateRevision = action.actionSeq;
  return { accepted: true, state: next, events: [], record: { action, events: [] } };
}
