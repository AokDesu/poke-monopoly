import { useRef, useState, useSyncExternalStore } from 'react';
import type { GameStore } from '../game/store.ts';
import { t } from '../i18n/en.ts';
import { ActionButton } from '../ui/ActionButton.tsx';
import { Screen } from '../ui/Screen.tsx';
import { Board } from './Board.tsx';
import { AiTurn } from './AiTurn.tsx';
import { useTurnPlayback } from './useTurnPlayback.ts';
import { EncounterDialog } from './EncounterDialog.tsx';
import { phaseLabel } from './labels.ts';
import { ShopPanel } from './ShopPanel.tsx';
import { StrategyPanel } from './StrategyPanel.tsx';
import { SellPanel } from './SellPanel.tsx';
import { turnMessages } from './turnMessages.ts';
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
  const decisionOpen = humanTurn && ['shop', 'strategy', 'sell'].includes(game.phase.kind);
  const choose = (id: string) => {
    if ('rejected' in store.choose(id)) setActionError(game.stateRevision);
  };
  const result = view.feed
    .filter(({ before }) => before.activeSeatIndex === view.seatIndex)
    .flatMap(turnMessages)
    .findLast((message) =>
      ['encounter.caught', 'encounter.escaped', 'encounter.released'].includes(message.key),
    );
  const automatic = view.feed.at(-1);
  const automaticMessage =
    automatic && turnMessages(automatic).find((message) => message.key === 'turn.automatic');
  const lastSale = view.feed.findLast(
    ({ before }) => before.activeSeatIndex === view.seatIndex && before.phase.kind === 'sell',
  );
  const receivedRescue = lastSale?.record.events.some(
    (event) => event.kind === 'uid_created' && event.entity === 'pokemon',
  );
  const lastMove = view.feed.findLast(
    ({ before, record }) =>
      before.activeSeatIndex === view.seatIndex &&
      before.phase.kind === 'move' &&
      record.action.kind === 'dice_result',
  );
  const roll = lastMove?.record.events.find(
    (event) => event.kind === 'random_result' && event.purpose.startsWith('move:'),
  );
  const you = game.players.find((player) => player.seatIndex === view.seatIndex)!;
  const opponentFailed = playback.failed;
  const opponentMessage =
    automatic?.before.activeSeatIndex === game.activeSeatIndex
      ? turnMessages(automatic).find((message) => message.key.startsWith('ai.'))
      : undefined;
  let body =
    game.phase.kind === 'finished'
      ? t('turn.finished')
      : !humanTurn
        ? (opponentMessage?.text ?? t('ai.playing'))
        : game.phase.kind === 'sell'
          ? t('turn.sellBody')
          : game.phase.kind === 'shop'
            ? t('turn.shopBody')
            : game.phase.kind === 'strategy' && view.legalActions.enabled.length > 1
              ? t('turn.strategyBody')
              : game.phase.kind === 'end'
                ? t('turn.end')
                : game.phase.kind === 'move'
                  ? t('turn.moving')
                  : t('turn.onlyLegalAction');
  if (humanTurn && game.phase.kind === 'encounter' && view.legalActions.enabled.length > 1) {
    body = t('turn.encounterBody');
  }
  if (opponentFailed) body = t('turn.opponentError');
  const controls = (
    <section className="turn-panel panel" aria-label={t('turn.actions')}>
      <div className="turn-panel-copy">
        <h2>
          {humanTurn && game.phase.kind === 'sell'
            ? t('turn.sellHeading')
            : humanTurn && game.phase.kind === 'shop'
              ? t('turn.shopHeading')
              : game.phase.kind === 'finished'
                ? t('board.finished')
                : humanTurn
                  ? phaseLabel(game.phase.kind)
                  : t('turn.opponent')}
        </h2>
        <p role={opponentFailed ? 'alert' : 'status'}>{body}</p>
        {automaticMessage && !decisionOpen && (
          <p className="turn-banner" role="status">
            {automaticMessage.text}
          </p>
        )}
        {humanTurn &&
          !decisionOpen &&
          roll?.kind === 'random_result' &&
          typeof roll.result === 'number' && (
            <p className="move-summary">
              {t('turn.lastMove', { roll: roll.result, position: you.position })}
            </p>
          )}
        {humanTurn && result && !decisionOpen && (
          <p className="catch-result" role="status" data-message-key={result.key}>
            {result.text}
          </p>
        )}
        {actionError === game.stateRevision && <p role="alert">{t('turn.actionError')}</p>}
        {notice && game.stateRevision === openedAt.current && (
          <p className="turn-banner" role="status">
            {notice}
          </p>
        )}
      </div>
      <AiTurn view={view} playback={playback} />
      {receivedRescue && (
        <p className="rescue-preview" role="status">
          {t('sell.rescueStarter')}
        </p>
      )}
      {humanTurn && game.phase.kind === 'shop' && (
        <ShopPanel
          observation={view.observation}
          legalActions={view.legalActions}
          onChoose={choose}
        />
      )}
      {humanTurn && game.phase.kind === 'strategy' && (
        <StrategyPanel
          key={game.stateRevision}
          observation={view.observation}
          legalActions={view.legalActions}
          onChoose={choose}
        />
      )}
      {opponentFailed && (
        <ActionButton enabled onClick={playback.retry}>
          {t('turn.retry')}
        </ActionButton>
      )}
      {game.phase.kind === 'finished' && onFinished && (
        <ActionButton enabled onClick={onFinished}>
          {t('nav.results')}
        </ActionButton>
      )}
    </section>
  );
  return (
    <>
      <Board observation={view.observation} feed={view.feed} controls={controls} />
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
