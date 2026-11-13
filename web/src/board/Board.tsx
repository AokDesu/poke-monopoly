import { lazy, Suspense, type ReactNode } from 'react';
import type { EngineEvent, Observation } from '../../../engine/index.ts';
import type { SeatFeedEntry } from '../game/store.ts';
import { t } from '../i18n/en.ts';
import { BallIcon } from '../ui/icons.tsx';
import { Screen } from '../ui/Screen.tsx';
import { hasWebGl } from '../ui/three/support.ts';
import { EventLog } from './EventLog.tsx';
import { phaseLabel, seatLabel } from './labels.ts';
import { PlayerPanel } from './PlayerPanel.tsx';
import { RouteArrow, SpaceIcon } from './SpaceIcon.tsx';
import './board.css';

const StarterMeadow = lazy(() => import('./StarterMeadow.tsx'));

export interface BoardProps {
  observation: Observation;
  /** Already filtered for this seat by eventsVisibleTo, never a raw engine log. */
  events?: readonly EngineEvent[];
  feed?: readonly SeatFeedEntry[];
  /** Live turn controls; omitted by the read-only fixture Board. */
  controls?: ReactNode;
  /** Current opponent action strip, rendered under the board loop (issue #123). */
  focus?: ReactNode;
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

export function Board({ observation, events = [], feed, controls, focus }: BoardProps) {
  const { public: game, own } = observation;
  const you = game.players.find((player) => player.seatIndex === own.seatIndex)!;
  const activeName = seatLabel(game.activeSeatIndex, own.seatIndex);
  // During an opponent's turn the board spotlight follows the acting rival, so the
  // square and the action text under it always name the same move (issue #123).
  const opponentTurn = game.phase.kind !== 'finished' && game.activeSeatIndex !== own.seatIndex;
  const focusSeat = opponentTurn ? game.activeSeatIndex : undefined;
  const focusPosition =
    focusSeat === undefined
      ? undefined
      : game.players.find((player) => player.seatIndex === focusSeat)?.position;
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
                  : game.activeSeatIndex === own.seatIndex
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
                                name: seatLabel(player.seatIndex, own.seatIndex),
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
                <p className="route-instruction">{t('board.direction')}</p>
                <div className="seat-order" aria-label={t('board.turnOrder')}>
                  {game.players.map((player) => (
                    <span key={player.seatIndex} className="seat-order-entry">
                      <span className="seat-disc" data-seat={player.seatIndex}>
                        {player.seatIndex}
                      </span>
                      <span>{seatLabel(player.seatIndex, own.seatIndex)}</span>
                      <RouteArrow direction="right" />
                    </span>
                  ))}
                </div>
              </div>
            </div>
            {focus}
            <EventLog events={events} feed={feed} observation={observation} />
          </div>
          <aside className="trainer-panels" aria-label={t('board.team')}>
            {controls}
            <PlayerPanel player={you} observation={observation} />
            {game.players
              .filter((player) => player.seatIndex !== own.seatIndex)
              .map((player) => (
                <PlayerPanel key={player.seatIndex} player={player} observation={observation} />
              ))}
          </aside>
        </div>
      </Screen>
    </div>
  );
}
