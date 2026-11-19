import {
  legalActions,
  observe,
  type LegalAction,
  type Observation,
} from '../../../engine/index.ts';
import type { GameStore } from '../game/store.ts';

/**
 * Dev gallery adapter (issues #220, #247): what an AI seat's open decision holds, the engine's
 * enabled actions and that seat's own observation, which is what `playOpponent` sends and what the
 * demo panel labels its options from. It lives here, not in the store, because only the gallery
 * needs a rival's private view; the player flow never calls it and the gallery is dropped from
 * production builds (see Root.tsx).
 */
export function seatDecision(
  store: GameStore,
  seatIndex: number,
): { enabledActions: LegalAction[]; observation: Observation } {
  const { state } = store.getSession()!;
  return {
    enabledActions: legalActions(state, seatIndex).enabled,
    observation: observe(state, seatIndex),
  };
}
