import { useRef, useState, useSyncExternalStore } from 'react';
import type { GameStore } from '../game/store.ts';
import { t } from '../i18n/en.ts';
import { Screen } from '../ui/Screen.tsx';
import { Board } from './Board.tsx';
import { TableTalkPanel } from './TableTalk.tsx';
import { useChatReply } from './useChatReply.ts';
import { useTableTalk } from './useTableTalk.ts';
import { useTurnPlayback } from './useTurnPlayback.ts';
import { EncounterDialog } from './EncounterDialog.tsx';
import { latestEvent } from './eventCard.ts';
import { SellPanel } from './SellPanel.tsx';
import { opponentMessageOf, TurnPanel } from './TurnPanel.tsx';
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
  const humanTurn = game.activeSeatIndex === view.seatIndex;
  const choose = (id: string) => {
    if ('rejected' in store.choose(id)) {
      setActionError(store.getView()?.observation.public.stateRevision ?? game.stateRevision);
    }
  };
  const you = game.players.find((player) => player.seatIndex === view.seatIndex)!;
  const opponentMessage = opponentMessageOf(view);
  // The encounter card (e1) is what opened an encounter: no Wild square and Event card share a turn.
  // Any other card drawn this turn is not the encounter's source.
  const drawn = latestEvent(view.feed, view.observation);
  const encounterEvent =
    drawn?.eventId === 'e1' && drawn.turn === game.globalTurnNo ? drawn.text : undefined;
  // The current rival action, spelled out under the board loop so the text sits right
  // where the spotlight is (issue #123). Same wording as the field-log row.
  const focus =
    !humanTurn && game.phase.kind !== 'finished' && opponentMessage ? (
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
  const controls = (
    <TurnPanel
      view={view}
      playback={playback}
      notice={notice && game.stateRevision === openedAt.current ? notice : undefined}
      actionError={actionError === game.stateRevision}
      onChoose={choose}
      social={social}
      onFinished={onFinished}
    />
  );
  return (
    <>
      <Board
        observation={view.observation}
        feed={view.feed}
        controls={controls}
        focus={focus}
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
      />
      {humanTurn && game.phase.kind === 'encounter' && !game.phase.catchRoll && (
        <EncounterDialog
          observation={view.observation}
          legalActions={view.legalActions}
          catchOdds={view.catchOdds}
          eventText={encounterEvent}
          onChoose={choose}
        />
      )}
      {humanTurn && game.phase.kind === 'sell' && (
        <SellPanel
          key={game.stateRevision}
          observation={view.observation}
          quoteSale={store.quoteSale}
          onSell={(pokemonInstanceIds) => {
            const result = store.submit({
              actorId: you.actorId,
              kind: 'sell',
              payload: { pokemonInstanceIds },
            });
            if ('rejected' in result) setActionError(game.stateRevision);
          }}
        />
      )}
    </>
  );
}
