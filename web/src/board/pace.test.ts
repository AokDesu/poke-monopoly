import { fc, test as fcTest } from '@fast-check/vitest';
import { expect, test } from 'vitest';
import { PACES } from '../game/setup.ts';
import { holdMs, PACE_TIMING, wordCount } from './pace.ts';

const words = fc
  .array(fc.oneof(fc.stringMatching(/^[A-Za-zé]{1,9}$/), fc.constantFrom('·', '→', '(−3)', '+5')), {
    maxLength: 30,
  })
  .map((parts) => parts.join(' '));

const rival = (text: string) => ({ text, ownChoice: false, ownResult: false });

test('the Readable numbers are the ones the pace was chosen with (#251 §9)', () => {
  expect(PACE_TIMING.readable).toEqual({
    fillerMs: 250,
    hold: { baseMs: 1200, perWordMs: 300, minMs: 2500, maxMs: 5000 },
    ownMinMs: 2500,
    speechMs: 1000,
    foldMs: 1500,
  });
});

test('a reader counts words, not the dots and arrows between them', () => {
  expect(wordCount('Caught Magikarp')).toBe(2);
  expect(wordCount('Found Magikarp · threw a Poké Ball')).toBe(6);
  expect(wordCount('Rolled 3 → Wild 5')).toBe(4);
  expect(wordCount('Bought from the Shop (−3)')).toBe(5);
  expect(wordCount('  ')).toBe(0);
});

test('worked holds at Readable: a short outcome 2.5 s, a longer one by its words, never past 5 s', () => {
  expect(holdMs(rival('Caught Magikarp'), 'readable')).toBe(2500);
  expect(holdMs(rival('Found Magikarp · threw a Poké Ball'), 'readable')).toBe(3000);
  expect(
    holdMs(rival('one two three four five six seven eight nine ten eleven twelve'), 'readable'),
  ).toBe(4800);
  expect(holdMs(rival('a b c d e f g h i j k l m n'), 'readable')).toBe(5000);
});

fcTest.prop([words])(
  'every rival outcome at Readable is held 1.2 s + 0.3 s a word, within 2.5-5 s',
  (text) => {
    const held = holdMs(rival(text), 'readable');
    expect(held).toBe(Math.min(5000, Math.max(2500, 1200 + 300 * wordCount(text))));
    expect(held).toBeGreaterThanOrEqual(2500);
    expect(held).toBeLessThanOrEqual(5000);
  },
);

fcTest.prop([words])(
  'the player’s own result is never held shorter than 2.5 s at Readable',
  (text) => {
    expect(holdMs({ text, ownChoice: false, ownResult: true }, 'readable')).toBeGreaterThanOrEqual(
      2500,
    );
  },
);

fcTest.prop([words, fc.constantFrom(...PACES)])(
  'a choice the player just made is never held: they know it already',
  (text, pace) => {
    expect(holdMs({ text, ownChoice: true, ownResult: false }, pace)).toBe(0);
  },
);

fcTest.prop([words])('at Step every outcome waits for Next; at Instant nothing waits', (text) => {
  expect(holdMs(rival(text), 'step')).toBe(Infinity);
  expect(holdMs({ text, ownChoice: false, ownResult: true }, 'step')).toBe(Infinity);
  expect(holdMs(rival(text), 'instant')).toBe(0);
  expect(holdMs({ text, ownChoice: false, ownResult: true }, 'instant')).toBe(0);
});

fcTest.prop([words])(
  'the paces keep their order: Readable holds longer than Fast, Fast than Instant',
  (text) => {
    const readable = holdMs(rival(text), 'readable');
    const fast = holdMs(rival(text), 'fast');
    expect(readable).toBeGreaterThan(fast);
    expect(fast).toBeGreaterThan(holdMs(rival(text), 'instant'));
    expect(PACE_TIMING.fast.fillerMs).toBeLessThanOrEqual(PACE_TIMING.readable.fillerMs);
  },
);
