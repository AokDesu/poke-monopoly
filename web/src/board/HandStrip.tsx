import { speciesType } from '../game/content.ts';
import { t } from '../i18n/en.ts';
import { itemName, speciesName } from '../i18n/names.ts';
import { BallIcon } from '../ui/icons.tsx';
import { TypeOrb } from '../ui/TypeOrb.tsx';
import type { ViewedObservation } from './labels.ts';

const BALLS = ['poke', 'great', 'ultra'] as const;

/**
 * The viewing seat's hand under the board (spec §3, Board screen; issue #256): its Ball counts,
 * its secret items and its team. Everything private comes from that seat's own observation, so a
 * rival's pouch or items can never appear here, and a watcher, who holds no seat, has no hand.
 * The full facts of each Ball, item and Pokémon open under the seat's own row.
 */
export function HandStrip({ observation }: { observation: ViewedObservation }) {
  if (!('own' in observation)) return null;
  const { own } = observation;
  const team =
    observation.public.players.find((player) => player.seatIndex === own.seatIndex)?.team ?? [];
  return (
    <section className="hand-strip panel" aria-label={t('hand.label')} data-seat={own.seatIndex}>
      <div className="hand-group hand-balls">
        <h2>{t('hand.balls')}</h2>
        <ul>
          {BALLS.map((ball) => (
            <li
              key={ball}
              className={`pouch-${ball}`}
              data-ball={ball}
              data-empty={own.balls[ball] === 0 ? 'true' : undefined}
            >
              <BallIcon className="size-5" />
              <strong>{own.balls[ball]}</strong>
              <span>{t(`hand.ball.${ball}`)}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="hand-group hand-items">
        <h2>{t('hand.items')}</h2>
        {own.items.length === 0 ? (
          <p className="hand-none">{t('hand.noItems')}</p>
        ) : (
          <ul>
            {own.items.map((item) => (
              <li key={item.instanceId} className="hand-chip">
                <span className="item-capsule" aria-hidden="true" />
                {itemName(item.itemId)}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="hand-group hand-team">
        <h2>{t('hand.team')}</h2>
        {team.length === 0 ? (
          <p className="hand-none">{t('board.emptyTeam')}</p>
        ) : (
          <ul>
            {team.map((pokemon) => (
              <li key={pokemon.instanceId} className="hand-chip" data-tired={pokemon.tired}>
                <TypeOrb type={speciesType(pokemon.speciesId)} className="size-6" />
                {speciesName(pokemon.speciesId)}
                {pokemon.tired && <span className="hand-tired">{t('board.tired')}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
