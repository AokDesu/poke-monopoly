import type { Observation } from '../../../engine/index.ts';
import { content, speciesType } from '../game/content.ts';
import { t } from '../i18n/en.ts';
import { className, itemName, speciesName } from '../i18n/names.ts';
import { BallIcon } from '../ui/icons.tsx';
import { TypeOrb } from '../ui/TypeOrb.tsx';
import { seatLabel, tagLabel } from './labels.ts';

interface PlayerPanelProps {
  player: Observation['public']['players'][number];
  observation: Observation;
}

export function PlayerPanel({ player, observation }: PlayerPanelProps) {
  const own = player.seatIndex === observation.own.seatIndex;
  const active = player.seatIndex === observation.public.activeSeatIndex;
  return (
    <section
      className={`panel player-panel ${own ? 'own-panel' : 'rival-panel'}`}
      data-testid={`player-${player.seatIndex}`}
      aria-labelledby={`player-heading-${player.seatIndex}`}
    >
      <header className="player-heading">
        <span
          className="seat-disc"
          data-seat={player.seatIndex}
          aria-label={t('board.seatLabel', { seat: player.seatIndex })}
        >
          {player.seatIndex}
        </span>
        <div>
          <h2 id={`player-heading-${player.seatIndex}`}>
            {seatLabel(player.seatIndex, observation.own.seatIndex)}
          </h2>
          <p>{className(player.classId)}</p>
        </div>
        {active && (
          <span
            className="current-turn-dot"
            aria-label={
              own
                ? t('board.yourTurn')
                : t('board.turn', {
                    name: seatLabel(player.seatIndex, observation.own.seatIndex),
                  })
            }
          />
        )}
      </header>
      <dl className="player-stats">
        <div className="coin-stat">
          <dt>{t('board.coins')}</dt>
          <dd aria-label={t('board.coins')}>{player.coins}</dd>
        </div>
        <div>
          <dt>{t('board.position')}</dt>
          <dd aria-label={t('board.position')}>{player.position}</dd>
        </div>
        <div>
          <dt>{t('board.lap')}</dt>
          <dd aria-label={t('board.lap')}>
            {player.creditedLap} / {observation.public.lapTarget}
          </dd>
        </div>
      </dl>
      <h3>{own ? t('board.yourTeam') : t('board.team')}</h3>
      {player.team.length === 0 ? (
        <p className="panel-note">{t('board.emptyTeam')}</p>
      ) : (
        <ul className="team-list" aria-label={t('board.team')}>
          {player.team.map((pokemon) => {
            const species = content.species.find((entry) => entry.id === pokemon.speciesId);
            return (
              <li className="team-member" key={pokemon.instanceId} data-testid={pokemon.instanceId}>
                <TypeOrb type={speciesType(pokemon.speciesId)} className="size-10 shrink-0" />
                <div className="team-member-detail">
                  <strong>{speciesName(pokemon.speciesId)}</strong>
                  <div className="pokemon-tags">
                    {species?.tags.map((tag) => (
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
                  <strong aria-label={t('board.battle')}>{species?.battle}</strong>
                </div>
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
                <dd aria-label={t(`board.ball.${ball}`)}>{observation.own.balls[ball]}</dd>
              </div>
            ))}
          </dl>
          <h3>{t('board.items')}</h3>
          <ul className="item-list" aria-label={t('board.items')}>
            {observation.own.items.length === 0 ? (
              <li className="panel-note">{t('board.emptyItems')}</li>
            ) : (
              observation.own.items.map((item) => (
                <li key={item.instanceId}>
                  <span className="item-capsule" aria-hidden="true" />
                  <span>{itemName(item.itemId)}</span>
                </li>
              ))
            )}
          </ul>
          <p className="panel-note inventory-note">{t('board.privateInventory')}</p>
        </>
      ) : (
        <>
          <dl className="opponent-items">
            <dt>{t('board.itemCount')}</dt>
            <dd aria-label={t('board.itemCount')}>{player.itemCount}</dd>
          </dl>
          <p className="panel-note">{t('board.hiddenInventory')}</p>
        </>
      )}
    </section>
  );
}
