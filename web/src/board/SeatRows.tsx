import { useEffect, useRef, useState } from 'react';
import type { Observation } from '../../../engine/index.ts';
import { ballItemId, currentForm, speciesType } from '../game/content.ts';
import { personName } from '../game/people.ts';
import { pendingOffer, promiseRows } from '../game/promises.ts';
import type { Pace } from '../game/setup.ts';
import type { OpponentSettings } from '../game/store.ts';
import { paceAllowsTalk } from '../game/tableTalk.ts';
import { t } from '../i18n/en.ts';
import { className, itemName } from '../i18n/names.ts';
import { BallIcon, CoinIcon } from '../ui/icons.tsx';
import { TypeOrb } from '../ui/TypeOrb.tsx';
import type { Beat, StorySpeech } from './beats.ts';
import { ItemFacts } from './ItemFacts.tsx';
import { tagLabel, type ViewedObservation } from './labels.ts';
import { PACE_TIMING } from './pace.ts';
import { PromiseItem } from './PromisePanel.tsx';
import { TeamDetails } from './TeamDetails.tsx';
import type { TableStory } from './useTurnPlayback.ts';
import './players-area.css';

/** A long turn shows its last few beats; "+N more" opens the rest in place. */
const MAX_BEATS = 4;

type Player = Observation['public']['players'][number];

export interface SeatRowsProps {
  /** A seat's observation, or a watcher's public-only view. */
  observation: ViewedObservation;
  /**
   * The seat the table is read from, as a value: its own row shows its private hand, and only it
   * gets the "touched you" banner. Undefined for a watcher, who holds no seat.
   */
  viewerSeat: number | undefined;
  /** What each seat did; absent on a read-only board with no feed. */
  story?: TableStory;
  /**
   * The pace the table runs at now, Instant while skipping: how long a finished turn stays open
   * before its row folds to one line, and whether speech shows (Step and Readable only).
   */
  pace?: Pace;
  /** Each AI's setup, shown under its row; a watcher's boards pass it. */
  opponents?: readonly OpponentSettings[];
  /** The Backup bot reason of each AI seat whose decisions the backup bot makes. */
  backup?: ReadonlyMap<number, string>;
}

/**
 * One row per player (spec §3, AI turns): name, coins, square and their last turn told as beats.
 * A playing seat's row writes itself beat by beat, folds to one line its pace's fold time after
 * its turn ends and keeps that line until the seat plays again. Whatever touched the viewing seat
 * is lit, and at the start of its turn listed first. Every fact here is public, or the viewing
 * seat's own.
 */
export function SeatRows({
  observation,
  viewerSeat,
  story,
  pace,
  opponents,
  backup,
}: SeatRowsProps) {
  const game = observation.public;
  const active = game.phase.kind === 'finished' ? null : game.activeSeatIndex;
  const foldMs = pace ? PACE_TIMING[pace].foldMs : 0;
  // One seat's details are open at a time; a local view choice that never reaches the game.
  const [openSeat, setOpenSeat] = useState<number | null>(null);
  const [lingering, setLingering] = useState<number | null>(null);
  const previous = useRef(active);
  useEffect(() => {
    if (previous.current === active) return;
    const ended = previous.current;
    previous.current = active;
    setLingering(foldMs > 0 ? ended : null);
    if (foldMs === 0) return;
    const timer = setTimeout(() => setLingering(null), foldMs);
    return () => clearTimeout(timer);
  }, [active, foldMs]);

  const you = game.players.find((player) => player.seatIndex === viewerSeat);
  // The viewing seat leads the list; the others follow in seat order.
  const seats = [...(you ? [you] : []), ...game.players.filter((player) => player !== you)];
  const told = story ? story.beats.slice(0, story.shown) : [];
  const lastTurn = (seat: number) =>
    told.filter((beat) => beat.seatIndex === seat && beat.turn === story?.turns.get(seat));
  const nameOf = (seat: number) =>
    personName(seat) ??
    className(game.players.find((player) => player.seatIndex === seat)?.classId ?? '');
  const touched = seats
    .filter((player) => player.seatIndex !== viewerSeat)
    .flatMap((player) =>
      lastTurn(player.seatIndex)
        .filter((beat) => beat.touchedYou)
        .map((beat) => ({ seat: player.seatIndex, beat })),
    );
  const newest = told.at(-1);
  return (
    <section className="players-area" aria-label={t('row.list')}>
      {viewerSeat !== undefined && active === viewerSeat && touched.length > 0 && (
        <section className="touched-banner" aria-labelledby="touched-banner-heading">
          <h2 id="touched-banner-heading">{t('row.touched')}</h2>
          <ul>
            {touched.map(({ seat, beat }) => (
              <li key={`${beat.at}:${beat.key}`}>
                <span className="seat-disc" data-seat={seat} aria-hidden="true">
                  {seat}
                </span>
                {t('row.touchedLine', { name: nameOf(seat), beat: beat.text })}
              </li>
            ))}
          </ul>
        </section>
      )}
      <ol className="seat-rows">
        {seats.map((player) => (
          <SeatRow
            key={player.seatIndex}
            player={player}
            observation={observation}
            viewerSeat={viewerSeat}
            beats={story ? lastTurn(player.seatIndex) : null}
            current={story && story.current !== null ? story.beats[story.current]! : null}
            speech={
              pace && paceAllowsTalk(pace) ? (story?.speech.get(player.seatIndex) ?? null) : null
            }
            writing={player.seatIndex === active || player.seatIndex === lingering}
            setup={opponents?.find((entry) => entry.seatIndex === player.seatIndex)}
            backupReason={backup?.get(player.seatIndex) ?? null}
            open={openSeat === player.seatIndex}
            onToggle={() => setOpenSeat(openSeat === player.seatIndex ? null : player.seatIndex)}
          />
        ))}
      </ol>
      {/* The newest beat, read out once as it is told. */}
      <p className="sr-only" role="status">
        {newest ? t('row.touchedLine', { name: nameOf(newest.seatIndex), beat: newest.text }) : ''}
      </p>
    </section>
  );
}

interface SeatRowProps {
  player: Player;
  observation: ViewedObservation;
  viewerSeat: number | undefined;
  /** The beats of the seat's last turn told so far, or null on a board with no story. */
  beats: readonly Beat[] | null;
  /** The beat being held now, wherever it is. */
  current: Beat | null;
  speech: StorySpeech | null;
  /** The seat is playing, or its turn has only just ended: the row is open as a list of beats. */
  writing: boolean;
  setup?: OpponentSettings;
  backupReason: string | null;
  open: boolean;
  onToggle: () => void;
}

function SeatRow({
  player,
  observation,
  viewerSeat,
  beats,
  current,
  speech,
  writing,
  setup,
  backupReason,
  open,
  onToggle,
}: SeatRowProps) {
  const game = observation.public;
  const seat = player.seatIndex;
  const own = seat === viewerSeat;
  // Private facts only for the viewing seat's own row, and only from that seat's own observation.
  const ownData =
    own && 'own' in observation && observation.own.seatIndex === viewerSeat
      ? observation.own
      : undefined;
  const active = seat === game.activeSeatIndex && game.phase.kind !== 'finished';
  // Another person at the table is named as they named themselves, with their class beside it.
  const name = own ? t('seat.you') : (personName(seat) ?? className(player.classId));
  // "+N more" opens one turn in place; the seat's next turn starts at its last few beats again.
  const [openTurn, setOpenTurn] = useState<number | null>(null);
  const row = useRef<HTMLLIElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(open);
  useEffect(() => {
    // The body unfolds under a row that may sit low in the window: bring the seat into view.
    if (open && !wasOpen.current) row.current?.scrollIntoView?.({ block: 'nearest' });
    wasOpen.current = open;
  }, [open]);
  const square = game.board.find((space) => space.position === player.position);
  const told = beats ?? [];
  const turn = told[0]?.turn ?? null;
  const all = turn !== null && openTurn === turn;
  const extra = Math.max(0, told.length - MAX_BEATS);
  const visible = all ? told : told.slice(extra);
  useEffect(() => {
    // Where the rows scroll in their own box (the one-screen layout), the row that is writing
    // itself is kept in view as its beats arrive. The page itself is never scrolled for it.
    const element = row.current;
    const box = element?.closest('.play-rows');
    if (!writing || !element || !(box instanceof HTMLElement)) return;
    if (box.scrollHeight <= box.clientHeight) return;
    const shown = element.getBoundingClientRect();
    const area = box.getBoundingClientRect();
    if (shown.bottom > area.bottom) {
      box.scrollTop += Math.min(shown.bottom - area.bottom, shown.top - area.top);
    } else if (shown.top < area.top) {
      box.scrollTop -= area.top - shown.top;
    }
  }, [writing, visible.length, speech]);
  const lit = !own && told.some((beat) => beat.touchedYou);
  const bodyId = `player-body-${seat}`;
  const storyId = `player-story-${seat}`;
  const lead = player.team[0];
  // Chat and promises are with AIs only: a person's row has no promises (spec §4.8).
  const person = personName(seat) !== undefined;
  const promises =
    !own && !person && viewerSeat !== undefined && 'own' in observation
      ? promiseRows(observation).filter(
          (entry) => entry.promiserSeatIndex === seat || entry.recipientSeatIndex === seat,
        )
      : null;
  const offered =
    promises && 'own' in observation && pendingOffer(observation)?.rivalSeatIndex === seat;
  return (
    <li
      ref={row}
      className={`panel seat-row ${own ? 'own-panel' : 'rival-panel'}`}
      data-testid={`player-${seat}`}
      data-seat={seat}
      data-active={active ? 'true' : undefined}
      data-writing={writing ? 'true' : undefined}
      data-touched={lit ? 'true' : undefined}
      data-open={open ? 'true' : undefined}
      aria-labelledby={`player-heading-${seat}`}
      aria-current={active ? 'true' : undefined}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.stopPropagation();
          onToggle();
          toggle.current?.focus();
        }
      }}
    >
      <div className="seat-row-summary">
        <span className="seat-disc" data-seat={seat} aria-label={t('board.seatLabel', { seat })}>
          {seat}
        </span>
        <div className="seat-row-who">
          <h2 id={`player-heading-${seat}`} className="seat-row-name">
            {name}{' '}
            <span className="seat-row-tag">
              {own || person ? className(player.classId) : t('row.ai')}
            </span>
          </h2>
          {active && (
            <span className="turn-badge">{own ? t('row.yourTurn') : t('row.playing')}</span>
          )}
          {backupReason !== null && (
            <strong className="ai-backup-badge seat-row-backup">{t('ai.backupBadge')}</strong>
          )}
        </div>
        <dl className="seat-row-facts">
          <div className="coin-stat">
            <dt>{t('board.coins')}</dt>
            <dd aria-label={t('board.coins')}>
              <CoinIcon className="size-4" />
              {player.coins}
            </dd>
          </div>
          <div>
            <dt>{t('board.position')}</dt>
            <dd aria-label={t('board.position')}>
              {square
                ? t('beat.square', {
                    kind: t(`board.kind.${square.kind}`),
                    position: player.position,
                  })
                : player.position}
            </dd>
          </div>
        </dl>
        <button
          ref={toggle}
          type="button"
          className="player-toggle"
          aria-expanded={open}
          aria-controls={bodyId}
          aria-label={t('board.openDetails', { name })}
          onClick={onToggle}
        >
          <svg className="player-chevron" viewBox="0 0 16 16" aria-hidden="true">
            <path
              d="M6 3.5l4.5 4.5L6 12.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
      {beats !== null && (
        <div className="seat-story" id={storyId} data-folded={writing ? undefined : 'true'}>
          {told.length === 0 ? (
            <p className="seat-story-empty">{active ? t('row.starting') : t('row.noTurn')}</p>
          ) : (
            <ol className="seat-beats" aria-label={t('row.lastTurn', { name })}>
              {/* One control, kept in place, so the keyboard stays on it as it opens and closes. */}
              {extra > 0 && (
                <li className="seat-beat-more">
                  <button
                    type="button"
                    className="beat-more"
                    aria-expanded={all}
                    aria-controls={storyId}
                    onClick={() => setOpenTurn(all ? null : turn)}
                  >
                    {all ? t('row.fewer') : t('row.more', { count: extra })}
                  </button>
                </li>
              )}
              {visible.map((beat) => (
                <li
                  key={`${beat.at}:${beat.key}`}
                  className="seat-beat"
                  data-kind={beat.kind}
                  data-message-key={beat.key}
                  data-touched={beat.touchedYou && !own ? 'true' : undefined}
                  data-current={beat === current ? 'true' : undefined}
                >
                  {beat.touchedYou && !own && <span className="beat-you">{t('row.toYou')}</span>}
                  {beat.text}
                </li>
              ))}
            </ol>
          )}
          {speech && writing && (
            <p
              className="seat-speech"
              aria-label={t('row.speech', { name, line: speech.text })}
              data-source={speech.source}
            >
              <q>{speech.text}</q>
              {speech.toYou && <span className="beat-you">{t('talk.toYou')}</span>}
              <span className="talk-label" data-label={speech.source}>
                {speech.source === 'haiku' ? t('talk.aiWritten') : t('talk.bank')}
              </span>
            </p>
          )}
        </div>
      )}
      <div className="player-body" id={bodyId} hidden={!open}>
        {setup && (
          <p className="player-setup">
            {t('watch.setup', {
              personality: t(`personality.${setup.personality}`),
              difficulty: t(`difficulty.${setup.difficulty}`),
            })}
          </p>
        )}
        {backupReason !== null && <p className="seat-row-reason">{backupReason}</p>}
        <dl className="player-glance">
          <div>
            <dt>{t('board.lapShort')}</dt>
            <dd aria-label={t('board.lap')}>
              {player.creditedLap} / {game.lapTarget}
            </dd>
          </div>
          <div>
            <dt>{t('board.itemsShort')}</dt>
            <dd aria-label={t('board.itemCount')}>{player.itemCount}</dd>
          </div>
          <div>
            <dt>{t('board.badges')}</dt>
            <dd aria-label={t('board.badges')}>{player.badges}</dd>
          </div>
          {(ownData?.armedShield ?? player.armedShield) && (
            <div>
              <dt>{t('board.shield')}</dt>
              <dd aria-label={t('board.shield')}>{t('board.shieldArmed')}</dd>
            </div>
          )}
          <div className="glance-team">
            <dt>{t('board.team')}</dt>
            <dd>
              {lead
                ? t('board.teamGlance', {
                    count: player.team.length,
                    name: currentForm(lead.speciesId).name,
                  })
                : t('board.teamGlanceNone')}
            </dd>
          </div>
        </dl>
        <h3>{own ? t('board.yourTeam') : t('board.team')}</h3>
        {player.team.length === 0 ? (
          <p className="panel-note">{t('board.emptyTeam')}</p>
        ) : (
          <ul className="team-list" aria-label={t('board.team')}>
            {player.team.map((pokemon) => {
              const form = currentForm(pokemon.speciesId);
              return (
                <li
                  className="team-member"
                  key={pokemon.instanceId}
                  data-testid={pokemon.instanceId}
                >
                  <div className="team-member-overview">
                    <TypeOrb type={speciesType(pokemon.speciesId)} className="size-10 shrink-0" />
                    <div className="team-member-detail">
                      <strong>{form.name}</strong>
                      <div className="pokemon-tags">
                        {form.tags.map((tag) => (
                          <span key={tag}>{tagLabel(tag)}</span>
                        ))}
                      </div>
                      {pokemon.tired && <span className="pokemon-status">{t('board.tired')}</span>}
                      {pokemon.origin === 'rescue_starter' && (
                        <span className="pokemon-status">{t('board.rescue')}</span>
                      )}
                    </div>
                    <div className="battle-stat">
                      <span>{t('board.battle')}</span>
                      <strong aria-label={t('board.battle')}>{form.battle}</strong>
                    </div>
                  </div>
                  <TeamDetails pokemon={pokemon} form={form} watched={viewerSeat === undefined} />
                </li>
              );
            })}
          </ul>
        )}
        {ownData ? (
          <>
            <h3>{t('board.balls')}</h3>
            <dl className="ball-pouch" aria-label={t('board.balls')}>
              {(['poke', 'great', 'ultra'] as const).map((ball) => (
                <div className={`pouch-${ball}`} key={ball}>
                  <dt>
                    <BallIcon className="size-6" />
                    <span>{t(`board.ball.${ball}`)}</span>
                  </dt>
                  <dd aria-label={t(`board.ball.${ball}`)}>{ownData.balls[ball]}</dd>
                  <dd className="pouch-facts">
                    <ItemFacts itemId={ballItemId(ball)} />
                  </dd>
                </div>
              ))}
            </dl>
            <h3>{t('board.items')}</h3>
            <ul className="item-list" aria-label={t('board.items')}>
              {ownData.items.length === 0 ? (
                <li className="panel-note">{t('board.emptyItems')}</li>
              ) : (
                ownData.items.map((item) => (
                  <li key={item.instanceId}>
                    <span className="item-capsule" aria-hidden="true" />
                    <div className="item-entry">
                      <strong>{itemName(item.itemId)}</strong>
                      <ItemFacts itemId={item.itemId} />
                    </div>
                  </li>
                ))
              )}
            </ul>
            <p className="panel-note inventory-note">{t('board.privateInventory')}</p>
          </>
        ) : (
          <p className="panel-note inventory-note">{t('board.hiddenInventory')}</p>
        )}
        {promises && viewerSeat !== undefined && (
          <>
            <h3>{t('row.promises', { name })}</h3>
            {promises.length > 0 || offered ? (
              <ul className="promise-list">
                {offered && (
                  <li data-promise-status="offered">
                    <p>
                      <strong>{t('promise.status.offered')}</strong>
                    </p>
                    <p>{t('promise.offeredRow', { rival: name })}</p>
                  </li>
                )}
                {promises.map((entry) => (
                  <li
                    key={`${entry.promiserSeatIndex}>${entry.recipientSeatIndex}@${entry.createdTurn}`}
                  >
                    <PromiseItem row={entry} own={viewerSeat} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="panel-note">{t('row.noPromises', { name })}</p>
            )}
          </>
        )}
      </div>
    </li>
  );
}
