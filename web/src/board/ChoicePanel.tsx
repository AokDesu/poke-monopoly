import type { LegalAction, LegalActions, Observation } from '../../../engine/index.ts';
import { currentForm } from '../game/content.ts';
import { t } from '../i18n/en.ts';
import { speciesName } from '../i18n/names.ts';
import { ActionButton } from '../ui/ActionButton.tsx';

/**
 * Plain words for an engine-listed choice that has no dedicated panel yet: Gym entry, battle
 * responses, Ability windows, rerolls and battle rewards (#55). Every option is the engine's own.
 */
export function choiceLabel(action: LegalAction, observation: Observation): string {
  const own = observation.public.players.find(
    (player) => player.seatIndex === observation.own.seatIndex,
  )!;
  const phase = observation.public.phase;
  switch (action.kind) {
    case 'challenge_gym':
      return t('choice.challengeGym');
    case 'respond_pvp':
      return t(action.payload.accept ? 'choice.acceptBattle' : 'choice.declineBattle');
    case 'choose_reward': {
      if (action.payload.kind === 'coins') return t('choice.rewardCoins');
      const { instanceId, nextFormId } = action.payload;
      const pokemon = own.team.find((entry) => entry.instanceId === instanceId);
      return t('choice.rewardEvolve', {
        pokemon: pokemon ? speciesName(pokemon.speciesId) : instanceId,
        form: speciesName(nextFormId),
      });
    }
    case 'activate_ability': {
      const pokemon = own.team.find((entry) => entry.instanceId === action.payload.instanceId);
      const form = pokemon ? currentForm(pokemon.speciesId) : undefined;
      let label = t('choice.ability', {
        ability: form?.ability?.name ?? action.payload.instanceId,
        pokemon: form?.name ?? action.payload.instanceId,
      });
      // Heal Pulse lists one choice per Pokémon it can heal; name the member, with its Team ID so
      // two of one species stay apart.
      const target = own.team.find(
        (entry) => entry.instanceId === action.payload.targetPokemonInstanceId,
      );
      if (target) {
        label = t('choice.abilityTarget', {
          label,
          target: t('strategy.potion.member', {
            pokemon: speciesName(target.speciesId),
            instanceId: target.instanceId,
          }),
        });
      }
      // Adaptability lists one choice per scope; name the scope so the options differ.
      const scope = action.payload.scope;
      if (scope === 'catch') return t('choice.abilityCatch', { label });
      if (scope === 'combat') return t('choice.abilityCombat', { label });
      return label;
    }
    case 'skip':
      if (phase.kind === 'gym' && phase.battle.step === 'entry') return t('choice.skipGym');
      if (action.id === 'pass-window') return t('choice.noAbility');
      if (action.id === 'keep-die') return t('choice.keepDie');
      return t('choice.skip');
    default:
      return action.id;
  }
}

export function ChoicePanel({
  observation,
  legalActions,
  onChoose,
}: {
  observation: Observation;
  legalActions: LegalActions;
  onChoose: (id: string) => void;
}) {
  return (
    <div className="decision-panel choice-panel">
      <ul className="choice-list">
        {legalActions.enabled.map((action) => (
          <li key={action.id}>
            <ActionButton enabled onClick={() => onChoose(action.id)}>
              {choiceLabel(action, observation)}
            </ActionButton>
          </li>
        ))}
      </ul>
    </div>
  );
}
