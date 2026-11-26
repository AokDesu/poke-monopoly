import type { BattlePreview, Observation } from '../../engine/index.ts';
import type { DecisionFacts } from '../../engine/contract/decision.ts';
import type { BattleChances } from '../../sim/policy.ts';

/**
 * Spec §4.4, §5.3, §5.4: the engine's battle chances as the asked seat reads them. The wire carries
 * them as `battlePreview` gives them, which are the challenger's (the PvP attacker's, the Gym
 * challenger's); the PvP defender's win is the challenger's loss. Choosing a side is the only thing
 * done here: every chance comes from the engine, and the buckets come from its one chance bucket.
 */
export type WireBattleFacts = NonNullable<DecisionFacts['battle']>;

/** The asked seat's own chances, and for each open Ability activation the chances after taking it. */
export interface OwnBattle {
  now: BattleChances;
  /** By engine action ID; empty outside a pre-roll window. */
  choices: Readonly<Record<string, BattleChances>>;
}

/** Whether the asked seat is the PvP defender (the Gym has only a challenger). */
function isDefender(observation: Observation): boolean {
  const { phase } = observation.public;
  return phase.kind === 'pvp' && phase.battle.defenderSeatIndex === observation.own.seatIndex;
}

export function ownBattle(observation: Observation, facts: WireBattleFacts): OwnBattle {
  const side = (chances: BattleChances): BattleChances =>
    isDefender(observation)
      ? { win: chances.loss, tie: chances.tie, loss: chances.win }
      : { win: chances.win, tie: chances.tie, loss: chances.loss };
  return {
    now: side(facts),
    choices: Object.fromEntries((facts.choices ?? []).map((choice) => [choice.id, side(choice)])),
  };
}

/**
 * The wire's battle facts from the engine's own `battlePreview` for the asked seat: its exact odds
 * as probabilities, with the odds after each open Ability activation. A change of shape only.
 */
export function wireBattleFacts(preview: BattlePreview): WireBattleFacts {
  const chances = ({ odds }: Pick<BattlePreview, 'odds'>) => ({
    win: odds.win.probability,
    tie: odds.tie.probability,
    loss: odds.loss.probability,
  });
  return {
    kind: preview.kind,
    ...chances(preview),
    ...(preview.choices.length > 0 && {
      choices: preview.choices.map((choice) => ({ id: choice.id, ...chances(choice) })),
    }),
  };
}
