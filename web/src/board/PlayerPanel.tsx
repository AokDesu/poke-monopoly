import { useEffect, useRef } from 'react';
import type { Observation } from '../../../engine/index.ts';
import { ballItemId, currentForm, speciesType } from '../game/content.ts';
import type { OpponentSettings } from '../game/store.ts';
import { t } from '../i18n/en.ts';
import { className, itemName } from '../i18n/names.ts';
import { BallIcon, CoinIcon } from '../ui/icons.tsx';
import { TypeOrb } from '../ui/TypeOrb.tsx';
import { ownSeatOf, seatLabel, tagLabel, type ViewedObservation } from './labels.ts';
import { ItemFacts } from './ItemFacts.tsx';
import { TeamDetails } from './TeamDetails.tsx';
import './players-area.css';

interface PlayerPanelProps {
  player: Observation['public']['players'][number];
  observation: ViewedObservation;
  /** A watcher sees every seat's setup beside its public numbers. */
  setup?: OpponentSettings;
  /** The seat's full details are open. The players area keeps at most one seat open. */
  open: boolean;
  onToggle: () => void;
}

/**
 * One seat in the players area. The summary is always on screen: name, class, whose turn it is
 * and the public key facts. The rest of what the seat may show (team, Ball pouch, items) is the
 * body, opened on demand. Opening is a local view choice and never a game action.
 */
export function PlayerPanel({ player, observation, setup, open, onToggle }: PlayerPanelProps) {
  const ownSeat = ownSeatOf(observation);
  const ownData =
    'own' in observation && player.seatIndex === ownSeat ? observation.own : undefined;
  const own = ownData !== undefined;
  const active = player.seatIndex === observation.public.activeSeatIndex;
  const name = seatLabel(player.seatIndex, ownSeat);
  const lead = player.team[0];
  const section = useRef<HTMLElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(open);
  useEffect(() => {
    // The body unfolds under a summary that may sit low in the window: bring the seat into view.
    if (open && !wasOpen.current) section.current?.scrollIntoView?.({ block: 'nearest' });
    wasOpen.current = open;
  }, [open]);
  const bodyId = `player-body-${player.seatIndex}`;
  return (
    <section
      ref={section}
      className={`panel player-panel ${own ? 'own-panel' : 'rival-panel'}`}
      data-testid={`player-${player.seatIndex}`}
      data-seat={player.seatIndex}
      data-active={active ? 'true' : undefined}
      data-open={open ? 'true' : undefined}
      aria-labelledby={`player-heading-${player.seatIndex}`}
      aria-current={active ? 'true' : undefined}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.stopPropagation();
          onToggle();
          toggle.current?.focus();
        }
      }}
    >
      <div className="player-summary">
        <span
          className="seat-disc"
          data-seat={player.seatIndex}
          aria-label={t('board.seatLabel', { seat: player.seatIndex })}
        >
          {player.seatIndex}
        </span>
        <header className="player-heading">
          <div className="player-identity">
            <h2 id={`player-heading-${player.seatIndex}`}>{name}</h2>
            <p>{className(player.classId)}</p>
            {setup && (
              <p className="player-setup">
                {t('watch.setup', {
                  personality: t(`personality.${setup.personality}`),
                  difficulty: t(`difficulty.${setup.difficulty}`),
                })}
              </p>
            )}
          </div>
          {active && (
            <span className="turn-badge">{own ? t('board.yourTurn') : t('board.turnBadge')}</span>
          )}
          <dl className="player-coins">
            <div className="coin-stat">
              <dt>{t('board.coins')}</dt>
              <dd aria-label={t('board.coins')}>
                <CoinIcon className="size-4" />
                {player.coins}
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
                d="M3.5 6l4.5 4.5L12.5 6"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </header>
        <dl className="player-glance">
          <div>
            <dt>{t('board.position')}</dt>
            <dd aria-label={t('board.position')}>{player.position}</dd>
          </div>
          <div>
            <dt>{t('board.lapShort')}</dt>
            <dd aria-label={t('board.lap')}>
              {player.creditedLap} / {observation.public.lapTarget}
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
      </div>
      <div className="player-body" id={bodyId} hidden={!open}>
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
                  <TeamDetails pokemon={pokemon} form={form} watched={ownSeat === undefined} />
                </li>
              );
            })}
          </ul>
        )}
        {own ? (
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
      </div>
    </section>
  );
}
