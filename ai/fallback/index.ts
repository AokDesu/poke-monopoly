import aggressive from '../../content/personalities/aggressive.json';
import cautious from '../../content/personalities/cautious.json';
import greedy from '../../content/personalities/greedy.json';
import opportunist from '../../content/personalities/opportunist.json';
import { parsePersonality } from '../../content/personality-schema.ts';

export * from './policy.ts';
export * from './battle-facts.ts';

/** Every `content/personalities/<id>.json`, validated (spec §5.5). */
export const PERSONALITIES = Object.freeze({
  aggressive: parsePersonality('aggressive', aggressive),
  cautious: parsePersonality('cautious', cautious),
  greedy: parsePersonality('greedy', greedy),
  opportunist: parsePersonality('opportunist', opportunist),
});
