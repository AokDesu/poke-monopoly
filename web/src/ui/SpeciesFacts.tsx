import { tagLabel } from '../board/labels.ts';
import { currentForm } from '../game/content.ts';
import { t } from '../i18n/en.ts';
import './facts.css';

/**
 * Tags, battle value, base value and Ability of one form, all read from the engine's effective-form
 * lookup (§4.5): the same numbers a team card shows, for surfaces that name a species before the
 * player owns it (a wild encounter, a Starter choice).
 */
export function SpeciesFacts({
  speciesId,
  showCatchDc = false,
}: {
  speciesId: string;
  showCatchDc?: boolean;
}) {
  const form = currentForm(speciesId);
  return (
    <div className="species-facts" data-species={speciesId}>
      <div className="pokemon-tags">
        {form.tags.map((tag) => (
          <span key={tag}>{tagLabel(tag)}</span>
        ))}
      </div>
      <dl className="species-stats">
        <div>
          <dt>{t('board.battle')}</dt>
          <dd>{form.battle}</dd>
        </div>
        <div>
          <dt>{t('team.baseValue')}</dt>
          <dd>{form.base}</dd>
        </div>
        {showCatchDc && (
          <div>
            <dt>{t('species.catchDc')}</dt>
            <dd>{form.dc}</dd>
          </div>
        )}
      </dl>
      <p className="species-ability">
        {form.ability ? (
          <>
            <strong>{form.ability.name}</strong> {form.ability.text}
          </>
        ) : (
          t('team.noAbility')
        )}
      </p>
    </div>
  );
}
