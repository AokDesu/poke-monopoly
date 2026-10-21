import { useId } from 'react';
import { speciesType } from '../game/content.ts';
import type { ClassOption, SeatChoice } from '../game/setup.ts';
import { className, classPassive, itemName, speciesName } from '../i18n/names.ts';
import { t } from '../i18n/th.ts';
import { Button } from '../ui/Button.tsx';
import { ChoiceRadio } from '../ui/Choice.tsx';
import { DisabledReason } from '../ui/DisabledReason.tsx';
import { Screen } from '../ui/Screen.tsx';
import { SpeciesArt } from '../ui/SpeciesArt.tsx';
import { TypeOrb } from '../ui/TypeOrb.tsx';
import { SetupProgress } from './SetupProgress.tsx';

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
        <fieldset className="panel mt-8 p-5 sm:p-6">
          <legend className="sr-only">{t('class.chooseStarter')}</legend>
          <h2 aria-hidden="true" className="text-xl">
            {t('class.chooseStarter')}
          </h2>
          <div className="mt-4 flex flex-wrap gap-3">
            {chosenClass.starterSpeciesIds.map((speciesId) => {
              const checked = chosen?.starterSpeciesId === speciesId;
              return (
                <label
                  key={speciesId}
                  className={`flex cursor-pointer items-center gap-3 rounded-full py-2 ps-2 pe-5 font-display text-lg transition-[box-shadow,background-color] duration-150 has-[input:focus-visible]:outline-3 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-ink ${
                    checked
                      ? 'bg-reward shadow-[0_4px_0_var(--color-reward-lip)]'
                      : 'bg-panel-tint shadow-[inset_0_0_0_2px_var(--color-line)] hover:shadow-[inset_0_0_0_2px_var(--color-reward)]'
                  }`}
                >
                  <input
                    type="radio"
                    className="sr-only"
                    name="human-starter"
                    value={speciesId}
                    checked={checked}
                    onChange={() =>
                      onSelect({ classId: chosenClass.id, starterSpeciesId: speciesId })
                    }
                  />
                  <TypeOrb type={speciesType(speciesId)} className="size-10" />
                  {speciesName(speciesId)}
                </label>
              );
            })}
          </div>
        </fieldset>
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
