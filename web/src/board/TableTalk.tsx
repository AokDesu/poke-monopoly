import type { AiSpeechEvent } from '../../../engine/index.ts';
import { talkEntries, type PublicGame, type VoiceReason } from '../game/tableTalk.ts';
import { t, type MessageKey } from '../i18n/en.ts';
import { className } from '../i18n/names.ts';
import { Button } from '../ui/Button.tsx';
import './table-talk.css';

const REASONS: Record<VoiceReason, MessageKey> = {
  disabled: 'talk.reason.disabled',
  missing_key: 'talk.reason.missing_key',
  budget_exceeded: 'talk.reason.budget_exceeded',
};

export interface TableTalkPanelProps {
  lines: readonly AiSpeechEvent[];
  players: PublicGame['players'];
  /** The viewing seat; absent for a watcher. */
  viewerSeat?: number;
  hidden: boolean;
  onToggle(): void;
  voiceOff: VoiceReason | null;
}

/**
 * The AIs' public table talk (spec §3, §4.8, §5.7). Every line names its speaker and says what
 * wrote it; a line written by Haiku is labelled "AI-written · only words". An exchange, one AI
 * speaking to another and being answered, reads as one group, opening line first. Hiding hides
 * the lines and stops new ones being asked for; nothing in the game changes either way.
 */
export function TableTalkPanel({
  lines,
  players,
  viewerSeat,
  hidden,
  onToggle,
  voiceOff,
}: TableTalkPanelProps) {
  const nameOf = (seatIndex: number) =>
    className(players.find((player) => player.seatIndex === seatIndex)?.classId ?? '');
  const lineItem = (line: AiSpeechEvent, key: number) => (
    <li key={key} data-source={line.source} data-seat={line.speakerSeatIndex}>
      <span className="seat-disc" data-seat={line.speakerSeatIndex} aria-hidden="true">
        {line.speakerSeatIndex}
      </span>
      <div>
        <p className="talk-who">
          <strong>{nameOf(line.speakerSeatIndex)}</strong>
          {line.addressedSeatIndex !== undefined && (
            <span>
              {line.addressedSeatIndex === viewerSeat
                ? t('talk.toYou')
                : t('talk.to', { name: nameOf(line.addressedSeatIndex) })}
            </span>
          )}
        </p>
        <p className="talk-text">{line.text}</p>
        <p className="talk-label" data-label={line.source}>
          {line.source === 'haiku' ? t('talk.aiWritten') : t('talk.bank')}
        </p>
      </div>
    </li>
  );
  const entries = talkEntries(lines)
    .map((entry, index) => ({ entry, index }))
    .toReversed();
  return (
    <section className="panel table-talk" aria-labelledby="table-talk-heading">
      <div className="talk-head">
        <h2 id="table-talk-heading">{t('talk.heading')}</h2>
        <Button
          variant="secondary"
          className="talk-toggle"
          aria-expanded={!hidden}
          aria-controls="table-talk-body"
          onClick={onToggle}
        >
          {hidden ? t('talk.show') : t('talk.hide')}
        </Button>
      </div>
      {voiceOff && (
        <p className="talk-voice" data-voice-reason={voiceOff}>
          <strong className="talk-badge">{t('talk.voiceOff')}</strong>
          <span>{t(REASONS[voiceOff])}</span>
        </p>
      )}
      <div id="table-talk-body">
        {hidden ? (
          <p className="panel-note">{t('talk.hidden')}</p>
        ) : lines.length === 0 ? (
          <p className="panel-note">{t('talk.empty')}</p>
        ) : (
          <ol className="talk-lines" aria-label={t('talk.heading')}>
            {entries.map(({ entry, index }) =>
              entry.kind === 'line' ? (
                lineItem(entry.line, index)
              ) : (
                <li key={index} className="talk-exchange" data-exchange>
                  <ol
                    aria-label={t('talk.exchange', {
                      from: nameOf(entry.opening.speakerSeatIndex),
                      to: nameOf(entry.reply.speakerSeatIndex),
                    })}
                  >
                    {lineItem(entry.opening, 0)}
                    {lineItem(entry.reply, 1)}
                  </ol>
                </li>
              ),
            )}
          </ol>
        )}
      </div>
      <p className="panel-note talk-notice">{t('talk.onlyWords')}</p>
    </section>
  );
}
