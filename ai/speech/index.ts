import voiceFile from '../../content/voice/en.json';
import { parseVoice } from '../../content/voice-schema.ts';
import type { Content, RngState } from '../../engine/index.ts';
import { selectLine, LINES, type LineSelection } from '../lines.ts';
import type { SpeechBrief } from './brief.ts';
import { screenSpeech, type SpeechRejection } from './screen.ts';

export * from './brief.ts';
export * from './instruction.ts';
export * from './screen.ts';

/** `content/voice/en.json`, validated (spec §5.7). */
export const VOICE = parseVoice(voiceFile);

export type SpokenLine = { rng: RngState; rejection?: SpeechRejection } & (
  { kind: 'haiku'; text: string } | { kind: 'bank'; selection: LineSelection } | { kind: 'silence' }
);

/**
 * Screens a recorded or live model reply (`null`: none came in time). A line that passes is used as
 * written; any other becomes a line-bank pick with the presentation RNG, or silence when the
 * personality has no line for the topic. Nothing is ever invented (spec §5.7).
 */
export function resolveSpeech(args: {
  reply: string | null;
  brief: SpeechBrief;
  content: Content;
  personalityId: string;
  /** The presentation RNG, never the gameplay one. */
  rng: RngState;
}): SpokenLine {
  const { reply, brief, content, personalityId, rng } = args;
  const screened = reply === null ? undefined : screenSpeech(reply, brief, content);
  if (screened?.ok) return { kind: 'haiku', text: screened.text, rng };
  const rejection = screened?.ok === false ? screened.reason : undefined;
  const situation = brief.topic.id;
  const covered = LINES[situation].some(
    (line) => line.personality === personalityId && line.trust === 'neutral',
  );
  if (!covered) return { kind: 'silence', rng, rejection };
  const selection = selectLine(situation, personalityId, 'neutral', rng);
  return { kind: 'bank', selection, rng: selection.rng, rejection };
}
