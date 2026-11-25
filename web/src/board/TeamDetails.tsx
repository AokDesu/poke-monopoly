import type { EffectiveForm, Observation } from '../../../engine/index.ts';
import { nextForms } from '../game/content.ts';
import { t } from '../i18n/en.ts';
import './team-details.css';

type TeamMember = Observation['public']['players'][number]['team'][number];

/** Native, local disclosure: inspecting public team data never submits a game action. */
export function TeamDetails({
  pokemon,
  form,
  watched = false,
}: {
  pokemon: TeamMember;
  form: EffectiveForm;
  /** A watcher holds no seat, so no one is "you" who chooses an evolution. */
  watched?: boolean;
}) {
  const next = nextForms(pokemon.speciesId);
  return (
    <details className="team-details">
      <summary>{t('team.details', { name: form.name })}</summary>
      <div className="team-details-body">
        {pokemon.tired && <p className="team-status-note">{t('team.tiredReason')}</p>}
        {pokemon.origin === 'rescue_starter' && (
          <p className="team-status-note">{t('team.rescueRestriction')}</p>
        )}
        <dl>
          <dt>{t('team.baseValue')}</dt>
          <dd>
            <strong>{form.base}</strong>
            <p>{t('team.baseValueNote')}</p>
          </dd>
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
              <>
                {next.length > 1 && (
                  <p>{t(watched ? 'team.branchChoiceWatched' : 'team.branchChoice')}</p>
                )}
                <ul>
                  {next.map((choice) => (
                    <li key={choice.id}>
                      <strong>{choice.name}</strong>
                      <span className="next-form-facts">
                        {t('team.nextFormStats', { battle: choice.battle, base: choice.base })}
                        {choice.ability &&
                          ` · ${t('team.nextFormAbility', { ability: choice.ability.name })}`}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
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
