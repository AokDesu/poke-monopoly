import type { Questions } from '@typesafe-ai/sdk';
import type { LegalAction, Observation } from '../../engine/index.ts';
import {
  assertNoComparableNumbers,
  assertStateTokenBudget,
  buildJevState,
} from '../state/index.ts';
import type { Personality } from './shortlist.ts';

/** A built question. `options` maps each criteria label back to its engine action ID. */
export interface AskDecision<State extends object> {
  kind: 'ask';
  state: State;
  questions: Questions;
  options: Readonly<Record<string, string>>;
}

/**
 * Spec §3.1: one legal action is applied without calling Jev; with none (which cannot happen in
 * play) the decision is skipped.
 */
export type Decision<State extends object> =
  { kind: 'skip' } | { kind: 'autoApply'; actionId: string } | AskDecision<State>;

export function withoutQuestion(enabled: readonly LegalAction[]) {
  if (enabled.length === 0) return { kind: 'skip' } as const;
  if (enabled.length === 1) return { kind: 'autoApply', actionId: enabled[0]!.id } as const;
  return undefined;
}

/** The engine action ID behind a criteria label; `undefined` for a label the question did not offer. */
export function actionIdFor(decision: Decision<object>, optionId: string): string | undefined {
  if (decision.kind !== 'ask' || !Object.hasOwn(decision.options, optionId)) return undefined;
  return decision.options[optionId];
}

/** The role-scoped state with the seat's personality, checked by the §5.4 guards. */
export function personalState<Extra extends object>(
  observation: Observation,
  personality: Personality,
  extra: Extra,
) {
  const base = buildJevState(observation);
  const state = {
    ...base,
    you: { ...base.you, personality: `${personality.name}: ${personality.description}` },
    ...extra,
  };
  assertNoComparableNumbers(state);
  assertStateTokenBudget(state);
  return state;
}

/** The seat's id as the state names it, so criteria and `opponents[].id` match. */
export function actorName(observation: Observation, seatIndex: number | undefined): string {
  const player = observation.public.players.find((entry) => entry.seatIndex === seatIndex);
  if (!player) throw new RangeError(`Observation has no player in seat ${seatIndex}`);
  return player.actorId;
}
