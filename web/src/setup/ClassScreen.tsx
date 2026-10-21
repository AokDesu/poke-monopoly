import { useId } from 'react';
import type { ClassOption, SeatChoice } from '../game/setup.ts';
import { className, classPassive, itemName, speciesName } from '../i18n/names.ts';
import { t } from '../i18n/en.ts';
import { Button } from '../ui/Button.tsx';
import { ChoiceRadio } from '../ui/Choice.tsx';
import { DisabledReason } from '../ui/DisabledReason.tsx';
import { Screen } from '../ui/Screen.tsx';
import { SpeciesArt } from '../ui/SpeciesArt.tsx';
import { SetupProgress } from './SetupProgress.tsx';
import { StarterPicker } from './StarterPicker.tsx';

interface ClassScreenProps {
  classes: readonly ClassOption[];
  chosen?: SeatChoice;
  onSelect: (choice: SeatChoice) => void;
  onNext: () => void;
  onBack: () => void;
}

/**
 * The human's class (spec §3, §4.1). Playable classes come from content, so the Main Character
 * and later classes appear as soon as the engine implements them. The class card is the choice;
 * a class with several Starters adds a Starter picker, preset to the first.
 */
export function ClassScreen({ classes, chosen, onSelect, onNext, onBack }: ClassScreenProps) {
  const reasonId = useId();
  const playable = classes.filter((option) => option.playable);
  const closed = classes.filter((option) => !option.playable);
  const chosenClass = playable.find((option) => option.id === chosen?.classId);

  const describe = (option: ClassOption) => (
    <span className="mt-1 grid gap-1.5">
      <span>
        <span className="block text-sm font-bold text-ink-soft">{t('class.passive')}</span>
        <span className="block text-pretty text-ink">{classPassive(option.id)}</span>
      </span>
      <span>
        <span className="block text-sm font-bold text-ink-soft">{t('class.starter')}</span>
        <span className="block text-ink">
          {option.starterSpeciesIds.map((id) => speciesName(id)).join(' · ')}
        </span>
      </span>
      <span>
        <span className="block text-sm font-bold text-ink-soft">{t('class.item')}</span>
        <span className="block text-ink">{itemName(option.classItemId)}</span>
      </span>
    </span>
  );

  return (
    <Screen
      before={<SetupProgress step="class" />}
      heading={t('class.heading')}
      body={t('class.body')}
      actions={
        <>
          <Button variant="secondary" onClick={onBack}>
            {t('nav.back')}
          </Button>
          <Button
            variant="primary"
            className="ms-auto"
            disabled={!chosenClass}
            aria-describedby={chosenClass ? undefined : reasonId}
            onClick={onNext}
          >
            {t('nav.next')}
          </Button>
          {!chosenClass && (
            <span className="basis-full text-end">
              <DisabledReason id={reasonId}>{t('class.chooseFirst')}</DisabledReason>
            </span>
          )}
        </>
      }
    >
      <fieldset>
        <legend className="sr-only">{t('class.heading')}</legend>
        <ul className="grid gap-6 lg:grid-cols-2">
          {playable.map((option) => (
            <li key={option.id}>
              <ChoiceRadio
                name="human-class"
                value={option.id}
                checked={chosenClass?.id === option.id}
                art={
                  <SpeciesArt
                    speciesIds={option.starterSpeciesIds}
                    spin={chosenClass?.id === option.id}
                  />
                }
                title={className(option.id)}
                description={describe(option)}
                onSelect={() =>
                  onSelect({
                    classId: option.id,
                    starterSpeciesId: option.starterSpeciesIds[0]!,
                  })
                }
              />
            </li>
          ))}
        </ul>
      </fieldset>

      {chosenClass && chosenClass.starterSpeciesIds.length > 1 && (
        <StarterPicker
          name="human-starter"
          legend={t('class.chooseStarter')}
          speciesIds={chosenClass.starterSpeciesIds}
          chosen={chosen!.starterSpeciesId}
          onChoose={(speciesId) =>
            onSelect({ classId: chosenClass.id, starterSpeciesId: speciesId })
          }
        />
      )}

      {closed.length > 0 && (
        <>
          <h2 className="mt-12 text-xl">{t('class.closedHeading')}</h2>
          <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {closed.map((option) => (
              <li key={option.id}>
                <ChoiceRadio
                  name="human-class"
                  value={option.id}
                  checked={false}
                  title={className(option.id)}
                  disabledReason={t('class.comingLater')}
                  onSelect={() => {}}
                />
              </li>
            ))}
          </ul>
        </>
      )}
    </Screen>
  );
}
