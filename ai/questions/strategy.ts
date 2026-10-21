import { choice } from '@typesafe-ai/sdk';
import type { LegalAction, Observation } from '../../engine/index.ts';
import { itemText } from './content.ts';
import { actorName, personalState, withoutQuestion, type Decision } from './decision.ts';
import { shortlistActions, type Personality } from './shortlist.ts';

export const STRATEGY_INSTRUCTIONS =
  'Pick the ONE action that best fits `you.personality` right now. Only the listed actions are ' +
  'allowed. Each option states its effect and what is unknown when you choose it.';

export type StrategyState = ReturnType<typeof personalState<Record<never, never>>>;

const HOSTILE_ITEM_IDS = ['repel', 'pickpocket'];

/** What `you` cannot know about a hostile item's target (spec §4.6: secret items stay secret). */
function shieldSentence(observation: Observation, seatIndex: number): string {
  const target = observation.public.players.find((player) => player.seatIndex === seatIndex)!;
  const name = target.actorId;
  if (target.knownItems.some((item) => item.itemId === 'price-shield')) {
    return `${name} openly holds a Price Shield.`;
  }
  if (target.itemCount > target.knownItems.length) {
    return `${name} holds secret items; whether one of them is a Price Shield is unknown.`;
  }
  return `${name} holds no secret items.`;
}

function itemCriteria(
  action: Extract<LegalAction, { kind: 'use_item' }>,
  observation: Observation,
) {
  const owned = observation.own.items.find(
    (item) => item.instanceId === action.payload.itemInstanceId,
  );
  if (!owned) throw new RangeError(`Action ${action.id} uses an item you do not hold`);
  const { name, effect } = itemText(owned.itemId, owned.name);
  const what = effect ? ` ${name} effect: ${effect}.` : '';
  const spends = ' This uses up the item and your tactical action for this turn.';
  const target = action.payload.targetSeatIndex;
  if (target === undefined) {
    const unknown =
      owned.itemId === 'lucky-egg'
        ? ' Whether you meet a wild Pokémon this turn is unknown, because your move roll is unknown.'
        : '';
    return `Use your ${name} on yourself.${what}${spends}${unknown}`;
  }
  const targetName = actorName(observation, target);
  const sentences = [`Use your ${name} on ${targetName}, the target.${what}${spends}`];
  if (HOSTILE_ITEM_IDS.includes(owned.itemId)) {
    sentences.push(`${targetName} will learn that you used it on them.`);
    if (owned.itemId === 'repel') {
      sentences.push(`How far ${targetName} would roll on their next move is unknown.`);
    }
    sentences.push(shieldSentence(observation, target));
  }
  return sentences.join(' ');
}

function criteriaFor(action: LegalAction, observation: Observation): string {
  if (action.kind === 'skip') {
    return 'Do nothing this phase and keep all your items. Your tactical action for this turn stays unused.';
  }
  if (action.kind === 'use_item') return itemCriteria(action, observation);
  throw new TypeError(`No Strategy wording for action kind "${action.kind}"`);
}

/**
 * Spec §5.3 Strategy: one Choice over a personality-filtered shortlist of at most 12 legal
 * actions, `skip` included. Options are labelled `a1`, `a2`, … in the engine's order, and `skip`.
 */
export function buildStrategyQuestion(
  observation: Observation,
  enabledActions: readonly LegalAction[],
  personality: Personality,
): Decision<StrategyState> {
  const early = withoutQuestion(enabledActions);
  if (early) return early;
  if (!enabledActions.some((action) => action.kind === 'skip')) {
    throw new RangeError('Strategy actions must include skip');
  }
  const shortlist = shortlistActions(enabledActions, personality, observation);
  if (shortlist.length === 1) return { kind: 'autoApply', actionId: shortlist[0]!.id };
  const options: Record<string, string> = {};
  const criteria: Record<string, string> = {};
  let next = 1;
  for (const action of shortlist) {
    const label = action.kind === 'skip' ? 'skip' : `a${next++}`;
    options[label] = action.id;
    criteria[label] = criteriaFor(action, observation);
  }
  return {
    kind: 'ask',
    state: personalState(observation, personality, {}),
    questions: { strategy: choice(STRATEGY_INSTRUCTIONS, criteria) },
    options,
  };
}
