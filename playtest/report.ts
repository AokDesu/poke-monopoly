// Playtest results (protocol sections 6, 8 and 9; spec §8, §10 C5): the committed session sheets in,
// the Human-layer tables and chart text out. No IO, so the command and the tests share it.
//
// Rules this file keeps:
// - A figure is "x of n". An `n/a` cell is unobserved: listed apart from the zeros, in no median.
// - No percentage and no test. The Human layer has no threshold (spec §8).
// - Quotes are the cells exactly as written. The same input always gives the same text.

import { barChartSvg, type BarGroup } from './chart.ts';
import {
  CODE_PATTERN,
  COLUMNS,
  DROP_OFF_POINTS,
  DROP_OFF_REASONS,
  HESITATION_TYPES,
  PLACEHOLDER,
  PRIVACY_PATTERN,
  parseCsv,
  type Column,
  type SheetProblem,
} from './sheet.ts';

/** Protocol section 5: at 25 minutes the facilitator lets the turn finish, then stops the game. */
export const PLAY_CAP_MIN = 25;

export type Answer = 'yes' | 'no' | 'unsure' | 'n/a';
export type HesitationType = (typeof HESITATION_TYPES)[number];
export type Switch = 'on' | 'off';

export type Session = {
  code: string;
  build: string;
  /** Every `number | null` and `| null` below is null when the cell said `n/a`: unobserved. */
  lengthMin: number | null;
  dropPoint: string | null;
  dropReason: string | null;
  choices: number | null;
  hesitationCount: number | null;
  hesitations: HesitationType[] | null;
  /** The cell exactly as written, and its first word. */
  q1: { raw: string; answer: Answer };
  q2: { raw: string; answer: Answer };
  q3: { raw: string; answer: Answer };
  q4: { raw: string; kind: 'none' | 'moment' | 'n/a' };
  /** Read from the words "Jev live", "Jev off" in `notes`; null when not stated. */
  jev: Switch | null;
  voice: Switch | null;
};

export type SheetText = { name: string; text: string };

const ANSWER = /^(yes|no|unsure|n\/a)(?: - .+)?$/;
const WHOLE = /^[0-9]+$/;
const BUILD = /^[0-9a-f]{7}$/;
/** A note that says the state was guessed or unseen does not count as a statement of it. */
const NOT_SEEN = /\b(?:assumed|not observed|unobserved|unknown|not sure)\b/i;

/**
 * `Jev live` / `Jev off` (or `Voice on` / `Voice off`) in the free-text notes, which is where the
 * protocol (section 8, `notes`) has the facilitator write it. A statement in a `;` part that says
 * it was assumed or not observed is ignored, and a note that states both is not a statement.
 */
export function readSwitch(notes: string, word: 'Jev' | 'Voice'): Switch | null {
  const on = word === 'Jev' ? 'live' : 'on';
  const found = new Set<Switch>();
  for (const match of notes.matchAll(new RegExp(`\\b${word}\\s+(${on}|off)\\b`, 'gi'))) {
    const at = match.index;
    const start = notes.lastIndexOf(';', at) + 1;
    const end = notes.indexOf(';', at);
    if (NOT_SEEN.test(notes.slice(start, end === -1 ? notes.length : end))) continue;
    found.add(match[1]!.toLowerCase() === 'off' ? 'off' : 'on');
  }
  return found.size === 1 ? [...found][0]! : null;
}

type Cells = Record<Column, string>;

/** One data row. Reports every problem it finds; returns the session only when there are none. */
function readRow(
  cells: Cells,
  fail: (column: Column, message: string) => void,
): Session | undefined {
  let bad = false;
  const refuse = (column: Column, message: string) => {
    bad = true;
    fail(column, message);
  };
  const value = (column: Column) => cells[column].trim();
  for (const column of COLUMNS) {
    if (value(column) === '') refuse(column, 'empty cell');
    else if (PLACEHOLDER.test(value(column))) {
      refuse(column, `placeholder left in the cell: ${value(column)}`);
    }
  }
  if (bad) return undefined;

  /** `n/a` is unobserved (null). Anything else must parse, or the row is refused. */
  const optional = <T>(
    column: Column,
    parse: (text: string) => T | undefined,
    expected: string,
  ) => {
    if (value(column) === 'n/a') return null;
    const parsed = parse(value(column));
    if (parsed === undefined) {
      refuse(column, `must be ${expected}, or n/a when unobserved; got ${value(column)}`);
      return null;
    }
    return parsed;
  };
  const whole = (text: string) => (WHOLE.test(text) ? Number(text) : undefined);
  const oneOf = (allowed: readonly string[]) => (text: string) =>
    allowed.includes(text) ? text : undefined;

  if (!CODE_PATTERN.test(value('participant_code'))) {
    refuse(
      'participant_code',
      `must look like <round>-<host><nn>; got ${value('participant_code')}`,
    );
  }
  if (!BUILD.test(value('build_commit'))) {
    refuse('build_commit', `must be the 7-character commit; got ${value('build_commit')}`);
  }
  const lengthMin = optional('game_length_min', whole, 'whole minutes');
  const dropPoint = optional('drop_off_point', oneOf(DROP_OFF_POINTS), DROP_OFF_POINTS.join(', '));
  const dropReason = optional(
    'drop_off_reason',
    oneOf(DROP_OFF_REASONS),
    DROP_OFF_REASONS.join(', '),
  );
  const choices = optional('meaningful_choices', whole, 'a whole number');
  const hesitationCount = optional('hesitation_count', whole, 'a whole number');
  const hesitations = optional(
    'hesitation_decisions',
    (text) => {
      if (text === 'none') return [];
      const codes = text.split('|');
      return codes.every((code) => (HESITATION_TYPES as readonly string[]).includes(code))
        ? (codes as HesitationType[])
        : undefined;
    },
    'none, or sell_keep and ball joined with |',
  );
  const answer = (column: Column) => {
    const match = ANSWER.exec(value(column));
    if (!match)
      refuse(column, 'must start with yes, no, unsure or n/a, then " - " and a paraphrase');
    return { raw: cells[column], answer: (match?.[1] ?? 'n/a') as Answer };
  };
  const q1 = answer('q1_hesitated_sell_keep');
  const q2 = answer('q2_opponent_personality');
  const q3 = answer('q3_conversation_changed_game');
  const q4Text = value('q4_boring_moment');
  const q4 = {
    raw: cells.q4_boring_moment,
    kind:
      q4Text === 'none'
        ? ('none' as const)
        : q4Text === 'n/a'
          ? ('n/a' as const)
          : ('moment' as const),
  };
  if (bad) return undefined;

  if ((dropPoint === null) !== (dropReason === null)) {
    refuse('drop_off_reason', 'drop_off_point and drop_off_reason are both n/a or both recorded');
  } else if (dropPoint !== null && (dropPoint === 'none') !== (dropReason === 'none')) {
    refuse(
      'drop_off_reason',
      `is ${dropReason} but drop_off_point is ${dropPoint}: both are none for a finished game, neither otherwise`,
    );
  }
  if ((hesitationCount === null) !== (hesitations === null)) {
    refuse(
      'hesitation_decisions',
      'hesitation_count and hesitation_decisions are both n/a or both recorded',
    );
  } else if (hesitations !== null && hesitations.length !== hesitationCount) {
    refuse(
      'hesitation_decisions',
      `lists ${hesitations.length} hesitation(s) but hesitation_count is ${hesitationCount}`,
    );
  }
  if (bad) return undefined;
  return {
    code: value('participant_code'),
    build: value('build_commit'),
    lengthMin,
    dropPoint,
    dropReason,
    choices,
    hesitationCount,
    hesitations,
    q1,
    q2,
    q3,
    q4,
    jev: readSwitch(cells.notes, 'Jev'),
    voice: readSwitch(cells.notes, 'Voice'),
  };
}

/**
 * Reads sheets for the report. Stricter than nothing and looser than `playtest:check`: `n/a` is
 * accepted as unobserved in the cells a facilitator may not have been able to fill, and a long
 * `notes` cell is not an error here. A cell that looks like personal data, a value of the wrong
 * form, an empty cell, a placeholder and a repeated code are errors; any error means no report.
 */
export function readSheets(
  sheets: readonly SheetText[],
  header: readonly string[],
): { sessions: Session[]; problems: SheetProblem[] } {
  const sessions: Session[] = [];
  const problems: SheetProblem[] = [];
  const seen = new Map<string, string>();
  for (const sheet of sheets) {
    const report = (line: number, message: string, column?: string) =>
      problems.push({
        file: sheet.name,
        line,
        message,
        ...(column === undefined ? {} : { column }),
      });
    const [head, ...rows] = parseCsv(
      sheet.text.startsWith('\uFEFF') ? sheet.text.slice(1) : sheet.text,
    );
    if (!head) {
      report(1, 'the file is empty: it needs the header from docs/playtest/session-sheet.csv');
      continue;
    }
    if (head.cells.length !== header.length || head.cells.some((name, i) => name !== header[i])) {
      report(
        head.line,
        `the header differs from docs/playtest/session-sheet.csv; expected ${header.join(',')}`,
      );
      continue;
    }
    for (const row of rows) {
      if (row.cells.length === 1 && row.cells[0] === '' && !row.unterminated) continue;
      row.cells.forEach((cell, i) => {
        if (PRIVACY_PATTERN.test(cell)) {
          report(
            row.line,
            'looks like personal data (an @, a link or a phone-like number)',
            COLUMNS[i] ?? `cell ${i + 1}`,
          );
        }
      });
      if (row.unterminated) report(row.line, 'a quoted cell is never closed');
      else if (row.endLine !== row.line) {
        report(row.line, `the row spans lines ${row.line} to ${row.endLine}: one line per row`);
      } else if (row.cells.length !== COLUMNS.length) {
        report(row.line, `the row has ${row.cells.length} cells; the sheet has ${COLUMNS.length}`);
      } else {
        const byName = Object.fromEntries(COLUMNS.map((name, i) => [name, row.cells[i]!])) as Cells;
        const session = readRow(byName, (column, message) => report(row.line, message, column));
        if (!session) continue;
        const first = seen.get(session.code);
        if (first !== undefined) {
          report(
            row.line,
            `the code ${session.code} is already used at ${first}`,
            'participant_code',
          );
        } else {
          seen.set(session.code, `${sheet.name}:${row.line}`);
          sessions.push(session);
        }
      }
    }
  }
  sessions.sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
  return { sessions, problems };
}

// --- Summary -----------------------------------------------------------------------------------

export type Spread = {
  observed: number;
  median: number | null;
  smallest: number | null;
  largest: number | null;
  /** Codes of the sessions whose cell said `n/a`. */
  unobserved: string[];
};

/** Median of an even count is the mean of the two middle values, so it can end in .5. */
export function spreadOf(
  sessions: readonly Session[],
  pick: (s: Session) => number | null,
): Spread {
  const values = sessions
    .map(pick)
    .filter((v): v is number => v !== null)
    .sort((a, b) => a - b);
  const mid = values.length >> 1;
  return {
    observed: values.length,
    median:
      values.length === 0
        ? null
        : values.length % 2
          ? values[mid]!
          : (values[mid - 1]! + values[mid]!) / 2,
    smallest: values[0] ?? null,
    largest: values[values.length - 1] ?? null,
    unobserved: sessions.filter((s) => pick(s) === null).map((s) => s.code),
  };
}

const codes = (sessions: readonly Session[], keep: (s: Session) => boolean) =>
  sessions.filter(keep).map((s) => s.code);

export type Results = {
  n: number;
  /** A partition of all n sessions. */
  outcomes: Record<'within' | 'over' | 'lengthUnobserved' | 'dropped' | 'unobserved', string[]>;
  length: Spread;
  choices: Spread;
  hesitation: {
    /** Sessions whose hesitation cells were recorded, not `n/a`. */
    recorded: string[];
    unrecorded: string[];
    total: number;
    byType: Record<HesitationType, { hesitations: number; sessions: string[] }>;
    /** Protocol section 9, "found hesitation": a sell_keep hesitation and Q1 yes or unsure. */
    found: string[];
    notFound: string[];
    undetermined: string[];
    /** Recorded sessions where Q1 was yes or unsure but no sell_keep hesitation was logged. */
    q1WithoutSellKeep: string[];
  };
  answers: Record<'q1' | 'q2' | 'q3', Record<Answer, string[]>>;
  q4: Record<'none' | 'moment' | 'n/a', string[]>;
  jev: Record<Switch | 'unobserved', string[]>;
  voice: Record<Switch | 'unobserved', string[]>;
};

export function summarize(sessions: readonly Session[]): Results {
  const finished = (s: Session) => s.dropPoint === 'none';
  const outcomes: Results['outcomes'] = {
    within: codes(
      sessions,
      (s) => finished(s) && s.lengthMin !== null && s.lengthMin <= PLAY_CAP_MIN,
    ),
    over: codes(sessions, (s) => finished(s) && s.lengthMin !== null && s.lengthMin > PLAY_CAP_MIN),
    lengthUnobserved: codes(sessions, (s) => finished(s) && s.lengthMin === null),
    dropped: codes(sessions, (s) => s.dropPoint !== null && !finished(s)),
    unobserved: codes(sessions, (s) => s.dropPoint === null),
  };
  const recorded = sessions.filter((s) => s.hesitations !== null);
  const sellKeep = (s: Session) => s.hesitations?.includes('sell_keep') === true;
  const positive = (s: Session) => s.q1.answer === 'yes' || s.q1.answer === 'unsure';
  const found = (s: Session) => sellKeep(s) && positive(s);
  const notFound = (s: Session) =>
    !found(s) && (s.q1.answer === 'no' || (s.hesitations !== null && !sellKeep(s)));
  const byType = (type: HesitationType) => ({
    hesitations: recorded.reduce(
      (sum, s) => sum + s.hesitations!.filter((t) => t === type).length,
      0,
    ),
    sessions: codes(recorded, (s) => s.hesitations!.includes(type)),
  });
  const tally = <K extends string>(keys: readonly K[], pick: (s: Session) => K) =>
    Object.fromEntries(keys.map((key) => [key, codes(sessions, (s) => pick(s) === key)])) as Record<
      K,
      string[]
    >;
  const answers = ['yes', 'no', 'unsure', 'n/a'] as const;
  const switchTally = (pick: (s: Session) => Switch | null) => ({
    on: codes(sessions, (s) => pick(s) === 'on'),
    off: codes(sessions, (s) => pick(s) === 'off'),
    unobserved: codes(sessions, (s) => pick(s) === null),
  });
  return {
    n: sessions.length,
    outcomes,
    length: spreadOf(sessions, (s) => s.lengthMin),
    choices: spreadOf(sessions, (s) => s.choices),
    hesitation: {
      recorded: recorded.map((s) => s.code),
      unrecorded: codes(sessions, (s) => s.hesitations === null),
      total: recorded.reduce((sum, s) => sum + s.hesitations!.length, 0),
      byType: { sell_keep: byType('sell_keep'), ball: byType('ball') },
      found: codes(sessions, found),
      notFound: codes(sessions, notFound),
      undetermined: codes(sessions, (s) => !found(s) && !notFound(s)),
      q1WithoutSellKeep: codes(recorded, (s) => positive(s) && !sellKeep(s)),
    },
    answers: {
      q1: tally(answers, (s) => s.q1.answer),
      q2: tally(answers, (s) => s.q2.answer),
      q3: tally(answers, (s) => s.q3.answer),
    },
    q4: tally(['none', 'moment', 'n/a'] as const, (s) => s.q4.kind),
    jev: switchTally((s) => s.jev),
    voice: switchTally((s) => s.voice),
  };
}

// --- Text --------------------------------------------------------------------------------------

export type Chart = { file: string; svg: string };

const list = (items: readonly string[]) => (items.length === 0 ? 'none' : items.join(', '));
const table = (head: string[], rows: string[][]) =>
  [
    `| ${head.join(' | ')} |`,
    `|${head.map(() => ' --- ').join('|')}|`,
    ...rows.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n');

function spreadLines(what: string, spread: Spread, n: number, unit: string): string[] {
  const head =
    spread.observed === 0
      ? `${what}: observed in 0 of ${n} sessions, so there is no median, smallest or largest.`
      : `${what}: observed in ${spread.observed} of ${n} sessions. Median ${spread.median}, smallest ${spread.smallest}, largest ${spread.largest} (${unit}).`;
  return [head, '', `Unobserved (n/a, not zero, in no median): ${list(spread.unobserved)}.`];
}

const QUESTIONS = [
  ['q1', 'Q1, a moment of hesitating between selling and keeping'],
  ['q2', 'Q2, could tell the opponent\u2019s personality'],
  ['q3', 'Q3, a conversation changed the game'],
] as const;

/** The chart file for each picture, named for the results file that links it. */
export const CHART_FILES = {
  outcomes: 'results-outcomes.svg',
  hesitation: 'results-hesitation.svg',
  answers: 'results-answers.svg',
} as const;

/**
 * The results text and its charts. `sheets` only names the files the sessions came from.
 * Nothing here depends on the clock, the machine or the order of the arguments.
 */
export function renderResults(
  sessions: readonly Session[],
  sheets: readonly string[],
): { markdown: string; charts: Chart[] } {
  const r = summarize(sessions);
  const n = r.n;
  const of = (items: readonly string[]) => `${items.length} of ${n}`;
  const h = r.hesitation;
  const o = h.recorded.length;
  const byCode = new Map(sessions.map((s) => [s.code, s]));
  const quotes = (pick: (s: Session) => string) =>
    sessions.map((s) => `- ${s.code}: "${pick(s)}"`).join('\n');

  const outcomeRows: Array<[string, string[]]> = [
    [`Finished within the ${PLAY_CAP_MIN}-minute cap`, r.outcomes.within],
    [`Finished, over ${PLAY_CAP_MIN} minutes`, r.outcomes.over],
    ['Finished, length unobserved', r.outcomes.lengthUnobserved],
    ['Dropped off', r.outcomes.dropped],
    ['Unobserved (finished or not is n/a)', r.outcomes.unobserved],
  ];
  const dropped = r.outcomes.dropped.map((code) => byCode.get(code)!);

  const typeRows = HESITATION_TYPES.map((type) => [
    `\`${type}\``,
    String(h.byType[type].hesitations),
    `${h.byType[type].sessions.length} of ${o}`,
    list(h.byType[type].sessions),
  ]);

  const markdown = [
    '# Playtest results',
    '',
    `Human layer (spec §8, §10 C5). n = ${n} session${n === 1 ? '' : 's'}, from ${sheets.length} sheet${sheets.length === 1 ? '' : 's'}: ${sheets.map((s) => `\`${s}\``).join(', ')}.`,
    '',
    'Every figure is "x of n", with n the number of sessions. An `n/a` cell is unobserved: it is listed apart from the zeros and is in no median. No threshold applies to the Human layer (spec §8), so this report gives counts with n and nothing else: no rate and no test.',
    '',
    '## Sessions',
    '',
    table(
      ['Session', 'Build'],
      sessions.map((s) => [s.code, `\`${s.build}\``]),
    ),
    '',
    '## Finished or dropped off',
    '',
    table(
      ['Outcome', 'Sessions', 'Which'],
      outcomeRows.map(([label, items]) => [label, of(items), list(items)]),
    ),
    '',
    dropped.length === 0
      ? 'No session dropped off.'
      : table(
          ['Dropped off', 'Point', 'Reason'],
          dropped.map((s) => [s.code, `\`${s.dropPoint}\``, `\`${s.dropReason}\``]),
        ),
    '',
    `![Outcomes: ${outcomeRows.map(([label, items]) => `${label} ${of(items)}`).join('; ')}](${CHART_FILES.outcomes})`,
    '',
    '## Game length',
    '',
    ...spreadLines('Game length', r.length, n, 'whole minutes, including games that stopped early'),
    '',
    '## Meaningful choices',
    '',
    ...spreadLines(
      'Meaningful choices',
      r.choices,
      n,
      'accepted human actions, protocol section 6',
    ),
    '',
    '## Hesitations',
    '',
    o === 0
      ? `Hesitations: recorded in 0 of ${n} sessions.`
      : `Hesitations: recorded in ${o} of ${n} sessions, ${h.total} in total.`,
    '',
    `Not recorded (n/a, not zero): ${list(h.unrecorded)}.`,
    '',
    ...(o === 0
      ? []
      : [
          table(['Decision type', 'Hesitations', 'Sessions with one or more', 'Which'], typeRows),
          '',
        ]),
    `Found hesitation (protocol section 9: a \`sell_keep\` hesitation and a Q1 answer of yes or unsure): ${of(h.found)}.`,
    '',
    table(
      ['Found hesitation', 'Sessions', 'Which'],
      [
        ['Yes', of(h.found), list(h.found)],
        ['No', of(h.notFound), list(h.notFound)],
        ['Cannot tell (a needed cell is n/a)', of(h.undetermined), list(h.undetermined)],
      ],
    ),
    '',
    `Listed apart, because they do not count as found hesitation (protocol section 9): a \`ball\` hesitation in ${h.byType.ball.sessions.length} of ${o} recorded sessions (${list(h.byType.ball.sessions)}); a Q1 answer of yes or unsure with no \`sell_keep\` hesitation logged in ${h.q1WithoutSellKeep.length} of ${o} (${list(h.q1WithoutSellKeep)}).`,
    '',
    `![Hesitations: ${HESITATION_TYPES.map((t) => `${t} ${h.byType[t].sessions.length} of ${o}`).join('; ')}; found hesitation ${of(h.found)}](${CHART_FILES.hesitation})`,
    '',
    '## The four questions',
    '',
    'Questions 1 to 3 start with yes, no, unsure or n/a; n/a means the question was skipped, so it is unobserved. Question 4 is `none`, or the moment named.',
    '',
    ...QUESTIONS.flatMap(([key, title]) => [
      `### ${title}`,
      '',
      table(
        ['Answer', 'Sessions', 'Which'],
        (['yes', 'no', 'unsure', 'n/a'] as const).map((a) => [
          `\`${a}\``,
          of(r.answers[key][a]),
          list(r.answers[key][a]),
        ]),
      ),
      '',
      'As written:',
      '',
      quotes((s) => s[key].raw),
      '',
    ]),
    '### Q4, when waiting or reading got boring',
    '',
    table(
      ['Answer', 'Sessions', 'Which'],
      [
        ['`none`', of(r.q4.none), list(r.q4.none)],
        ['a moment named', of(r.q4.moment), list(r.q4.moment)],
        ['`n/a`', of(r.q4['n/a']), list(r.q4['n/a'])],
      ],
    ),
    '',
    'As written:',
    '',
    quotes((s) => s.q4.raw),
    '',
    `![Answers: ${[...QUESTIONS.map(([key]) => `${key.toUpperCase()} yes ${r.answers[key].yes.length}, no ${r.answers[key].no.length}, unsure ${r.answers[key].unsure.length}, n/a ${r.answers[key]['n/a'].length}`), `Q4 none ${r.q4.none.length}, a moment named ${r.q4.moment.length}, n/a ${r.q4['n/a'].length}`].join('; ')} (each of ${n})](${CHART_FILES.answers})`,
    '',
    '## Jev and Voice, by session',
    '',
    'Read from the words `Jev live`, `Jev off`, `Voice on` and `Voice off` in each row\u2019s `notes`. A session whose notes do not say, say it was assumed or not observed, or say both is unobserved.',
    '',
    table(
      ['Session', 'Jev', 'Voice'],
      sessions.map((s) => [
        s.code,
        s.jev === null ? 'unobserved' : s.jev === 'on' ? 'live' : 'off',
        s.voice ?? 'unobserved',
      ]),
    ),
    '',
    table(
      ['Setting', 'Sessions'],
      [
        ['Jev live', of(r.jev.on)],
        ['Jev off', of(r.jev.off)],
        ['Jev unobserved', of(r.jev.unobserved)],
        ['Voice on', of(r.voice.on)],
        ['Voice off', of(r.voice.off)],
        ['Voice unobserved', of(r.voice.unobserved)],
      ],
    ),
    '',
  ].join('\n');

  const bar = (label: string, items: readonly string[], total: number) => ({
    label,
    count: items.length,
    n: total,
  });
  const outcomeGroups: BarGroup[] = [
    { bars: outcomeRows.map(([label, items]) => bar(label, items, n)) },
  ];
  const hesitationGroups: BarGroup[] = [
    {
      heading: `Sessions with a hesitation, by type (${o} of ${n} recorded)`,
      bars: HESITATION_TYPES.map((t) => bar(t, h.byType[t].sessions, o)),
    },
    {
      heading: 'Found hesitation (protocol section 9)',
      bars: [
        bar('Yes', h.found, n),
        bar('No', h.notFound, n),
        bar('Cannot tell', h.undetermined, n),
      ],
    },
  ];
  const answerGroups: BarGroup[] = [
    ...QUESTIONS.map(([key, title]) => ({
      heading: title,
      bars: (['yes', 'no', 'unsure', 'n/a'] as const).map((a) => bar(a, r.answers[key][a], n)),
    })),
    {
      heading: 'Q4, when waiting or reading got boring',
      bars: [
        bar('none', r.q4.none, n),
        bar('a moment named', r.q4.moment, n),
        bar('n/a', r.q4['n/a'], n),
      ],
    },
  ];
  return {
    markdown,
    charts: [
      {
        file: CHART_FILES.outcomes,
        svg: barChartSvg(`Outcomes, n = ${n} sessions`, outcomeGroups),
      },
      {
        file: CHART_FILES.hesitation,
        svg: barChartSvg(`Hesitations, n = ${n} sessions`, hesitationGroups),
      },
      {
        file: CHART_FILES.answers,
        svg: barChartSvg(`The four questions, n = ${n} sessions`, answerGroups),
      },
    ],
  };
}
