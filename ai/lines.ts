import chatReply from '../content/lines/en/chat_reply.json';
import catchFail from '../content/lines/en/catch_fail.json';
import catchSuccess from '../content/lines/en/catch_success.json';
import dealAccept from '../content/lines/en/deal_accept.json';
import dealReject from '../content/lines/en/deal_reject.json';
import fallbackNotice from '../content/lines/en/fallback_notice.json';
import gameStart from '../content/lines/en/game_start.json';
import gymWin from '../content/lines/en/gym_win.json';
import manipulationRefused from '../content/lines/en/manipulation_refused.json';
import promiseBroken from '../content/lines/en/promise_broken.json';
import promiseKept from '../content/lines/en/promise_kept.json';
import soldPokemon from '../content/lines/en/sold_pokemon.json';
import tauntLeader from '../content/lines/en/taunt_leader.json';
import rollHighOwn from '../content/lines/en/roll_high_own.json';
import rollLowOwn from '../content/lines/en/roll_low_own.json';
import battleWonOwn from '../content/lines/en/battle_won_own.json';
import battleLostOwn from '../content/lines/en/battle_lost_own.json';
import coinsInOwn from '../content/lines/en/coins_in_own.json';
import coinsOutOwn from '../content/lines/en/coins_out_own.json';
import catchOther from '../content/lines/en/catch_other.json';
import missOther from '../content/lines/en/miss_other.json';
import rollHighOther from '../content/lines/en/roll_high_other.json';
import rollLowOther from '../content/lines/en/roll_low_other.json';
import battleWonOther from '../content/lines/en/battle_won_other.json';
import battleLostOther from '../content/lines/en/battle_lost_other.json';
import coinsOther from '../content/lines/en/coins_other.json';
import saleOther from '../content/lines/en/sale_other.json';
import gymWinOther from '../content/lines/en/gym_win_other.json';
import tableBanter from '../content/lines/en/table_banter.json';
import tableRetort from '../content/lines/en/table_retort.json';
import { parseLines, type Line } from '../content/lines-schema.ts';
import { int, type RandomResultEvent, type RngState } from '../engine/index.ts';

/** Every `content/lines/en/<situation>.json`, validated (spec §5.7). */
export const LINES = Object.freeze({
  game_start: parseLines('game_start', gameStart),
  catch_success: parseLines('catch_success', catchSuccess),
  catch_fail: parseLines('catch_fail', catchFail),
  sold_pokemon: parseLines('sold_pokemon', soldPokemon),
  fallback_notice: parseLines('fallback_notice', fallbackNotice),
  deal_accept: parseLines('deal_accept', dealAccept),
  deal_reject: parseLines('deal_reject', dealReject),
  promise_kept: parseLines('promise_kept', promiseKept),
  promise_broken: parseLines('promise_broken', promiseBroken),
  gym_win: parseLines('gym_win', gymWin),
  taunt_leader: parseLines('taunt_leader', tauntLeader),
  manipulation_refused: parseLines('manipulation_refused', manipulationRefused),
  chat_reply: parseLines('chat_reply', chatReply),
  roll_high_own: parseLines('roll_high_own', rollHighOwn),
  roll_low_own: parseLines('roll_low_own', rollLowOwn),
  battle_won_own: parseLines('battle_won_own', battleWonOwn),
  battle_lost_own: parseLines('battle_lost_own', battleLostOwn),
  coins_in_own: parseLines('coins_in_own', coinsInOwn),
  coins_out_own: parseLines('coins_out_own', coinsOutOwn),
  catch_other: parseLines('catch_other', catchOther),
  miss_other: parseLines('miss_other', missOther),
  roll_high_other: parseLines('roll_high_other', rollHighOther),
  roll_low_other: parseLines('roll_low_other', rollLowOther),
  battle_won_other: parseLines('battle_won_other', battleWonOther),
  battle_lost_other: parseLines('battle_lost_other', battleLostOther),
  coins_other: parseLines('coins_other', coinsOther),
  sale_other: parseLines('sale_other', saleOther),
  gym_win_other: parseLines('gym_win_other', gymWinOther),
  table_banter: parseLines('table_banter', tableBanter),
  table_retort: parseLines('table_retort', tableRetort),
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
 * situation's lines for that personality and trust bucket with the seeded RNG, and returns the pick events for the caller to append to `GameLog.dialogueEvents`.
 * Use a separate presentation RNG; dialogue does not advance the gameplay RNG.
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
