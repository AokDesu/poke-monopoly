import type { BallType, CatchOdds, LegalActions, Observation } from '../../../engine/index.ts';
import { HowToPlayButton } from '../howToPlay/HowToPlay.tsx';
import { t } from '../i18n/en.ts';
import { speciesName } from '../i18n/names.ts';
import { ActionButton } from '../ui/ActionButton.tsx';
import { BallIcon } from '../ui/icons.tsx';
import { SpeciesArt } from '../ui/SpeciesArt.tsx';
import { SpeciesFacts } from '../ui/SpeciesFacts.tsx';
import { AbilityPanel } from './AbilityPanel.tsx';
import { DecisionCard } from './DecisionCard.tsx';

const BALLS: readonly BallType[] = ['poke', 'great', 'ultra'];

export interface EncounterCardProps {
  observation: Observation;
  legalActions: LegalActions;
  catchOdds: readonly ({ ballType: BallType } & CatchOdds)[];
  onChoose: (id: string) => void;
  /** The Event card that opened this encounter, when it came from an Event square (§4.6). */
  eventText?: string;
}

/**
 * A wild encounter (spec §4.3) in the decision slot: the Pokémon (its model, or its type orb), its
 * facts, each held Ball with the engine's catch chance and how many are left, and Release. A catch
 * is a protected decision: focus moves into the card and stays until a legal choice is made.
 */
export function EncounterCard({
  observation,
  legalActions,
  catchOdds,
  onChoose,
  eventText,
}: EncounterCardProps) {
  const phase = observation.public.phase;
  if (phase.kind !== 'encounter') return null;
  const pokemon = speciesName(phase.pokemon.speciesId);
  const release = legalActions.enabled.find((choice) => choice.kind === 'release');
  const disabledCatch = legalActions.disabled.find((choice) => choice.kind === 'catch');
  const notHeld = BALLS.filter((ball) => !catchOdds.some((odds) => odds.ballType === ball)).map(
    (ball) => t(`board.ball.${ball}`),
  );
  return (
    <DecisionCard
      kind="encounter"
      protect
      art={<SpeciesArt speciesIds={[phase.pokemon.speciesId]} />}
      heading={t('encounter.heading', { pokemon })}
      lead={t(catchOdds.length === 0 ? 'encounter.noBall' : 'encounter.body')}
      actions={
        <>
          {catchOdds.map(({ ballType, percent }) => {
            const choice = legalActions.enabled.find(
              (entry) => entry.kind === 'catch' && entry.payload.ballType === ballType,
            );
            const disabled = legalActions.disabled.find(
              (entry) => entry.kind === 'catch' && entry.payload.ballType === ballType,
            );
            const availability = choice
              ? { enabled: true as const }
              : { enabled: false as const, reasonText: t(`action.reason.${disabled!.reasonCode}`) };
            const ball = t(`board.ball.${ballType}`);
            const left = observation.own.balls[ballType];
            return (
              <ActionButton
                key={ballType}
                {...availability}
                className={`ball-choice pouch-${ballType}`}
                aria-label={t('encounter.ballChoiceLeft', { ball, percent, count: left })}
                data-primary={choice && ballType === catchOdds[0]?.ballType ? '' : undefined}
                onClick={() => choice && onChoose(choice.id)}
              >
                <BallIcon className="size-6 shrink-0" />
                <span className="ball-choice-label">
                  {t('encounter.ballChoice', { ball, percent })}
                </span>
                <span className="ball-left">{t('encounter.ballsLeft', { count: left })}</span>
              </ActionButton>
            );
          })}
          {catchOdds.length === 0 && disabledCatch && (
            <ActionButton
              enabled={false}
              reasonText={t(`action.reason.${disabledCatch.reasonCode}`)}
            >
              {t('encounter.catch')}
            </ActionButton>
          )}
          {release && (
            <ActionButton enabled variant="secondary" onClick={() => onChoose(release.id)}>
              {t('encounter.release')}
            </ActionButton>
          )}
          {catchOdds.length > 0 && notHeld.length > 0 && (
            <p className="card-note">
              {notHeld.length === 1
                ? t('encounter.notHeldOne', { ball: notHeld[0]! })
                : t('encounter.notHeldTwo', { first: notHeld[0]!, second: notHeld[1]! })}
            </p>
          )}
          {/* A sole Release is applied by the game itself (spec §3.1): the card says so. */}
          {legalActions.enabled.length === 1 && (
            <p className="card-note" role="status">
              {t('turn.onlyLegalAction')}
            </p>
          )}
        </>
      }
    >
      {eventText && (
        <p className="encounter-source">{t('event.card.fromEncounter', { text: eventText })}</p>
      )}
      <section aria-label={t('encounter.facts')}>
        <SpeciesFacts speciesId={phase.pokemon.speciesId} showCatchDc />
      </section>
      <AbilityPanel
        key={observation.public.stateRevision}
        observation={observation}
        legalActions={legalActions}
        onChoose={onChoose}
      />
      <div className="card-help">
        <HowToPlayButton />
      </div>
    </DecisionCard>
  );
}
