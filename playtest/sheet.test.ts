import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import {
  checkSheet,
  COLUMNS,
  csvCell,
  impliedSeed,
  isUnobserved,
  parseCsv,
  UNOBSERVED_COLUMNS,
  type SheetProblem,
} from './sheet.ts';
import { templateHeader } from './template.ts';

const HEADER = COLUMNS.join(',');
const GOOD = [
  'P5-A01',
  '2026-12-01',
  'abc1234',
  '5101',
  '17',
  'none',
  'none',
  '31',
  '2',
  'sell_keep|ball',
  'yes - unsure whether to sell at the first Start',
  'no - could not tell them apart',
  'n/a - no chat in this build',
  'waiting for the AI turn',
  '"Pause at Shop (items), not counted; Jev live"',
];

/** The good row with some cells replaced by column name. */
function sheet(...rows: Array<Partial<Record<(typeof COLUMNS)[number], string>>>): string {
  const lines = rows.map((over) => GOOD.map((cell, i) => over[COLUMNS[i]!] ?? cell).join(','));
  return [HEADER, ...lines].join('\n') + '\n';
}
const check = (text: string) => checkSheet('s.csv', text, COLUMNS).problems;
const only = (problems: SheetProblem[]) => problems.map((p) => `${p.line}:${p.column ?? ''}`);

describe('a sheet that follows the protocol', () => {
  test('passes, with a quoted comma, and with CRLF line endings or no final newline', () => {
    expect(check(sheet({}))).toEqual([]);
    expect(check(sheet({}).replaceAll('\n', '\r\n'))).toEqual([]);
    expect(check(sheet({}).trimEnd())).toEqual([]);
    expect(
      checkSheet('s.csv', sheet({}, { participant_code: 'P5-A02', seed: '5102' }), COLUMNS).rows,
    ).toBe(2);
  });

  test('the template header and the protocol example row agree with the checker', () => {
    expect(templateHeader()).toEqual([...COLUMNS]);
    const protocol = readFileSync(new URL('../docs/playtest/PROTOCOL.md', import.meta.url), 'utf8');
    const example = /```csv\n(.+)\n```/.exec(protocol)![1]!;
    expect(check(`${HEADER}\n${example}\n`)).toEqual([]);
  });
});

describe('what the checker flags', () => {
  test('a changed header', () => {
    const renamed = sheet({}).replace('seed', 'seeds');
    expect(check(renamed).map((p) => p.message)).toEqual([
      expect.stringContaining('the header differs from docs/playtest/session-sheet.csv'),
    ]);
    expect(check(sheet({}).replace(',notes', '')).length).toBeGreaterThan(0);
  });

  test('an empty cell, and a cell of spaces', () => {
    expect(
      check(sheet({ date: '', build_commit: '   ' })).map((p) => [p.column, p.message]),
    ).toEqual([
      ['date', 'empty cell'],
      ['build_commit', 'empty cell'],
    ]);
  });

  test.each(['<<fill: date>>', 'TODO', 'tbd', 'FIXME later'])(
    'a leftover placeholder: %s',
    (value) => {
      const [problem, ...rest] = check(sheet({ notes: value }));
      expect(rest).toEqual([]);
      expect(problem).toMatchObject({ file: 's.csv', line: 2, column: 'notes' });
      expect(problem!.message).toMatch(/placeholder/);
    },
  );

  test.each(['Alice', 'G1-D01', 'G1-A1', 'g1-a01', 'P5-A001', '101'])(
    'a code that does not match: %s',
    (code) => {
      expect(only(check(sheet({ participant_code: code })))).toEqual(['2:participant_code']);
    },
  );

  test.each(['2026-13-01', '01/12/2026', '2026-02-30', 'yesterday'])(
    'a date that is not one: %s',
    (date) => {
      expect(only(check(sheet({ date })))).toEqual(['2:date']);
    },
  );

  test.each([['1.5'], ['abc'], ['ABC1234'], ['abc123']])(
    'a seed or commit that is wrong: %s',
    (value) => {
      expect(only(check(sheet({ seed: value })))).toEqual(['2:seed']);
      expect(only(check(sheet({ build_commit: value })))).toEqual(['2:build_commit']);
    },
  );

  test('a hesitation type that is not sell_keep or ball, and a count that is not a number', () => {
    expect(only(check(sheet({ hesitation_decisions: 'sell_keep|shop' })))).toEqual([
      '2:hesitation_decisions',
    ]);
    expect(only(check(sheet({ hesitation_decisions: 'sell_keep||ball' })))).toEqual([
      '2:hesitation_decisions',
    ]);
    expect(only(check(sheet({ hesitation_count: 'two', hesitation_decisions: 'n/a' })))).toEqual([
      '2:hesitation_count',
    ]);
  });

  test('a free-text cell over 200 characters is flagged and 200 is not', () => {
    const exactly = 'x'.repeat(200);
    expect(check(sheet({ notes: exactly }))).toEqual([]);
    expect(only(check(sheet({ notes: `${exactly}x` })))).toEqual(['2:notes']);
    expect(only(check(sheet({ q4_boring_moment: 'y'.repeat(201) })))).toEqual([
      '2:q4_boring_moment',
    ]);
    expect(only(check(sheet({ q1_hesitated_sell_keep: `yes - ${'z'.repeat(200)}` })))).toEqual([
      '2:q1_hesitated_sell_keep',
    ]);
  });

  test.each([
    'mail me at someone@example.com',
    'see https://example.org/x',
    'http://example.org',
    'www.example.org',
    'call 081-234-5678',
    'call 081.234.5678',
    'call 081 234 5678',
  ])('a cell holding an @, a link or a phone-like number: %s', (notes) => {
    const [problem, ...rest] = check(sheet({ notes }));
    expect(rest).toEqual([]);
    expect(problem).toMatchObject({ line: 2, column: 'notes' });
    expect(problem!.message).toMatch(/personal data/);
  });

  test('personal data in any column, on the right line, and in a row that is the wrong width', () => {
    const text = sheet({}, {}, { q2_opponent_personality: 'no - found @handle' }) + 'a,b,x@y.z\n';
    expect(only(check(text))).toEqual(['4:q2_opponent_personality', '5:', '5:cell 3']);
  });

  test('a question cell that does not start with yes, no, unsure or n/a', () => {
    expect(only(check(sheet({ q1_hesitated_sell_keep: 'maybe - hmm' })))).toEqual([
      '2:q1_hesitated_sell_keep',
    ]);
    expect(only(check(sheet({ q2_opponent_personality: 'nothing happened' })))).toEqual([
      '2:q2_opponent_personality',
    ]);
    expect(only(check(sheet({ q3_conversation_changed_game: 'Yes - capital' })))).toEqual([
      '2:q3_conversation_changed_game',
    ]);
    for (const answer of ['yes - x', 'no - x', 'unsure - x', 'n/a - the participant skipped it']) {
      expect(check(sheet({ q1_hesitated_sell_keep: answer }))).toEqual([]);
    }
  });

  test.each(['yes', 'no', 'unsure', 'n/a', 'yes - ', 'n/a -   ', 'yes -x', 'yes  - x'])(
    'a question answer without a paraphrase is refused in all three question cells: %j',
    (answer) => {
      expect(
        only(
          check(
            sheet({
              q1_hesitated_sell_keep: answer,
              q2_opponent_personality: answer,
              q3_conversation_changed_game: answer,
            }),
          ),
        ),
      ).toEqual([
        '2:q1_hesitated_sell_keep',
        '2:q2_opponent_personality',
        '2:q3_conversation_changed_game',
      ]);
    },
  );

  test('n/a is accepted in exactly the cells that mean unobserved, together with its partner', () => {
    const unobserved = {
      game_length_min: 'n/a',
      drop_off_point: 'n/a',
      drop_off_reason: 'n/a',
      meaningful_choices: 'n/a',
      hesitation_count: 'n/a',
      hesitation_decisions: 'n/a',
    };
    expect(check(sheet(unobserved))).toEqual([]);
    // Every other column refuses it, so an unknown date or code is never waved through.
    for (const column of COLUMNS) {
      if (column in unobserved || column.startsWith('q') || column === 'notes') continue;
      expect(only(check(sheet({ [column]: 'n/a' })))).toContain(`2:${column}`);
    }
  });

  test('an unobserved count is not a zero: n/a is the only way to say it, and the message says so', () => {
    const [problem] = check(sheet({ hesitation_count: 'unknown', hesitation_decisions: 'n/a' }));
    expect(problem!.message).toMatch(/n\/a \(unobserved\)/);
    expect(problem!.message).not.toMatch(/0 if none/);
  });

  test('cells the protocol limits to fixed values', () => {
    expect(only(check(sheet({ drop_off_point: 'lap4', drop_off_reason: 'quit' })))).toEqual([
      '2:drop_off_point',
    ]);
    expect(only(check(sheet({ game_length_min: 'about 10' })))).toEqual(['2:game_length_min']);
    expect(only(check(sheet({ meaningful_choices: '-1' })))).toEqual(['2:meaningful_choices']);
  });

  test('a drop-off point and reason that contradict each other', () => {
    expect(only(check(sheet({ drop_off_point: 'lap1' })))).toEqual(['2:drop_off_reason']);
    expect(only(check(sheet({ drop_off_reason: 'quit' })))).toEqual(['2:drop_off_reason']);
    expect(check(sheet({ drop_off_point: 'lap1', drop_off_reason: 'time_cap' }))).toEqual([]);
  });

  test('n/a in one drop-off cell and a value in the other', () => {
    expect(only(check(sheet({ drop_off_point: 'n/a' })))).toEqual(['2:drop_off_reason']);
    expect(only(check(sheet({ drop_off_point: 'lap1', drop_off_reason: 'n/a' })))).toEqual([
      '2:drop_off_reason',
    ]);
    expect(only(check(sheet({ drop_off_reason: 'n/a' })))).toEqual(['2:drop_off_reason']);
  });

  test('n/a in one hesitation cell and a value in the other, and a count that does not match', () => {
    expect(only(check(sheet({ hesitation_count: 'n/a' })))).toEqual(['2:hesitation_decisions']);
    expect(only(check(sheet({ hesitation_decisions: 'n/a' })))).toEqual(['2:hesitation_decisions']);
    expect(only(check(sheet({ hesitation_count: 'n/a', hesitation_decisions: 'none' })))).toEqual([
      '2:hesitation_decisions',
    ]);
    expect(only(check(sheet({ hesitation_count: '0', hesitation_decisions: 'n/a' })))).toEqual([
      '2:hesitation_decisions',
    ]);
    expect(only(check(sheet({ hesitation_count: '3' })))).toEqual(['2:hesitation_decisions']);
  });

  test('structure: wrong width, blank line, a row on two lines, an unclosed quote, empty file', () => {
    expect(only(check(`${HEADER}\na,b\n`))).toEqual(['2:']);
    expect(only(check(sheet({}) + '\n' + GOOD.join(',') + '\n'))).toEqual(['3:']);
    const split = GOOD.map((cell, i) => (i === 14 ? '"two\nlines"' : cell)).join(',');
    expect(check(`${HEADER}\n${split}\n`).map((p) => p.message)).toEqual([
      expect.stringContaining('spans lines 2 to 3'),
    ]);
    expect(
      check(`${HEADER}\n${GOOD.slice(0, 14).join(',')},"open\n`).map((p) => p.message),
    ).toContain('a quoted cell is never closed');
    expect(check('').map((p) => p.message)).toEqual([expect.stringContaining('the file is empty')]);
    expect(checkSheet('s.csv', `${HEADER}\n`, COLUMNS)).toEqual({ rows: 0, problems: [] });
  });

  test('reports every problem of every row with its own line', () => {
    const text = sheet({ date: '' }, {}, { seed: 'x', notes: 'a@b.c' });
    expect(only(check(text))).toEqual(['2:date', '4:seed', '4:notes']);
  });

  test('never throws on arbitrary bytes', () => {
    for (const text of [
      '\uFEFF' + HEADER,
      '"',
      '\n\n\n',
      ',,,,',
      '"""',
      'a"b,c\r',
      '\u0000\u0001',
    ]) {
      expect(() => check(text)).not.toThrow();
    }
    expect(check('\uFEFF' + HEADER + '\n').map((p) => p.message)).toEqual([
      expect.stringContaining('byte-order mark'),
    ]);
  });
});

describe('csv reading and writing', () => {
  test('a cell with a comma, quote or line break round-trips', () => {
    const values = ['plain', 'a,b', 'say "hi"', 'two\nlines', ''];
    const [record] = parseCsv(values.map(csvCell).join(','));
    expect(record!.cells).toEqual(values);
  });
});

describe('the shared n/a rule (protocol section 8)', () => {
  test('isUnobserved is true only for n/a in a column that may be unobserved', () => {
    expect(Object.keys(UNOBSERVED_COLUMNS).sort()).toEqual([
      'drop_off_point',
      'drop_off_reason',
      'game_length_min',
      'hesitation_count',
      'hesitation_decisions',
      'meaningful_choices',
    ]);
    for (const column of Object.keys(UNOBSERVED_COLUMNS) as Array<(typeof COLUMNS)[number]>) {
      expect(isUnobserved(column, 'n/a')).toBe(true);
      expect(isUnobserved(column, ' n/a ')).toBe(true);
      expect(isUnobserved(column, '0')).toBe(false);
      expect(isUnobserved(column, 'none')).toBe(false);
      expect(isUnobserved(column, 'N/A')).toBe(false);
    }
    expect(isUnobserved('seed', 'n/a')).toBe(false);
    expect(isUnobserved('date', 'n/a')).toBe(false);
    expect(isUnobserved('notes', 'n/a')).toBe(false);
    expect(isUnobserved('q1_hesitated_sell_keep', 'n/a')).toBe(false);
  });
});

describe('the seed a participant code implies (protocol section 3, step 2)', () => {
  test.each([
    ['G1-A01', 101],
    ['G1-B02', 202],
    ['G1-C02', 302],
    ['P5-A01', 5101],
    ['P5-A02', 5102],
    ['P5-B01', 5201],
    ['P5-C99', 5399],
  ])('%s implies %i', (code, seed) => {
    expect(impliedSeed(code)).toBe(seed);
  });

  test.each(['X9-A01', 'P5-D01', 'p5-a01', 'P5-A1', ''])(
    'a round without a base, or a code that is not one, implies nothing: %j',
    (code) => {
      expect(impliedSeed(code)).toBeUndefined();
    },
  );
});
