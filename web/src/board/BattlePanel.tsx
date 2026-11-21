import { useState } from 'react';
import type { LegalAction, LegalActions, Observation } from '../../../engine/index.ts';
import { currentForm } from '../game/content.ts';
import type { SeatView } from '../game/store.ts';
import { t } from '../i18n/en.ts';
import { memberName, speciesName } from '../i18n/names.ts';
import { ActionButton } from '../ui/ActionButton.tsx';
import { DieFace } from '../ui/DieFace.tsx';
import { BattleTerms, chancesText } from './BattleTerms.tsx';
import { battleCopy, forcedSource } from './battle.ts';
import { choiceLabel } from './ChoicePanel.tsx';
import { DecisionCard, Folded, foldLabel, useInView } from './DecisionCard.tsx';
import { seatLabel } from './labels.ts';

type Phase = Observation['public']['phase'];
type BattlePhase = Extract<Phase, { kind: 'pvp' | 'gym' }>;

/**
 * Every PvP and Gym decision this seat owns (§4.4, C.3) as one card: the terms that are not zero
 * and the chances (the full table under "All battle terms"), the dice in a reroll window, and the
 * engine's choices in its own order in the footer, always in view. Greyed-out choices fold into
 * one line that opens to the engine's reasons.
 */
export function BattlePanel({
  view,
  onChoose,
}: {
  view: SeatView;
  onChoose: (id: string) => void;
}) {
  const { phase } = view.observation.public;
  const copy = battleCopy(view);
  if ((phase.kind !== 'pvp' && phase.kind !== 'gym') || !copy) return null;
  const preview = view.battle;
  const step = phase.battle.step;
  const forced = phase.kind === 'pvp' && phase.battle.forced === true;
  return (
    <DecisionCard
      kind="battle"
      heading={copy.heading}
      lead={copy.body}
      actions={step === 'reward' ? undefined : <Options view={view} onChoose={onChoose} />}
    >
      <div className="battle-panel" data-battle-step={step}>
        {step === 'reroll' && <Dice view={view} phase={phase} />}
        {preview && step !== 'reward' && (
          <BattleTerms
            terms={preview}
            viewerSeat={view.seatIndex}
            frozen={preview.frozen}
            forced={forced ? forcedSource(view) : undefined}
          />
        )}
        {step === 'reward' ? (
          <RewardChooser view={view} phase={phase} onChoose={onChoose} />
        ) : (
          <Blocked view={view} />
        )}
      </div>
    </DecisionCard>
  );
}

/** The dice the engine revealed, before any outcome applies (Porygon's A window, D11). */
function Dice({ view, phase }: { view: SeatView; phase: BattlePhase }) {
  const you = view.seatIndex;
  const { battle } = phase;
  const faces: { seatIndex: number; face: number }[] = [];
  if (phase.kind === 'gym' && phase.battle.step === 'reroll') {
    faces.push({ seatIndex: view.observation.public.activeSeatIndex, face: phase.battle.face });
  } else if (battle.step === 'reroll' && 'attackerFace' in battle) {
    faces.push(
      { seatIndex: battle.attackerSeatIndex, face: battle.attackerFace },
      { seatIndex: battle.defenderSeatIndex, face: battle.defenderFace },
    );
  }
  if (faces.length === 0) return null;
  return (
    <ul className="battle-dice" aria-label={t('battle.dice')}>
      {faces.map(({ seatIndex, face }, order) => (
        <li key={seatIndex}>
          <DieFace value={face} order={order} />
          <span>{t('battle.dieOf', { name: seatLabel(seatIndex, you), face })}</span>
        </li>
      ))}
    </ul>
  );
}

/** What taking an option does, in the engine's own numbers; empty when it changes no term. */
function effectNote(view: SeatView, action: LegalAction): string | undefined {
  const option = view.battle?.choices.find((entry) => entry.id === action.id);
  return option
    ? t('battle.withThis', { chances: chancesText(option, view.seatIndex) })
    : undefined;
}

/** The engine's choices this window lists as disabled: a Gym challenge, Abilities (once each). */
function blockedOptions(view: SeatView) {
  const { legalActions } = view;
  const usable = legalActions.enabled.filter((action) => action.kind === 'activate_ability');
  // An Ability the engine lists as disabled says why (§3.1), once per Pokémon; one that is
  // usable in this window is not repeated.
  const abilities = legalActions.disabled
    .filter(
      (action): action is Extract<LegalActions['disabled'][number], { kind: 'activate_ability' }> =>
        action.kind === 'activate_ability',
    )
    .filter(
      (action, index, all) =>
        all.findIndex((entry) => entry.payload.instanceId === action.payload.instanceId) ===
          index &&
        !usable.some(
          (entry) =>
            entry.kind === 'activate_ability' &&
            entry.payload.instanceId === action.payload.instanceId,
        ),
    );
  return {
    gym: legalActions.disabled.filter((action) => action.kind === 'challenge_gym'),
    abilities,
  };
}

/** The greyed-out choices, folded into one line that opens to each with the engine's reason. */
function Blocked({ view }: { view: SeatView }) {
  const { observation } = view;
  const { gym, abilities } = blockedOptions(view);
  const count = gym.length + abilities.length;
  if (count === 0) return null;
  return (
    <Folded label={foldLabel(count, 'options')}>
      <ul className="battle-options">
        {gym.map((action) => (
          <li key={action.id}>
            <ActionButton
              enabled={false}
              reasonText={t('action.engineReason', { reason: action.reasonText })}
            >
              {choiceLabel(action, observation)}
            </ActionButton>
          </li>
        ))}
        {abilities.map((action) => (
          <li key={action.id} data-ability-blocked={action.payload.instanceId}>
            <ActionButton
              enabled={false}
              reasonText={t('action.engineReason', { reason: action.reasonText })}
            >
              {choiceLabel(
                { ...action, payload: { instanceId: action.payload.instanceId } },
                observation,
              )}
            </ActionButton>
          </li>
        ))}
      </ul>
    </Folded>
  );
}

/**
 * The engine's choices in the card's footer: response, windows, Gym entry, and reroll or keep.
 * Abilities first, then the plain choices in the engine's own order, each with what it changes.
 */
function Options({ view, onChoose }: { view: SeatView; onChoose: (id: string) => void }) {
  const { legalActions, observation } = view;
  const { phase } = observation.public;
  const notes: Record<string, string | undefined> = {
    'decline-pvp': t('battle.declineNote'),
    'challenge-gym': t('battle.challengeNote'),
    ...(phase.kind === 'gym' && phase.battle.step === 'entry' && { skip: t('battle.skipGymNote') }),
  };
  const enabled = [
    ...legalActions.enabled.filter((action) => action.kind === 'activate_ability'),
    ...legalActions.enabled.filter((action) => action.kind !== 'activate_ability'),
  ];
  const quiet = (action: LegalAction) => action.kind === 'skip' || action.id === 'decline-pvp';
  // Enter takes the first choice that moves the battle on; in a window or reroll that offers only
  // Abilities and a pass, it is the pass (keep the die, no Ability), never an Ability.
  const primary =
    enabled.find((action) => !quiet(action) && action.kind !== 'activate_ability') ??
    enabled.find(quiet);
  return (
    <ul className="battle-options">
      {enabled.map((action) => (
        <li key={action.id}>
          <ActionButton
            enabled
            // One red button per footer: the one Enter presses.
            variant={action === primary ? 'primary' : 'secondary'}
            data-primary={action === primary ? '' : undefined}
            onClick={() => onChoose(action.id)}
          >
            {choiceLabel(action, observation)}
          </ActionButton>
          {(effectNote(view, action) ?? notes[action.id]) && (
            <p className="battle-note">{effectNote(view, action) ?? notes[action.id]}</p>
          )}
        </li>
      ))}
    </ul>
  );
}

interface EvolveOption {
  action: Extract<LegalAction, { kind: 'choose_reward' }>;
  instanceId: string;
  nextFormId: string;
}

/**
 * The winner's one reward: coins, or one authored one-stage evolution of one Pokémon, never both
 * (§4.4, §4.5). Choosing only selects; nothing commits until Confirm. A selection from an older
 * list of choices is dropped, never submitted, and the player is told to review the new ones.
 */
function RewardChooser({
  view,
  phase,
  onChoose,
}: {
  view: SeatView;
  phase: BattlePhase;
  onChoose: (id: string) => void;
}) {
  const [picked, setPicked] = useState<{ actions: LegalActions; id: string }>();
  const { legalActions, observation } = view;
  const current = picked?.actions === legalActions ? picked.id : undefined;
  const preview = useInView<HTMLElement>(current);
  const rewards = legalActions.enabled.filter(
    (action): action is EvolveOption['action'] => action.kind === 'choose_reward',
  );
  const coins = rewards.find((action) => action.payload.kind === 'coins');
  const evolutions: EvolveOption[] = rewards.flatMap((action) =>
    action.payload.kind === 'evolve'
      ? [{ action, instanceId: action.payload.instanceId, nextFormId: action.payload.nextFormId }]
      : [],
  );
  const team = observation.public.players.find(
    (player) => player.seatIndex === view.seatIndex,
  )!.team;
  const loser =
    phase.battle.step === 'reward' && phase.battle.request.source.kind === 'pvp'
      ? phase.battle.request.source.loserId
      : undefined;
  const loserName = observation.public.players.find((player) => player.actorId === loser);
  const select = (action: LegalAction) => setPicked({ actions: legalActions, id: action.id });
  const chosen = rewards.find((action) => action.id === current);
  const chosenEvolve = evolutions.find((entry) => entry.action.id === current);
  const owner =
    chosenEvolve && team.find((member) => member.instanceId === chosenEvolve.instanceId);
  const pokemonLabel = (instanceId: string) => {
    return t('strategy.potion.member', { pokemon: memberName(team, instanceId) });
  };
  const groups = [...new Set(evolutions.map((entry) => entry.instanceId))];
  return (
    <div className="reward-chooser">
      {picked && !current && (
        <p role="alert" className="battle-stale">
          {t('battle.reward.stale')}
        </p>
      )}
      {coins && (
        <div className="reward-group" role="group" aria-label={t('battle.reward.coinsGroup')}>
          <h3>{t('battle.reward.coinsGroup')}</h3>
          <ActionButton
            enabled
            variant={current === coins.id ? 'reward' : 'secondary'}
            aria-pressed={current === coins.id}
            onClick={() => select(coins)}
          >
            {choiceLabel(coins, observation)}
          </ActionButton>
          <p className="battle-note">
            {loserName
              ? t('battle.reward.coinsFrom', {
                  name: seatLabel(loserName.seatIndex, view.seatIndex),
                })
              : t('battle.reward.coinsBank')}
          </p>
        </div>
      )}
      {groups.length > 0 && (
        <div className="reward-group" role="group" aria-label={t('battle.reward.evolveGroup')}>
          <h3>{t('battle.reward.evolveGroup')}</h3>
          {groups.map((instanceId) => {
            const member = team.find((entry) => entry.instanceId === instanceId);
            return (
              <div className="reward-pokemon" key={instanceId}>
                <p>
                  <strong>{pokemonLabel(instanceId)}</strong>
                  {member?.tired && <span className="pokemon-status">{t('board.tired')}</span>}
                  {member?.origin === 'rescue_starter' && (
                    <span className="pokemon-status">{t('board.rescue')}</span>
                  )}
                  {member && !member.abilityReady && (
                    <span className="pokemon-status">{t('battle.reward.abilityUsed')}</span>
                  )}
                </p>
                <div className="reward-branches">
                  {evolutions
                    .filter((entry) => entry.instanceId === instanceId)
                    .map(({ action, nextFormId }) => (
                      <ActionButton
                        key={action.id}
                        enabled
                        variant={current === action.id ? 'reward' : 'secondary'}
                        aria-pressed={current === action.id}
                        onClick={() => select(action)}
                      >
                        {t('battle.reward.branch', {
                          form: speciesName(nextFormId),
                          battle: currentForm(nextFormId).battle,
                        })}
                      </ActionButton>
                    ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {chosen ? (
        <section
          ref={preview}
          className="item-preview"
          aria-label={t('battle.reward.preview')}
          aria-live="polite"
        >
          <h3>{t('battle.reward.preview')}</h3>
          <p>
            {chosenEvolve && owner
              ? t('battle.reward.evolvePreview', {
                  pokemon: pokemonLabel(chosenEvolve.instanceId),
                  form: speciesName(chosenEvolve.nextFormId),
                  from: currentForm(owner.speciesId).battle,
                  to: currentForm(chosenEvolve.nextFormId).battle,
                })
              : t(loser ? 'battle.reward.coinsPreviewPvp' : 'battle.reward.coinsPreviewGym')}
          </p>
          <p className="panel-note">
            {t(chosenEvolve ? 'battle.reward.evolveKeeps' : 'battle.reward.notBoth')}
          </p>
          <ActionButton enabled data-primary="" onClick={() => onChoose(chosen.id)}>
            {t('battle.reward.confirm')}
          </ActionButton>
        </section>
      ) : (
        <p className="target-prompt" role="status">
          {t('battle.reward.choose')}
        </p>
      )}
    </div>
  );
}
