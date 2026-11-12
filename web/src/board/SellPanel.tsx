import { useEffect, useId, useRef, useState } from 'react';
import type { Observation, SaleQuote } from '../../../engine/index.ts';
import { currentForm, speciesType } from '../game/content.ts';
import { t } from '../i18n/en.ts';
import { speciesName } from '../i18n/names.ts';
import { ActionButton } from '../ui/ActionButton.tsx';
import { TypeOrb } from '../ui/TypeOrb.tsx';
import { tagLabel } from './labels.ts';
import { TeamDetails } from './TeamDetails.tsx';

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
  const dialog = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  const totalId = useId();
  const team = observation.public.players.find(
    (player) => player.seatIndex === observation.own.seatIndex,
  )!.team;
  const quote = quoteSale(selected);
  // A Sell decision is protected like a catch: focus moves in and stays until the
  // player chooses to sell a selection or to keep the whole team (§3.1, §4.7).
  useEffect(() => {
    const element = dialog.current!;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element.showModal();
    (element.querySelector<HTMLElement>('input[type="checkbox"]') ?? element).focus();
    return () => {
      element.close();
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="sell-dialog panel"
      aria-labelledby={headingId}
      onCancel={(event) => event.preventDefault()}
    >
      <h2 id={headingId}>{t('turn.sellHeading')}</h2>
      <p className="sell-copy">{t('turn.sellBody')}</p>
      <ul className="sale-team" aria-label={t('board.yourTeam')}>
        {team.map((pokemon) => {
          const checked = selected.includes(pokemon.instanceId);
          const form = currentForm(pokemon.speciesId);
          // Unselected cards show a solo quote, never a guessed share of the batch bonus.
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
                <TypeOrb type={speciesType(pokemon.speciesId)} className="size-10 shrink-0" />
                <span className="sale-detail">
                  <strong>{speciesName(pokemon.speciesId)}</strong>
                  <span className="pokemon-tags">
                    {form.tags.map((tag) => (
                      <span key={tag}>{tagLabel(tag)}</span>
                    ))}
                  </span>
                  <span>{t(row.classBonus === 0 ? 'sell.price' : 'sell.priceBonus', row)}</span>
                  <small>{t(checked ? 'sell.selectedPrice' : 'sell.soloPrice')}</small>
                  {pokemon.tired && <small className="pokemon-status">{t('sell.tired')}</small>}
                  {pokemon.origin === 'rescue_starter' && <small>{t('board.rescue')}</small>}
                </span>
                <span className="battle-stat">
                  <span>{t('board.battle')}</span>
                  <strong aria-label={t('board.battle')}>{form.battle}</strong>
                </span>
              </label>
              <TeamDetails pokemon={pokemon} form={form} />
            </li>
          );
        })}
      </ul>
      {team.length === 0 && <p className="sell-copy">{t('board.emptyTeam')}</p>}
      <div className="sale-total" aria-live="polite">
        <span id={totalId}>{t('sell.total')}</span>
        <output aria-labelledby={totalId}>{t('sell.coins', { amount: quote.total })}</output>
      </div>
      {quote.rescueStarter && (
        <p className="rescue-preview" role="status">
          {t('sell.rescuePreview', { value: quote.rescueStarter.saleValue })}
        </p>
      )}
      <div className="sell-actions">
        {selected.length > 0 && (
          <ActionButton enabled onClick={() => onSell(selected)}>
            {t('sell.confirm')}
          </ActionButton>
        )}
        <ActionButton enabled variant="secondary" onClick={() => onSell([])}>
          {t('sell.keep')}
        </ActionButton>
      </div>
    </dialog>
  );
}
