import { useRef, useState, useSyncExternalStore } from 'react';
import type { GameStore } from '../game/store.ts';
import { t } from '../i18n/en.ts';
import { Screen } from '../ui/Screen.tsx';
import { Board } from './Board.tsx';
import { useTurnPlayback } from './useTurnPlayback.ts';
import { EncounterDialog } from './EncounterDialog.tsx';
import { SellPanel } from './SellPanel.tsx';
import { opponentMessageOf, TurnPanel } from './TurnPanel.tsx';
import './turn-flow.css';
import './decision-panels.css';

export function BoardScreen({
  store,
  notice,
  onFinished,
}: {
  store: GameStore;
  notice?: string;
  onFinished?: () => void;
}) {
  const view = useSyncExternalStore(store.subscribe, store.getView);
  const openedAt = useRef<number | null>(null);
  const playback = useTurnPlayback(store, view);
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
      onFinished={onFinished}
    />
  );
  return (
    <>
      <Board observation={view.observation} feed={view.feed} controls={controls} focus={focus} />
      {humanTurn && game.phase.kind === 'encounter' && !game.phase.catchRoll && (
        <EncounterDialog
          observation={view.observation}
          legalActions={view.legalActions}
          catchOdds={view.catchOdds}
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
