import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { toEngineContent } from '../../content/schema.ts';
import { PERSONALITY_IDS, SLOTS, parseLines, type Line } from '../../content/lines-schema.ts';
import { PERSONALITIES } from '../fallback/index.ts';
import { CONTENT } from '../questions/content.ts';
import { LINES, type Situation } from '../lines.ts';
import { screenSpeech, VOICE, type SpeechBrief } from './index.ts';

const content = toEngineContent(CONTENT);

/**
 * The situations table talk draws bank lines from (spec §5.7). Speaking about its own turn, an AI
 * uses an `_own` situation or one of the first-person after-action situations; speaking about
 * another seat it uses an `_other` one. The rest are the table-wide ones.
 */
const FIRST_PERSON = ['catch_success', 'catch_fail', 'sold_pokemon', 'gym_win'] as const;
const OWN = [
  'roll_high_own',
  'roll_low_own',
  'battle_won_own',
  'battle_lost_own',
  'coins_in_own',
  'coins_out_own',
] as const;
const OTHER = [
  'catch_other',
  'miss_other',
  'roll_high_other',
  'roll_low_other',
  'battle_won_other',
  'battle_lost_other',
  'coins_other',
  'sale_other',
  'gym_win_other',
] as const;
const TABLE = ['game_start', 'taunt_leader', 'table_banter', 'table_retort'] as const;
const NEW_SITUATIONS = [...OWN, ...OTHER, 'table_banter', 'table_retort'] as const;
const ALL = [...FIRST_PERSON, ...OWN, ...OTHER, ...TABLE];

const filePath = (situation: string) =>
  new URL(`../../content/lines/en/${situation}.json`, import.meta.url);
const read = (situation: string): Line[] =>
  parseLines(situation, JSON.parse(readFileSync(filePath(situation), 'utf8')));

/** The brief the output screen reads: no public items, so every utility item name is hidden. */
const brief = (situation: Situation, personalityId: string): SpeechBrief => ({
  topic: { id: situation, text: VOICE.topics[situation] ?? '' },
  world: VOICE.world,
  lap_stage: 'first lap',
  speaker: {
    name: 'Rival',
    class_hint: VOICE.classHints.rival ?? '',
    coins: 'level',
    personality: {
      name: PERSONALITIES[personalityId as keyof typeof PERSONALITIES].name,
      text: PERSONALITIES[personalityId as keyof typeof PERSONALITIES].description,
      line_style: PERSONALITIES[personalityId as keyof typeof PERSONALITIES].lineStyle,
    },
  },
  addressed: { name: 'Fisherman', coins: 'level' },
  recent_events: [],
  public_items: [],
});

// A slot is filled with a plain word: the real values are the engine's facts, and a number is
// never part of a line the output screen would read.
const FILL: Record<string, string> = { target: 'Fisherman', pokemon: 'Magikarp', coins: 'some' };
const fill = (text: string) => text.replace(/\{(\w+)\}/g, (_, slot: string) => FILL[slot] ?? slot);

describe('the table talk line bank (§5.7)', () => {
  test('every table talk situation is registered in the line bank', () => {
    for (const situation of ALL) expect(Object.keys(LINES), situation).toContain(situation);
  });

  test.each(NEW_SITUATIONS)(
    '%s has four lines for each personality, at neutral trust, and the files match the registry',
    (situation) => {
      const lines = read(situation);
      expect(lines).toEqual(LINES[situation]);
      for (const personality of PERSONALITY_IDS) {
        const own = lines.filter((line) => line.personality === personality);
        expect(own.length, personality).toBeGreaterThanOrEqual(4);
        for (const [index, line] of own.entries()) {
          expect(line.trust).toBe('neutral');
          expect(line.id).toBe(
            `${situation.replaceAll('_', '-')}-${personality}-neutral-${index + 1}`,
          );
        }
      }
    },
  );

  test.each(ALL)(
    '%s: every line is short and every slot is one the table can fill',
    (situation) => {
      for (const line of read(situation)) {
        expect(line.text.length, line.id).toBeLessThanOrEqual(110);
        for (const [, slot] of line.text.matchAll(/\{(\w+)\}/g))
          expect(SLOTS as readonly string[], line.id).toContain(slot);
      }
    },
  );

  // A slot a situation never fills (spec §5.7) would show as a brace; these are the facts each
  // situation's moment carries.
  test.each([
    [OWN, []],
    [['catch_success', 'catch_fail', 'gym_win', 'gym_win_other'] as const, ['pokemon', 'target']],
    [OTHER, ['target']],
    [['sold_pokemon'] as const, ['pokemon', 'coins', 'target']],
  ] as const)('%j uses only the slots %j', (situations, allowed) => {
    for (const situation of situations)
      for (const line of read(situation))
        for (const [, slot] of line.text.matchAll(/\{(\w+)\}/g))
          expect(allowed as readonly string[], line.id).toContain(slot);
  });

  test.each(NEW_SITUATIONS)(
    '%s: a line about another seat names it, so the line says who the moment is about',
    (situation) => {
      if (!(OTHER as readonly string[]).includes(situation)) return;
      for (const line of read(situation)) expect(line.text, line.id).toContain('{target}');
    },
  );

  // The bank is held to the output screen Haiku's lines pass: no digit, number word, link, offer,
  // probe, foreign species or utility item name, so no line can name a hidden thing.
  test.each(NEW_SITUATIONS)('%s: every line passes the output screen', (situation) => {
    for (const line of read(situation)) {
      const result = screenSpeech(fill(line.text), brief(situation, line.personality), content);
      expect(result, `${line.id}: ${line.text}`).toEqual({ ok: true, text: fill(line.text) });
    }
  });

  // The first three greetings per personality are the core tier's; the greetings table talk added
  // (numbered 4 and up) are held to the output screen.
  test('game_start keeps its core greetings and the new ones pass the output screen', () => {
    const lines = read('game_start');
    for (const personality of PERSONALITY_IDS)
      expect(
        lines.filter((line) => line.personality === personality).length,
      ).toBeGreaterThanOrEqual(6);
    for (const line of lines.filter((entry) => Number(entry.id.split('-').at(-1)) > 3)) {
      const result = screenSpeech(fill(line.text), brief('game_start', line.personality), content);
      expect(result, `${line.id}: ${line.text}`).toEqual({ ok: true, text: fill(line.text) });
    }
  });
});
