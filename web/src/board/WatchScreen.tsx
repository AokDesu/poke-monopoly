import { useRef } from 'react';
import type { GameStore, SpectatorView } from '../game/store.ts';
import { AllBackupBanner, backupSeats, PaceSelect } from './AiTurn.tsx';
import { Board } from './Board.tsx';
import { SeatRows } from './SeatRows.tsx';
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
 * board nothing else: no `own`, so no hand, Ball pouch, secret item, peek result or "You" can
 * appear. Each AI's row tells its turns at the same pace as a player's game.
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
  return (
    <Board
      observation={{ public: game }}
      feed={view.feed}
      walk={!playback.skipping && playback.pace !== 'instant'}
      pace={<PaceSelect playback={playback} />}
      seats={
        <>
          <AllBackupBanner view={view} playback={playback} />
          <SeatRows
            observation={{ public: game }}
            viewerSeat={undefined}
            story={playback.story}
            pace={playback.skipping ? 'instant' : playback.pace}
            opponents={view.opponents}
            backup={backupSeats(view, playback.status)}
          />
        </>
      }
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
