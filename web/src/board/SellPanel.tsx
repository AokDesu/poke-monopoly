import { useId, useState } from 'react';
import type { Observation, SaleQuote } from '../../../engine/index.ts';
import { currentForm, speciesType } from '../game/content.ts';
import type { SeatFeedEntry } from '../game/store.ts';
import { HowToPlayButton } from '../howToPlay/HowToPlay.tsx';
import { t } from '../i18n/en.ts';
import { speciesName } from '../i18n/names.ts';
import { ActionButton } from '../ui/ActionButton.tsx';
import { TypeOrb } from '../ui/TypeOrb.tsx';
import { DecisionCard } from './DecisionCard.tsx';
import { tagLabel } from './labels.ts';
import { TeamDetails } from './TeamDetails.tsx';

/** What passing Start gave the seat this turn, from the engine's own records (§4.7 step 1). */
export interface StartPass {
  /** The Start income the engine paid. */
  readonly coins: number;
  /** Laps credited so far, and the game's Lap target. */
  readonly lap: number;
  readonly target: number;
  /** The engine made used Abilities ready again. */
  readonly abilities: boolean;
}

/**
 * The record of this turn in which the seat passed Start, read back as what it gave: the income
 * paid, the Lap credited and whether Abilities were made ready. Null when no such record is in the
 * seat's feed for the current turn.
 */
export function startPass(
  feed: readonly SeatFeedEntry[],
  observation: Observation,
): StartPass | null {
  const { public: game, own } = observation;
  const you = game.players.find((player) => player.seatIndex === own.seatIndex)!;
  // Only this seat's records of this turn: the Start crossing that opened this Sell Phase.
  const events = feed
    .filter(
      ({ before }) =>
        before.activeSeatIndex === own.seatIndex && before.globalTurnNo === game.globalTurnNo,
    )
    .flatMap(({ record }) => record.events);
  const income = events.findLast(
    (event) =>
      event.kind === 'coin_transfer' &&
      event.reason === 'start_income' &&
      event.destination.kind === 'player' &&
      event.destination.actorId === you.actorId,
  );
  if (income?.kind !== 'coin_transfer') return null;
  return {
    coins: income.amount,
    lap: you.creditedLap,
    target: game.lapTarget,
    abilities: events.some(
      (event) => event.kind === 'abilities_reset' && event.ownerId === you.actorId,
    ),
  };
}

/** The Sell card's banner: "You passed Start: +5 coins · Lap 1 of 2 · Abilities ready". */
function StartBanner({ pass }: { pass: StartPass }) {
  const parts = [
    t('sell.start.coins', { amount: pass.coins }),
    t(pass.lap >= pass.target ? 'sell.start.lastLap' : 'sell.start.lap', {
      lap: pass.lap,
      target: pass.target,
    }),
    ...(pass.abilities ? [t('sell.start.abilities')] : []),
  ];
  return (
    <p className="start-banner" data-last-lap={pass.lap >= pass.target ? 'true' : undefined}>
      <svg viewBox="0 0 24 24" aria-hidden="true" className="start-flag">
        <path
          d="M5 21V4m0 0h11l-2 4 2 4H5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span>
        {t('sell.start.heading', {
          parts: parts.reduce((first, second) => t('beat.join', { first, second })),
        })}
      </span>
    </p>
  );
}

/**
 * Keep or sell at Start (spec §4.7) in the decision slot: what passing Start gave, the team with the
 * engine's price of each Pokémon (in this batch, or if sold alone), the engine's running total, and
 * Sell or Keep all. Every price comes from `saleQuote`, asked again on every change. A Sell
 * decision is protected like a catch: focus moves in and stays until the player sells a selection
 * or keeps the whole team.
 */
export function SellPanel({
  observation,
  feed = [],
  quoteSale,
  onSell,
  initialSelection = [],
}: {
  observation: Observation;
  /** The seat's feed, for what passing Start gave; the banner is left out without it. */
  feed?: readonly SeatFeedEntry[];
  quoteSale: (ids: string[]) => SaleQuote;
  onSell: (ids: string[]) => void;
  /** Dev gallery only: Pokémon already ticked when the card opens. */
  initialSelection?: readonly string[];
}) {
  const [selected, setSelected] = useState<string[]>([...initialSelection]);
  const team = observation.public.players.find(
    (player) => player.seatIndex === observation.own.seatIndex,
  )!.team;
  const quote = quoteSale(selected);
  const pass = startPass(feed, observation);
  const totalId = useId();
  const sold = team.filter((pokemon) => selected.includes(pokemon.instanceId));
  return (
    <DecisionCard
      kind="sell"
      protect
      heading={t('turn.sellHeading')}
      lead={t('turn.sellBody')}
      banner={pass && <StartBanner pass={pass} />}
      actions={
        <div className="card-pair">
          {sold.length > 0 ? (
            <ActionButton enabled data-primary="" onClick={() => onSell(selected)}>
              {sold.length === 1
                ? t('sell.confirmOne', {
                    pokemon: speciesName(sold[0]!.speciesId),
                    amount: quote.total,
                  })
                : t('sell.confirmMany', { count: sold.length, amount: quote.total })}
            </ActionButton>
          ) : (
            <ActionButton enabled={false} reasonText={t('sell.chooseFirst')}>
              {t('sell.confirm')}
            </ActionButton>
          )}
          <ActionButton enabled variant="secondary" onClick={() => onSell([])}>
            {t('sell.keep')}
          </ActionButton>
        </div>
      }
    >
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
                <TypeOrb type={speciesType(pokemon.speciesId)} className="size-9 shrink-0" />
                <span className="sale-detail">
                  <strong>{speciesName(pokemon.speciesId)}</strong>
                  <span className="pokemon-tags">
                    {form.tags.map((tag) => (
                      <span key={tag}>{tagLabel(tag)}</span>
                    ))}
                    <span>
                      {t('board.battle')}{' '}
                      <strong aria-label={t('board.battle')}>{form.battle}</strong>
                    </span>
                  </span>
                  {pokemon.tired && <small className="pokemon-status">{t('sell.tired')}</small>}
                  {pokemon.origin === 'rescue_starter' && <small>{t('board.rescue')}</small>}
                </span>
                {/* The engine's price parts as they are: the browser never adds them up. */}
                <span className="sale-price">
                  <strong>{t(row.classBonus === 0 ? 'sell.price' : 'sell.priceBonus', row)}</strong>
                  <small>{t(checked ? 'sell.selectedPrice' : 'sell.soloPrice')}</small>
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
      <div className="card-help">
        <HowToPlayButton />
      </div>
    </DecisionCard>
  );
}
