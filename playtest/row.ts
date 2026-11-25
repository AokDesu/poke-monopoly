// Draft one playtest sheet row from an exported game log (spec §6, §8; protocol sections 6 and 8).
// Reads the engine save the results screen exports; counts only what the log can say.
import { deserialize, verifyReplay, type SavedGame } from '../engine/index.ts';
import { COLUMNS, CODE_PATTERN, csvCell, impliedSeed, placeholder, type Column } from './sheet.ts';

/** A refusal with a message for the facilitator; no row is printed. */
export class RowError extends Error {}

export type Draft = {
  row: string;
  /** For the facilitator to cross-check against the scratch note; none of it is decided here. */
  facts: {
    seed: string;
    seatIndex: number;
    finished: boolean;
    meaningfulChoices: number;
    sellPhaseDecisions: number;
    ballDecisions: number;
    dropOffPoint: string;
    dropOffNote: string;
    /** Set when the log's seed is not the one the code implies (protocol section 3, step 2). */
    seedWarning?: string;
  };
  /** Columns left as placeholders for the facilitator. */
  placeholders: Column[];
};

/** Protocol section 8: `setup`, `lap1`..`lap3`, `final_round`; only a candidate for an unfinished game. */
function dropOff(game: SavedGame, seatIndex: number): { point: string; note: string } {
  const { state } = game;
  if (state.phase.kind === 'finished') return { point: 'none', note: 'the game finished' };
  if (state.phase.kind === 'first_player_roll') {
    return { point: 'setup', note: 'the first-player roll was not finished' };
  }
  if (state.finalTableRound !== null) {
    return { point: 'final_round', note: 'the Final Table Round had been announced' };
  }
  const paid = state.players.find((player) => player.seatIndex === seatIndex)!.creditedLap;
  // The board shows paid Laps (`0 / 2` while the first Lap is played), so the Lap being played is one more.
  const lap = paid + 1;
  const note = `the human seat had been paid ${paid} of ${state.config.lapTarget} Laps`;
  return lap <= 3
    ? { point: `lap${lap}`, note }
    : { point: placeholder(`drop_off_point lap ${lap} has no name on the sheet`), note };
}

function load(text: string): SavedGame {
  let game: SavedGame;
  try {
    game = deserialize(text);
  } catch (error) {
    const message =
      error instanceof SyntaxError
        ? `the file is not JSON (${error.message})`
        : error instanceof Error
          ? error.message
          : String(error);
    throw new RowError(`Not a usable game log: ${message}`);
  }
  const check = verifyReplay(game);
  if (!check.pass) {
    throw new RowError(`Not a usable game log: it does not replay (${check.reason})`);
  }
  return game;
}

/**
 * `meaningful_choices` is every accepted action of the human seat that is not `auto: true`
 * (protocol section 6). A reload adds no record, so a Continue never adds a choice.
 */
export function draftRow(text: string, code: string): Draft {
  if (!CODE_PATTERN.test(code)) {
    throw new RowError(
      `--code must look like <round>-<host><nn>, for example G1-A01 (protocol section 2); got ${code}`,
    );
  }
  const game = load(text);
  const humans = game.log.initialConfig.seats.filter((seat) => seat.controller === 'human');
  if (humans.length !== 1) {
    throw new RowError(
      humans.length === 0
        ? 'This log has no human seat (a watched game), so there is no participant to count.'
        : `This log has ${humans.length} human seats; a session has exactly one participant.`,
    );
  }
  const human = humans[0]!;
  let meaningful = 0;
  let sell = 0;
  let ball = 0;
  for (const { action, auto } of game.log.actions) {
    if (action.actorId !== human.actorId || auto) continue;
    meaningful++;
    if (action.kind === 'sell' || action.kind === 'finish_sell') sell++;
    else if (action.kind === 'catch' || action.kind === 'release') ball++;
  }
  const finished = game.state.phase.kind === 'finished';
  const drop = dropOff(game, human.seatIndex);
  const seed = String(game.log.seed);
  const implied = impliedSeed(code);
  const seedWarning =
    implied === undefined
      ? `no seed rule for the round of ${code} (protocol section 3, step 2 knows G1 and P5), so the log's seed ${seed} was not checked`
      : String(implied) === seed
        ? undefined
        : `the log's seed is ${seed} but ${code} implies ${implied} (protocol section 3, step 2); the row keeps the log's seed`;
  const cells: Record<Column, string> = {
    participant_code: code,
    date: placeholder('date YYYY-MM-DD'),
    build_commit: placeholder('build commit 7 characters'),
    seed: /^-?[0-9]+$/.test(seed)
      ? seed
      : placeholder(`seed the log has ${JSON.stringify(seed)} which is not an integer`),
    game_length_min: placeholder('game length in whole minutes from the stopwatch'),
    drop_off_point: drop.point,
    drop_off_reason: finished
      ? 'none'
      : placeholder('drop_off_reason quit or bug or time_cap or other'),
    meaningful_choices: String(meaningful),
    hesitation_count: placeholder('hesitation_count from the scratch note'),
    hesitation_decisions: placeholder('hesitation_decisions from the scratch note'),
    q1_hesitated_sell_keep: placeholder('answer to question 1'),
    q2_opponent_personality: placeholder('answer to question 2'),
    q3_conversation_changed_game: placeholder('answer to question 3'),
    q4_boring_moment: placeholder('answer to question 4'),
    notes: placeholder('notes Jev live or off and badge and bugs and issue numbers'),
  };
  return {
    row: COLUMNS.map((column) => csvCell(cells[column])).join(','),
    facts: {
      seed,
      seatIndex: human.seatIndex,
      finished,
      meaningfulChoices: meaningful,
      sellPhaseDecisions: sell,
      ballDecisions: ball,
      dropOffPoint: drop.point,
      dropOffNote: drop.note,
      ...(seedWarning === undefined ? {} : { seedWarning }),
    },
    placeholders: COLUMNS.filter((column) => /^<<.*>>$/.test(cells[column])),
  };
}
