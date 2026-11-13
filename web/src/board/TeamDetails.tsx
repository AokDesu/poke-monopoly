import type { EffectiveForm, Observation } from '../../../engine/index.ts';
import { nextForms } from '../game/content.ts';
import { t } from '../i18n/en.ts';
import './team-details.css';

type TeamMember = Observation['public']['players'][number]['team'][number];

/** Native, local disclosure: inspecting public team data never submits a game action. */
export function TeamDetails({ pokemon, form }: { pokemon: TeamMember; form: EffectiveForm }) {
  const next = nextForms(pokemon.speciesId);
  return (
    <details className="team-details">
      <summary>{t('team.details', { name: form.name })}</summary>
      <div className="team-details-body">
        <p className="team-instance">{t('team.instance', { id: pokemon.instanceId })}</p>
        {pokemon.tired && <p className="team-status-note">{t('team.tiredReason')}</p>}
        {pokemon.origin === 'rescue_starter' && (
          <p className="team-status-note">{t('team.rescueRestriction')}</p>
        )}
        <dl>
          <dt>{t('team.ability')}</dt>
          <dd>
            {form.ability ? (
              <>
                <strong>{form.ability.name}</strong>
                <p>{form.ability.text}</p>
              </>
            ) : (
              t('team.noAbility')
            )}
          </dd>
          <dt>{t('team.nextForms')}</dt>
          <dd>
            {next.length > 0 ? (
              <ul>
                {next.map((choice) => (
                  <li key={choice.id}>{choice.name}</li>
                ))}
              </ul>
            ) : (
              <p>{t('team.finalForm')}</p>
            )}
          </dd>
        </dl>
        <p className="team-read-only">{t('team.readOnly')}</p>
      </div>
    </details>
  );
}
