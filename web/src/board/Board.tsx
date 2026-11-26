import { lazy, Suspense, useContext, useEffect, useRef, type ReactNode } from 'react';
import type { SeatEvent } from '../../../engine/index.ts';
import { HowToPlayButton } from '../howToPlay/HowToPlay.tsx';
import { MEADOW_STARTERS } from '../game/models.ts';
import type { SeatFeedEntry } from '../game/store.ts';
import { t } from '../i18n/en.ts';
import { className, speciesName } from '../i18n/names.ts';
import { BallIcon } from '../ui/icons.tsx';
import { FocusHeadingContext } from '../ui/Screen.tsx';
import { hasWebGl } from '../ui/three/support.ts';
import { EventCard } from './EventCard.tsx';
import { EventLog } from './EventLog.tsx';
import { GameRecord } from './GameRecord.tsx';
import { HandStrip } from './HandStrip.tsx';
import { ownSeatOf, phaseLabel, seatLabel, type ViewedObservation } from './labels.ts';
import { SeatRows } from './SeatRows.tsx';
import { RouteArrow, SpaceIcon } from './SpaceIcon.tsx';
import { usePawnWalk } from './usePawnWalk.ts';
import './board.css';

const StarterMeadow = lazy(() => import('./StarterMeadow.tsx'));

export interface BoardProps {
  /** A seat's observation, or a watcher's public-only view (no `own`: nothing is "you"). */
  observation: ViewedObservation;
  /** Already filtered for this seat by eventsVisibleTo, never a raw engine log. */
  events?: readonly SeatEvent[];
  feed?: readonly SeatFeedEntry[];
  /** The decision slot under the seat rows; omitted by the read-only fixture Board. */
  controls?: ReactNode;
  /**
   * The seat rows with each seat's story; a live screen passes them. Without them the board shows
   * each seat's row with no story, read from the observation's own seat.
   */
  seats?: ReactNode;
  /** The pace choice, in the top bar. */
  pace?: ReactNode;
  /** The Table talk panel, in the Game record. */
  talk?: ReactNode;
  /** The Promises and memory panel, in the Game record. */
  promises?: ReactNode;
  /** Pawns walk to a new square one square at a time; off, they jump (Instant, a skip). */
  walk?: boolean;
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

/**
 * The play screen (spec §3, Board screen; issue #256): a top bar (whose turn, the turn and Laps,
 * pace, Game record, How to play), the board with the viewing seat's hand under it, and a side
 * column with the seat rows and one decision slot. At 1024 px and wider it fits the window: the
 * board scales to the room it has, and the rows and the card scroll inside themselves.
 */
export function Board({
  observation,
  events = [],
  feed,
  controls,
  seats,
  pace,
  talk,
  promises,
  walk = false,
}: BoardProps) {
  const { public: game } = observation;
  const ownSeat = ownSeatOf(observation);
  const you = game.players.find((player) => player.seatIndex === ownSeat);
  // One name per rival on the whole screen: its class, as its seat row and card name it.
  const activeName = className(
    game.players.find((player) => player.seatIndex === game.activeSeatIndex)?.classId ?? '',
  );
  const heading = useRef<HTMLHeadingElement>(null);
  const focusHeading = useContext(FocusHeadingContext);
  useEffect(() => {
    if (focusHeading) heading.current?.focus();
  }, [focusHeading]);
  const drawn = usePawnWalk(game.players, game.board.length, walk);
  // During an opponent's turn the board spotlight follows the acting rival, so the square and
  // the beats in its row name the same move (issue #123). A watcher holds no seat, so every turn
  // is a rival's and the spotlight follows each seat in turn.
  const opponentTurn = game.phase.kind !== 'finished' && game.activeSeatIndex !== ownSeat;
  const focusSeat = opponentTurn ? game.activeSeatIndex : undefined;
  // The spotlight marks the square the move ends on, the one the rival's beat names, while the
  // pawn walks there.
  const focusPosition =
    focusSeat === undefined
      ? undefined
      : game.players.find((player) => player.seatIndex === focusSeat)?.position;
  const players = seats ?? <SeatRows observation={observation} viewerSeat={ownSeat} />;
  return (
    <section className="game-board-screen play-shell" aria-labelledby="screen-heading">
      <h1 id="screen-heading" ref={heading} tabIndex={-1} className="sr-only">
        {t('play.heading')}
      </h1>
      <header className="play-top">
        <p className="play-brand">
          <BallIcon className="play-brand-ball" />
          <span className="title-3d">{t('app.title')}</span>
        </p>
        <div className="play-status">
          <div
            className="active-trainer"
            data-testid="active-seat"
            data-seat={game.activeSeatIndex}
            role="status"
          >
            <span className="seat-disc" data-seat={game.activeSeatIndex} aria-hidden="true">
              {game.activeSeatIndex}
            </span>
            <strong>
              {game.phase.kind === 'finished'
                ? t('board.finished')
                : game.activeSeatIndex === ownSeat
                  ? t('board.yourTurn')
                  : t('board.turn', { name: activeName })}
            </strong>
            {game.phase.kind !== 'finished' && (
              <span className="active-phase">{phaseLabel(game.phase.kind)}</span>
            )}
          </div>
          <p className="turn-counter">
            <span>{t('board.globalTurn')}</span>{' '}
            <strong aria-label={t('board.globalTurn')}>{game.globalTurnNo}</strong>
            <span className="turn-laps">
              {you
                ? t('play.laps', { lap: you.creditedLap, target: game.lapTarget })
                : t('play.lapTarget', { target: game.lapTarget })}
            </span>
          </p>
          {game.finalTableRound && <strong className="final-round">{t('board.finalRound')}</strong>}
        </div>
        {!controls && <p className="preview-note">{t('board.readOnly')}</p>}
        <div className="play-tools">
          {pace}
          <GameRecord>
            {feed && <EventCard observation={observation} feed={feed} />}
            <EventLog events={events} feed={feed} observation={observation} />
            {talk}
            {promises}
          </GameRecord>
          <HowToPlayButton className="top-button" />
        </div>
      </header>
      <div className="play-table">
        <div className="board-fit">
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
                        .filter((player) => drawn.get(player.seatIndex) === space.position)
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
                              position: space.position,
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
                <BallIcon className="size-6" />
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
        </div>
        <HandStrip observation={observation} />
      </div>
      <aside className="play-side" aria-label={t('play.side')}>
        <div className="play-rows">{players}</div>
        {controls && (
          <section className="decision-slot" aria-label={t('turn.actions')}>
            {controls}
          </section>
        )}
      </aside>
    </section>
  );
}
