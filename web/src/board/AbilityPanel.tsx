import { useState } from 'react';
import type { LegalActions, Observation } from '../../../engine/index.ts';
import { abilityFacts, content, currentForm } from '../game/content.ts';
import { t } from '../i18n/en.ts';
import { memberName } from '../i18n/names.ts';
import { ActionButton } from '../ui/ActionButton.tsx';
import { Folded, foldLabel, useInView } from './DecisionCard.tsx';
import { seatLabel } from './labels.ts';

type Enabled = LegalActions['enabled'][number] & { kind: 'activate_ability' };
type Disabled = LegalActions['disabled'][number] & { kind: 'activate_ability' };

const isEnabled = (action: LegalActions['enabled'][number]): action is Enabled =>
  action.kind === 'activate_ability';
const isDisabled = (action: LegalActions['disabled'][number]): action is Disabled =>
  action.kind === 'activate_ability';

/** An option the player picks inside one Ability: an opponent, an own Pokémon or a roll scope. */
const hasOption = ({ payload }: Enabled | Disabled) =>
  payload.targetSeatIndex !== undefined ||
  payload.targetPokemonInstanceId !== undefined ||
  payload.scope !== undefined;

/**
 * Every Ability on the player's team with what it does and, when the engine lists it as
 * disabled, why it cannot be used now (§3.1). A choice is previewed with its effect, target and
 * costs before it is confirmed; confirming commits exactly that enabled engine action (§4.5,
 * Appendix C). The same section serves Strategy, the catch window, battle windows and rerolls.
 */
export function AbilityPanel({
  observation,
  legalActions,
  onChoose,
}: {
  observation: Observation;
  legalActions: LegalActions;
  onChoose: (id: string) => void;
}) {
  const [selection, setSelection] = useState<{
    actions: LegalActions;
    instanceId: string;
    choiceId?: string;
  }>();
  // A preview belongs to one offered action list, never to a later revision.
  const current = selection?.actions === legalActions ? selection : undefined;
  const preview = useInView<HTMLElement>(current?.choiceId);
  const ownSeat = observation.own.seatIndex;
  const team = observation.public.players.find((player) => player.seatIndex === ownSeat)!.team;
  const enabled = legalActions.enabled.filter(isEnabled);
  const disabled = legalActions.disabled.filter(isDisabled);
  // A bound Ability the engine did not list has no window or reason to show, so it gets no row;
  // an Ability the engine does not run yet is shown as planned, never as a button that does nothing.
  const members = team.flatMap((pokemon) => {
    const form = currentForm(pokemon.speciesId);
    const { ability } = form;
    if (!ability) return [];
    const own = {
      enabled: enabled.filter((action) => action.payload.instanceId === pokemon.instanceId),
      disabled: disabled.filter((action) => action.payload.instanceId === pokemon.instanceId),
    };
    return ability.effect && own.enabled.length + own.disabled.length === 0
      ? []
      : [{ pokemon, ability, ...own }];
  });
  const peek = observation.own.privateResults.findLast((result) => result.kind === 'peek');
  if (members.length === 0) return null;

  const selected = members.find(({ pokemon }) => pokemon.instanceId === current?.instanceId);
  // Enabled and disabled options read in one stable order, so a greyed-out target keeps its place.
  const options = selected
    ? [
        ...selected.enabled.filter(hasOption).map((action) => ({ action, reasonText: undefined })),
        ...selected.disabled
          .filter(hasOption)
          .map((action) => ({ action, reasonText: action.reasonText })),
      ].sort((a, b) => a.action.id.localeCompare(b.action.id, undefined, { numeric: true }))
    : [];
  const choice = selected?.enabled.find((action) => action.id === current?.choiceId);
  const optionLabel = ({ payload }: Enabled | Disabled) => {
    if (payload.targetPokemonInstanceId !== undefined) {
      const member = memberLabel(payload.targetPokemonInstanceId, payload.targetSeatIndex);
      if (payload.targetSeatIndex !== undefined) {
        return t('ability.targetMember', {
          member,
          target: seatLabel(payload.targetSeatIndex, ownSeat),
        });
      }
      return payload.status === 'combat_debuff' ? t('ability.healDebuff', { member }) : member;
    }
    if (payload.targetSeatIndex !== undefined) return seatLabel(payload.targetSeatIndex, ownSeat);
    return t(payload.scope === 'catch' ? 'ability.scope.catch' : 'ability.scope.combat');
  };
  const memberLabel = (instanceId: string, seatIndex = ownSeat) =>
    t('ability.member', {
      pokemon: memberName(
        observation.public.players.find((entry) => entry.seatIndex === seatIndex)?.team ?? [],
        instanceId,
      ),
    });
  const optionHeading = options.some(({ action }) => action.payload.targetSeatIndex !== undefined)
    ? t('ability.targets')
    : options.some(({ action }) => action.payload.targetPokemonInstanceId !== undefined)
      ? t('ability.members')
      : t('ability.scopes');
  const effect = selected?.ability.effect;
  const facts = effect ? abilityFacts(effect) : undefined;
  const memberRow = ({
    pokemon,
    ability,
    enabled: usable,
    disabled: blocked,
  }: (typeof members)[number]) => {
    const reasons = [...new Set(blocked.map((action) => action.reasonText))];
    const availability =
      usable.length > 0
        ? { enabled: true as const }
        : {
            enabled: false as const,
            reasonText: ability.effect
              ? t('action.engineReason', { reason: reasons.join(' · ') })
              : t('ability.planned'),
          };
    return (
      <li key={pokemon.instanceId} data-ability={ability.effect ?? 'planned'}>
        <ActionButton
          {...availability}
          variant={pokemon.instanceId === current?.instanceId ? 'reward' : 'secondary'}
          aria-pressed={pokemon.instanceId === current?.instanceId}
          onClick={() => {
            const sole = usable.length === 1 && !hasOption(usable[0]!) ? usable[0] : undefined;
            setSelection({
              actions: legalActions,
              instanceId: pokemon.instanceId,
              choiceId: sole?.id,
            });
          }}
        >
          {ability.name}
        </ActionButton>
        <p className="ability-source">
          {t('ability.source', { pokemon: memberName(team, pokemon.instanceId) })}
        </p>
        <p className="ability-text">{ability.text}</p>
      </li>
    );
  };
  // The Abilities that can be used now come first; the rest fold into one line with their reasons.
  const ready = members.filter((member) => member.enabled.length > 0);
  const shut = members.filter((member) => member.enabled.length === 0);
  return (
    <section className="ability-panel card-section" aria-label={t('ability.heading')}>
      <h3>{t('ability.heading')}</h3>
      {selection && !current && <p role="alert">{t('ability.stale')}</p>}
      {ready.length > 0 && <ul className="ability-list">{ready.map(memberRow)}</ul>}
      {shut.length > 0 && (
        <Folded label={foldLabel(shut.length, 'abilities')}>
          <ul className="ability-list">{shut.map(memberRow)}</ul>
        </Folded>
      )}
      {selected && options.length > 0 && (
        <div className="ability-options" role="group" aria-label={optionHeading}>
          <h4>{optionHeading}</h4>
          {options.map(({ action, reasonText }) => (
            <ActionButton
              key={action.id}
              {...(reasonText
                ? {
                    enabled: false as const,
                    reasonText: t('action.engineReason', { reason: reasonText }),
                  }
                : { enabled: true as const })}
              variant="secondary"
              aria-pressed={current?.choiceId === action.id}
              onClick={() => setSelection({ ...current!, choiceId: action.id })}
            >
              {optionLabel(action)}
            </ActionButton>
          ))}
        </div>
      )}
      {selected && choice && effect && facts ? (
        <section
          ref={preview}
          className="ability-preview"
          aria-label={t('ability.preview')}
          aria-live="polite"
        >
          <h4>{t('ability.preview')}</h4>
          <p>
            {t('ability.previewSource', {
              ability: selected.ability.name,
              pokemon: memberName(team, selected.pokemon.instanceId),
            })}
          </p>
          <p>{t('ability.previewEffect', { effect: selected.ability.text })}</p>
          {choice.payload.targetSeatIndex !== undefined && (
            <p>
              {t('ability.previewTarget', {
                target: seatLabel(choice.payload.targetSeatIndex, ownSeat),
              })}
            </p>
          )}
          {choice.payload.targetPokemonInstanceId !== undefined && (
            <p>
              {t('ability.previewMember', {
                member: memberLabel(
                  choice.payload.targetPokemonInstanceId,
                  choice.payload.targetSeatIndex,
                ),
              })}
            </p>
          )}
          {choice.payload.scope !== undefined && (
            <p>{t('ability.previewScope', { scope: optionLabel(choice) })}</p>
          )}
          <p className="panel-note">{t('ability.cost')}</p>
          {facts.tacticalAction && <p className="panel-note">{t('ability.costTactical')}</p>}
          {facts.hostile && <p className="panel-note">{t('ability.hostile')}</p>}
          <div className="ability-confirm">
            <ActionButton enabled data-primary="" onClick={() => onChoose(choice.id)}>
              {t('ability.confirm', { ability: selected.ability.name })}
            </ActionButton>
            <ActionButton enabled variant="secondary" onClick={() => setSelection(undefined)}>
              {t('ability.cancel')}
            </ActionButton>
          </div>
        </section>
      ) : selected ? (
        <div className="ability-confirm">
          <p className="target-prompt" role="status">
            {t('ability.chooseOption')}
          </p>
          <ActionButton enabled variant="secondary" onClick={() => setSelection(undefined)}>
            {t('ability.cancel')}
          </ActionButton>
        </div>
      ) : (
        enabled.length > 0 && (
          <p className="target-prompt" role="status">
            {t('ability.choosePrompt')}
          </p>
        )
      )}
      {peek && (
        <p className="ability-peek" role="status">
          {t('ability.peek', {
            text: content.events.find((card) => card.id === peek.eventId)?.text ?? peek.eventId,
          })}
        </p>
      )}
    </section>
  );
}
