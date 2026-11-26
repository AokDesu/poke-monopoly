import { useRef, useState, useSyncExternalStore } from 'react';
import type { GameStore } from '../game/store.ts';
import { t } from '../i18n/en.ts';
import { Screen } from '../ui/Screen.tsx';
import { AllBackupBanner, backupSeats, PaceSelect } from './AiTurn.tsx';
import { Board } from './Board.tsx';
import { PromisePanel } from './PromisePanel.tsx';
import { TableTalkPanel } from './TableTalk.tsx';
import { useChatReply } from './useChatReply.ts';
import { useTableTalk } from './useTableTalk.ts';
import { useTurnPlayback } from './useTurnPlayback.ts';
import { SeatRows } from './SeatRows.tsx';
import { TurnPanel } from './TurnPanel.tsx';
import { WatchScreen } from './WatchScreen.tsx';
import './turn-flow.css';
import './decision-panels.css';

export interface BoardScreenProps {
  store: GameStore;
  notice?: string;
  onFinished?: () => void;
  /** Watch mode only: true when the browser cannot keep a save. */
  savingOff?: boolean;
  /** Watch mode only: the watcher chose Save and continue later, or End, from Leave. Without it the bar has no Leave. */
  onLeave?: (how: 'save' | 'end') => void;
}

/** A game with no human seat is watched; any other game is played from its human seat. */
export function BoardScreen({ savingOff, onLeave, ...props }: BoardScreenProps) {
  const spectator = useSyncExternalStore(props.store.subscribe, props.store.getSpectatorView);
  return spectator ? (
    <WatchScreen
      store={props.store}
      view={spectator}
      notice={props.notice}
      savingOff={savingOff}
      onFinished={props.onFinished}
      onLeave={onLeave}
    />
  ) : (
    <PlayerBoardScreen {...props} />
  );
}

/**
 * The play screen read from one seat (the view's `seatIndex`): the board, that seat's hand and
 * rows, and its decision card. Nothing here reads which seat is "the human" another way, so a
 * game with several people can hand the same screen another seat's view.
 */
function PlayerBoardScreen({
  store,
  notice,
  onFinished,
}: Pick<BoardScreenProps, 'store' | 'notice' | 'onFinished'>) {
  const view = useSyncExternalStore(store.subscribe, store.getView);
  const openedAt = useRef<number | null>(null);
  const playback = useTurnPlayback(store, view);
  const talk = useTableTalk(store, view, playback);
  const social = useChatReply(store, view);
  const [actionError, setActionError] = useState<number | null>(null);
  if (view && openedAt.current === null) openedAt.current = view.observation.public.stateRevision;

  if (!view) return <Screen heading={t('play.heading')} body={t('board.noGame')} />;
  const { public: game } = view.observation;
  const choose = (id: string) => {
    if ('rejected' in store.choose(id)) {
      setActionError(store.getView()?.observation.public.stateRevision ?? game.stateRevision);
    }
  };
  const you = game.players.find((player) => player.seatIndex === view.seatIndex)!;
  return (
    <Board
      observation={view.observation}
      feed={view.feed}
      walk={!playback.skipping && playback.pace !== 'instant'}
      pace={<PaceSelect playback={playback} />}
      controls={
        <TurnPanel
          view={view}
          playback={playback}
          notice={notice && game.stateRevision === openedAt.current ? notice : undefined}
          actionError={actionError === game.stateRevision}
          onChoose={choose}
          social={social}
          onFinished={onFinished}
          quoteSale={store.quoteSale}
          onConfirmDeal={(shown) => {
            const result = store.confirmDeal(shown);
            if ('rejected' in result) setActionError(game.stateRevision);
            return result;
          }}
          onSell={(pokemonInstanceIds) => {
            const result = store.submit({
              actorId: you.actorId,
              kind: 'sell',
              payload: { pokemonInstanceIds },
            });
            if ('rejected' in result) setActionError(game.stateRevision);
          }}
        />
      }
      seats={
        <>
          <AllBackupBanner view={view} playback={playback} />
          <SeatRows
            observation={view.observation}
            viewerSeat={view.seatIndex}
            story={playback.story}
            pace={playback.skipping ? 'instant' : playback.pace}
            backup={backupSeats(view, playback.status)}
          />
        </>
      }
      talk={
        talk.enabled ? (
          <TableTalkPanel
            lines={talk.lines}
            players={game.players}
            viewerSeat={view.seatIndex}
            hidden={talk.hidden}
            onToggle={() => talk.setHidden(!talk.hidden)}
            voiceOff={talk.voiceOff}
          />
        ) : undefined
      }
      promises={
        view.observation.own.promises !== undefined ? (
          <PromisePanel observation={view.observation} feed={view.feed} />
        ) : undefined
      }
    />
  );
}
