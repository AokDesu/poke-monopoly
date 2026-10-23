import greedy from '../../content/personalities/greedy.json';
import { parsePersonality } from '../../content/personality-schema.ts';

export * from './policy.ts';

/** Every `content/personalities/<id>.json`, validated (spec §5.5). Cycle 4 adds the other three. */
export const PERSONALITIES = Object.freeze({ greedy: parsePersonality('greedy', greedy) });
