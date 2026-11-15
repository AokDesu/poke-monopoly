import type { SeatView } from '../game/store.ts';
import { t } from '../i18n/en.ts';
import { ActionButton } from '../ui/ActionButton.tsx';
import { AiTurn } from './AiTurn.tsx';
import { phaseLabel } from './labels.ts';
import { ShopPanel } from './ShopPanel.tsx';
import { StrategyPanel } from './StrategyPanel.tsx';
import { turnMessages } from './turnMessages.ts';
import type { TurnPlayback } from './useTurnPlayback.ts';

/** The rival's latest announced action, from the accepted records alone. */
export function opponentMessageOf(view: SeatView) {
  const game = view.observation.public;
  const automatic = view.feed.at(-1);
  return automatic?.before.activeSeatIndex === game.activeSeatIndex
    ? turnMessages(automatic).find((message) => message.key.startsWith('ai.'))
    : undefined;
}

export interface TurnPanelProps {
  view: SeatView;
  playback: TurnPlayback;
  /** A one-time notice (a resumed save); the screen decides when it still applies. */
  notice?: string;
  /** The last human command was rejected for the current revision. */
  actionError: boolean;
  onChoose: (id: string) => void;
  onFinished?: () => void;
}

/** What the player may do now and what just happened, from the human seat's view only. */
export function TurnPanel({
  view,
  playback,
  notice,
  actionError,
  onChoose,
  onFinished,
}: TurnPanelProps) {
  const { public: game } = view.observation;
  const humanTurn = game.activeSeatIndex === view.seatIndex;
  const decisionOpen = humanTurn && ['shop', 'strategy', 'sell'].includes(game.phase.kind);
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
  const opponentMessage = opponentMessageOf(view);
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
  return (
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
        {actionError && <p role="alert">{t('turn.actionError')}</p>}
        {notice && (
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
          onChoose={onChoose}
        />
      )}
      {humanTurn && game.phase.kind === 'strategy' && (
        <StrategyPanel
          key={game.stateRevision}
          observation={view.observation}
          legalActions={view.legalActions}
          onChoose={onChoose}
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
}
