import { useEffect, useId, useRef } from 'react';
import type { BallType, CatchOdds, LegalActions, Observation } from '../../../engine/index.ts';
import { HowToPlayButton } from '../howToPlay/HowToPlay.tsx';
import { t } from '../i18n/en.ts';
import { speciesName } from '../i18n/names.ts';
import { ActionButton } from '../ui/ActionButton.tsx';
import { BallIcon } from '../ui/icons.tsx';
import { SpeciesFacts } from '../ui/SpeciesFacts.tsx';
import { AbilityPanel } from './AbilityPanel.tsx';

export interface EncounterDialogProps {
  observation: Observation;
  legalActions: LegalActions;
  catchOdds: readonly ({ ballType: BallType } & CatchOdds)[];
  onChoose: (id: string) => void;
  /** The Event card that opened this encounter, when it came from an Event square (§4.6). */
  eventText?: string;
  /** Dev gallery only: show the same dialog in the page flow instead of as a modal. */
  inline?: boolean;
}

/** A catch is a protected decision: native modal focus stays here until a legal choice is made. */
export function EncounterDialog({
  observation,
  legalActions,
  catchOdds,
  onChoose,
  eventText,
  inline = false,
}: EncounterDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  const bodyId = useId();
  useEffect(() => {
    if (inline) return;
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, [inline]);
  const phase = observation.public.phase;
  if (phase.kind !== 'encounter') return null;
  const pokemon = speciesName(phase.pokemon.speciesId);
  const release = legalActions.enabled.find((choice) => choice.kind === 'release');
  const disabledCatch = legalActions.disabled.find((choice) => choice.kind === 'catch');
  return (
    <dialog
      ref={dialog}
      open={inline || undefined}
      className="encounter-dialog panel"
      aria-labelledby={headingId}
      aria-describedby={bodyId}
      onCancel={(event) => event.preventDefault()}
    >
      <div className="encounter-emblem" aria-hidden="true">
        <BallIcon className="size-12" />
      </div>
      <h2 id={headingId}>{t('encounter.heading', { pokemon })}</h2>
      {eventText && (
        <p className="encounter-source">{t('event.card.fromEncounter', { text: eventText })}</p>
      )}
      <p id={bodyId}>{t(catchOdds.length === 0 ? 'encounter.noBall' : 'encounter.body')}</p>
      <section aria-label={t('encounter.facts')}>
        <SpeciesFacts speciesId={phase.pokemon.speciesId} showCatchDc />
      </section>
      <AbilityPanel
        key={observation.public.stateRevision}
        observation={observation}
        legalActions={legalActions}
        onChoose={onChoose}
      />
      <div className="encounter-choices">
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
          return (
            <ActionButton
              key={ballType}
              {...availability}
              onClick={() => choice && onChoose(choice.id)}
            >
              {t('encounter.ballChoice', { ball: t(`board.ball.${ballType}`), percent })}
            </ActionButton>
          );
        })}
        {catchOdds.length === 0 && disabledCatch && (
          <ActionButton enabled={false} reasonText={t(`action.reason.${disabledCatch.reasonCode}`)}>
            {t('encounter.catch')}
          </ActionButton>
        )}
        {release && (
          <ActionButton enabled variant="secondary" onClick={() => onChoose(release.id)}>
            {t('encounter.release')}
          </ActionButton>
        )}
      </div>
      <div className="encounter-help">
        <HowToPlayButton />
      </div>
    </dialog>
  );
}
