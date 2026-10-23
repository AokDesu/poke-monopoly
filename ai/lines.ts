import catchFail from '../content/lines/en/catch_fail.json';
import catchSuccess from '../content/lines/en/catch_success.json';
import fallbackNotice from '../content/lines/en/fallback_notice.json';
import gameStart from '../content/lines/en/game_start.json';
import soldPokemon from '../content/lines/en/sold_pokemon.json';
import { parseLines, type Line } from '../content/lines-schema.ts';
import { int, type RandomResultEvent, type RngState } from '../engine/index.ts';

/** Every `content/lines/en/<situation>.json`, validated (spec §5.7). */
export const LINES = Object.freeze({
  game_start: parseLines('game_start', gameStart),
  catch_success: parseLines('catch_success', catchSuccess),
  catch_fail: parseLines('catch_fail', catchFail),
  sold_pokemon: parseLines('sold_pokemon', soldPokemon),
  fallback_notice: parseLines('fallback_notice', fallbackNotice),
} satisfies Record<string, Line[]>);

export type Situation = keyof typeof LINES;

export type LineSelectedEvent = {
  kind: 'line_selected';
  situation: Situation;
  personalityId: string;
  trustBucket: string;
  lineId: string;
};

export type LineSelection = {
  lineId: string;
  /** The text with its `{slot}`s still in place; fill it with `fillSlots`. */
  template: string;
  rng: RngState;
  events: (RandomResultEvent | LineSelectedEvent)[];
};

/**
 * Spec §5.7: until Jev picks the line ID, and whenever it is unavailable, picks uniformly among the
 * situation's lines for that personality and trust bucket with the seeded RNG, and logs the pick.
 */
export function selectLine(
  situation: Situation,
  personalityId: string,
  trustBucket: string,
  rng: RngState,
): LineSelection {
  const candidates = LINES[situation].filter(
    (line) => line.personality === personalityId && line.trust === trustBucket,
  );
  if (candidates.length === 0) {
    throw new Error(`No "${situation}" lines for ${personalityId} at ${trustBucket} trust`);
  }
  const draw = int(rng, candidates.length, `line:${situation}`);
  const line = candidates[draw.value]!;
  return {
    lineId: line.id,
    template: line.text,
    rng: draw.rng,
    events: [
      ...draw.events,
      { kind: 'line_selected', situation, personalityId, trustBucket, lineId: line.id },
    ],
  };
}
