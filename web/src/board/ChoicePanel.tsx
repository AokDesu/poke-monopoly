import type { LegalAction, LegalActions, Observation, PendingDie } from '../../../engine/index.ts';
import { currentForm } from '../game/content.ts';
import { t } from '../i18n/en.ts';
import { memberName, speciesName } from '../i18n/names.ts';
import { ActionButton } from '../ui/ActionButton.tsx';
import { DieFace } from '../ui/DieFace.tsx';
import { AbilityPanel } from './AbilityPanel.tsx';
import { DecisionCard } from './DecisionCard.tsx';
import { phaseLabel } from './labels.ts';

/**
 * Plain words for an engine-listed choice that has no dedicated panel yet: Gym entry, battle
 * responses, window passes, rerolls and battle rewards (#55). Every option is the engine's own.
 * Outside a battle, Ability activations have their own section (`AbilityPanel`); a battle panel
 * lists them as plain buttons and labels them here.
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
      return t('choice.rewardEvolve', {
        pokemon: memberName(own.team, instanceId),
        form: speciesName(nextFormId),
      });
    }
    case 'activate_ability': {
      const pokemon = own.team.find((entry) => entry.instanceId === action.payload.instanceId);
      const form = pokemon ? currentForm(pokemon.speciesId) : undefined;
      let label = t('choice.ability', {
        ability: form?.ability?.name ?? t('team.memberUnknown'),
        pokemon: memberName(own.team, action.payload.instanceId),
      });
      // Heal Pulse lists one choice per Pokémon it can heal; name the member, numbered when two of
      // one species would otherwise read the same.
      const target = own.team.find(
        (entry) => entry.instanceId === action.payload.targetPokemonInstanceId,
      );
      if (target) {
        label = t('choice.abilityTarget', {
          label,
          target: t('strategy.potion.member', {
            pokemon: memberName(own.team, target.instanceId),
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

/** The die a reroll window asks about, so the player decides on a number and not on a guess. */
export function dieSummary(pendingDie: PendingDie): string {
  if (pendingDie.kind === 'move') {
    return pendingDie.steps === pendingDie.die
      ? t('reroll.move', { die: pendingDie.die, square: pendingDie.destination })
      : t('reroll.moveSlowed', {
          die: pendingDie.die,
          steps: pendingDie.steps,
          square: pendingDie.destination,
        });
  }
  return t(pendingDie.succeeds ? 'reroll.catchHit' : 'reroll.catchMiss', {
    die: pendingDie.die,
    total: pendingDie.total,
    dc: pendingDie.dc,
  });
}

/**
 * A window with the engine's own choices and no card of its own (spec §3, C.3): a move or catch
 * reroll window shows the die it asks about, Abilities come with their previews, and the plain
 * choices sit in the footer, always in view.
 */
export function ChoicePanel({
  observation,
  legalActions,
  pendingDie = null,
  onChoose,
}: {
  observation: Observation;
  legalActions: LegalActions;
  /** The engine's reading of the die in a move or catch reroll window; null in any other choice. */
  pendingDie?: PendingDie | null;
  onChoose: (id: string) => void;
}) {
  const choices = legalActions.enabled.filter((action) => action.kind !== 'activate_ability');
  const abilities = [...legalActions.enabled, ...legalActions.disabled].some(
    (action) => action.kind === 'activate_ability',
  );
  return (
    <DecisionCard
      kind="choice"
      heading={phaseLabel(observation.public.phase.kind)}
      lead={t(pendingDie ? 'turn.rerollBody' : 'turn.choiceBody')}
      actions={
        <ul className="choice-list">
          {choices.map((action, index) => (
            <li key={action.id}>
              <ActionButton
                enabled
                variant={index === 0 ? 'primary' : 'secondary'}
                data-primary={index === 0 ? '' : undefined}
                onClick={() => onChoose(action.id)}
              >
                {choiceLabel(action, observation)}
              </ActionButton>
            </li>
          ))}
        </ul>
      }
    >
      {pendingDie && (
        <div className="reroll-die" data-die-kind={pendingDie.kind}>
          <DieFace value={pendingDie.die} />
          <p role="status">{dieSummary(pendingDie)}</p>
        </div>
      )}
      {abilities && (
        <AbilityPanel observation={observation} legalActions={legalActions} onChoose={onChoose} />
      )}
    </DecisionCard>
  );
}
