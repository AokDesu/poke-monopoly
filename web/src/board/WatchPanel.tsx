import type { SpectatorView } from '../game/store.ts';
import { t } from '../i18n/en.ts';
import { ActionButton } from '../ui/ActionButton.tsx';
import { AiTurn } from './AiTurn.tsx';
import { DecisionCard } from './DecisionCard.tsx';
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

/**
 * The watcher's card in the decision slot, from the public view alone: what the table is doing,
 * and the watch controls (Pause, Next, Step, Skip to results, Leave) in its footer.
 */
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
    <DecisionCard
      kind="watch"
      heading={finished ? t('board.finished') : t('watch.heading')}
      lead={body}
      alert={playback.failed}
      actions={
        <div className="watch-panel">
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
        </div>
      }
    >
      {notice && (
        <p className="turn-banner" role="status">
          {notice}
        </p>
      )}
      <AiTurn view={view} playback={playback} />
    </DecisionCard>
  );
}
