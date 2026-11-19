import type { SpectatorView } from '../game/store.ts';
import { t } from '../i18n/en.ts';
import { ActionButton } from '../ui/ActionButton.tsx';
import { AiTurn } from './AiTurn.tsx';
import { WatchControls } from './WatchControls.tsx';
import type { TurnPlayback } from './useTurnPlayback.ts';

export interface WatchPanelProps {
  view: SpectatorView;
  playback: TurnPlayback;
  /** A one-time notice (a resumed save); the screen decides when it still applies. */
  notice?: string;
  savingOff: boolean;
  onLeave?: (how: 'save' | 'end') => void;
  onFinished?: () => void;
}

/** What the watcher may do now and what just happened, from the public view alone. */
export function WatchPanel({
  view,
  playback,
  notice,
  savingOff,
  onLeave,
  onFinished,
}: WatchPanelProps) {
  const game = view.observation.public;
  const finished = game.phase.kind === 'finished';
  const body = finished
    ? t('turn.finished')
    : playback.failed
      ? t('turn.opponentError')
      : playback.paused
        ? t('watch.paused')
        : t('watch.playing');
  return (
    <section className="turn-panel panel watch-panel" aria-label={t('watch.controls')}>
      <div className="turn-panel-copy">
        <h2>{finished ? t('board.finished') : t('watch.heading')}</h2>
        <p role={playback.failed ? 'alert' : 'status'}>{body}</p>
        {notice && (
          <p className="turn-banner" role="status">
            {notice}
          </p>
        )}
      </div>
      <AiTurn view={view} playback={playback} />
      {playback.failed && (
        <ActionButton enabled onClick={playback.retry}>
          {t('turn.retry')}
        </ActionButton>
      )}
      {finished && onFinished && (
        <ActionButton enabled onClick={onFinished}>
          {t('nav.results')}
        </ActionButton>
      )}
      <WatchControls
        playback={playback}
        finished={finished}
        savingOff={savingOff}
        onLeave={onLeave}
      />
    </section>
  );
}
