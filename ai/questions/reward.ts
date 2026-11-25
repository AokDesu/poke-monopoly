import { choice } from '@typesafe-ai/sdk';
import type { LegalAction, Observation } from '../../engine/index.ts';
import { formText } from './content.ts';
import { personalState, withoutQuestion, type Decision } from './decision.ts';
import type { Personality } from './shortlist.ts';

export const REWARD_INSTRUCTIONS =
  'You won a battle and now choose its reward (`reward`): coins, or evolving one of your ' +
  'Pokémon by one stage. Pick the ONE option that best fits `you.personality` right now. ' +
  'Weigh how much you need coins now against a stronger, more valuable team later. Only the ' +
  'listed options are allowed.';

export type RewardState = ReturnType<
  typeof personalState<{ reward: { source: 'pvp' | 'gym'; loser_id?: string } }>
>;

/** A label for each evolution option, unique among them: `evolve_eevee_to_vaporeon`. */
function evolveLabel(from: string, to: string, taken: ReadonlySet<string>): string {
  const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
  const base = `evolve_${slug(from)}_to_${slug(to)}`;
  let label = base;
  for (let n = 2; taken.has(label); n++) label = `${base}_${n}`;
  return label;
}

/**
 * Spec §4.4, §5.3 "Battle / Gym reward": one Choice over `coins` and one `evolve_<from>_to_<to>`
 * for each eligible Pokémon and branch, mapped to the engine's `reward:coins` and
 * `reward:evolve:<uid>:<form>`. The wording gives the reward's effect and never an amount (§5.4).
 */
export function buildRewardQuestion(
  observation: Observation,
  enabled: readonly LegalAction[],
  personality: Personality,
): Decision<RewardState> {
  const early = withoutQuestion(enabled);
  if (early) return early;
  const { phase } = observation.public;
  if ((phase.kind !== 'pvp' && phase.kind !== 'gym') || phase.battle.step !== 'reward') {
    throw new RangeError('Observation holds no battle reward for this seat');
  }
  const { source } = phase.battle.request;
  const loser = source.kind === 'pvp' ? source.loserId : undefined;
  const you = observation.public.players.find(
    (player) => player.seatIndex === observation.own.seatIndex,
  );
  const options: Record<string, string> = {};
  const criteria: Record<string, string> = {};
  for (const action of enabled) {
    if (action.kind !== 'choose_reward') {
      throw new TypeError(`No reward wording for action kind "${action.kind}"`);
    }
    if (action.payload.kind === 'coins') {
      options.coins = action.id;
      criteria.coins =
        source.kind === 'pvp'
          ? `Take coins. You take coins from ${loser}, up to a fixed share of what they hold; ` +
            'nothing changes for your Pokémon. You get nothing if they have none to lose.'
          : 'Take coins. The bank pays you a fixed sum of coins; nothing changes for your Pokémon.';
      continue;
    }
    const { instanceId, nextFormId } = action.payload;
    const pokemon = you?.team.find((entry) => entry.instanceId === instanceId);
    if (!pokemon) throw new RangeError(`Reward ${action.id} evolves a Pokémon you do not hold`);
    const from = formText(pokemon.speciesId).name;
    const to = formText(nextFormId).name;
    const label = evolveLabel(from, to, new Set(Object.keys(options)));
    options[label] = action.id;
    criteria[label] =
      `Evolve your ${from} into ${to}. That Pokémon moves up one stage: it fights harder in ` +
      `battle and is worth more when sold. ${
        source.kind === 'pvp' ? `${loser} then pays you nothing. ` : 'You take no coins. '
      }It happens at once and cannot be undone.`;
  }
  if (!options.coins) throw new RangeError('A battle reward offers coins');
  return {
    kind: 'ask',
    state: personalState(observation, personality, {
      reward: {
        source: source.kind,
        ...(loser !== undefined && { loser_id: loser }),
      },
    }),
    questions: { reward: choice(REWARD_INSTRUCTIONS, criteria) },
    options,
  };
}
