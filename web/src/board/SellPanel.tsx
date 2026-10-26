import { useId, useState } from 'react';
import type { Observation, SaleQuote } from '../../../engine/index.ts';
import { speciesType } from '../game/content.ts';
import { t } from '../i18n/en.ts';
import { speciesName } from '../i18n/names.ts';
import { ActionButton } from '../ui/ActionButton.tsx';
import { TypeOrb } from '../ui/TypeOrb.tsx';

export function SellPanel({
  observation,
  quoteSale,
  onSell,
}: {
  observation: Observation;
  quoteSale: (ids: string[]) => SaleQuote;
  onSell: (ids: string[]) => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const totalId = useId();
  const team = observation.public.players.find(
    (player) => player.seatIndex === observation.own.seatIndex,
  )!.team;
  const quote = quoteSale(selected);
  return (
    <div className="decision-panel sell-panel">
      <ul className="sale-team" aria-label={t('board.yourTeam')}>
        {team.map((pokemon) => {
          const checked = selected.includes(pokemon.instanceId);
          // Unselected rows show a solo quote, never a guessed share of the batch bonus.
          const row =
            quote.rows.find((entry) => entry.instanceId === pokemon.instanceId) ??
            quoteSale([pokemon.instanceId]).rows[0]!;
          return (
            <li key={pokemon.instanceId} data-testid={`sale-${pokemon.instanceId}`}>
              <label className="sale-choice" data-selected={checked}>
                <input
                  type="checkbox"
                  checked={checked}
                  aria-label={speciesName(pokemon.speciesId)}
                  onChange={() =>
                    setSelected((ids) =>
                      checked
                        ? ids.filter((id) => id !== pokemon.instanceId)
                        : [...ids, pokemon.instanceId],
                    )
                  }
                />
                <TypeOrb type={speciesType(pokemon.speciesId)} className="size-9 shrink-0" />
                <span className="sale-detail">
                  <strong>{speciesName(pokemon.speciesId)}</strong>
                  <span>{t(row.classBonus === 0 ? 'sell.price' : 'sell.priceBonus', row)}</span>
                  <small>{t(checked ? 'sell.selectedPrice' : 'sell.soloPrice')}</small>
                  {pokemon.tired && <small className="pokemon-status">{t('sell.tired')}</small>}
                  {pokemon.origin === 'rescue_starter' && <small>{t('board.rescue')}</small>}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      {team.length === 0 && <p>{t('board.emptyTeam')}</p>}
      <div className="sale-total" aria-live="polite">
        <span id={totalId}>{t('sell.total')}</span>
        <output aria-labelledby={totalId}>{t('sell.coins', { amount: quote.total })}</output>
      </div>
      {quote.rescueStarter && (
        <p className="rescue-preview" role="status">
          {t('sell.rescuePreview', { value: quote.rescueStarter.saleValue })}
        </p>
      )}
      {selected.length > 0 && (
        <ActionButton enabled onClick={() => onSell(selected)}>
          {t('sell.confirm')}
        </ActionButton>
      )}
      <ActionButton enabled variant="secondary" onClick={() => onSell([])}>
        {t('sell.keep')}
      </ActionButton>
    </div>
  );
}
