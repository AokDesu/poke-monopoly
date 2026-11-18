import type { ChatTopic } from '../../engine/index.ts';
import type { ChatDecision } from '../../engine/contract/speech.ts';
import type { Situation } from '../lines.ts';

/**
 * The words behind a chat reply (spec §4.8, §5.7). Team-written English, like `SPEECH_INSTRUCTION`:
 * changing it needs a team review. The brief carries these as data; none holds a digit, an item or
 * a species name, so the writer is told what the player raised and what its character decided, and
 * never what the player's message named (an item ID, a leader) or what any seat holds.
 */
export const CHAT_TOPIC_TEXT: Readonly<Record<ChatTopic, string>> = Object.freeze({
  truce: 'The player asked you to ease off and leave them alone for a while.',
  trade: 'The player floated the idea of an exchange between the two of you.',
  point_leader: 'The player pointed out that another trainer is currently ahead at the table.',
  use_item: 'The player asked you to make use of something you carry.',
  hold_item: 'The player asked you to keep something you carry in reserve.',
});

/** What the character has already decided; the writer only puts it into words. */
export const CHAT_DECISION_TEXT: Readonly<Record<ChatDecision, string>> = Object.freeze({
  noncommittal:
    'You have decided not to answer yet. You neither agree nor refuse: you only acknowledge what was said and keep your options open.',
  refused: 'You have decided to turn this down. You politely refuse and keep to your own plans.',
});

/** How the reply must read, whatever the topic: words only, and the decision is not the writer's to change. */
export const CHAT_REPLY_RULES =
  'Answer the player in character in one or two short sentences. Match the decision exactly and never change it. ' +
  'Say nothing about what you hold, whether you will use or keep anything, or what you will do on your turn. ' +
  'Do not agree, and do not promise or offer anything.';

/**
 * The line-bank situation a decision belongs to (`ai/chat-reply.ts`): the bank's own line is the
 * fallback the browser already holds, and the situation's voice topic opens the brief.
 */
export const chatSituation = (decision: ChatDecision): Situation =>
  decision === 'refused' ? 'manipulation_refused' : 'chat_reply';

// Words of assent. A reply that says them agrees to something, which no decision here is.
const ASSENT = [
  /\b(?:yes|yeah|yep|sure|okay|ok|agreed?|accept(?:ed|s)?|gladly|happily|willingly)\b/,
  /\bof course\b|\bcount me in\b|\bsounds? (?:good|great|fair)\b|\bgood (?:idea|plan)\b|\bgreat (?:idea|plan)\b|\bwhy not\b|\bit(?:'s| is) a plan\b|\blet's\b/,
  /\bi(?:'ll| will| shall| would be glad to| can)\s+(?:do|try|use|hold|keep|go along|join|gladly|happily)\b/,
];

// Words of refusal. A reply that says them turns the message down, which a noncommittal one never does.
const REFUSAL = [
  /(?:^|[.!?]\s+)no\b|\b(?:nope|nah|never|refuse[sd]?|declin(?:e|es|ed|ing)|reject(?:s|ed|ing)?|cannot|can't|won't|wouldn't|unwilling)\b/,
  /\bwill not\b|\bnot (?:going|happening|interested|doing)\b|\bnot this time\b|\bnot falling\b|\bfalling for\b/,
];

// Words of consideration. A reply that says them leaves the matter open, which a refusal never does.
const OPEN = [
  /\b(?:maybe|perhaps|possibly|consider(?:ing)?|weigh(?:ing)?|undecided)\b/,
  /\bthink(?:ing)? (?:it|that|this|about|on)\b|\bwe(?:'ll| will) see\b|\bsee how\b|\bkeep(?:ing)? (?:it|that|this) in mind\b|\bmight\b|\bnoted\b/,
];

const matches = (patterns: readonly RegExp[], text: string) =>
  patterns.some((pattern) => pattern.test(text));

/**
 * Whether `text` reads the opposite of `decision` (spec §4.8: the words never change the decision).
 * A noncommittal reply must neither assent nor refuse; a refusal must neither assent nor stay open.
 * A deliberately blunt check over a short reviewed word list: a false hit only sends the player the
 * line-bank line, and a miss still changes nothing, because words never touch the decision.
 */
export function contradictsDecision(text: string, decision: ChatDecision): boolean {
  const lower = text.toLowerCase();
  if (matches(ASSENT, lower)) return true;
  return decision === 'refused' ? matches(OPEN, lower) : matches(REFUSAL, lower);
}

const words = (text: string) => text.toLowerCase().match(/[a-zé]+/g) ?? [];

/** Whether `text` repeats a run of five words from `source`: the writer must not parrot the brief. */
export function echoesAny(text: string, sources: readonly string[], run = 5): boolean {
  const own = new Set<string>();
  for (const source of sources) {
    const list = words(source);
    for (let i = 0; i + run <= list.length; i++) own.add(list.slice(i, i + run).join(' '));
  }
  const list = words(text);
  for (let i = 0; i + run <= list.length; i++) {
    if (own.has(list.slice(i, i + run).join(' '))) return true;
  }
  return false;
}
