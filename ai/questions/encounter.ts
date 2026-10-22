import { choice } from '@typesafe-ai/sdk';
import { bucketCount } from '../../engine/index.ts';
import type { BallType, CatchOdds, LegalAction, Observation } from '../../engine/index.ts';
import { itemText, speciesText } from './content.ts';
import { personalState, withoutQuestion, type Decision } from './decision.ts';
import type { Personality } from './shortlist.ts';

/** The engine's odds for the Encounter: `oddsForAllBalls(state, seat)` (spec §4.3). */
export interface EncounterFacts {
  odds: readonly ({ ballType: BallType } & Pick<CatchOdds, 'successFaces'>)[];
}

/**
 * Catch-chance words by how many of the d6's six faces succeed, so every engine result has one
 * word: 0–1 very low, 2 low, 3 even, 4 high, 5–6 very high. Presentation only (spec §5.4).
 */
export const CATCH_CHANCE_BY_SUCCESS_FACES = Object.freeze([
  'very low',
  'very low',
  'low',
  'even',
  'high',
  'very high',
  'very high',
] as const);

export type CatchChance = (typeof CATCH_CHANCE_BY_SUCCESS_FACES)[number];

export function bucketCatchChance(successFaces: number): CatchChance {
  const word = CATCH_CHANCE_BY_SUCCESS_FACES[successFaces];
  if (!Number.isSafeInteger(successFaces) || word === undefined) {
    throw new RangeError('Success faces must be a whole number from 0 to 6');
  }
  return word;
}

/** Ball counts as words: none, one, a few (2–3) or many (4 or more), from the engine's buckets. */
export function ballCountWords(count: number): 'none' | 'one' | 'a few' | 'many' {
  const bucket = bucketCount(count);
  return bucket === 'few' ? 'a few' : bucket;
}

export const ENCOUNTER_INSTRUCTIONS =
  'A wild Pokémon is here (`encounter.pokemon`). Pick the ONE option that best fits ' +
  '`you.personality` right now: throw one of your Balls at it, or release it. Only the listed ' +
  'options are allowed. Catch chance, from worst to best, is very low, low, even, high or very ' +
  'high; "even" means as likely to succeed as to fail, and "very high" includes a certain catch. ' +
  'A throw uses up the Ball whether or not the catch succeeds.';

const LABELS: Record<BallType, string> = {
  poke: 'poke_ball',
  great: 'great_ball',
  ultra: 'ultra_ball',
};
const BALL_ITEM_IDS: Record<BallType, string> = {
  poke: 'poke-ball',
  great: 'great-ball',
  ultra: 'ultra-ball',
};

export type EncounterState = ReturnType<
  typeof personalState<{ encounter: { pokemon: string; rarity: string } }>
>;

/**
 * Spec §5.3 Encounter: one Choice over the Balls the seat can throw plus `release`, labelled
 * `poke_ball`, `great_ball`, `ultra_ball` and `release`. With no Ball, release is the only
 * action and is applied without a question (§3.1).
 */
export function buildEncounterQuestion(
  observation: Observation,
  enabledActions: readonly LegalAction[],
  facts: EncounterFacts,
  personality: Personality,
): Decision<EncounterState> {
  const early = withoutQuestion(enabledActions);
  if (early) return early;
  const { phase } = observation.public;
  if (phase.kind !== 'encounter') throw new RangeError('Observation is not in an Encounter');
  const pokemon = speciesText(phase.pokemon.speciesId);
  const options: Record<string, string> = {};
  const criteria: Record<string, string> = {};
  for (const action of enabledActions) {
    if (action.kind === 'release') {
      options.release = action.id;
      criteria.release =
        `Release the wild ${pokemon.name} without throwing a Ball. You keep all your Balls ` +
        `and do not get the ${pokemon.name}.`;
      continue;
    }
    if (action.kind !== 'catch') {
      throw new TypeError(`No Encounter wording for action kind "${action.kind}"`);
    }
    const { ballType } = action.payload;
    const odds = facts.odds.find((entry) => entry.ballType === ballType);
    if (!odds) throw new RangeError(`No catch odds for ${ballType} Balls`);
    const ball = itemText(BALL_ITEM_IDS[ballType], ballType).name;
    const label = LABELS[ballType];
    options[label] = action.id;
    criteria[label] =
      `Throw one ${ball} at the wild ${pokemon.name}. Catch chance with this Ball: ` +
      `${bucketCatchChance(odds.successFaces)}. ${ball}s you hold now, counting this one: ` +
      `${ballCountWords(observation.own.balls[ballType])}. Whether the catch succeeds is ` +
      'unknown until the die is rolled.';
  }
  if (!options.release) throw new RangeError('Encounter actions must include release');
  return {
    kind: 'ask',
    state: personalState(observation, personality, {
      encounter: { pokemon: pokemon.name, rarity: pokemon.rarity },
    }),
    questions: { encounter: choice(ENCOUNTER_INSTRUCTIONS, criteria) },
    options,
  };
}
