// Playtest sheet rules (docs/playtest/PROTOCOL.md sections 2, 6 and 8; spec §8, §9).
// Pure text in, problems out: no IO, so both commands and the tests share it.

/** Protocol section 2 rule 1: `<round>-<host><nn>`, for example `G1-A01` or `P5-C12`. */
export const CODE_PATTERN = /^[A-Z][A-Z0-9]{1,3}-[ABC][0-9]{2}$/;

/** Protocol section 8, the check at the end: an `@`, a link, a phone-like number. */
export const PRIVACY_PATTERN = /@|https?:\/\/|www\.|[0-9]{3}[- .][0-9]{3}[- .][0-9]{4}/i;

export const MAX_FREE_TEXT = 200;

export const DROP_OFF_POINTS = ['none', 'setup', 'lap1', 'lap2', 'lap3', 'final_round'] as const;
export const DROP_OFF_REASONS = ['none', 'quit', 'bug', 'time_cap', 'other'] as const;
export const HESITATION_TYPES = ['sell_keep', 'ball'] as const;

/** Every column of the template, in the protocol's words (section 8). */
export const COLUMNS = [
  'participant_code',
  'date',
  'build_commit',
  'seed',
  'game_length_min',
  'drop_off_point',
  'drop_off_reason',
  'meaningful_choices',
  'hesitation_count',
  'hesitation_decisions',
  'q1_hesitated_sell_keep',
  'q2_opponent_personality',
  'q3_conversation_changed_game',
  'q4_boring_moment',
  'notes',
] as const;
export type Column = (typeof COLUMNS)[number];

const FREE_TEXT: ReadonlySet<Column> = new Set([
  'q1_hesitated_sell_keep',
  'q2_opponent_personality',
  'q3_conversation_changed_game',
  'q4_boring_moment',
  'notes',
]);

/** A cell the row command could not know. It is visible and the checker refuses it. */
export function placeholder(what: string): string {
  return `<<fill: ${what}>>`;
}
export const PLACEHOLDER = /<<.*>>|\b(?:TODO|TBD|FIXME)\b/i;

export type CsvRecord = {
  /** 1-based line where the record starts, and where it ends (a quoted newline spans lines). */
  line: number;
  endLine: number;
  cells: string[];
  /** The text ended inside a quoted cell. */
  unterminated: boolean;
};

/** RFC 4180 reader: quoted cells, doubled quotes, LF or CRLF. Never throws. */
export function parseCsv(text: string): CsvRecord[] {
  const records: CsvRecord[] = [];
  let cells: string[] = [];
  let cell = '';
  let quoted = false;
  let line = 1;
  let startLine = 1;
  let index = 0;
  const endRecord = (unterminated: boolean) => {
    cells.push(cell);
    records.push({ line: startLine, endLine: line, cells, unterminated });
    cells = [];
    cell = '';
    startLine = line + 1;
  };
  while (index < text.length) {
    const char = text[index]!;
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        cell += '"';
        index++;
      } else if (char === '"') {
        quoted = false;
      } else {
        if (char === '\n') line++;
        cell += char;
      }
    } else if (char === '"' && cell === '') {
      quoted = true;
    } else if (char === ',') {
      cells.push(cell);
      cell = '';
    } else if (char === '\n') {
      endRecord(false);
      line++;
      startLine = line;
    } else if (char === '\r' && text[index + 1] === '\n') {
      // CRLF: the LF ends the record.
    } else {
      cell += char;
    }
    index++;
  }
  if (quoted) endRecord(true);
  else if (cell !== '' || cells.length > 0) endRecord(false);
  return records;
}

/** One CSV cell: wrapped in quotes only when it holds a comma, quote or line break. */
export function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

export type SheetProblem = { file: string; line: number; column?: string; message: string };

const WHOLE = /^[0-9]+$/;
const QUESTION = /^(?:yes|no|unsure|n\/a)(?: - .+)?$/;

function validDate(value: string): boolean {
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
}

const oneOf = (value: string, allowed: readonly string[]) =>
  allowed.includes(value) ? undefined : `must be one of ${allowed.join(', ')}; got ${value}`;

/** What a filled, non-empty cell must look like. Returns the complaint, or undefined when fine. */
function cellRule(column: Column, value: string): string | undefined {
  switch (column) {
    case 'participant_code':
      return CODE_PATTERN.test(value)
        ? undefined
        : `must look like <round>-<host><nn>, for example G1-A01; got ${value}`;
    case 'date':
      return validDate(value) ? undefined : `must be a real date, YYYY-MM-DD; got ${value}`;
    case 'build_commit':
      return /^[0-9a-f]{7}$/.test(value)
        ? undefined
        : `must be the 7-character commit (lower-case hex); got ${value}`;
    case 'seed':
      return /^-?[0-9]+$/.test(value) ? undefined : `must be an integer; got ${value}`;
    case 'game_length_min':
      return WHOLE.test(value) ? undefined : `must be whole minutes; got ${value}`;
    case 'drop_off_point':
      return oneOf(value, DROP_OFF_POINTS);
    case 'drop_off_reason':
      return oneOf(value, DROP_OFF_REASONS);
    case 'meaningful_choices':
      return WHOLE.test(value) || value === 'n/a'
        ? undefined
        : `must be a whole number or n/a; got ${value}`;
    case 'hesitation_count':
      return WHOLE.test(value) ? undefined : `must be a whole number, 0 if none; got ${value}`;
    case 'hesitation_decisions': {
      if (value === 'none') return undefined;
      const bad = value
        .split('|')
        .find((code) => !(HESITATION_TYPES as readonly string[]).includes(code));
      return bad === undefined
        ? undefined
        : `must be none, or sell_keep and ball joined with |; got ${value}`;
    }
    case 'q1_hesitated_sell_keep':
    case 'q2_opponent_personality':
    case 'q3_conversation_changed_game':
      return QUESTION.test(value)
        ? undefined
        : 'must start with yes, no, unsure or n/a, then " - " and a short paraphrase';
    // Free text: only the length and privacy checks apply.
    case 'q4_boring_moment':
    case 'notes':
      return undefined;
  }
}

/** Checks one data row; `cells` is already known to match the header's width. */
function rowProblems(cells: Record<Column, string>): Array<[Column, string]> {
  const found: Array<[Column, string]> = [];
  const usable = new Set<Column>();
  for (const column of COLUMNS) {
    const value = cells[column].trim();
    if (value === '') {
      found.push([column, 'empty cell']);
    } else if (PLACEHOLDER.test(value)) {
      found.push([column, `placeholder left in the cell: ${value}`]);
    } else {
      const complaint = cellRule(column, value);
      if (complaint) found.push([column, complaint]);
      else usable.add(column);
    }
    if (FREE_TEXT.has(column) && [...cells[column]].length > MAX_FREE_TEXT) {
      found.push([
        column,
        `longer than ${MAX_FREE_TEXT} characters (${[...cells[column]].length})`,
      ]);
    }
    if (PRIVACY_PATTERN.test(cells[column])) {
      found.push([column, 'looks like personal data (an @, a link or a phone-like number)']);
    }
  }
  if (usable.has('hesitation_count') && usable.has('hesitation_decisions')) {
    const count = Number(cells.hesitation_count.trim());
    const listed = cells.hesitation_decisions.trim();
    const codes = listed === 'none' ? 0 : listed.split('|').length;
    if (codes !== count) {
      found.push([
        'hesitation_decisions',
        `lists ${codes} hesitation(s) but hesitation_count is ${count}`,
      ]);
    }
  }
  if (usable.has('drop_off_point') && usable.has('drop_off_reason')) {
    const point = cells.drop_off_point.trim();
    const reason = cells.drop_off_reason.trim();
    if ((point === 'none') !== (reason === 'none')) {
      found.push([
        'drop_off_reason',
        `is ${reason} but drop_off_point is ${point}: both are none for a finished game, neither otherwise`,
      ]);
    }
  }
  return found;
}

export type SheetReport = { rows: number; problems: SheetProblem[] };

/**
 * Checks one sheet's text against the template header (protocol section 8). `file` only labels the
 * problems. Never throws on bad input.
 */
export function checkSheet(file: string, text: string, header: readonly string[]): SheetReport {
  const problems: SheetProblem[] = [];
  const report = (line: number, message: string, column?: string) =>
    problems.push({ file, line, message, ...(column === undefined ? {} : { column }) });
  const records = parseCsv(text.startsWith('\uFEFF') ? text.slice(1) : text);
  if (text.startsWith('\uFEFF'))
    report(1, 'the file starts with a byte-order mark; save it as plain UTF-8');
  const [head, ...rows] = records;
  if (!head) {
    report(1, 'the file is empty: it needs the header from docs/playtest/session-sheet.csv');
    return { rows: 0, problems };
  }
  const headerMatches =
    head.cells.length === header.length && head.cells.every((name, i) => name === header[i]);
  if (!headerMatches) {
    report(
      head.line,
      `the header differs from docs/playtest/session-sheet.csv; expected ${header.join(',')}`,
    );
  }
  if (head.endLine !== head.line) report(head.line, 'the header spans more than one line');
  for (const row of rows) {
    if (row.cells.length === 1 && row.cells[0] === '' && !row.unterminated) {
      report(row.line, 'blank line: one line per row, nothing between rows');
      continue;
    }
    if (row.unterminated) report(row.line, 'a quoted cell is never closed');
    if (row.endLine !== row.line) {
      report(row.line, `the row spans lines ${row.line} to ${row.endLine}: one line per row`);
    }
    if (row.cells.length !== COLUMNS.length) {
      report(row.line, `the row has ${row.cells.length} cells; the sheet has ${COLUMNS.length}`);
      // Cell positions are unreliable now, but the privacy check never depends on them.
      row.cells.forEach((cell, i) => {
        if (PRIVACY_PATTERN.test(cell)) {
          report(
            row.line,
            'looks like personal data (an @, a link or a phone-like number)',
            `cell ${i + 1}`,
          );
        }
      });
      continue;
    }
    const byName = Object.fromEntries(COLUMNS.map((name, i) => [name, row.cells[i]!])) as Record<
      Column,
      string
    >;
    for (const [column, message] of rowProblems(byName)) report(row.line, message, column);
  }
  return { rows: rows.length, problems };
}

export function formatProblem(problem: SheetProblem): string {
  const where = `${problem.file}:${problem.line}`;
  return problem.column === undefined
    ? `${where}: ${problem.message}`
    : `${where}: ${problem.column}: ${problem.message}`;
}
