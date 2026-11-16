import type { Content } from '../../engine/index.ts';
import { SPEECH_INSTRUCTION, SPEECH_MAX_CHARS } from './instruction.ts';
import type { SpeechBrief } from './brief.ts';

export type SpeechRejection =
  | 'empty'
  | 'multiline'
  | 'too_long'
  | 'digit'
  | 'number_word'
  | 'link'
  | 'markup'
  | 'characters'
  | 'item_name'
  | 'unknown_name'
  | 'commitment'
  | 'probe'
  | 'echo';

export type ScreenResult = { ok: true; text: string } | { ok: false; reason: SpeechRejection };

/** Longest run of words a reply may share with the instruction or the brief's own text. */
const ECHO_RUN = 5;

const LINK =
  /\b(?:https?|ftp|www)\b|\b[a-z0-9-]+\.(?:com|net|org|io|dev|app|co|me|ly|gg|xyz|info|ai|ru|cn|uk|de|link|site)\b|\bdot (?:com|net|org)\b/i;
// Markup, code, mentions, escapes and quotation marks (anything quoted is data, not the voice).
const MARKUP = /[<>`*_#[\]{}|\\/@&=~^$%+"“”‘]/;
// Plain English letters (é for Poké) and sentence punctuation only.
const PLAIN = /^[A-Za-zé .,'!?;:-]+$/;

const NUMBER_WORD =
  /\b(?:two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|(?:thir|four|fif|six|seven|eigh|nine)teen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|dozen|zero)\b|\bone (?:\w+ )?(?:balls?|items?|coins?|creatures?)\b/i;

// A reviewed short list; loose talk is not a contract, so the screen refuses anything that sounds like one (spec §4.8).
const COMMITMENT = [
  /\bpromis(?:e|es|ed|ing)\b/,
  /\bdeals?\b/,
  /\boffer(?:s|ed|ing)?\b/,
  /\btrad(?:e|es|ed|ing)\b/,
  /\bswap(?:s|ped|ping)?\b/,
  /\bbargain/,
  /\bguarantee/,
  /\bpledge/,
  /\bswear\b/,
  /\bowe\b/,
  /\bgift/,
  /\btruce\b|\bpact\b|\balliance\b|\bally\b/,
  /\bmy word\b|\bcount on me\b|\byou can (?:have|count on|trust)\b/,
  /\bi(?:'ll| will| shall| am going to|'m going to)\s+(?:give|pay|send|sell|lend|hand|share|spare|return|let you|help you|not attack|never attack|leave you|protect)/,
  /\b(?:won't|will not|never)\s+attack\b/,
];

// Questions about hidden things and attempts to steer the writer.
const PROBE = [
  /\b(?:secrets?|hidden|seed|deck|pouch|inventory|peek|peeked|rng|password|system|prompts?|instructions?)\b/,
  /\b(?:ignore|disregard)\b/,
  /\b(?:show|tell|reveal|share|give)\s+(?:me|us)\b/,
  /\b(?:my|your|the)\s+hand\b/,
  /\bas an? (?:ai|assistant)\b|\blanguage model\b/,
  /\b(?:what|which|how many|how much)\b.{0,40}\b(?:items?|balls?|coins?|cards?|holding|hold|carry|carrying|have|got)\b/,
  /\b(?:do|does|did)\s+you\s+(?:hold|have|carry|own)\b/,
];

// Real species the game does not have. A list is never complete: the capital-letter rule below is
// the general check; this catches the best-known names written in lower case or opening a sentence.
const OUTSIDE_SPECIES = [
  'pikachu', 'mewtwo', 'mew', 'jigglypuff', 'meowth', 'togepi', 'lucario', 'greninja', 'gengar',
  'alakazam', 'onix', 'geodude', 'zubat', 'vulpix', 'ninetales', 'lapras', 'ditto', 'abra',
  'kadabra', 'slowpoke', 'cubone', 'marowak', 'oddish', 'bellsprout', 'diglett', 'mimikyu',
  'garchomp', 'rayquaza', 'lugia', 'celebi',
]; // prettier-ignore

const words = (text: string) => text.toLowerCase().match(/[a-zé]+/g) ?? [];

function runs(text: string): Set<string> {
  const list = words(text);
  const found = new Set<string>();
  for (let i = 0; i + ECHO_RUN <= list.length; i++) {
    found.add(list.slice(i, i + ECHO_RUN).join(' '));
  }
  return found;
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Every proper name the game owns; a capitalised word outside this set may be a foreign species. */
function knownNames(brief: SpeechBrief, content: Content): Set<string> {
  const names = [
    ...content.species.map((entry) => entry.name),
    ...(content.evolutions?.forms ?? []).map((entry) => entry.name),
    ...content.classes.map((entry) => entry.name),
    ...content.board.map((square) => square.name),
    ...content.items.map((item) => item.name),
    brief.speaker.name,
    brief.speaker.personality.name,
    ...(brief.addressed ? [brief.addressed.name] : []),
    // The game's own terms, which a line may capitalise; not foreign species.
    ...['Pokémon', 'Pokemon', 'Poké', 'Lap', 'Laps', 'Ball', 'Balls', 'Badge', 'Badges'],
    ...['Ability', 'Abilities', 'Tired', 'Social', 'Strategy'],
  ];
  return new Set(names.flatMap(words));
}

/**
 * The output screen (spec §5.7, §4.8): accepts a reply only if it is one plain line that carries no
 * number, link, markup, hidden item, foreign species, offer or echo. Pure: no model, no network.
 */
export function screenSpeech(reply: string, brief: SpeechBrief, content: Content): ScreenResult {
  const text = reply.trim();
  const reject = (reason: SpeechRejection): ScreenResult => ({ ok: false, reason });
  if (text.length === 0) return reject('empty');
  if (/[\r\n\u2028\u2029]/.test(text)) return reject('multiline');
  if ([...text].length > SPEECH_MAX_CHARS) return reject('too_long');
  if (/\p{N}/u.test(text)) return reject('digit');
  if (LINK.test(text)) return reject('link');
  if (MARKUP.test(text)) return reject('markup');
  if (!PLAIN.test(text)) return reject('characters');
  if (NUMBER_WORD.test(text)) return reject('number_word');

  for (const item of content.items) {
    if (item.kind === 'utility' && !brief.public_items.includes(item.name)) {
      if (new RegExp(`\\b${escape(item.name)}\\b`, 'i').test(text)) return reject('item_name');
    }
  }

  const known = knownNames(brief, content);
  const foreign = new Set(OUTSIDE_SPECIES.filter((name) => !known.has(name)));
  for (const match of text.matchAll(/[A-Za-zé]+(?:'[A-Za-z]+)?/g)) {
    const word = match[0].split("'")[0]!;
    const lower = word.toLowerCase();
    if (foreign.has(lower)) return reject('unknown_name');
    const opensSentence = /(?:^|[.!?]\s*)$/.test(text.slice(0, match.index));
    if (/^[A-Z]/.test(word) && !opensSentence && word !== 'I' && !known.has(lower)) {
      return reject('unknown_name');
    }
  }

  const own = runs(
    [
      SPEECH_INSTRUCTION,
      brief.world,
      brief.topic.text,
      brief.speaker.class_hint,
      brief.speaker.personality.text,
    ].join('. '),
  );
  for (const run of runs(text)) if (own.has(run)) return reject('echo');
  const lower = text.toLowerCase();
  if (COMMITMENT.some((pattern) => pattern.test(lower))) return reject('commitment');
  if (PROBE.some((pattern) => pattern.test(lower))) return reject('probe');

  return { ok: true, text };
}
