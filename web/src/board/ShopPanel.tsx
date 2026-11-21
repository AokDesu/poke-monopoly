import type { LegalActions, Observation } from '../../../engine/index.ts';
import { t } from '../i18n/en.ts';
import { itemName } from '../i18n/names.ts';
import { ActionButton } from '../ui/ActionButton.tsx';
import { BallIcon } from '../ui/icons.tsx';
import { DecisionCard, Folded, foldLabel } from './DecisionCard.tsx';
import { ItemFacts } from './ItemFacts.tsx';

type Offer = Extract<Observation['public']['phase'], { kind: 'shop' }>['offers'][number];

/**
 * A Shop stop (spec §4.6) in the decision slot: the offers the player can buy first, each with the
 * engine's price and effect; the ones it cannot buy folded into one line that opens to the engine's
 * reasons; and Leave the Shop, always in view.
 */
export function ShopPanel({
  observation,
  legalActions,
  onChoose,
}: {
  observation: Observation;
  legalActions: LegalActions;
  onChoose: (id: string) => void;
}) {
  const phase = observation.public.phase;
  if (phase.kind !== 'shop') return null;
  const you = observation.public.players.find(
    (player) => player.seatIndex === observation.own.seatIndex,
  )!;
  const skip = legalActions.enabled.find(
    (action) => action.kind === 'skip_shop' || action.kind === 'skip',
  );
  const buy = (offer: Offer) =>
    legalActions.enabled.find(
      (action) => action.kind === 'buy' && action.payload.offerId === offer.id,
    );
  const usable = phase.offers.filter((offer) => buy(offer));
  const closed = phase.offers.filter((offer) => !buy(offer));
  const row = (offer: Offer) => {
    const choice = buy(offer);
    const disabled = legalActions.disabled.find(
      (action) => action.kind === 'buy' && action.payload.offerId === offer.id,
    );
    const availability = choice
      ? { enabled: true as const }
      : {
          enabled: false as const,
          reasonText: t('action.engineReason', { reason: disabled!.reasonText }),
        };
    return (
      <li key={offer.id} data-unavailable={!choice}>
        <span
          className={`offer-art ${offer.kind === 'ball' ? `pouch-${offer.ballType}` : ''}`}
          aria-hidden="true"
        >
          {offer.kind === 'ball' ? (
            <BallIcon className="size-7" />
          ) : (
            <span className="item-capsule" />
          )}
        </span>
        <div className="offer-body">
          <ActionButton
            {...availability}
            variant="reward"
            onClick={() => choice && onChoose(choice.id)}
          >
            {t(offer.price === 1 ? 'shop.buyOne' : 'shop.buy', {
              item: itemName(offer.itemId),
              price: offer.price,
            })}
          </ActionButton>
          <ItemFacts itemId={offer.itemId} price={offer.price} />
        </div>
      </li>
    );
  };
  return (
    <DecisionCard
      kind="shop"
      heading={t('turn.shopHeading')}
      lead={t('shop.balance', { coins: you.coins })}
      actions={
        skip && (
          <ActionButton
            enabled
            variant="secondary"
            data-primary={usable.length === 0 ? '' : undefined}
            onClick={() => onChoose(skip.id)}
          >
            {t('shop.skip')}
          </ActionButton>
        )
      }
    >
      <p className="card-copy">{t('turn.shopBody')}</p>
      {usable.length > 0 && <ul className="shop-offers">{usable.map(row)}</ul>}
      {closed.length > 0 && (
        <Folded label={foldLabel(closed.length, 'offers')}>
          <ul className="shop-offers">{closed.map(row)}</ul>
        </Folded>
      )}
    </DecisionCard>
  );
}
