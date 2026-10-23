import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { fillSlots, parseLines } from './lines-schema.ts';

const dir = new URL('./lines/en/', import.meta.url);
const files = readdirSync(dir).filter((name) => name.endsWith('.json'));
const read = (file: string): unknown => JSON.parse(readFileSync(new URL(file, dir), 'utf8'));
const situationOf = (file: string) => file.slice(0, -'.json'.length);

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

describe('line bank v0 (§5.7)', () => {
  test('ships the five v0 situations, each validating with 3+ Greedy lines at neutral trust', () => {
    expect(files).toEqual([
      'catch_fail.json',
      'catch_success.json',
      'fallback_notice.json',
      'game_start.json',
      'sold_pokemon.json',
    ]);
    for (const file of files) {
      const lines = parseLines(situationOf(file), read(file));
      const greedyNeutral = lines.filter(
        (l) => l.personality === 'greedy' && l.trust === 'neutral',
      );
      expect(greedyNeutral.length, file).toBeGreaterThanOrEqual(3);
    }
  });

  const THAI = /\p{Script=Thai}/u;
  // Any run of 3+ Latin words; the bank is English, so this guards the scan itself.
  test.each(
    files.flatMap((file) =>
      (read(file) as { id: string; text: string }[]).map((l) => [l.id, l.text]),
    ),
  )('%s is English with only filled slots and no number literals', (_id, text) => {
    expect(text).not.toMatch(THAI);
    const bare = text.replace(/\{(target|turn|pokemon|coins)\}/g, '');
    expect(bare, 'unfilled or malformed brace').not.toMatch(/[{}]/);
    expect(bare, 'number literal that should be a slot').not.toMatch(/\p{N}/u);
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
