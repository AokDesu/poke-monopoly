import { useRef } from 'react';
import type { GameStore, SpectatorView } from '../game/store.ts';
import { t } from '../i18n/en.ts';
import { Board } from './Board.tsx';
import { opponentMessageOf } from './TurnPanel.tsx';
import { useTurnPlayback } from './useTurnPlayback.ts';
import { WatchPanel } from './WatchPanel.tsx';

export interface WatchScreenProps {
  store: GameStore;
  view: SpectatorView;
  notice?: string;
  /** True when the browser cannot keep a save. */
  savingOff?: boolean;
  onFinished?: () => void;
  /** Leave is offered only where the screen has somewhere to go. */
  onLeave?: (how: 'save' | 'end') => void;
}

/**
 * The board of a game with no human seat. It reads the public-only spectator view and hands the
 * board nothing else: no `own`, so no Ball pouch, secret item, peek result or "You" can appear.
 */
export function WatchScreen({
  store,
  view,
  notice,
  savingOff = false,
  onFinished,
  onLeave,
}: WatchScreenProps) {
  const playback = useTurnPlayback(store, view);
  const openedAt = useRef<number | null>(null);
  const game = view.observation.public;
  if (openedAt.current === null) openedAt.current = game.stateRevision;
  const opponentMessage = opponentMessageOf(view);
  // The current action, spelled out under the board loop where the spotlight is (issue #123).
  const focus =
    game.phase.kind !== 'finished' && opponentMessage ? (
      <div className="now-strip" data-seat={game.activeSeatIndex}>
        <span className="seat-disc" data-seat={game.activeSeatIndex}>
          {game.activeSeatIndex}
        </span>
        <p>
          <strong>{t('ai.now')}</strong>
          <span aria-hidden="true" className="now-between">
            {' — '}
          </span>
          {opponentMessage.text}
        </p>
      </div>
    ) : undefined;
  return (
    <Board
      observation={{ public: game }}
      feed={view.feed}
      opponents={view.opponents}
      focus={focus}
      controls={
        <WatchPanel
          view={view}
          playback={playback}
          notice={notice && game.stateRevision === openedAt.current ? notice : undefined}
          savingOff={savingOff}
          onLeave={onLeave}
          onFinished={onFinished}
        />
      }
    />
  );
}
