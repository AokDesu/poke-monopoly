import type { SeatView } from '../game/store.ts';
import type { AiDecision } from '../game/ai.ts';
import { t, type MessageKey } from '../i18n/en.ts';
import { Button } from '../ui/Button.tsx';
import { seatLabel } from './labels.ts';
import type { TurnPlayback, TurnSpeed } from './useTurnPlayback.ts';

const REASONS: Record<string, MessageKey> = {
  disabled: 'ai.reason.disabled',
  missing_key: 'ai.reason.missing_key',
  budget_exceeded: 'ai.reason.budget_exceeded',
  timeout: 'ai.reason.timeout',
  rate_limited: 'ai.reason.rate_limited',
  auth: 'ai.reason.auth',
  stub: 'ai.reason.stub',
  not_an_option: 'ai.backupInvalidAnswer',
  invalid_choice: 'ai.backupInvalidAnswer',
  revision_mismatch: 'ai.backupRevisionMismatch',
  low_confidence: 'ai.backupLowConfidence',
};

export function AiTurn({ view, playback }: { view: SeatView; playback: TurnPlayback }) {
  const game = view.observation.public;
  const latest = new Map<number, AiDecision>();
  for (const entry of view.feed)
    if (entry.decision) latest.set(entry.before.activeSeatIndex, entry.decision);
  const opponents = game.players.filter((player) => player.seatIndex !== view.seatIndex);
  const allBackup =
    playback.status?.backupOnly ||
    (opponents.length > 0 &&
      opponents.every((player) => latest.get(player.seatIndex)?.source === 'fallback'));
  const decision = latest.get(game.activeSeatIndex);
  const backup =
    game.activeSeatIndex !== view.seatIndex &&
    (playback.status?.backupOnly || decision?.source === 'fallback');
  const reason = playback.status?.backupOnly ? playback.status.reason : decision?.fallbackReason;
  return (
    <div className="ai-playback">
      <label className="ai-speed">
        <span>{t('ai.speed')}</span>
        <select
          value={playback.speed}
          onChange={(event) => playback.setSpeed(event.target.value as TurnSpeed)}
        >
          {(['normal', 'fast', 'instant'] as const).map((speed) => (
            <option key={speed} value={speed}>
              {t(`ai.speed.${speed}`)}
            </option>
          ))}
        </select>
      </label>
      {allBackup && (
        <p className="ai-backup-banner" role="status">
          {t('ai.allBackupBanner')}
        </p>
      )}
      {backup && (
        <div className="ai-backup" data-ai-seat={game.activeSeatIndex}>
          <strong className="ai-backup-badge">{t('ai.backupBadge')}</strong>
          <span>{seatLabel(game.activeSeatIndex, view.seatIndex)}</span>
          <p>{t(REASONS[reason ?? ''] ?? 'ai.backupUnavailable')}</p>
        </div>
      )}
      {playback.statusUnavailable && <p className="ai-status-note">{t('ai.statusUnavailable')}</p>}
      {playback.thinking && (
        <p className="ai-thinking" role="status">
          {t('ai.thinking')}
        </p>
      )}
      {playback.line && (
        <div
          className="ai-speech"
          role="group"
          aria-label={t('ai.speech', { name: playback.line.name, line: playback.line.text })}
        >
          <strong>{playback.line.name}</strong>
          <blockquote>{playback.line.text}</blockquote>
          <Button variant="secondary" onClick={playback.skipLine}>
            {t('ai.skipLine')}
          </Button>
        </div>
      )}
    </div>
  );
}
