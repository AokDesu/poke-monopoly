import { lazy, Suspense, type ReactNode } from 'react';
import type { SeatEvent } from '../../../engine/index.ts';
import { MEADOW_STARTERS } from '../game/models.ts';
import type { SeatFeedEntry } from '../game/store.ts';
import { t } from '../i18n/en.ts';
import { speciesName } from '../i18n/names.ts';
import { BallIcon } from '../ui/icons.tsx';
import { Screen } from '../ui/Screen.tsx';
import { hasWebGl } from '../ui/three/support.ts';
import { EventCard } from './EventCard.tsx';
import { EventLog } from './EventLog.tsx';
import { ownSeatOf, phaseLabel, seatLabel, type ViewedObservation } from './labels.ts';
import { SeatRows } from './SeatRows.tsx';
import { RouteArrow, SpaceIcon } from './SpaceIcon.tsx';
import './board.css';

const StarterMeadow = lazy(() => import('./StarterMeadow.tsx'));

export interface BoardProps {
  /** A seat's observation, or a watcher's public-only view (no `own`: nothing is "you"). */
  observation: ViewedObservation;
  /** Already filtered for this seat by eventsVisibleTo, never a raw engine log. */
  events?: readonly SeatEvent[];
  feed?: readonly SeatFeedEntry[];
  /** Live turn controls; omitted by the read-only fixture Board. */
  controls?: ReactNode;
  /**
   * The seat rows with each seat's story; a live screen passes them. Without them the board shows
   * each seat's row with no story, read from the observation's own seat.
   */
  seats?: ReactNode;
  /** The Table talk panel, shown beside the field log. */
  talk?: ReactNode;
  /** The Promises and memory panel, shown beside the field log. */
  promises?: ReactNode;
}

// Presentation coordinates only. Game positions are already positionOf(routeProgress) in observe().
function squareLayout(position: number) {
  if (position <= 6)
    return { row: 7, column: 7 - position, direction: position === 6 ? 'up' : 'left' };
  if (position <= 12)
    return { row: 13 - position, column: 1, direction: position === 12 ? 'right' : 'up' };
  if (position <= 18)
    return { row: 1, column: position - 11, direction: position === 18 ? 'down' : 'right' };
  return { row: position - 17, column: 7, direction: 'down' };
}

export function Board({
  observation,
  events = [],
  feed,
  controls,
  seats,
  talk,
  promises,
}: BoardProps) {
  const { public: game } = observation;
  const ownSeat = ownSeatOf(observation);
  const activeName = seatLabel(game.activeSeatIndex, ownSeat);
  // During an opponent's turn the board spotlight follows the acting rival, so the square and
  // the beats in its row name the same move (issue #123). A watcher holds no seat, so every turn
  // is a rival's and the spotlight follows each seat in turn.
  const opponentTurn = game.phase.kind !== 'finished' && game.activeSeatIndex !== ownSeat;
  const focusSeat = opponentTurn ? game.activeSeatIndex : undefined;
  const focusPosition =
    focusSeat === undefined
      ? undefined
      : game.players.find((player) => player.seatIndex === focusSeat)?.position;
  // A watcher takes no action, so the seats lead the column; a player's turn controls come first.
  const watching = ownSeat === undefined;
  const players = seats ?? <SeatRows observation={observation} viewerSeat={ownSeat} />;
  return (
    <div className="game-board-screen">
      <Screen heading={t('play.heading')}>
        <div className="board-status-bar">
          <div
            className="active-trainer"
            data-testid="active-seat"
            data-seat={game.activeSeatIndex}
            role="status"
          >
            <span className="seat-disc" data-seat={game.activeSeatIndex}>
              {game.activeSeatIndex}
            </span>
            <div>
              <strong>
                {game.phase.kind === 'finished'
                  ? t('board.finished')
                  : game.activeSeatIndex === ownSeat
                    ? t('board.yourTurn')
                    : t('board.turn', { name: activeName })}
              </strong>
              <span>{phaseLabel(game.phase.kind)}</span>
            </div>
          </div>
          <div className="turn-counter">
            <span>{t('board.globalTurn')}</span>
            <strong aria-label={t('board.globalTurn')}>{game.globalTurnNo}</strong>
          </div>
          {game.finalTableRound && <strong className="final-round">{t('board.finalRound')}</strong>}
          {!controls && <p className="preview-note">{t('board.readOnly')}</p>}
        </div>
        <div className="board-layout">
          <div className="board-column">
            <div className="loop-frame">
              <ol className="board-loop" aria-label={t('board.loop')}>
                {game.board.map((space) => {
                  const layout = squareLayout(space.position);
                  const focused = focusPosition === space.position;
                  return (
                    <li
                      className={`loop-square square-${space.kind}`}
                      key={space.position}
                      data-position={space.position}
                      data-focus={focused ? 'ai' : undefined}
                      data-focus-seat={focused && focusSeat !== undefined ? focusSeat : undefined}
                      aria-label={t('board.squareLabel', {
                        position: space.position,
                        kind: t(`board.kind.${space.kind}`),
                      })}
                      style={{ gridRow: layout.row, gridColumn: layout.column }}
                    >
                      <span className="square-number">{space.position}</span>
                      <RouteArrow direction={layout.direction} />
                      <span className="square-icon">
                        <SpaceIcon kind={space.kind} />
                      </span>
                      <span className="square-label">{t(`board.kind.${space.kind}`)}</span>
                      <span className="square-tokens">
                        {game.players
                          .filter((player) => player.position === space.position)
                          .map((player) => (
                            <span
                              className="trainer-pawn"
                              data-seat={player.seatIndex}
                              data-focus={
                                opponentTurn && player.seatIndex === focusSeat ? 'ai' : undefined
                              }
                              key={player.seatIndex}
                              data-testid={`token-${player.seatIndex}`}
                              aria-label={t('board.tokenLabel', {
                                name: seatLabel(player.seatIndex, ownSeat),
                                seat: player.seatIndex,
                                position: player.position,
                              })}
                            >
                              {player.seatIndex}
                            </span>
                          ))}
                      </span>
                    </li>
                  );
                })}
              </ol>
              <div className="board-infield">
                <div className="meadow-art" aria-hidden="true">
                  {hasWebGl() ? (
                    <Suspense fallback={<BallIcon className="meadow-fallback" />}>
                      <StarterMeadow />
                    </Suspense>
                  ) : (
                    <BallIcon className="meadow-fallback" />
                  )}
                </div>
                <div className="meadow-caption">
                  <BallIcon className="size-7" />
                  <span>{t('board.habitat')}</span>
                </div>
                <p className="meadow-names">
                  {t('board.habitatNames', {
                    names: MEADOW_STARTERS.map(({ id }) => speciesName(id)).join(', '),
                  })}
                </p>
                <p className="route-instruction">{t('board.direction')}</p>
                <div className="seat-order" aria-label={t('board.turnOrder')}>
                  {game.players.map((player) => (
                    <span key={player.seatIndex} className="seat-order-entry">
                      <span className="seat-disc" data-seat={player.seatIndex}>
                        {player.seatIndex}
                      </span>
                      <span>{seatLabel(player.seatIndex, ownSeat)}</span>
                      <RouteArrow direction="right" />
                    </span>
                  ))}
                </div>
              </div>
            </div>
            {feed && <EventCard observation={observation} feed={feed} />}
            <div className="log-row">
              <EventLog events={events} feed={feed} observation={observation} />
              {talk}
              {promises}
            </div>
          </div>
          <aside className="trainer-panels" aria-label={t('board.team')}>
            {watching && players}
            {controls}
            {!watching && players}
          </aside>
        </div>
      </Screen>
    </div>
  );
}
