import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { PERSONALITY_IDS, SLOTS, fillSlots, parseLines, type Line } from './lines-schema.ts';

const dir = new URL('./lines/en/', import.meta.url);
const files = readdirSync(dir).filter((name) => name.endsWith('.json'));
const read = (file: string): unknown => JSON.parse(readFileSync(new URL(file, dir), 'utf8'));
const situationOf = (file: string) => file.slice(0, -'.json'.length);

const MIN_LINES = 3; // spec §5.7: per situation, per personality, per trust bucket
/**
 * Every situation × personality × trust bucket in use that has fewer than MIN_LINES lines. A bucket
 * is "in use" when any file has a line for it; low and high trust are not authored yet, so today
 * that is `neutral` only, and authoring them later needs no change here.
 */
function coverageGaps(bank: Record<string, Line[]>, personalities: readonly string[]): string[] {
  const buckets = new Set(Object.values(bank).flatMap((lines) => lines.map((l) => l.trust)));
  return Object.entries(bank).flatMap(([situation, lines]) =>
    personalities.flatMap((personality) =>
      [...buckets].flatMap((trust) => {
        const count = lines.filter(
          (l) => l.personality === personality && l.trust === trust,
        ).length;
        return count >= MIN_LINES ? [] : [`${situation} / ${personality} / ${trust}: ${count}`];
      }),
    ),
  );
}
const bank = Object.fromEntries(
  files.map((file) => [situationOf(file), parseLines(situationOf(file), read(file))]),
);
// Personalities the project knows: the spec §5.5 ids, plus any personality file that has landed.
const personalityFiles = readdirSync(new URL('./personalities/', import.meta.url))
  .filter((name) => name.endsWith('.json'))
  .map((name) => name.slice(0, -'.json'.length));

test('fillSlots puts the engine name and turn into {target} and {turn}', () => {
  expect(fillSlots('{target}, see you on turn {turn}.', { target: 'Ash', turn: 7 })).toBe(
    'Ash, see you on turn 7.',
  );
});

test('fillSlots throws when the engine gives no value for a slot', () => {
  expect(() => fillSlots('Your move, {target}.', { turn: 3 })).toThrow(/target/);
});

test('fillSlots throws on a slot the line bank does not know', () => {
  expect(() => fillSlots('Hello {name}.', {})).toThrow(/unknown slot "name"/);
});

describe('line bank (§5.7)', () => {
  test('ships the 13 situations of the core tier', () => {
    expect(files.map(situationOf)).toEqual(
      [
        'catch_fail',
        'catch_success',
        'chat_reply',
        'deal_accept',
        'deal_reject',
        'fallback_notice',
        'game_start',
        'gym_win',
        'manipulation_refused',
        'promise_broken',
        'promise_kept',
        'sold_pokemon',
        'taunt_leader',
      ].sort(),
    );
  });

  test('every situation has 3+ lines for every personality at every trust bucket in use', () => {
    expect(coverageGaps(bank, PERSONALITY_IDS)).toEqual([]);
  });

  test('every personality file on disk is one the line bank covers', () => {
    expect(
      personalityFiles.filter((id) => !(PERSONALITY_IDS as readonly string[]).includes(id)),
    ).toEqual([]);
  });

  test('the coverage check reports a thin bucket and a missing personality', () => {
    const line = (id: string, personality: string, trust: string): Line => ({
      id,
      personality: personality as Line['personality'],
      trust,
      text: 'Hi.',
    });
    const three = (personality: string, trust: string) =>
      [1, 2, 3].map((n) => line(`${personality}-${trust}-${n}`, personality, trust));
    expect(
      coverageGaps(
        {
          s: [
            ...three('greedy', 'neutral'),
            ...three('greedy', 'low'),
            line('x', 'cautious', 'neutral'),
          ],
        },
        ['greedy', 'cautious', 'aggressive'],
      ),
    ).toEqual([
      's / cautious / neutral: 1',
      's / cautious / low: 0',
      's / aggressive / neutral: 0',
      's / aggressive / low: 0',
    ]);
  });

  test('line ids are unique across the whole bank, so an id names one line', () => {
    const ids = Object.values(bank).flatMap((lines) => lines.map((l) => l.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  const allSlots = Object.fromEntries(SLOTS.map((slot) => [slot, slot]));
  test.each(
    files.flatMap((file) =>
      (read(file) as { id: string }[]).map((line) => [line.id, situationOf(file), line] as const),
    ),
  )('%s validates on its own and fills every slot', (_id, situation, line) => {
    const [parsed] = parseLines(situation, [line]);
    expect(() => fillSlots(parsed!.text, allSlots)).not.toThrow();
  });

  test('fallback_notice says plainly that a backup bot is playing', () => {
    for (const line of parseLines('fallback_notice', read('fallback_notice.json'))) {
      expect(line.text).toMatch(/\ba backup bot is (playing|making my moves)\b/i);
    }
  });

  test.each([
    [
      'an unknown slot',
      [{ id: 'a', personality: 'greedy', trust: 'neutral', text: 'Hi {name}.' }],
      'slots',
    ],
    [
      'a duplicate id',
      [
        { id: 'a', personality: 'greedy', trust: 'neutral', text: 'One.' },
        { id: 'a', personality: 'greedy', trust: 'neutral', text: 'Two.' },
      ],
      'unique',
    ],
    [
      'an unknown key',
      [{ id: 'a', personality: 'greedy', trust: 'neutral', text: 'One.', mood: 'x' }],
      'mood',
    ],
  ])('a line file with %s is refused with a readable message', (_what, json, message) => {
    expect(() => parseLines('broken', json)).toThrow(message);
  });
});

describe('a broken copy of deal_accept.json is refused with a readable message', () => {
  const real = parseLines('deal_accept', read('deal_accept.json'));
  const first = real[0]!;
  test.each([
    ['a duplicate id', [...real, { ...first }], 'line ids must be unique'],
    ['an unknown slot', [{ ...first, text: 'Hello {name}.' }], 'may only use the slots'],
    ['Thai text', [{ ...first, text: 'ตกลง' }], 'without Thai script'],
    ['a number literal', [{ ...first, text: 'Deal for 5 coins.' }], 'number literals'],
    [
      'an unknown personality key',
      [{ ...first, personality: 'sneaky' }],
      'personality must be one of',
    ],
  ])('%s', (_what, json, message) => {
    expect(() => parseLines('deal_accept', json)).toThrow(message);
    expect(() => parseLines('deal_accept', json)).toThrow('Invalid lines "deal_accept"');
  });
});

test.each(['Hello {target', 'Hello {unknown-slot}'])(
  'slot filler rejects malformed template %s',
  (text) => {
    expect(() => fillSlots(text, {})).toThrow();
  },
);

test.each(['Hello {target', 'Hello {unknown-slot}', 'Hello target}', 'Thai ภาษาไทย', 'Turn 42.'])(
  'line validation rejects unsafe template %s',
  (text) => {
    expect(() =>
      parseLines('broken', [{ id: 'broken', personality: 'greedy', trust: 'neutral', text }]),
    ).toThrow();
  },
);
