import { expect, test } from 'vitest';
import classes from './classes.json';
import evolutions from './evolutions.json';
import items from './items.json';
import species from './species.json';
import voiceFile from './voice/en.json';
import { parseVoice } from './voice-schema.ts';
import { LINES } from '../ai/lines.ts';

const voice = parseVoice(voiceFile);
const texts = [voice.world, ...Object.values(voice.classHints), ...Object.values(voice.topics)];

test('the voice file has a class hint for every class and a topic for every line-bank situation but the backup notice (§5.7)', () => {
  expect(Object.keys(voice.classHints).sort()).toEqual(classes.map((entry) => entry.id).sort());
  expect(Object.keys(voice.topics).sort()).toEqual(
    Object.keys(LINES)
      .filter((situation) => situation !== 'fallback_notice')
      .sort(),
  );
});

test('the voice file names no species, form, class or item and no real-world or official character (§5.4)', () => {
  const names = [
    ...species.map((entry) => entry.name),
    ...evolutions.forms.map((entry) => entry.name),
    ...classes.map((entry) => entry.name),
    ...items.map((entry) => entry.name),
    'Pokémon',
    'Pokemon',
    'Pikachu',
    'Ash',
    'Misty',
    'Brock',
  ];
  for (const text of texts) {
    for (const name of names) expect(text, name).not.toMatch(new RegExp(`\\b${name}\\b`, 'i'));
  }
});

test('the voice schema refuses a digit, markup, an unknown key and an empty text', () => {
  const bad = (change: object) => () => parseVoice({ ...voiceFile, ...change });
  expect(bad({ world: 'A town with 24 squares.' })).toThrow(/plain English/);
  expect(bad({ world: 'A town <b>by the sea</b>.' })).toThrow(/plain English/);
  expect(bad({ world: '' })).toThrow();
  expect(bad({ extra: 'x' })).toThrow();
  expect(bad({ classHints: { 'Bad Key': 'Fine text.' } })).toThrow(/Invalid key/);
  expect(bad({ topics: { game_start: 'It is turn 3.' } })).toThrow(/plain English/);
});
