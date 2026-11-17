import { content, itemStatus } from '../game/content.ts';
import { t } from '../i18n/en.ts';
import '../ui/facts.css';

/**
 * Kind, price and effect of one item, from the content table, with the engine's own word on how
 * much of the effect it applies (`itemEffectStatus`): an effect the engine does not run yet is
 * labelled as planned and is never worded as something the item does (§3, §4.6, Appendix A).
 * `price` is the engine's offer price where there is one; otherwise the content price.
 */
export function ItemFacts({
  itemId,
  price,
  showStatus = true,
}: {
  itemId: string;
  price?: number;
  /** Off only where an adjacent greyed-out reason already says the same thing. */
  showStatus?: boolean;
}) {
  const item = content.items.find((entry) => entry.id === itemId);
  const status = itemStatus(itemId);
  if (!item || !status) return null;
  const cost = price ?? item.price;
  const effect =
    item.kind === 'ball'
      ? t('item.ball.effect', { bonus: item.bonus })
      : status === 'planned'
        ? t('item.effect.planned', { effect: item.effect })
        : item.effect;
  return (
    <div className="item-facts" data-item={itemId} data-effect-status={status}>
      <p className="item-meta">
        <span className="item-kind">{t(`item.kind.${item.kind}`)}</span>
        <span>{t(cost === 1 ? 'item.priceOne' : 'item.price', { price: cost })}</span>
      </p>
      <p className="item-effect">{effect}</p>
      {showStatus && status !== 'active' && (
        <p className="item-status">{t(`item.status.${status}`)}</p>
      )}
    </div>
  );
}
