import { useId } from 'react';
import {
  DIFFICULTIES,
  PERSONALITIES,
  type ClassOption,
  type OpponentChoice,
  type SeatChoice,
} from '../game/setup.ts';
import { className, classPassive } from '../i18n/names.ts';
import { t } from '../i18n/en.ts';
import { Button } from '../ui/Button.tsx';
import { ChoiceRadio } from '../ui/Choice.tsx';
import { DisabledReason } from '../ui/DisabledReason.tsx';
import { Screen } from '../ui/Screen.tsx';
import { SpeciesArt } from '../ui/SpeciesArt.tsx';
import { SetupProgress } from './SetupProgress.tsx';
import { StarterPicker } from './StarterPicker.tsx';

interface OpponentScreenProps {
  classes: readonly ClassOption[];
  human: SeatChoice;
  /** Undefined only when no playable class is left for the opponent. */
  opponent?: OpponentChoice;
  onChange: (opponent: OpponentChoice) => void;
  onNext: () => void;
  onBack: () => void;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="mt-10 first:mt-0">
      <legend className="font-display text-2xl font-semibold">{title}</legend>
      <div className="mt-4">{children}</div>
    </fieldset>
  );
}

/**
 * One AI opponent this cycle (issue #36): its class, personality and difficulty (spec §1, §3).
 * Classes are unique in a game, so the human's class is greyed with the reason; class and
 * personality are independent.
 */
export function OpponentScreen({
  classes,
  human,
  opponent,
  onChange,
  onNext,
  onBack,
}: OpponentScreenProps) {
  const reasonId = useId();
  const playable = classes.filter((option) => option.playable);
  const opponentClass = playable.find((option) => option.id === opponent?.classId);

  return (
    <Screen
      before={<SetupProgress step="opponents" />}
      heading={t('opponents.heading')}
      body={t('opponents.body')}
      actions={
        <>
          <Button variant="secondary" onClick={onBack}>
            {t('nav.back')}
          </Button>
          <Button
            variant="primary"
            className="ms-auto"
            disabled={!opponent}
            aria-describedby={opponent ? undefined : reasonId}
            onClick={onNext}
          >
            {t('opponents.next')}
          </Button>
          {!opponent && (
            <span className="basis-full text-end">
              <DisabledReason id={reasonId}>{t('opponents.noFreeClass')}</DisabledReason>
            </span>
          )}
        </>
      }
    >
      <Section title={t('opponents.class')}>
        <ul className="grid gap-6 lg:grid-cols-2">
          {playable.map((option) => (
            <li key={option.id}>
              <ChoiceRadio
                name="opponent-class"
                value={option.id}
                checked={opponent?.classId === option.id}
                art={
                  <SpeciesArt
                    speciesIds={option.starterSpeciesIds}
                    spin={opponent?.classId === option.id}
                  />
                }
                title={className(option.id)}
                description={classPassive(option.id)}
                disabledReason={option.id === human.classId ? t('opponents.classTaken') : undefined}
                onSelect={() =>
                  opponent &&
                  onChange({
                    ...opponent,
                    classId: option.id,
                    starterSpeciesId: option.starterSpeciesIds[0]!,
                  })
                }
              />
            </li>
          ))}
        </ul>
        {opponent && opponentClass && opponentClass.starterSpeciesIds.length > 1 && (
          <StarterPicker
            name="opponent-starter"
            legend={t('opponents.starter')}
            speciesIds={opponentClass.starterSpeciesIds}
            chosen={opponent.starterSpeciesId}
            onChoose={(starterSpeciesId) => onChange({ ...opponent, starterSpeciesId })}
          />
        )}
      </Section>

      <Section title={t('opponents.personality')}>
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {PERSONALITIES.map((entry) => (
            <li key={entry.id}>
              <ChoiceRadio
                name="opponent-personality"
                value={entry.id}
                checked={opponent?.personality === entry.id}
                title={t(`personality.${entry.id}`)}
                disabledReason={entry.enabled ? undefined : t('opponents.personalityClosed')}
                onSelect={() => opponent && onChange({ ...opponent, personality: entry.id })}
              />
            </li>
          ))}
        </ul>
      </Section>

      <Section title={t('opponents.difficulty')}>
        <p className="-mt-2 mb-4 text-ink-soft">{t('opponents.difficultyHint')}</p>
        <ul className="grid gap-4 sm:grid-cols-2">
          {DIFFICULTIES.map((difficulty) => (
            <li key={difficulty}>
              <ChoiceRadio
                name="opponent-difficulty"
                value={difficulty}
                checked={opponent?.difficulty === difficulty}
                title={t(`difficulty.${difficulty}`)}
                description={t(`difficulty.${difficulty}Hint`)}
                onSelect={() => opponent && onChange({ ...opponent, difficulty })}
              />
            </li>
          ))}
        </ul>
      </Section>
    </Screen>
  );
}
