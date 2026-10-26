import type { LegalActions, Observation } from '../../../engine/index.ts';
import { t } from '../i18n/en.ts';
import { itemName } from '../i18n/names.ts';
import { ActionButton } from '../ui/ActionButton.tsx';
import { BallIcon } from '../ui/icons.tsx';

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
  return (
    <div className="decision-panel shop-panel">
      <p className="decision-balance">{t('shop.balance', { coins: you.coins })}</p>
      <ul className="shop-offers">
        {phase.offers.map((offer) => {
          const choice = legalActions.enabled.find(
            (action) => action.kind === 'buy' && action.payload.offerId === offer.id,
          );
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
                  <BallIcon className="size-8" />
                ) : (
                  <span className="item-capsule" />
                )}
              </span>
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
            </li>
          );
        })}
      </ul>
      {skip && (
        <ActionButton enabled variant="secondary" onClick={() => onChoose(skip.id)}>
          {t('shop.skip')}
        </ActionButton>
      )}
    </div>
  );
}
