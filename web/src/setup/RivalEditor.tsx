import { personalityDescriptions } from '../game/content.ts';
import {
  DIFFICULTIES,
  PERSONALITIES,
  type ClassOption,
  type OpponentChoice,
} from '../game/setup.ts';
import { t } from '../i18n/en.ts';
import { className, classPassive } from '../i18n/names.ts';
import { ChoiceRadio } from '../ui/Choice.tsx';
import { SpeciesArt } from '../ui/SpeciesArt.tsx';
import { StarterFacts } from './StarterFacts.tsx';
import { StarterPicker } from './StarterPicker.tsx';

export function Section({
  title,
  small = false,
  children,
}: {
  title: string;
  small?: boolean;
  children: React.ReactNode;
}) {
  return (
    <fieldset className="mt-10 first:mt-0">
      <legend className={`font-display font-semibold ${small ? 'text-xl' : 'text-2xl'}`}>
        {title}
      </legend>
      <div className="mt-4">{children}</div>
    </fieldset>
  );
}

interface RivalEditorProps {
  /** Prefix of the radio groups' names, one per AI being edited. */
  name: string;
  rival: OpponentChoice;
  classes: readonly ClassOption[];
  /** Who holds a class, as a label, or undefined when it is free: a held class is greyed with the reason. */
  holderOf: (classId: string) => string | undefined;
  classTitle: string;
  starterTitle: string;
  onChange: (patch: Partial<OpponentChoice>) => void;
}

/**
 * One AI's class, Starter, personality and difficulty (spec §3, §5.5). Used by the AI step of a game
 * against AIs, the watch path and the people path's "Change"; a choice changes only this AI.
 */
export function RivalEditor({
  name,
  rival,
  classes,
  holderOf,
  classTitle,
  starterTitle,
  onChange,
}: RivalEditorProps) {
  const playable = classes.filter((option) => option.playable);
  const rivalClass = playable.find((option) => option.id === rival.classId);
  return (
    <div className="mt-6">
      <Section title={classTitle} small>
        <ul className="grid gap-6 lg:grid-cols-2">
          {playable.map((option) => {
            const holder = holderOf(option.id);
            return (
              <li key={option.id}>
                <ChoiceRadio
                  name={`${name}-class`}
                  value={option.id}
                  checked={rival.classId === option.id}
                  art={
                    <SpeciesArt
                      speciesIds={option.starterSpeciesIds}
                      spin={rival.classId === option.id}
                    />
                  }
                  title={className(option.id)}
                  description={classPassive(option.id)}
                  disabledReason={
                    holder === undefined ? undefined : t('opponents.classTaken', { holder })
                  }
                  onSelect={() =>
                    onChange({
                      classId: option.id,
                      starterSpeciesId: option.starterSpeciesIds[0]!,
                    })
                  }
                />
              </li>
            );
          })}
        </ul>
        {rivalClass && rivalClass.starterSpeciesIds.length > 1 && (
          <StarterPicker
            name={`${name}-starter`}
            legend={starterTitle}
            speciesIds={rivalClass.starterSpeciesIds}
            chosen={rival.starterSpeciesId}
            onChoose={(starterSpeciesId) => onChange({ starterSpeciesId })}
          />
        )}
        {rivalClass && <StarterFacts speciesId={rival.starterSpeciesId} rival />}
      </Section>

      <Section title={t('opponents.personality')} small>
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {PERSONALITIES.map((entry) => (
            <li key={entry.id}>
              <ChoiceRadio
                name={`${name}-personality`}
                value={entry.id}
                checked={rival.personality === entry.id}
                title={t(`personality.${entry.id}`)}
                description={personalityDescriptions[entry.id]}
                disabledReason={entry.enabled ? undefined : t('opponents.personalityClosed')}
                onSelect={() => onChange({ personality: entry.id })}
              />
            </li>
          ))}
        </ul>
      </Section>

      <Section title={t('opponents.difficulty')} small>
        <p className="-mt-2 mb-4 text-ink-soft">{t('opponents.difficultyHint')}</p>
        <ul className="grid gap-4 sm:grid-cols-2">
          {DIFFICULTIES.map((difficulty) => (
            <li key={difficulty}>
              <ChoiceRadio
                name={`${name}-difficulty`}
                value={difficulty}
                checked={rival.difficulty === difficulty}
                title={t(`difficulty.${difficulty}`)}
                description={t(`difficulty.${difficulty}Hint`)}
                onSelect={() => onChange({ difficulty })}
              />
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
