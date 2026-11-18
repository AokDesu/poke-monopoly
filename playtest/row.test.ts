import { describe, expect, test } from 'vitest';
import {
  advanceAutomatically,
  applyAction,
  createGame,
  createGameConfig,
  createGameLog,
  deserialize,
  fixtureSchema,
  legalActions,
  observe,
  pendingDecision,
  serialize,
  type GameLog,
  type GameState,
} from '../engine/index.ts';
import fixture from '../engine/fixtures/start-of-game-2p.json';
import { draftRow, RowError } from './row.ts';
import { checkSheet, COLUMNS, parseCsv, type Column } from './sheet.ts';

type Game = { state: GameState; log: GameLog };
type Tally = { meaningful: number; sell: number; ball: number };

function newGame(
  seed: number,
  controllers: ['human' | 'ai', 'human' | 'ai'] = ['human', 'ai'],
): Game {
  const scenario = fixtureSchema.parse(fixture).state;
  const seats = scenario.config.seats.map((seat, i) => ({ ...seat, controller: controllers[i]! }));
  const state = createGame(
    createGameConfig({ seats, seed, lapTarget: 2 }),
    structuredClone(scenario.content),
  );
  return { state, log: createGameLog(state) };
}

/**
 * One accepted step, with an oracle that does not read the log: the driver itself counts every
 * decision it submits for the human seat, and a step the engine applies on its own is never counted.
 */
function step(game: Game, tally: Tally): Game {
  const automatic = advanceAutomatically(game.state);
  if (automatic.records.length === 1) {
    return {
      state: automatic.state,
      log: { ...game.log, actions: [...game.log.actions, ...automatic.records] },
    };
  }
  const { state } = game;
  const seat = pendingDecision(state)!;
  const choices = legalActions(state, seat.seatIndex).enabled;
  const choice = choices[(state.stateRevision * 7 + 3) % choices.length]!;
  if (seat.actorId === 'player-0') {
    tally.meaningful++;
    if (choice.kind === 'sell' || choice.kind === 'finish_sell') tally.sell++;
    if (choice.kind === 'catch' || choice.kind === 'release') tally.ball++;
  }
  const observed = observe(state, seat.seatIndex).public.stateRevision;
  const result = applyAction(state, {
    actorId: seat.actorId,
    actionSeq: observed + 1,
    stateRevisionBefore: observed,
    kind: choice.kind,
    payload: choice.payload,
  } as never);
  if ('rejected' in result) throw new Error(`Rejected ${choice.kind}: ${result.reason}`);
  return {
    state: result.state,
    log: { ...game.log, actions: [...game.log.actions, result.record] },
  };
}

function playUntil(game: Game, tally: Tally, stop: (state: GameState) => boolean): Game {
  let current = game;
  for (let steps = 0; !stop(current.state); steps++) {
    if (steps > 5000) throw new Error('Game did not reach the stop');
    current = step(current, tally);
  }
  return current;
}

const finished = (state: GameState) => state.phase.kind === 'finished';
const empty = (): Tally => ({ meaningful: 0, sell: 0, ball: 0 });
const humanPaid = (state: GameState) => state.players[0]!.creditedLap;

function cellsOf(row: string): Record<Column, string> {
  const [record] = parseCsv(row);
  return Object.fromEntries(COLUMNS.map((name, i) => [name, record!.cells[i]!])) as Record<
    Column,
    string
  >;
}

describe('meaningful_choices (protocol section 6)', () => {
  test('a finished game counts accepted human actions that are not auto, never dice or one-option steps', () => {
    const tally = empty();
    const game = playUntil(newGame(11), tally, finished);
    const records = game.log.actions;
    // The log really holds both kinds of automatic step, or this proves nothing.
    expect(records.some((r) => r.auto && r.action.actorId === 'engine')).toBe(true);
    expect(records.some((r) => r.auto && r.action.actorId === 'player-0')).toBe(true);
    expect(records.length).toBeGreaterThan(tally.meaningful);

    const draft = draftRow(serialize(game), 'P5-A01');

    expect(tally.meaningful).toBeGreaterThan(10);
    expect(cellsOf(draft.row).meaningful_choices).toBe(String(tally.meaningful));
    expect(draft.facts).toMatchObject({
      meaningfulChoices: tally.meaningful,
      sellPhaseDecisions: tally.sell,
      ballDecisions: tally.ball,
      finished: true,
    });
    expect(tally.sell).toBeGreaterThan(0);
    expect(tally.ball).toBeGreaterThan(0);
  });

  test('a reload in the middle adds no choice: the loaded game ends with the uninterrupted count', () => {
    const whole = empty();
    const uninterrupted = playUntil(newGame(11), whole, finished);

    const before = empty();
    const half = playUntil(newGame(11), before, (s) => s.stateRevision >= 60);
    const reloaded = draftRow(serialize(half), 'P5-A01');
    // Continue: the save is read back and the game resumes; the count so far is unchanged.
    expect(reloaded.facts.meaningfulChoices).toBe(before.meaningful);
    const loaded = deserialize(serialize(half));
    expect(draftRow(serialize(loaded), 'P5-A01').row).toBe(reloaded.row);

    const after = empty();
    const rest = playUntil(loaded, after, finished);
    expect(before.meaningful + after.meaningful).toBe(whole.meaningful);
    expect(draftRow(serialize(rest), 'P5-A01').facts.meaningfulChoices).toBe(whole.meaningful);
    expect(rest.state.stateRevision).toBe(uninterrupted.state.stateRevision);
  });
});

describe('drop_off_point candidate (protocol section 8)', () => {
  test('a finished game gives none for both point and reason', () => {
    const game = playUntil(newGame(11), empty(), finished);
    const cells = cellsOf(draftRow(serialize(game), 'P5-A01').row);
    expect(cells.drop_off_point).toBe('none');
    expect(cells.drop_off_reason).toBe('none');
  });

  test.each([
    ['setup', () => true, 'setup'],
    ['lap1', (s: GameState) => s.phase.kind !== 'first_player_roll', 'lap1'],
    ['lap2', (s: GameState) => humanPaid(s) === 1 && s.finalTableRound === null, 'lap2'],
    ['final_round', (s: GameState) => s.finalTableRound !== null && !finished(s), 'final_round'],
  ])(
    'a game stopped at %s gives %s and leaves the reason to the facilitator',
    (_name, stop, point) => {
      const game = playUntil(newGame(11), empty(), stop);
      const draft = draftRow(serialize(game), 'P5-A01');
      const cells = cellsOf(draft.row);
      expect(cells.drop_off_point).toBe(point);
      expect(cells.drop_off_reason).toMatch(/^<<fill: .*>>$/);
      expect(draft.placeholders).toContain('drop_off_reason');
      expect(draft.facts.finished).toBe(false);
    },
  );
});

describe('the seed the code implies (protocol section 3, step 2)', () => {
  const log = (seed: number) =>
    serialize(playUntil(newGame(seed), empty(), (s) => s.stateRevision >= 20));

  test('a log whose seed is the one the code implies draws no warning', () => {
    expect(draftRow(log(5102), 'P5-A02').facts.seedWarning).toBeUndefined();
    expect(draftRow(log(201), 'G1-B01').facts.seedWarning).toBeUndefined();
  });

  test('a log with another seed warns, names both seeds, and the row keeps the log seed', () => {
    const draft = draftRow(log(5101), 'P5-A02');
    expect(draft.facts.seedWarning).toMatch(/seed is 5101 but P5-A02 implies 5102/);
    expect(cellsOf(draft.row).seed).toBe('5101');
  });

  test('a round with no seed base says the seed was not checked instead of staying silent', () => {
    expect(draftRow(log(77), 'X9-A01').facts.seedWarning).toMatch(/no seed rule.*not checked/);
  });
});

describe('refusals print no row', () => {
  const good = () => serialize(playUntil(newGame(11), empty(), (s) => s.stateRevision >= 20));

  test.each([
    ['not JSON', 'this is not json', /not JSON/],
    ['not a save', JSON.stringify({ hello: 'world' }), /format undefined/],
    ['an array', '[]', /Not a usable game log/],
    ['an empty file', '', /not JSON/],
  ])('%s', (_name, text, message) => {
    expect(() => draftRow(text, 'P5-A01')).toThrowError(RowError);
    expect(() => draftRow(text, 'P5-A01')).toThrowError(message);
  });

  test.each([
    ['engineVersion', /engine version/],
    ['contentVersion', /content version/],
    ['rngVersion', /RNG version/],
    ['saveVersion', /format/],
  ])('a save with another %s is named in the message', (field, message) => {
    const save = JSON.parse(good()) as Record<string, unknown>;
    save[field] = 'other-version';
    expect(() => draftRow(JSON.stringify(save), 'P5-A01')).toThrowError(message);
  });

  test('a save whose state no longer follows its log does not replay', () => {
    const save = JSON.parse(good()) as { state: { players: Array<{ coins: number }> } };
    save.state.players[0]!.coins += 5;
    expect(() => draftRow(JSON.stringify(save), 'P5-A01')).toThrowError(/does not replay/);
  });

  test('a watched game has no participant', () => {
    const text = serialize(newGame(11, ['ai', 'ai']));
    expect(() => draftRow(text, 'P5-A01')).toThrowError(/no human seat/);
  });

  test('two human seats are not one participant', () => {
    const text = serialize(newGame(11, ['human', 'human']));
    expect(() => draftRow(text, 'P5-A01')).toThrowError(/2 human seats/);
  });

  test.each(['', 'Alice', 'a.b@c.com', 'G1-D01', 'g1-a01', 'G1-A1', 'G1-A001'])(
    'a code that is not <round>-<host><nn> is refused: %j',
    (code) => {
      expect(() => draftRow(good(), code)).toThrowError(/--code/);
    },
  );
});

describe('the draft row and the checker agree', () => {
  test('every cell the tool cannot know is a placeholder that the checker refuses, and nothing else', () => {
    const game = playUntil(newGame(11), empty(), finished);
    const draft = draftRow(serialize(game), 'P5-B07');
    const header = COLUMNS.join(',');
    const report = checkSheet('draft.csv', `${header}\n${draft.row}\n`, COLUMNS);
    const flagged = report.problems.map((p) => p.column);
    expect(flagged.sort()).toEqual([...draft.placeholders].sort());
    expect(draft.placeholders).toEqual(
      expect.arrayContaining([
        'date',
        'build_commit',
        'game_length_min',
        'hesitation_count',
        'notes',
      ]),
    );
    expect(report.problems.every((p) => /placeholder/.test(p.message))).toBe(true);
  });

  test('once the facilitator fills the placeholders the same row passes', () => {
    const game = playUntil(newGame(11), empty(), finished);
    const cells = cellsOf(draftRow(serialize(game), 'P5-B07').row);
    const filled = {
      ...cells,
      date: '2026-12-01',
      build_commit: 'abc1234',
      game_length_min: '14',
      hesitation_count: '1',
      hesitation_decisions: 'sell_keep',
      q1_hesitated_sell_keep: 'yes - torn at the first Sell Phase',
      q2_opponent_personality: 'no - could not tell',
      q3_conversation_changed_game: 'n/a - no chat',
      q4_boring_moment: 'none',
      notes: 'Jev off',
    };
    const text = `${COLUMNS.join(',')}\n${COLUMNS.map((c) => filled[c]).join(',')}\n`;
    expect(checkSheet('filled.csv', text, COLUMNS).problems).toEqual([]);
  });
});
