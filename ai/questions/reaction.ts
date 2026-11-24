import { choice } from '@typesafe-ai/sdk';
import type { LegalAction, Observation } from '../../engine/index.ts';
import { chanceBucket, type OwnBattle } from '../battle.ts';
import { formText } from './content.ts';
import { actorName, personalState, withoutQuestion, type Decision } from './decision.ts';
import type { Personality } from './shortlist.ts';

export const REACTION_INSTRUCTIONS =
  'An Ability window is open (`window`): you may use one Ability now, or none. Pick the ONE ' +
  'option that best fits `you.personality` right now. Each option says what the Ability does and ' +
  'what it costs; in a battle it also says your chance to win with it and without it, as named ' +
  'buckets (low, medium or high). Using no Ability spends nothing. Only the listed options are ' +
  'allowed.';

/** Which window is open, and who is on the other side of it; names, never numbers (spec §5.4). */
type WindowState = {
  kind: 'pvp_attacker' | 'pvp_defender' | 'gym' | 'pickpocket';
  opponent_id?: string;
  attacker_id?: string;
  your_win_chance?: string;
  their_win_chance?: string;
};

export type ReactionState = ReturnType<typeof personalState<{ window: WindowState }>>;

/**
 * What each Ability effect does, in words and with no numbers (spec §5.4). The effect IDs are the
 * engine's names for them; what they do, and by how much, is the engine's and is never read here.
 */
const EFFECT_WORDS: Readonly<Record<string, string>> = {
  blaze: 'it raises your combat total in this battle',
  quick_slash: 'it raises your combat total in this battle',
  dragon_rush:
    'it raises your combat total in this battle by a lot, but that Pokémon becomes tired after ' +
    'the battle (a tired Pokémon does not count for battles and sells for less)',
  intimidate: "it lowers your rival's combat total in this battle",
  shell_guard: 'it prevents the next coin loss you would suffer in a battle',
  block: 'it prevents the next coin loss you would suffer from a PvP battle or a Pickpocket',
  heal_pulse: 'it removes one status, such as tired, from one of your Pokémon',
};

type Activation = Extract<LegalAction, { kind: 'activate_ability' }>;

function wording(
  observation: Observation,
  action: Activation,
  opponent: string | undefined,
  own: OwnBattle | undefined,
): { label: string; text: string } {
  const you = observation.public.players.find(
    (player) => player.seatIndex === observation.own.seatIndex,
  );
  const source = you?.team.find((entry) => entry.instanceId === action.payload.instanceId);
  if (!source) throw new RangeError(`Action ${action.id} uses an Ability you do not hold`);
  const form = formText(source.speciesId);
  const ability = form.abilityName ?? 'its Ability';
  let effect = form.effect ? EFFECT_WORDS[form.effect] : undefined;
  if (form.effect === 'adaptability') {
    effect =
      action.payload.scope === 'catch'
        ? 'it raises your catch rolls until the end of this turn, and does nothing for this battle'
        : 'it raises your combat total in this battle and in every battle until the end of this turn';
  }
  const target = you?.team.find(
    (entry) => entry.instanceId === action.payload.targetPokemonInstanceId,
  );
  const on = target ? ` on your ${formText(target.speciesId).name}` : '';
  const after = own?.choices[action.id];
  const theirs = opponent ? `${opponent}'s` : 'theirs';
  let chances = '';
  if (after && own) {
    const [winNow, lossNow] = [chanceBucket(own.now.win), chanceBucket(own.now.loss)];
    const [winAfter, lossAfter] = [chanceBucket(after.win), chanceBucket(after.loss)];
    chances =
      winAfter === winNow && lossAfter === lossNow
        ? ' It does not change your chance to win this battle.'
        : ` With it your chance to win is ${winAfter} and ${theirs} is ${lossAfter}; without it ${winNow} and ${lossNow}.`;
  }
  const hostile =
    form.effect === 'intimidate' && opponent ? ` ${opponent} will learn that you used it.` : '';
  return {
    label: `use_${form.effect ?? 'ability'}_${form.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`,
    text:
      `Use ${ability} from your ${form.name}${on}: ${effect ?? 'its effect is as the game defines it'}.` +
      `${chances}${hostile} The Ability is then spent for now.`,
  };
}

/**
 * Spec §4.4, §5.3 "Reaction Ability": one Choice over the Abilities the engine lists for the open
 * window plus `none`, mapped to the engine's `ability:<uid>…` and `pass-window`. A battle window
 * carries the engine's chances with and without each Ability, as buckets; a private Pickpocket
 * reaction has no battle and so no chances.
 */
export function buildReactionQuestion(
  observation: Observation,
  enabled: readonly LegalAction[],
  personality: Personality,
  own: OwnBattle | undefined,
): Decision<ReactionState> {
  const early = withoutQuestion(enabled);
  if (early) return early;
  const { phase } = observation.public;
  const me = observation.own.seatIndex;
  let window: WindowState;
  let opponent: string | undefined;
  if (observation.own.pickpocketReaction) {
    const attacker = actorName(observation, observation.public.activeSeatIndex);
    window = { kind: 'pickpocket', attacker_id: attacker };
  } else if (phase.kind === 'gym') {
    window = { kind: 'gym' };
  } else if (phase.kind === 'pvp') {
    const { attackerSeatIndex, defenderSeatIndex } = phase.battle;
    const attacking = attackerSeatIndex === me;
    opponent = actorName(observation, attacking ? defenderSeatIndex : attackerSeatIndex);
    window = { kind: attacking ? 'pvp_attacker' : 'pvp_defender', opponent_id: opponent };
  } else {
    throw new RangeError('Observation holds no open Ability window for this seat');
  }
  if (window.kind !== 'pickpocket' && !own) {
    throw new RangeError('A battle Ability window needs the engine battle chances');
  }
  if (own && window.kind !== 'pickpocket') {
    window.your_win_chance = chanceBucket(own.now.win);
    window.their_win_chance = chanceBucket(own.now.loss);
  }
  const options: Record<string, string> = {};
  const criteria: Record<string, string> = {};
  for (const action of enabled) {
    if (action.kind === 'skip') {
      options.none = action.id;
      criteria.none =
        window.kind === 'pickpocket'
          ? `Use no Ability. You do not react: ${window.attacker_id}'s Pickpocket goes ahead against you. Nothing is spent.`
          : 'Use no Ability. Nothing is spent and the battle goes ahead as it stands.';
      continue;
    }
    if (action.kind !== 'activate_ability') {
      throw new TypeError(`No Ability window wording for action kind "${action.kind}"`);
    }
    const { label: base, text } = wording(observation, action, opponent, own);
    let label = base;
    for (let n = 2; Object.hasOwn(options, label); n++) label = `${base}_${n}`;
    options[label] = action.id;
    criteria[label] = text;
  }
  if (!options.none) throw new RangeError('An Ability window offers using none');
  return {
    kind: 'ask',
    state: personalState(observation, personality, { window }),
    questions: { ability_window: choice(REACTION_INSTRUCTIONS, criteria) },
    options,
  };
}
