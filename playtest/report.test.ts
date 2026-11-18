import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import {
  CHART_FILES,
  readSheets,
  readSwitch,
  renderResults,
  spreadOf,
  summarize,
} from './report.ts';
import { COLUMNS, PRIVACY_PATTERN } from './sheet.ts';
import { templateHeader } from './template.ts';

const HEADER = COLUMNS.join(',');
type Row = Partial<Record<(typeof COLUMNS)[number], string>>;

const BASE: Record<(typeof COLUMNS)[number], string> = {
  participant_code: 'T1-A01',
  date: '2026-12-01',
  build_commit: 'abc1234',
  seed: '1',
  game_length_min: '10',
  drop_off_point: 'none',
  drop_off_reason: 'none',
  meaningful_choices: '20',
  hesitation_count: '0',
  hesitation_decisions: 'none',
  q1_hesitated_sell_keep: 'no - kept everything',
  q2_opponent_personality: 'n/a',
  q3_conversation_changed_game: 'n/a',
  q4_boring_moment: 'none',
  notes: 'nothing to add',
};

const cell = (value: string) =>
  /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
function sheet(...rows: Row[]): string {
  const lines = rows.map((row) => COLUMNS.map((c) => cell(row[c] ?? BASE[c])).join(','));
  return [HEADER, ...lines].join('\n') + '\n';
}
const read = (text: string, name = 's.csv') => readSheets([{ name, text }], COLUMNS);
const sessionsOf = (...rows: Row[]) => {
  const { sessions, problems } = read(sheet(...rows));
  expect(problems).toEqual([]);
  return sessions;
};

// Six invented sessions, worked out by hand below.
const INVENTED: Row[] = [
  {
    participant_code: 'T1-A01',
    game_length_min: '12',
    meaningful_choices: '30',
    hesitation_count: '2',
    hesitation_decisions: 'sell_keep|ball',
    q1_hesitated_sell_keep: 'yes - unsure at the first Start',
    q3_conversation_changed_game: 'no - none',
    q4_boring_moment: 'waiting for the AI turn - a long wait',
    notes: 'jev=live; voice=off; setup=fixed; finished_in_cap=yes; Voice off badge seen',
  },
  {
    participant_code: 'T1-A02',
    game_length_min: '20',
    meaningful_choices: '28',
    q2_opponent_personality: 'yes - bold opponent',
    notes: 'jev=live; voice=on',
  },
  {
    participant_code: 'T1-B01',
    game_length_min: '17',
    drop_off_point: 'lap2',
    drop_off_reason: 'quit',
    meaningful_choices: '15',
    hesitation_count: '1',
    hesitation_decisions: 'sell_keep',
    q2_opponent_personality: 'unsure - maybe',
    notes: 'jev=off; voice=on; Backup bot badge',
  },
  {
    participant_code: 'T1-B02',
    game_length_min: '26',
    meaningful_choices: '41',
    hesitation_count: '2',
    hesitation_decisions: 'ball|ball',
    q1_hesitated_sell_keep: 'yes - weighing Balls',
    notes: 'jev=live',
  },
  {
    participant_code: 'T1-C01',
    game_length_min: 'n/a',
    meaningful_choices: 'n/a',
    hesitation_count: 'n/a',
    hesitation_decisions: 'n/a',
    q1_hesitated_sell_keep: 'unsure - not sure',
    notes: 'jev=off assumed, not observed',
  },
  {
    participant_code: 'T1-C02',
    game_length_min: 'n/a',
    drop_off_point: 'n/a',
    drop_off_reason: 'n/a',
    meaningful_choices: 'n/a',
    hesitation_count: 'n/a',
    hesitation_decisions: 'n/a',
    q1_hesitated_sell_keep: 'yes - torn',
    q3_conversation_changed_game: 'n/a - no chat',
  },
];

describe('the hand calculation on an invented sheet', () => {
  const results = summarize(sessionsOf(...INVENTED));

  test('game length: 12, 20, 17, 26 observed; two sessions n/a', () => {
    // Sorted 12, 17, 20, 26: median (17 + 20) / 2 = 18.5.
    expect(results.n).toBe(6);
    expect(results.length).toEqual({
      observed: 4,
      median: 18.5,
      smallest: 12,
      largest: 26,
      unobserved: ['T1-C01', 'T1-C02'],
    });
  });

  test('meaningful choices: 30, 28, 15, 41 observed, never a zero for the n/a cells', () => {
    // Sorted 15, 28, 30, 41: median (28 + 30) / 2 = 29.
    expect(results.choices).toEqual({
      observed: 4,
      median: 29,
      smallest: 15,
      largest: 41,
      unobserved: ['T1-C01', 'T1-C02'],
    });
  });

  test('outcomes are a partition of the 6 sessions, with the 25-minute cap', () => {
    expect(results.outcomes).toEqual({
      within: ['T1-A01', 'T1-A02'], // finished at 12 and 20 minutes
      over: ['T1-B02'], // finished at 26
      lengthUnobserved: ['T1-C01'],
      dropped: ['T1-B01'],
      unobserved: ['T1-C02'],
    });
    expect(Object.values(results.outcomes).flat()).toHaveLength(6);
  });

  test('hesitations: 2 + 0 + 1 + 2 = 5 in the 4 sessions that recorded them', () => {
    const h = results.hesitation;
    expect(h.recorded).toEqual(['T1-A01', 'T1-A02', 'T1-B01', 'T1-B02']);
    expect(h.unrecorded).toEqual(['T1-C01', 'T1-C02']);
    expect(h.total).toBe(5);
    // sell_keep: A01 once, B01 once. ball: A01 once, B02 twice.
    expect(h.byType.sell_keep).toEqual({ hesitations: 2, sessions: ['T1-A01', 'T1-B01'] });
    expect(h.byType.ball).toEqual({ hesitations: 3, sessions: ['T1-A01', 'T1-B02'] });
  });

  test('found hesitation (protocol section 9) is three-valued', () => {
    const h = results.hesitation;
    // A01: sell_keep and Q1 yes. A02: none. B01: sell_keep but Q1 no. B02: balls only.
    // C01 and C02: hesitation n/a and Q1 not "no", so it cannot be told.
    expect(h.found).toEqual(['T1-A01']);
    expect(h.notFound).toEqual(['T1-A02', 'T1-B01', 'T1-B02']);
    expect(h.undetermined).toEqual(['T1-C01', 'T1-C02']);
    // Q1 yes with no sell_keep: B02 only (C02 recorded nothing, so it is not in the recorded 4).
    expect(h.q1WithoutSellKeep).toEqual(['T1-B02']);
  });

  test('question tallies and Jev / Voice', () => {
    expect(results.answers.q1.yes).toEqual(['T1-A01', 'T1-B02', 'T1-C02']);
    expect(results.answers.q1.unsure).toEqual(['T1-C01']);
    expect(results.answers.q2).toMatchObject({ yes: ['T1-A02'], unsure: ['T1-B01'] });
    expect(results.answers.q3['n/a']).toHaveLength(5);
    expect(results.q4.moment).toEqual(['T1-A01']);
    expect(results.jev).toEqual({
      on: ['T1-A01', 'T1-A02', 'T1-B02'],
      off: ['T1-B01'],
      unobserved: ['T1-C01', 'T1-C02'],
    });
    expect(results.voice).toEqual({
      on: ['T1-A02', 'T1-B01'],
      off: ['T1-A01'],
      unobserved: ['T1-B02', 'T1-C01', 'T1-C02'],
    });
  });
});

describe('unobserved is not zero', () => {
  test('an n/a never enters a median: a zero would have lowered it', () => {
    const sessions = sessionsOf(
      { participant_code: 'T1-A01', game_length_min: '10' },
      { participant_code: 'T1-A02', game_length_min: '14' },
      { participant_code: 'T1-A03', game_length_min: 'n/a' },
    );
    const spread = spreadOf(sessions, (s) => s.lengthMin);
    expect(spread).toMatchObject({ observed: 2, median: 12, smallest: 10, largest: 14 });
  });

  test('a recorded zero is a zero, listed as recorded', () => {
    const sessions = sessionsOf(
      { participant_code: 'T1-A01' },
      { participant_code: 'T1-A02', hesitation_count: 'n/a', hesitation_decisions: 'n/a' },
    );
    const h = summarize(sessions).hesitation;
    expect(h.recorded).toEqual(['T1-A01']);
    expect(h.unrecorded).toEqual(['T1-A02']);
    expect(h.total).toBe(0);
  });

  test('every spread is n/a-safe when nothing was observed', () => {
    const sessions = sessionsOf({ game_length_min: 'n/a' });
    const spread = spreadOf(sessions, (s) => s.lengthMin);
    expect(spread).toMatchObject({ observed: 0, median: null, smallest: null, largest: null });
    const { markdown } = renderResults(sessions, ['s.csv']);
    expect(markdown).toContain('observed in 0 of 1 sessions, so there is no median');
  });
});

describe('Jev and Voice in the notes', () => {
  test('reads the tags the protocol asks for, in any case, from the start of the notes', () => {
    const notes = 'jev=live; voice=off; setup=fixed; finished_in_cap=yes; Pause at Shop';
    expect(readSwitch(notes, 'Jev')).toBe('on');
    expect(readSwitch(notes, 'Voice')).toBe('off');
    expect(readSwitch('JEV=OFF; Voice=On', 'Jev')).toBe('off');
    expect(readSwitch('JEV=OFF; Voice=On', 'Voice')).toBe('on');
    expect(readSwitch('jev=live; voice=on', 'Jev')).toBe('on');
  });

  test('a tag beats the words, so a "Voice off badge" note does not contradict voice=on', () => {
    expect(readSwitch('jev=live; voice=on; Voice off badge seen once', 'Voice')).toBe('on');
    expect(readSwitch('jev=live; voice=on; Jev off badge seen', 'Jev')).toBe('on');
  });

  test('a tag that is guessed, contradicted or malformed is unobserved', () => {
    expect(readSwitch('jev=live assumed; voice=on', 'Jev')).toBeNull();
    expect(readSwitch('jev=live; jev=off', 'Jev')).toBeNull();
    expect(readSwitch('jev=maybe; voice=', 'Jev')).toBeNull();
    expect(readSwitch('jev=maybe; voice=', 'Voice')).toBeNull();
    expect(readSwitch('xjev=live; myvoice=on', 'Jev')).toBeNull();
    expect(readSwitch('xjev=live; myvoice=on', 'Voice')).toBeNull();
  });

  test('a row written with the tags counts as observed in the results', () => {
    const [session] = sessionsOf({ notes: 'jev=live; voice=off; setup=fixed' });
    expect(session).toMatchObject({ jev: 'on', voice: 'off' });
  });

  test('reads the words when a row has no tag, ignores a guess, and refuses a contradiction', () => {
    expect(readSwitch('Jev live; Voice off badge seen', 'Jev')).toBe('on');
    expect(readSwitch('Jev live; Voice off badge seen', 'Voice')).toBe('off');
    expect(readSwitch('jev OFF (backup bot; server decider not wired to Jev)', 'Jev')).toBe('off');
    expect(readSwitch('Jev off/backup assumed, not observed', 'Jev')).toBeNull();
    expect(readSwitch('Jev live; Jev off after a restart', 'Jev')).toBeNull();
    expect(readSwitch('nothing said', 'Voice')).toBeNull();
    expect(readSwitch('Jeve live, Voiceover on', 'Jev')).toBeNull();
  });
});

describe('question 4', () => {
  const kind = (q4_boring_moment: string) => sessionsOf({ q4_boring_moment })[0]!.q4.kind;

  test('none, n/a and n/a with a reason are not a moment named', () => {
    expect(kind('none')).toBe('none');
    expect(kind('n/a')).toBe('n/a');
    expect(kind('n/a - skipped')).toBe('n/a');
    expect(kind('n/a - participant left before the question')).toBe('n/a');
  });

  test('a moment that merely starts with those letters is a moment named', () => {
    expect(kind('waiting for the AI turn - a long wait')).toBe('moment');
    expect(kind('n/aXYZ screen - slow')).toBe('moment');
    expect(kind('Shop - n/a items')).toBe('moment');
  });
});

describe('what the reader refuses', () => {
  const messages = (...rows: Row[]) =>
    read(sheet(...rows)).problems.map((p) => `${p.line}:${p.column}: ${p.message}`);

  test('a header that is not the template', () => {
    const { problems, sessions } = read(sheet({}).replace('seed', 'seeds'));
    expect(problems).toHaveLength(1);
    expect(sessions).toEqual([]);
  });

  test('personal data in any cell, including a row of the wrong width', () => {
    expect(messages({ notes: 'ask me at jo@example.org' })).toEqual([
      expect.stringContaining('2:notes: looks like personal data'),
    ]);
    expect(messages({ q4_boring_moment: 'see https://example.org' })[0]).toContain(
      'q4_boring_moment',
    );
    const wide = read(`${HEADER}\nT1-A01,call 555-123-4567\n`).problems.map((p) => p.message);
    expect(wide).toEqual([
      expect.stringContaining('personal data'),
      expect.stringContaining('2 cells'),
    ]);
  });

  test('empty cells, placeholders, wrong forms and impossible pairs', () => {
    expect(messages({ build_commit: '' })).toEqual(['2:build_commit: empty cell']);
    expect(messages({ game_length_min: '<<fill: minutes>>' })[0]).toContain('placeholder');
    expect(messages({ game_length_min: '12.5' })[0]).toContain('whole minutes, or n/a');
    expect(messages({ drop_off_point: 'lap9', drop_off_reason: 'quit' })[0]).toContain(
      'drop_off_point',
    );
    expect(messages({ q1_hesitated_sell_keep: 'maybe' })[0]).toContain('yes, no, unsure or n/a');
    expect(messages({ hesitation_count: '2', hesitation_decisions: 'sell_keep' })[0]).toContain(
      'lists 1',
    );
    expect(messages({ hesitation_count: 'n/a' })[0]).toContain('both n/a or both recorded');
    expect(messages({ drop_off_point: 'lap1', drop_off_reason: 'none' })[0]).toContain(
      'both are none',
    );
    expect(messages({ drop_off_point: 'n/a' })[0]).toContain('both n/a or both recorded');
  });

  test('a repeated code, even across two sheets, and a row on two lines', () => {
    const one = sheet({});
    const twice = readSheets(
      [
        { name: 'a.csv', text: one },
        { name: 'b.csv', text: one },
      ],
      COLUMNS,
    );
    expect(twice.problems).toEqual([
      expect.objectContaining({
        file: 'b.csv',
        message: expect.stringContaining('already used at a.csv:2'),
      }),
    ]);
    expect(messages({ notes: 'two\nlines' })[0]).toContain('one line per row');
  });

  test('codes of two rounds, in one sheet or across two', () => {
    const mixed = readSheets(
      [
        { name: 'a.csv', text: sheet({ participant_code: 'G1-A01' }) },
        { name: 'b.csv', text: sheet({ participant_code: 'P5-B01' }) },
      ],
      COLUMNS,
    );
    expect(mixed.problems).toEqual([
      expect.objectContaining({
        file: 'b.csv',
        line: 2,
        column: 'participant_code',
        message: expect.stringContaining('of round P5, but a.csv:2 is of round G1'),
      }),
    ]);
    const within = read(
      sheet(
        { participant_code: 'G1-A01' },
        { participant_code: 'G1-B01' },
        { participant_code: 'P5-A01' },
      ),
    );
    expect(within.problems).toHaveLength(1);
    expect(within.problems[0]!.line).toBe(4);
    expect(
      read(sheet({ participant_code: 'G1-A01' }, { participant_code: 'G1-C07' })).problems,
    ).toEqual([]);
  });

  test('a long notes cell is not an error here: the check command owns that rule', () => {
    expect(read(sheet({ notes: 'x'.repeat(300) })).problems).toEqual([]);
  });
});

describe('the report text', () => {
  const sessions = (() => {
    const tricky = {
      participant_code: 'T1-C03',
      game_length_min: 'n/a',
      q1_hesitated_sell_keep: 'yes - said "hmm", not sure | torn between <two> & more',
    };
    return sessionsOf(...INVENTED, tricky);
  })();
  const { markdown, charts } = renderResults(sessions, ['a.csv', 'b.csv']);

  test('says in the headline how many builds are pooled, and names them', () => {
    expect(markdown).toContain('1 build: `abc1234`.');
    const pooled = renderResults(
      sessionsOf({}, { participant_code: 'T1-A02', build_commit: 'def5678' }),
      ['a.csv'],
    ).markdown;
    expect(pooled).toContain(
      '2 builds pooled, the sessions of different builds counted together: `abc1234`, `def5678`.',
    );
  });

  test('states n and that no threshold applies, and carries no rate, test or "significant"', () => {
    expect(markdown).toContain('n = 7 sessions, from 2 sheets');
    expect(markdown).toContain('No threshold applies to the Human layer (spec §8)');
    for (const text of [markdown, ...charts.map((c) => c.svg)]) {
      expect(text).not.toMatch(/%|significan|p-value|percent/i);
    }
  });

  test('prints the hand-calculated figures with their n', () => {
    expect(markdown).toContain(
      'Game length: observed in 4 of 7 sessions. Median 18.5, smallest 12, largest 26',
    );
    expect(markdown).toContain('Unobserved (n/a, not zero, in no median): T1-C01, T1-C02, T1-C03.');
    expect(markdown).toContain('Hesitations: recorded in 5 of 7 sessions, 5 in total.');
    expect(markdown).toContain('| `sell_keep` | 2 | 2 of 5 | T1-A01, T1-B01 |');
    expect(markdown).toContain('| Finished within the 25-minute cap | 2 of 7 | T1-A01, T1-A02 |');
    expect(markdown).toContain('Not recorded (n/a, not zero): T1-C01, T1-C02.');
  });

  test('quotes every answer exactly as written, whatever characters it holds', () => {
    expect(markdown).toContain(
      '- T1-C03: "yes - said "hmm", not sure | torn between <two> & more"',
    );
    expect(markdown).toContain('- T1-A01: "waiting for the AI turn - a long wait"');
  });

  test('the output passes the sheet privacy check', () => {
    expect(PRIVACY_PATTERN.test(markdown)).toBe(false);
    for (const { svg } of charts) {
      expect(PRIVACY_PATTERN.test(svg.replace(/ xmlns="[^"]*"/, ''))).toBe(false);
    }
  });

  test('the same sheets give the same text, in any order of the sheets', () => {
    const again = renderResults(sessions, ['a.csv', 'b.csv']);
    expect(again).toEqual({ markdown, charts });
    const split = readSheets(
      [
        { name: 'b.csv', text: sheet(...INVENTED.slice(3)) },
        { name: 'a.csv', text: sheet(...INVENTED.slice(0, 3)) },
      ],
      COLUMNS,
    );
    const whole = readSheets([{ name: 'x.csv', text: sheet(...INVENTED) }], COLUMNS);
    expect(split.sessions).toEqual(whole.sessions);
  });
});

describe('the charts', () => {
  const { markdown, charts } = renderResults(sessionsOf(...INVENTED), ['s.csv']);

  test('are static SVG with no script, link or reference to anything else', () => {
    expect(charts.map((c) => c.file)).toEqual(Object.values(CHART_FILES));
    for (const { file, svg } of charts) {
      expect(markdown).toContain(`](${file})`);
      expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
      expect(svg).not.toMatch(/<script|<foreignObject|<image|href=|onload|style=/i);
      expect(svg.endsWith('</svg>\n')).toBe(true);
    }
  });

  test('every bar is labelled "count of n" in its text, its tooltip and the description', () => {
    const outcomes = charts[0]!.svg;
    expect(outcomes).toContain('>2 of 6</text>');
    expect(outcomes).toContain('<title>Finished within the 25-minute cap: 2 of 6</title>');
    expect(outcomes).toContain('Dropped off: 1 of 6');
    const hesitation = charts[1]!.svg;
    expect(hesitation).toContain(
      '<title>Sessions with a hesitation, by type (4 of 6 recorded), sell_keep: 2 of 4</title>',
    );
    expect(hesitation).toContain(
      '<title>Found hesitation (protocol section 9), Yes: 1 of 6</title>',
    );
  });

  test('bar lengths follow the count on one scale, and a zero has no length', () => {
    const rects = [...charts[0]!.svg.matchAll(/<rect x="312" y="\d+" width="(\d+)"/g)].map((m) =>
      Number(m[1]),
    );
    // within 2, over 1, length unobserved 1, dropped 1, unobserved 1, all of 6.
    expect(rects).toEqual([73, 37, 37, 37, 37]);
    const zero = renderResults(sessionsOf({}), ['s.csv']).charts[0]!.svg;
    expect(zero).toContain('<title>Dropped off: 0 of 1</title>');
    expect(zero).toContain('width="0"');
  });
});

describe('the committed G1 sheets', () => {
  test('give a report without an error, with n/a shown as unobserved', () => {
    const folder = new URL('../docs/playtest/g1/', import.meta.url);
    const sheets = readdirSync(folder)
      .filter((name) => /^session-sheet-.*\.csv$/.test(name))
      .map((name) => ({ name, text: readFileSync(new URL(name, folder), 'utf8') }));
    expect(sheets.length).toBeGreaterThan(0);
    const { sessions, problems } = readSheets(sheets, templateHeader());
    expect(problems).toEqual([]);
    const { markdown } = renderResults(
      sessions,
      sheets.map((s) => s.name),
    );
    expect(markdown).toContain(`n = ${sessions.length} session`);
    expect(markdown).toContain('Not recorded (n/a, not zero)');
    expect(PRIVACY_PATTERN.test(markdown)).toBe(false);
  });
});

test('a session type carries the cell text unedited, with the spaces the sheet had', () => {
  const session = sessionsOf({ q1_hesitated_sell_keep: 'no - kept ' })[0]!;
  expect(session.q1.raw).toBe('no - kept ');
});
